/**
 * Background music bed.
 *
 * A ~30s instrumental is generated once per project (Replicate meta/musicgen,
 * cached in projects/<slug>/assets/music/ keyed by prompt hash — every video of
 * the project reuses it, which doubles as channel sound-identity). At mix time
 * the bed is looped to video length, faded in/out, and sidechain-ducked under
 * the voiceover so narration always stays on top.
 *
 * Idempotency: the first mix renames final_video.mp4 → video_nomusic.mp4 and
 * always mixes from that clean source; renderers delete video_nomusic.mp4 when
 * they produce a fresh final_video.mp4.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import type { Project } from "./project.js";
import { secrets, requireSecrets } from "./env.js";
import { mediaDuration } from "./media.js";

const MUSIC_MODEL = "meta/musicgen";

async function generateMusic(prompt: string): Promise<Buffer> {
  requireSecrets("imageApiKey");
  const auth = { Authorization: `Bearer ${secrets.imageApiKey}` };

  // musicgen is version-addressed, not an official model — resolve latest version first.
  const modelRes = await fetch(`https://api.replicate.com/v1/models/${MUSIC_MODEL}`, { headers: auth });
  if (!modelRes.ok) throw new Error(`Replicate model lookup ${modelRes.status}: ${await modelRes.text()}`);
  const version = ((await modelRes.json()) as any).latest_version.id;

  const createRes = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      version,
      input: {
        prompt,
        duration: 30,
        model_version: "stereo-large",
        output_format: "mp3",
        normalization_strategy: "peak",
      },
    }),
  });
  if (!createRes.ok) throw new Error(`Replicate ${createRes.status}: ${await createRes.text()}`);
  let prediction = (await createRes.json()) as any;

  const start = Date.now();
  while (!["succeeded", "failed", "canceled"].includes(prediction.status)) {
    if (Date.now() - start > 10 * 60 * 1000) throw new Error("Music generation timed out after 10 minutes");
    await new Promise((r) => setTimeout(r, 5000));
    const poll = await fetch(prediction.urls.get, { headers: auth });
    prediction = await poll.json();
    process.stdout.write(".");
  }
  if (prediction.status !== "succeeded" || !prediction.output) {
    throw new Error(`Music prediction failed: ${prediction.error ?? prediction.status}`);
  }
  const url = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  const audio = await fetch(url);
  return Buffer.from(await audio.arrayBuffer());
}

/** Returns the cached project music bed, generating it on first use. Null if music is disabled. */
export async function ensureMusicTrack(project: Project): Promise<string | null> {
  const mc = project.config.music;
  if (!mc?.enabled || !mc.prompt) return null;
  const hash = createHash("sha1").update(mc.prompt).digest("hex").slice(0, 12);
  const dir = join(project.dir, "assets", "music");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `bed-${hash}.mp3`);
  if (existsSync(path)) return path;

  process.stdout.write(`Generating project music bed (musicgen, ~1-3 min)`);
  const buf = await generateMusic(mc.prompt);
  writeFileSync(path, buf);
  console.log(` done → ${path}`);
  return path;
}

/** Stage entrypoint: mix the project bed under final_video.mp4's audio. No-op when disabled. */
export async function runMusic(project: Project, opts: { dir: string }): Promise<void> {
  const track = await ensureMusicTrack(project);
  if (!track) {
    console.log("Music disabled for this project — skipping.");
    return;
  }
  const { dir } = opts;
  const finalPath = join(dir, "final_video.mp4");
  const sourcePath = join(dir, "video_nomusic.mp4");
  if (!existsSync(sourcePath)) {
    if (!existsSync(finalPath)) throw new Error(`No final_video.mp4 in ${dir} — render first`);
    renameSync(finalPath, sourcePath); // keep a clean pre-music source so re-mixes never stack
  }

  const dur = mediaDuration(sourcePath);
  const gainDb = project.config.music?.gainDb ?? -21;
  const fadeOutStart = Math.max(0, dur - 3);

  // Music: loop → level → fades. Duck: compress music using the video's own
  // narration as the sidechain key, then mix (normalize=0 keeps voice level intact).
  const filter =
    `[1:a]volume=${gainDb}dB,afade=t=in:st=0:d=1.5,afade=t=out:st=${fadeOutStart.toFixed(2)}:d=3[m];` +
    `[m][0:a]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=600[duck];` +
    `[0:a][duck]amix=inputs=2:duration=first:normalize=0[aout]`;

  execFileSync(
    secrets.ffmpegPath,
    [
      "-y",
      "-i", sourcePath,
      "-stream_loop", "-1", "-i", track,
      "-filter_complex", filter,
      "-map", "0:v", "-map", "[aout]",
      "-c:v", "copy",
      "-c:a", "aac", "-b:a", "192k",
      "-t", dur.toFixed(3),
      finalPath,
    ],
    { stdio: ["ignore", "ignore", "inherit"] }
  );
  console.log(`Mixed music bed (${gainDb} dB, ducked under narration) → ${finalPath}`);
}
