/**
 * Module 3 — Voiceover
 * Input:  output/<slug>/script.json
 * Output: output/<slug>/voiceover.mp3 + output/<slug>/timestamps.json (word-level)
 *
 * Uses ElevenLabs text-to-speech with-timestamps endpoint, one call per scene,
 * concatenating audio and offsetting timestamps so each scene's start time is known.
 *
 * Usage:  npm run voiceover -- --dir output/<slug>
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { config, requireKeys } from "./lib/config.js";
import { arg } from "./lib/util.js";

/** Real duration of an MP3 buffer via ffprobe — alignment end-times undercount
 *  trailing silence, which makes caption offsets drift scene by scene. */
function audioDuration(buf: Buffer, tmpDir: string): number {
  const p = join(tmpDir, "chunk.mp3");
  writeFileSync(p, buf);
  const ffprobe = config.ffmpegPath.replace(/ffmpeg([^/\\]*)$/, "ffprobe$1");
  const out = execFileSync(ffprobe, [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    p,
  ]);
  return Number(out.toString().trim());
}

interface Scene {
  narration: string;
  visual_description: string;
}

interface WordTiming {
  word: string;
  start: number; // seconds, global across the whole voiceover
  end: number;
  scene: number;
}

async function ttsScene(text: string): Promise<{ audio: Buffer; words: { word: string; start: number; end: number }[] }> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${config.elevenLabsVoiceId}/with-timestamps`,
    {
      method: "POST",
      headers: {
        "xi-api-key": config.elevenLabsApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        output_format: "mp3_44100_128",
      }),
    }
  );
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

async function main() {
  requireKeys("elevenLabsApiKey", "elevenLabsVoiceId");
  const dir = arg("dir");
  if (!dir) {
    console.error("Usage: npm run voiceover -- --dir output/<slug>");
    process.exit(1);
  }

  const script: { scenes: Scene[] } = JSON.parse(readFileSync(join(dir, "script.json"), "utf8"));

  const audioChunks: Buffer[] = [];
  const allWords: WordTiming[] = [];
  const sceneStarts: number[] = [];
  let offset = 0;
  const tmpDir = mkdtempSync(join(tmpdir(), "voiceover-"));

  for (let i = 0; i < script.scenes.length; i++) {
    process.stdout.write(`Scene ${i + 1}/${script.scenes.length}... `);
    const { audio, words } = await ttsScene(script.scenes[i].narration);
    sceneStarts.push(offset);
    for (const w of words) allWords.push({ ...w, start: w.start + offset, end: w.end + offset, scene: i });
    // Offset by the chunk's real audio length so caption/scene timing never drifts.
    const sceneDuration = audioDuration(audio, tmpDir);
    offset += sceneDuration;
    audioChunks.push(audio);
    console.log(`${sceneDuration.toFixed(1)}s`);
  }
  rmSync(tmpDir, { recursive: true, force: true });

  // Note: concatenating MP3 buffers directly is valid for same-codec MPEG frames.
  const mp3Path = join(dir, "voiceover.mp3");
  writeFileSync(mp3Path, Buffer.concat(audioChunks));

  const tsPath = join(dir, "timestamps.json");
  writeFileSync(
    tsPath,
    JSON.stringify({ totalDuration: offset, sceneStarts, words: allWords }, null, 2)
  );

  console.log(`\nSaved ${mp3Path} (${(offset / 60).toFixed(1)} min) and ${tsPath} (${allWords.length} words)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
