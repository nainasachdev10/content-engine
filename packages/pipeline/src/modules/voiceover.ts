/**
 * Stage — Voiceover (ElevenLabs with-timestamps, one call per scene)
 * Writes <videoDir>/voiceover.mp3 + timestamps.json (word-level, drift-corrected
 * by ffprobing each chunk's real duration — alignment end-times undercount trailing silence).
 *
 * Per-scene chunks are cached in <videoDir>/audio-chunks/ keyed by a hash of
 * (narration, voice, model): re-running after a script edit only re-bills the
 * scenes whose narration actually changed.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Project } from "../lib/project.js";
import { secrets, requireSecrets } from "../lib/env.js";
import { mediaDuration } from "../lib/media.js";

interface WordTiming {
  word: string;
  start: number; // seconds, global across the whole voiceover
  end: number;
  scene: number;
}

interface ChunkMeta {
  hash: string;
  duration: number;
  words: { word: string; start: number; end: number }[]; // scene-relative times
}

async function ttsScene(
  text: string,
  voiceId: string,
  modelId: string,
  voiceSettings?: Record<string, number>
): Promise<{ audio: Buffer; words: { word: string; start: number; end: number }[] }> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`, {
    method: "POST",
    headers: { "xi-api-key": secrets.elevenLabsApiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      model_id: modelId,
      output_format: "mp3_44100_128",
      ...(voiceSettings ? { voice_settings: voiceSettings } : {}),
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    audio_base64: string;
    alignment: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] };
  };

  // Collapse character-level alignment into word-level timings.
  const words: { word: string; start: number; end: number }[] = [];
  let current = "";
  let start = 0;
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = data.alignment;
  for (let i = 0; i < characters.length; i++) {
    const ch = characters[i];
    if (/\s/.test(ch)) {
      if (current) words.push({ word: current, start, end: ends[i - 1] });
      current = "";
    } else {
      if (!current) start = starts[i];
      current += ch;
    }
  }
  if (current) words.push({ word: current, start, end: ends[characters.length - 1] });

  return { audio: Buffer.from(data.audio_base64, "base64"), words };
}

export async function runVoiceover(project: Project, opts: { dir: string }): Promise<void> {
  requireSecrets("elevenLabsApiKey");
  const { voiceId, modelId, settings } = project.config.voice;
  // Settings join the cache key only when set, so pre-settings chunk caches stay valid.
  const settingsKey = settings ? `|${JSON.stringify(settings)}` : "";
  const script: { scenes: { narration: string }[] } = JSON.parse(
    readFileSync(join(opts.dir, "script.json"), "utf8")
  );

  const chunksDir = join(opts.dir, "audio-chunks");
  mkdirSync(chunksDir, { recursive: true });
  const metaPath = join(chunksDir, "meta.json");
  const oldMeta: Record<string, ChunkMeta> = existsSync(metaPath)
    ? JSON.parse(readFileSync(metaPath, "utf8"))
    : {};
  const newMeta: Record<string, ChunkMeta> = {};

  const audioChunks: Buffer[] = [];
  const allWords: WordTiming[] = [];
  const sceneStarts: number[] = [];
  let offset = 0;
  let reused = 0;

  for (let i = 0; i < script.scenes.length; i++) {
    const narration = script.scenes[i].narration;
    const hash = createHash("sha1").update(`${voiceId}|${modelId}${settingsKey}|${narration}`).digest("hex").slice(0, 16);
    const chunkPath = join(chunksDir, `scene-${i + 1}.mp3`);

    let chunk: ChunkMeta;
    let audio: Buffer;
    if (oldMeta[String(i)]?.hash === hash && existsSync(chunkPath)) {
      chunk = oldMeta[String(i)];
      audio = readFileSync(chunkPath);
      reused++;
      console.log(`Scene ${i + 1}/${script.scenes.length}... reused (${chunk.duration.toFixed(1)}s)`);
    } else {
      process.stdout.write(`Scene ${i + 1}/${script.scenes.length}... `);
      const res = await ttsScene(narration, voiceId, modelId, settings);
      audio = res.audio;
      writeFileSync(chunkPath, audio);
      // Real chunk length (not last word end) so caption/scene timing never drifts.
      chunk = { hash, duration: mediaDuration(chunkPath), words: res.words };
      console.log(`${chunk.duration.toFixed(1)}s`);
    }
    newMeta[String(i)] = chunk;

    sceneStarts.push(offset);
    for (const w of chunk.words) allWords.push({ ...w, start: w.start + offset, end: w.end + offset, scene: i });
    offset += chunk.duration;
    audioChunks.push(audio);
  }

  writeFileSync(metaPath, JSON.stringify(newMeta, null, 2));
  // Concatenating MP3 buffers directly is valid for same-codec MPEG frames.
  writeFileSync(join(opts.dir, "voiceover.mp3"), Buffer.concat(audioChunks));
  writeFileSync(
    join(opts.dir, "timestamps.json"),
    JSON.stringify({ totalDuration: offset, sceneStarts, words: allWords }, null, 2)
  );
  console.log(
    `Saved voiceover.mp3 (${(offset / 60).toFixed(1)} min, ${reused}/${script.scenes.length} scenes reused) + timestamps.json (${allWords.length} words)`
  );
}
