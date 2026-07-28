/**
 * Module 6 — Captions
 * Input:  output/<slug>/timestamps.json + raw_video.mp4
 * Output: output/<slug>/final_video.mp4 (burned-in captions) + captions.srt
 *
 * Groups word timestamps into short caption lines (max ~6 words / 42 chars),
 * writes an SRT, then burns it in with ffmpeg's subtitles filter.
 *
 * Usage:  npm run captions -- --dir output/<slug>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { arg } from "./lib/util.js";
import { config } from "./lib/config.js";

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

async function main() {
  const dir = arg("dir");
  if (!dir) {
    console.error("Usage: npm run captions -- --dir output/<slug>");
    process.exit(1);
  }

  const ts: { words: Word[] } = JSON.parse(readFileSync(join(dir, "timestamps.json"), "utf8"));
  const srtPath = join(dir, "captions.srt");
  writeFileSync(srtPath, buildSrt(ts.words));

  const outPath = join(dir, "final_video.mp4");
  // subtitles filter path needs escaping for ffmpeg filter syntax
  const escaped = resolve(srtPath).replace(/([:'\\])/g, "\\$1");
  execFileSync(
    config.ffmpegPath,
    [
      "-y",
      "-i", join(dir, "raw_video.mp4"),
      "-vf", `subtitles='${escaped}':force_style='FontSize=24,Bold=1,Outline=3,Shadow=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,MarginV=50'`,
      "-c:v", "libx264", "-preset", "medium", "-crf", "20",
      "-c:a", "copy",
      outPath,
    ],
    { stdio: ["ignore", "ignore", "inherit"] }
  );

  console.log(`Saved ${srtPath}`);
  console.log(`Saved ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
