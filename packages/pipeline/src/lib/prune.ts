/**
 * Disk hygiene for a finished video. Hosted volumes are small (Railway Hobby: 5 GB),
 * and a single video leaves ~150-400 MB behind; this keeps the review copy and the
 * script and drops everything only the pipeline needed.
 *
 * Kept: final_video.mp4 (re-encoded to a lean ~8 Mbps copy after publishing), script.json,
 *       metadata.json, validation.json, thumbnail.png, captions.srt, timestamps.json.
 * Removed: raw_video.mp4, video_nomusic.mp4, hf/ workspace, versions/, audio-chunks/,
 *          scene clips/last-frames (stills stay so edits can regenerate cheaply).
 */
import { existsSync, rmSync, renameSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { secrets } from "./env.js";

export function pruneVideoDir(dir: string, opts: { shrinkFinal?: boolean } = {}): { freedMb: number } {
  if (!existsSync(dir)) return { freedMb: 0 };
  const before = dirSize(dir);
  for (const f of ["raw_video.mp4", "video_nomusic.mp4", "final_video_premusic_backup.mp4", "final_video_hf.mp4", "final_video_hf_preview.mp4"]) {
    rmSync(join(dir, f), { force: true });
  }
  for (const d of ["hf", "versions", "audio-chunks"]) rmSync(join(dir, d), { recursive: true, force: true });
  const images = join(dir, "images");
  if (existsSync(images)) {
    for (const f of readdirSync(images)) if (/\.(mp4)$|-lastframe\.png$/.test(f)) rmSync(join(images, f), { force: true });
  }
  if (opts.shrinkFinal) shrinkFinal(join(dir, "final_video.mp4"));
  return { freedMb: Math.max(0, Math.round((before - dirSize(dir)) / 1e6)) };
}

/** Re-encode the archive copy at ~8 Mbps (YouTube already has the full-quality upload). */
function shrinkFinal(path: string): void {
  if (!existsSync(path) || statSync(path).size < 40e6) return;
  const tmp = path + ".small.mp4";
  try {
    execFileSync(secrets.ffmpegPath, ["-y", "-loglevel", "error", "-i", path, "-c:v", "libx264", "-preset", "medium", "-crf", "23", "-maxrate", "8M", "-bufsize", "16M", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", tmp]);
    renameSync(tmp, path);
  } catch {
    rmSync(tmp, { force: true });
  }
}

function dirSize(dir: string): number {
  let total = 0;
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else total += statSync(p).size;
    }
  };
  walk(dir);
  return total;
}
