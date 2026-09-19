/**
 * Stage — Video Assembly via HyperFrames (default renderer)
 * Builds <videoDir>/hf/ (HTML/GSAP composition with karaoke word-pop captions)
 * then renders it with the hyperframes CLI to <videoDir>/final_video.mp4.
 *
 * Scene mapping mirrors renderFfmpeg: video scenes play once/twice then hand off
 * to a Ken Burns still of the clip's last frame; image scenes get a full Ken Burns.
 * Caption font/size come from config.captionTheme.
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import type { Project } from "../lib/project.js";
import { secrets } from "../lib/env.js";
import { mediaDuration } from "../lib/media.js";

type ManifestScene = { n: number; type: "image" | "video" };
type Word = { word: string; start: number; end: number; scene: number };
type Segment = {
  id: string;
  type: "image" | "video";
  src: string; // path within hf/assets/
  start: number;
  duration: number;
  kb?: { from: { scale: number; x: number; y: number }; to: { scale: number; x: number; y: number } };
  loops?: number;
};

// 8 deterministic Ken Burns moves, indexed per segment (no render-time randomness).
function kenBurnsMove(i: number) {
  const Z1 = 1.0, Z2 = 1.22, P = 2.5; // pan % keeps edges covered at these scales
  const moves = [
    { from: { scale: Z1, x: 0, y: 0 }, to: { scale: Z2, x: 0, y: 0 } },
    { from: { scale: Z2, x: 0, y: 0 }, to: { scale: Z1, x: 0, y: 0 } },
    { from: { scale: 1.18, x: P, y: 0 }, to: { scale: 1.18, x: -P, y: 0 } },
    { from: { scale: 1.18, x: -P, y: 0 }, to: { scale: 1.18, x: P, y: 0 } },
    { from: { scale: Z1, x: 0, y: 0 }, to: { scale: Z2, x: -P, y: 0 } },
    { from: { scale: Z2, x: P, y: 0 }, to: { scale: Z1, x: 0, y: 0 } },
    { from: { scale: 1.18, x: 0, y: P }, to: { scale: 1.18, x: 0, y: -P } },
    { from: { scale: Z1, x: 0, y: 0 }, to: { scale: Z2, x: 0, y: -P } },
  ];
  return moves[i % moves.length];
}

// Group words into short caption lines (same limits as captions.ts).
function buildGroups(words: Word[]) {
  const groups: { words: { i: number; text: string; start: number }[]; end: number }[] = [];
  let current: { i: number; text: string; start: number }[] = [];
  let chars = 0;
  words.forEach((w, i) => {
    current.push({ i, text: w.word, start: w.start });
    chars += w.word.length + 1;
    if (current.length >= 6 || chars >= 42 || /[.!?]$/.test(w.word)) {
      groups.push({ words: current, end: w.end });
      current = [];
      chars = 0;
    }
  });
  if (current.length) groups.push({ words: current, end: words[words.length - 1].end });
  return groups;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function runRenderHf(
  project: Project,
  opts: { dir: string; render?: boolean }
): Promise<string> {
  const { dir } = opts;
  const ts: { totalDuration: number; sceneStarts: number[]; words: Word[] } = JSON.parse(
    readFileSync(join(dir, "timestamps.json"), "utf8")
  );
  const manifestPath = join(dir, "visuals-manifest.json");
  const manifest: { scenes: ManifestScene[] } = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, "utf8"))
    : { scenes: ts.sceneStarts.map((_, i) => ({ n: i + 1, type: "image" as const })) };

  const imagesDir = join(dir, "images");
  const hfDir = join(dir, "hf");
  const assetsDir = join(hfDir, "assets");
  mkdirSync(assetsDir, { recursive: true });

  const durations = ts.sceneStarts.map((start, i) =>
    (i + 1 < ts.sceneStarts.length ? ts.sceneStarts[i + 1] : ts.totalDuration) - start
  );

  // Build segments (clip once/twice, then last-frame Ken Burns — same policy as renderFfmpeg).
  const segments: Segment[] = [];
  for (let i = 0; i < manifest.scenes.length; i++) {
    const scene = manifest.scenes[i];
    const start = ts.sceneStarts[i];
    const dur = durations[i];
    const png = `scene-${scene.n}.png`;
    copyFileSync(join(imagesDir, png), join(assetsDir, png));

    if (scene.type === "video") {
      const mp4 = `scene-${scene.n}.mp4`;
      const mp4Src = join(imagesDir, mp4);
      copyFileSync(mp4Src, join(assetsDir, mp4));
      const clipLen = mediaDuration(mp4Src);
      const loops = clipLen * 2 <= dur - 1 ? 2 : 1;
      const videoDur = Math.min(loops * clipLen, dur);
      const remainder = dur - videoDur;
      segments.push({ id: `seg${segments.length}`, type: "video", src: mp4, start, duration: videoDur, loops });
      if (remainder >= 0.5) {
        const lastFrame = `scene-${scene.n}-lastframe.png`;
        execFileSync(
          secrets.ffmpegPath,
          ["-y", "-sseof", "-0.2", "-i", mp4Src, "-frames:v", "1", "-update", "1", join(assetsDir, lastFrame)],
          { stdio: "ignore" }
        );
        segments.push({
          id: `seg${segments.length}`, type: "image", src: lastFrame,
          start: start + videoDur, duration: remainder, kb: kenBurnsMove(i),
        });
      }
    } else {
      segments.push({ id: `seg${segments.length}`, type: "image", src: png, start, duration: dur, kb: kenBurnsMove(i) });
    }
  }

  // Crossfades: when both sides of a boundary are stills, hold the outgoing one
  // 0.5s longer and fade the incoming Ken Burns wrapper in over it. (Video-clip
  // boundaries stay hard cuts — clips can't be extended, and a cut off real
  // motion reads fine.) Scene start times never move, so voiceover sync holds.
  const FADE = 0.5;
  const fades: { id: string; start: number }[] = [];
  for (let i = 1; i < segments.length; i++) {
    if (segments[i - 1].type === "image" && segments[i].type === "image") {
      segments[i - 1].duration += FADE;
      fades.push({ id: `kb-${segments[i].id}`, start: segments[i].start });
    }
  }

  copyFileSync(join(dir, "voiceover.mp3"), join(assetsDir, "voiceover.mp3"));
  const groups = buildGroups(ts.words);
  const total = ts.totalDuration;
  const f = (n: number) => n.toFixed(3);

  const fontSize = project.config.captionTheme?.fontSize ?? 58;
  const fontFamily =
    project.config.captionTheme?.fontFamily ?? '"Arial Rounded MT Bold", "Helvetica Rounded", Arial, sans-serif';

  // --- Compose index.html ---
  const segClips = segments
    .map((s) => {
      if (s.type === "video") {
        return `      <video id="${s.id}" class="clip scene" src="assets/${s.src}" data-start="${f(s.start)}" data-duration="${f(s.duration)}" data-track-index="1" muted playsinline></video>`;
      }
      return `      <div id="${s.id}" class="clip scene" data-start="${f(s.start)}" data-duration="${f(s.duration)}" data-track-index="1"><div class="kb" id="kb-${s.id}"><img src="assets/${s.src}" alt="" /></div></div>`;
    })
    .join("\n");

  const captionClips = groups
    .map((g, gi) => {
      const gStart = g.words[0].start;
      const spans = g.words.map((w) => `<span class="w" id="w-${w.i}">${esc(w.text)}</span>`).join(" ");
      return `      <div class="clip capline" id="g-${gi}" data-start="${f(Math.max(0, gStart - 0.05))}" data-duration="${f(g.end - gStart + 0.15)}" data-track-index="5"><p class="captext">${spans}</p></div>`;
    })
    .join("\n");

  const kbData = segments
    .filter((s) => s.kb)
    .map((s) => ({ id: `kb-${s.id}`, start: s.start, dur: s.duration, kb: s.kb }));
  const wordData = groups.flatMap((g) => g.words.map((w) => ({ id: `w-${w.i}`, start: w.start })));

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <title>${esc(project.config.name)} — pipeline render</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      body { margin: 0; background: #000; }
      #root { position: relative; width: 1920px; height: 1080px; overflow: hidden; background: #000; }
      .clip { position: absolute; inset: 0; }
      .scene { overflow: hidden; }
      video.scene { object-fit: cover; width: 1920px; height: 1080px; }
      .kb { position: absolute; inset: 0; will-change: transform; }
      .kb img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .capline { display: flex; align-items: flex-end; justify-content: center; padding-bottom: 72px; pointer-events: none; }
      .captext {
        margin: 0; max-width: 1500px; text-align: center;
        font-family: ${fontFamily};
        font-size: ${fontSize}px; font-weight: 900; line-height: 1.25; color: #fff;
        text-shadow: 0 3px 0 #000, 0 -2px 0 #000, 3px 0 0 #000, -3px 0 0 #000, 0 6px 18px rgba(0,0,0,.55);
        letter-spacing: 0.5px;
      }
      .w { display: inline-block; opacity: 0; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="${f(total)}">
${segClips}
${captionClips}
      <audio id="vo" src="assets/voiceover.mp3" data-start="0" data-duration="${f(total)}" data-track-index="10" data-volume="1"></audio>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const KB = ${JSON.stringify(kbData)};
      const WORDS = ${JSON.stringify(wordData)};
      const FADES = ${JSON.stringify(fades)};
      const tl = gsap.timeline({ paused: true });
      for (const f of FADES) {
        tl.fromTo("#" + f.id, { autoAlpha: 0 }, { autoAlpha: 1, duration: ${FADE}, ease: "none", immediateRender: false }, f.start);
      }
      for (const s of KB) {
        tl.fromTo("#" + s.id,
          { scale: s.kb.from.scale, xPercent: s.kb.from.x, yPercent: s.kb.from.y },
          { scale: s.kb.to.scale, xPercent: s.kb.to.x, yPercent: s.kb.to.y, duration: s.dur, ease: "none", immediateRender: false },
          s.start);
      }
      for (const w of WORDS) {
        tl.fromTo("#" + w.id,
          { autoAlpha: 0, y: 26, scale: 0.72 },
          { autoAlpha: 1, y: 0, scale: 1, duration: 0.16, ease: "back.out(2.2)", immediateRender: false },
          w.start);
      }
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;

  writeFileSync(join(hfDir, "index.html"), html);
  if (!existsSync(join(hfDir, "hyperframes.json"))) {
    writeFileSync(join(hfDir, "hyperframes.json"), JSON.stringify({ name: `${project.slug}-video` }, null, 2));
  }
  console.log(
    `HyperFrames project: ${segments.length} segments, ${groups.length} caption lines, ${wordData.length} animated words, ${f(total)}s`
  );

  const outPath = join(dir, "final_video.mp4");
  if (opts.render !== false) {
    // --workers 1: parallel workers crash ("detached Frame") on this machine.
    console.log("Rendering with hyperframes (this takes a few minutes)...");
    // Docker image pre-installs the CLI globally; elsewhere npx fetches it on first use.
    const hfCmd = process.env.HYPERFRAMES_BIN ? [process.env.HYPERFRAMES_BIN] : ["npx", "-y", "hyperframes"];
    execFileSync(hfCmd[0], [...hfCmd.slice(1), "render", "--quality", "high", "--workers", "1", "--output", resolve(outPath)], {
      cwd: hfDir,
      stdio: ["ignore", "inherit", "inherit"],
    });
    // A fresh render invalidates any earlier pre-music source (see lib/music.ts).
    rmSync(join(dir, "video_nomusic.mp4"), { force: true });
    console.log(`Saved ${outPath}`);
  }
  return outPath;
}
