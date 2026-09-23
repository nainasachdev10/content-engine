/**
 * Stage — Captions
 * Always writes <videoDir>/captions.srt (uploadable to YouTube as closed captions).
 * With burn: true (ffmpeg renderer path) also burns them into final_video.mp4.
 * The HyperFrames renderer bakes karaoke captions itself, so it uses burn: false.
 */
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import type { Project } from "../lib/project.js";
import { secrets } from "../lib/env.js";

interface Word {
  word: string;
  start: number;
  end: number;
}

function srtTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.round((s % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function buildSrt(words: Word[]): string {
  const lines: { start: number; end: number; text: string }[] = [];
  let group: Word[] = [];
  for (const w of words) {
    group.push(w);
    const text = group.map((g) => g.word).join(" ");
    if (group.length >= 6 || text.length >= 42 || /[.!?]$/.test(w.word)) {
      lines.push({ start: group[0].start, end: w.end, text });
      group = [];
    }
  }
  if (group.length) {
    lines.push({ start: group[0].start, end: group[group.length - 1].end, text: group.map((g) => g.word).join(" ") });
  }
  return lines
    .map((l, i) => `${i + 1}\n${srtTime(l.start)} --> ${srtTime(l.end)}\n${l.text}\n`)
    .join("\n");
}

export async function runCaptions(_project: Project, opts: { dir: string; burn: boolean }): Promise<void> {
  const { dir } = opts;
  const ts: { words: Word[] } = JSON.parse(readFileSync(join(dir, "timestamps.json"), "utf8"));
  const srtPath = join(dir, "captions.srt");
  writeFileSync(srtPath, buildSrt(ts.words));
  console.log(`Saved ${srtPath}`);

  if (!opts.burn) return;

  const outPath = join(dir, "final_video.mp4");
  // subtitles filter path needs escaping for ffmpeg filter syntax
  const escaped = resolve(srtPath).replace(/([:'\\])/g, "\\$1");
  execFileSync(
    secrets.ffmpegPath,
    [
      "-y",
      "-i", join(dir, "raw_video.mp4"),
      "-vf", `subtitles='${escaped}':force_style='FontSize=${process.env.RENDER_LOW_MEMORY === "1" ? 18 : 24},Bold=1,Outline=3,Shadow=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,MarginV=50'`,
      "-c:v", "libx264", "-preset", "medium", "-crf", "20",
      "-c:a", "copy",
      outPath,
    ],
    { stdio: ["ignore", "ignore", "inherit"] }
  );
  // A fresh final_video invalidates any earlier pre-music source (see lib/music.ts).
  rmSync(join(dir, "video_nomusic.mp4"), { force: true });
  console.log(`Saved ${outPath}`);
}
