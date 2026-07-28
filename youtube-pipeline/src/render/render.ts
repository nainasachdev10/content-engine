/**
 * Module 5 — Video Assembly
 * Input:  output/<slug>/images/scene-<n>.png (+ scene-<n>.mp4 for hero scenes)
 *         + voiceover.mp3 + timestamps.json + visuals-manifest.json (optional)
 * Output: output/<slug>/raw_video.mp4 (1920x1080, each scene shown for its scene's duration)
 *
 * If visuals-manifest.json is absent, every scene-<n>.png is treated as a plain
 * image slideshow (backward compatible with visuals.ts's slideshow mode).
 * If it lists any video scenes, those scene-<n>.mp4 clips are looped/trimmed to
 * fill the scene's duration and mixed with the image scenes via filter_complex.
 *
 * Implementation: ffmpeg (spec §3 allows "Remotion (preferred) or ffmpeg").
 * ffmpeg was chosen for the MVP because it renders headlessly with no browser
 * dependency; the module's I/O contract is unchanged if swapped for Remotion later.
 *
 * Usage:  npm run render -- --dir output/<slug>
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { arg } from "../lib/util.js";
import { config } from "../lib/config.js";

type Scene = { n: number; type: "image" | "video" };

async function main() {
  const dir = arg("dir");
  if (!dir) {
    console.error("Usage: npm run render -- --dir output/<slug>");
    process.exit(1);
  }

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
    console.error(`Mismatch: ${scenes.length} scenes in visuals but ${ts.sceneStarts.length} scenes in timestamps.json`);
    process.exit(1);
  }

  // Per-scene durations: gap to the next scene start; last scene runs to totalDuration.
  const durations = ts.sceneStarts.map((start, i) =>
    (i + 1 < ts.sceneStarts.length ? ts.sceneStarts[i + 1] : ts.totalDuration) - start
  );

  const outPath = join(dir, "raw_video.mp4");

  // One or two segments per scene, joined via filter_complex concat:
  // - image scenes: a pronounced Ken Burns zoom (alternating in/out)
  // - video scenes: the clip plays once or twice (never endlessly looping),
  //   then hands off to a Ken Burns zoom on the scene's still for the remainder.
  const ffprobePath = config.ffmpegPath.replace(/ffmpeg([^/\\]*)$/, "ffprobe$1");
  const clipDuration = (p: string): number =>
    Number(
      execFileSync(ffprobePath, [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        p,
      ]).toString().trim()
    );

  const ffArgs: string[] = ["-y"];
  const filterParts: string[] = [];
  const segLabels: string[] = [];
  let inputIdx = 0;

  // Randomized Ken Burns: each still gets a random zoom direction + pan path so
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

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const dur = durations[i];
    const imgPath = resolve(imagesDir, `scene-${scene.n}.png`);

    if (scene.type === "video") {
      const vidPath = resolve(imagesDir, `scene-${scene.n}.mp4`);
      const clipLen = clipDuration(vidPath);
      // Play the clip once — or twice if that still leaves ≥1s for the still —
      // then switch to the Ken Burns still instead of looping forever.
      const loops = clipLen * 2 <= dur - 1 ? 2 : 1;
      const videoDur = Math.min(loops * clipLen, dur);
      const remainder = dur - videoDur;

      ffArgs.push("-stream_loop", String(loops - 1), "-t", videoDur.toFixed(3), "-i", vidPath);
      const label = `s${segLabels.length}`;
      filterParts.push(
        `[${inputIdx}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p,fps=30,setsar=1[${label}]`
      );
      segLabels.push(label);
      inputIdx++;

      if (remainder >= 0.5) {
        // Continue from the clip's final frame (not the original still) so the
        // handoff from motion to Ken Burns is seamless with no visible jump.
        const lastFramePath = resolve(imagesDir, `scene-${scene.n}-lastframe.png`);
        execFileSync(
          config.ffmpegPath,
          ["-y", "-sseof", "-0.2", "-i", vidPath, "-frames:v", "1", "-update", "1", lastFramePath],
          { stdio: "ignore" }
        );
        addKenBurns(lastFramePath, remainder, i);
      }
    } else {
      addKenBurns(imgPath, dur, i);
    }
  }
  filterParts.push(`${segLabels.map((l) => `[${l}]`).join("")}concat=n=${segLabels.length}:v=1:a=0[outv]`);

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

  execFileSync(config.ffmpegPath, ffArgs, { stdio: ["ignore", "ignore", "inherit"] });
  console.log(`Saved ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
