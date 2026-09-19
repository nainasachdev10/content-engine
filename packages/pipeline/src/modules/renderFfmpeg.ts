/**
 * Stage — Video Assembly (ffmpeg path; fallback renderer)
 * Writes <videoDir>/raw_video.mp4. Image scenes get randomized Ken Burns; video
 * scenes play once/twice then hand off to a Ken Burns of the clip's last frame.
 * Segments are joined with 0.5s crossfades (offsets keep every scene start
 * aligned with the voiceover — the fade eats into the incoming scene, never
 * shifts it), and a subtle saturation/contrast grade is applied at the end.
 * Pair with runCaptions(burn: true) to produce final_video.mp4.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import type { Project } from "../lib/project.js";
import { secrets } from "../lib/env.js";
import { mediaDuration } from "../lib/media.js";

type Scene = { n: number; type: "image" | "video" };
type Seg =
  | { kind: "kb"; img: string; dur: number; seed: number }
  | { kind: "clip"; path: string; dur: number; loops: number };

export async function runRenderFfmpeg(_project: Project, opts: { dir: string }): Promise<string> {
  const { dir } = opts;
  const ts: { totalDuration: number; sceneStarts: number[] } = JSON.parse(
    readFileSync(join(dir, "timestamps.json"), "utf8")
  );
  const imagesDir = join(dir, "images");

  const manifestPath = join(dir, "visuals-manifest.json");
  const scenes: Scene[] = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, "utf8")).scenes as Scene[])
    : readdirSync(imagesDir)
        .filter((f) => /^scene-\d+\.png$/.test(f))
        .map((f) => ({ n: Number(f.match(/\d+/)![0]), type: "image" as const }))
        .sort((a, b) => a.n - b.n);

  if (scenes.length !== ts.sceneStarts.length) {
    throw new Error(`Mismatch: ${scenes.length} scenes in visuals but ${ts.sceneStarts.length} in timestamps.json`);
  }

  // Per-scene durations: gap to the next scene start; last scene runs to totalDuration.
  const durations = ts.sceneStarts.map((start, i) =>
    (i + 1 < ts.sceneStarts.length ? ts.sceneStarts[i + 1] : ts.totalDuration) - start
  );

  // --- Plan segments first (crossfade length must adapt to the shortest one) ---
  const plan: Seg[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const dur = durations[i];
    const imgPath = resolve(imagesDir, `scene-${scene.n}.png`);

    if (scene.type === "video") {
      const vidPath = resolve(imagesDir, `scene-${scene.n}.mp4`);
      const clipLen = mediaDuration(vidPath);
      // Play the clip once — or twice if that still leaves ≥1s for the still —
      // then switch to the Ken Burns still instead of looping forever.
      const loops = clipLen * 2 <= dur - 1 ? 2 : 1;
      const videoDur = Math.min(loops * clipLen, dur);
      const remainder = dur - videoDur;
      plan.push({ kind: "clip", path: vidPath, dur: videoDur, loops });

      if (remainder >= 0.5) {
        // Continue from the clip's final frame (not the original still) so the
        // handoff from motion to Ken Burns is seamless with no visible jump.
        const lastFramePath = resolve(imagesDir, `scene-${scene.n}-lastframe.png`);
        execFileSync(
          secrets.ffmpegPath,
          ["-y", "-sseof", "-0.2", "-i", vidPath, "-frames:v", "1", "-update", "1", lastFramePath],
          { stdio: "ignore" }
        );
        plan.push({ kind: "kb", img: lastFramePath, dur: remainder, seed: i });
      }
    } else {
      plan.push({ kind: "kb", img: imgPath, dur, seed: i });
    }
  }

  // Crossfade length: 0.5s, shrunk if a segment is too short; below 0.15s just hard-cut.
  const minDur = Math.min(...plan.map((s) => s.dur));
  let F = plan.length > 1 ? Math.min(0.5, minDur / 2) : 0;
  if (F < 0.15) F = 0;

  const outPath = join(dir, "raw_video.mp4");
  const ffArgs: string[] = ["-y"];
  const filterParts: string[] = [];
  const segLabels: string[] = [];
  let inputIdx = 0;

  // Randomized Ken Burns: each still gets a varied zoom direction + pan path so
  // consecutive scenes never move identically (avoids a repetitive, mass-produced feel).
  const addKenBurns = (imgPath: string, durSec: number, seed: number) => {
    ffArgs.push("-i", imgPath);
    const frames = Math.max(1, Math.round(durSec * 30));
    const p = `on/${frames}`; // progress 0→1 through the segment
    const zoomIn = `'min(1+0.25*${p},1.25)'`;
    const zoomOut = `'max(1.25-0.25*${p},1.0)'`;
    const xCenter = `'iw/2-(iw/zoom/2)'`;
    const xLtoR = `'(iw-iw/zoom)*${p}'`;
    const xRtoL = `'(iw-iw/zoom)*(1-${p})'`;
    const yCenter = `'ih/2-(ih/zoom/2)'`;
    const yTtoB = `'(ih-ih/zoom)*${p}'`;
    const yBtoT = `'(ih-ih/zoom)*(1-${p})'`;
    const moves: [string, string, string][] = [
      [zoomIn, xCenter, yCenter],
      [zoomOut, xCenter, yCenter],
      [zoomIn, xLtoR, yCenter],
      [zoomIn, xRtoL, yCenter],
      [zoomOut, xLtoR, yCenter],
      [zoomOut, xRtoL, yCenter],
      [zoomIn, xCenter, yTtoB],
      [zoomOut, xCenter, yBtoT],
    ];
    // Deterministic per scene within a render, varied across scenes.
    const [z, x, y] = moves[(seed * 7 + segLabels.length * 3) % moves.length];
    const label = `s${segLabels.length}`;
    filterParts.push(
      `[${inputIdx}:v]scale=3840:2160:force_original_aspect_ratio=increase,crop=3840:2160,` +
        `zoompan=z=${z}:d=${frames}:x=${x}:y=${y}:s=1920x1080:fps=30,` +
        `format=yuv420p,setsar=1[${label}]`
    );
    segLabels.push(label);
    inputIdx++;
  };

  for (let i = 0; i < plan.length; i++) {
    const seg = plan[i];
    const extend = i < plan.length - 1 ? F : 0; // non-last segments carry F extra content for the fade overlap
    if (seg.kind === "kb") {
      addKenBurns(seg.img, seg.dur + extend, seg.seed);
    } else {
      ffArgs.push("-stream_loop", String(seg.loops - 1), "-t", seg.dur.toFixed(3), "-i", seg.path);
      const label = `s${segLabels.length}`;
      const pad = extend > 0 ? `,tpad=stop_mode=clone:stop_duration=${extend.toFixed(3)}` : "";
      filterParts.push(
        `[${inputIdx}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p,fps=30,setsar=1${pad}[${label}]`
      );
      segLabels.push(label);
      inputIdx++;
    }
  }

  // Join segments. With crossfades: offset_k = sum of content durations before
  // segment k, so every scene still starts exactly on its voiceover timestamp
  // and the total duration stays sum(dur) — the fade consumes the extra padding.
  let joined: string;
  if (F > 0 && segLabels.length > 1) {
    let chain = segLabels[0];
    let acc = plan[0].dur;
    for (let i = 1; i < segLabels.length; i++) {
      const out = i === segLabels.length - 1 ? "joined" : `x${i}`;
      filterParts.push(
        `[${chain}][${segLabels[i]}]xfade=transition=fade:duration=${F.toFixed(3)}:offset=${acc.toFixed(3)}[${out}]`
      );
      chain = out;
      acc += plan[i].dur;
    }
    joined = "joined";
  } else if (segLabels.length > 1) {
    filterParts.push(`${segLabels.map((l) => `[${l}]`).join("")}concat=n=${segLabels.length}:v=1:a=0[joined]`);
    joined = "joined";
  } else {
    joined = segLabels[0];
  }
  // Subtle grade — a touch of saturation and contrast reads as "finished" without looking filtered.
  filterParts.push(`[${joined}]eq=saturation=1.05:contrast=1.02[outv]`);

  const audioInputIndex = inputIdx;
  ffArgs.push("-i", join(dir, "voiceover.mp3"));
  ffArgs.push(
    "-filter_complex", filterParts.join(";"),
    "-map", "[outv]",
    "-map", `${audioInputIndex}:a`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "20",
    "-c:a", "aac", "-b:a", "192k",
    "-shortest",
    outPath
  );

  execFileSync(secrets.ffmpegPath, ffArgs, { stdio: ["ignore", "ignore", "inherit"] });
  console.log(`Saved ${outPath} (${plan.length} segments, ${F > 0 ? `${F.toFixed(2)}s crossfades` : "hard cuts"})`);
  return outPath;
}
