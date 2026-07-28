/**
 * Module 5b — Video Assembly via HyperFrames (alternative to render.ts + captions.ts)
 * Input:  output/<slug>/images/* + voiceover.mp3 + timestamps.json + visuals-manifest.json
 * Output: output/<slug>/hf/ (HyperFrames project: index.html + assets/)
 *         → render with: cd output/<slug>/hf && npx hyperframes render --quality high --output ../final_video_hf.mp4
 *
 * Why: HTML/CSS/GSAP composition gives animated word-by-word captions and
 * smoother scene motion than the ffmpeg zoompan path, rendered locally for free.
 *
 * Scene mapping mirrors render.ts: video scenes play once/twice then hand off to
 * a Ken Burns still of the clip's last frame; image scenes get a full Ken Burns.
 * Captions pop in word-by-word from ElevenLabs word timestamps (karaoke style).
 *
 * Usage:  npm run render-hf -- --dir output/<slug>
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { arg } from "../lib/util.js";
import { config } from "../lib/config.js";

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

const ffprobeOf = (ffmpeg: string) => ffmpeg.replace(/ffmpeg([^/\\]*)$/, "ffprobe$1");

function mediaDuration(p: string): number {
  return Number(
    execFileSync(ffprobeOf(config.ffmpegPath), [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      p,
    ]).toString().trim()
  );
}

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

async function main() {
  const dir = arg("dir");
  if (!dir) {
    console.error("Usage: npm run render-hf -- --dir output/<slug>");
    process.exit(1);
  }

  const ts: { totalDuration: number; sceneStarts: number[]; words: Word[] } = JSON.parse(
    readFileSync(join(dir, "timestamps.json"), "utf8")
  );
  const manifest: { scenes: ManifestScene[] } = JSON.parse(
    readFileSync(join(dir, "visuals-manifest.json"), "utf8")
  );
  const imagesDir = join(dir, "images");
  const hfDir = join(dir, "hf");
  const assetsDir = join(hfDir, "assets");
  mkdirSync(assetsDir, { recursive: true });

  const durations = ts.sceneStarts.map((start, i) =>
    (i + 1 < ts.sceneStarts.length ? ts.sceneStarts[i + 1] : ts.totalDuration) - start
  );

  // Build segments (same policy as render.ts: clip once/twice, then last-frame Ken Burns).
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
          config.ffmpegPath,
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

  copyFileSync(join(dir, "voiceover.mp3"), join(assetsDir, "voiceover.mp3"));
  const groups = buildGroups(ts.words);
  const total = ts.totalDuration;
  const f = (n: number) => n.toFixed(3);

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
      const spans = g.words
        .map((w) => `<span class="w" id="w-${w.i}">${esc(w.text)}</span>`)
        .join(" ");
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
    <title>YouTube Pipeline HyperFrames Render</title>
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
        font-family: "Arial Rounded MT Bold", "Helvetica Rounded", Arial, sans-serif;
        font-size: 58px; font-weight: 900; line-height: 1.25; color: #fff;
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
      const tl = gsap.timeline({ paused: true });
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
    writeFileSync(join(hfDir, "hyperframes.json"), JSON.stringify({ name: "pipeline-video" }, null, 2));
  }

  console.log(`HyperFrames project written: ${resolve(hfDir)}`);
  console.log(`${segments.length} segments (${segments.filter((s) => s.type === "video").length} video), ${groups.length} caption lines, ${wordData.length} animated words, ${f(total)}s total`);
  console.log(`Next: cd ${hfDir} && npx hyperframes check && npx hyperframes render --quality high --output ../final_video_hf.mp4`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
