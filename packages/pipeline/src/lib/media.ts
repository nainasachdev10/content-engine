/** ffprobe helpers shared by voiceover and both renderers. */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ffprobePath } from "./env.js";

export function mediaDuration(path: string): number {
  const out = execFileSync(ffprobePath(), [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    path,
  ]);
  return Number(out.toString().trim());
}

/** Real duration of an in-memory audio buffer (written to a temp file for ffprobe). */
export function bufferDuration(buf: Buffer, tmpDir: string): number {
  const p = join(tmpDir, "chunk.mp3");
  writeFileSync(p, buf);
  return mediaDuration(p);
}
