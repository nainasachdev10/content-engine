/**
 * Stage — Visuals (Replicate images — Flux 1.1 Pro by default, configurable; hero clips via lib/clips.ts — Replicate Kling 2.5 by default or Higgsfield DoP)
 * Writes <videoDir>/images/scene-<n>.png (+ .mp4 for heroes) + visuals-manifest.json.
 * Skip-existing on both so already-billed scenes never regenerate.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import type { Project } from "../lib/project.js";
import { secrets, requireSecrets } from "../lib/env.js";
import { presenterEnabled, ensurePresenterImage, generateTalkingClip } from "../lib/presenter.js";
import { generateClip, clipProvider } from "../lib/clips.js";

/** fetch that retries on 429 (accounts under $5 credit are limited to 6 requests/min)
 *  and on transient network errors ("TypeError: fetch failed"). */
async function fetchWithRetry(url: string, init?: RequestInit, attempts = 6): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      lastErr = err;
      const waitSec = 5 * (i + 1);
      process.stdout.write(`[network error, retrying in ${waitSec}s] `);
      await new Promise((r) => setTimeout(r, waitSec * 1000));
      continue;
    }
    if (res.status === 429) {
      const body = await res.text();
      const retryAfter = Number(JSON.parse(body).retry_after ?? 10);
      const waitSec = Math.max(retryAfter, 10) + 2;
      process.stdout.write(`[rate-limited, waiting ${waitSec}s] `);
      await new Promise((r) => setTimeout(r, waitSec * 1000));
      continue;
    }
    if (res.status >= 500 || res.status === 404) {
      // Replicate intermittently 404s live models ("No adapter found for model: ...").
      const body = await res.text();
      if (res.status === 404 && !/no adapter found/i.test(body)) {
        return new Response(body, { status: res.status, headers: res.headers }); // real 404
      }
      lastErr = `${res.status}: ${body.slice(0, 200)}`;
      const waitSec = 8 * (i + 1);
      process.stdout.write(`[replicate ${res.status}, retrying in ${waitSec}s] `);
      await new Promise((r) => setTimeout(r, waitSec * 1000));
      continue;
    }
    return res;
  }
  throw new Error(`Replicate unreachable after ${attempts} attempts${lastErr ? `: ${String(lastErr)}` : " (429)"}`);
}

export const DEFAULT_IMAGE_MODEL = "black-forest-labs/flux-1.1-pro";

/** What makes stills look "AI": oversaturation, glow, symmetry, plastic skin. Appended to every image prompt. */
export const IMAGE_NEGATIVES =
  "Avoid: oversaturated neon colors, glowing eyes, lens flare, plastic or airbrushed skin, perfectly symmetrical hero poses, generic fantasy-CGI sheen, extra limbs or fingers, text, watermarks, logos.";

let imageFieldsCache: Record<string, string[]> = {};
async function imageModelFields(model: string): Promise<string[]> {
  if (imageFieldsCache[model]) return imageFieldsCache[model];
  const res = await fetchWithRetry(`https://api.replicate.com/v1/models/${model}`, {
    headers: { Authorization: `Bearer ${secrets.imageApiKey}` },
  });
  if (!res.ok) throw new Error(`Replicate model lookup ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as any;
  const fields = Object.keys(data.latest_version?.openapi_schema?.components?.schemas?.Input?.properties ?? {});
  imageFieldsCache[model] = fields;
  return fields;
}

async function generateImage(prompt: string, model = process.env.IMAGE_MODEL || DEFAULT_IMAGE_MODEL): Promise<Buffer> {
  const fields = await imageModelFields(model);
  const input: Record<string, unknown> = { prompt: `${prompt} ${IMAGE_NEGATIVES}` };
  if (fields.includes("aspect_ratio")) input.aspect_ratio = "16:9";
  if (fields.includes("output_format")) input.output_format = "png";
  if (fields.includes("negative_prompt")) input.negative_prompt = IMAGE_NEGATIVES.replace(/^Avoid: /, "");
  if (fields.includes("prompt_upsampling")) input.prompt_upsampling = false; // keep our art direction verbatim
  if (fields.includes("safety_tolerance")) input.safety_tolerance = 2;
  if (fields.includes("output_quality")) input.output_quality = 95;

  const res = await fetchWithRetry(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secrets.imageApiKey}`,
      "Content-Type": "application/json",
      Prefer: "wait",
    },
    body: JSON.stringify({ input }),
  });
  if (!res.ok) throw new Error(`Replicate ${res.status}: ${await res.text()}`);
  let prediction = (await res.json()) as {
    status: string;
    output?: string[] | string;
    error?: string;
    urls?: { get: string };
  };
  // "Prefer: wait" can return early (status "starting"/"processing") under load — poll to terminal.
  const start = Date.now();
  while (!["succeeded", "failed", "canceled"].includes(prediction.status) && prediction.urls?.get) {
    if (Date.now() - start > 5 * 60 * 1000) throw new Error("Image generation timed out after 5 minutes");
    await new Promise((r) => setTimeout(r, 3000));
    const poll = await fetchWithRetry(prediction.urls.get, {
      headers: { Authorization: `Bearer ${secrets.imageApiKey}` },
    });
    prediction = (await poll.json()) as typeof prediction;
  }
  const out = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  if (prediction.status !== "succeeded" || !out) {
    throw new Error(`Prediction failed (${model}): ${prediction.error ?? prediction.status}`);
  }
  const img = await fetch(out);
  return normalize169(Buffer.from(await img.arrayBuffer()));
}

/** Models don't always honour aspect_ratio; a non-16:9 still shows as letterbox bars in the
 *  video. Center-crop/scale to exactly 1920x1080 so every still fills the frame. */
function normalize169(png: Buffer): Buffer {
  const tmpIn = join(tmpdir(), `img-${process.pid}-${Date.now()}-in.png`);
  const tmpOut = tmpIn.replace(/-in\.png$/, "-out.png");
  try {
    writeFileSync(tmpIn, png);
    execFileSync(secrets.ffmpegPath, [
      "-y", "-loglevel", "error", "-i", tmpIn,
      "-vf", "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080",
      "-frames:v", "1", tmpOut,
    ]);
    return readFileSync(tmpOut);
  } catch {
    return png; // keep the original rather than fail the stage
  } finally {
    rmSync(tmpIn, { force: true });
    rmSync(tmpOut, { force: true });
  }
}

/** Predictions can fail terminally on Replicate's side (e.g. "Director: unexpected
 *  error handling prediction") — recreate the prediction a few times before giving up.
 *  Exported for thumbnail.ts so every Replicate image call shares the same resilience. */
export async function generateImageWithRetry(prompt: string, attempts = 3, model?: string): Promise<Buffer> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await generateImage(prompt, model);
    } catch (err) {
      lastErr = err;
      const waitSec = 10 * (i + 1);
      process.stdout.write(`[prediction failed, recreating in ${waitSec}s] `);
      await new Promise((r) => setTimeout(r, waitSec * 1000));
    }
  }
  throw lastErr;
}

export async function runVisuals(
  project: Project,
  opts: { dir: string; mode?: "slideshow" | "hybrid" | "video"; hero?: string }
): Promise<void> {
  requireSecrets("imageApiKey");
  const mode = opts.mode ?? project.config.video.visualsMode;

  const script: { style_note?: string; scenes: { visual_description: string; motion?: string; shot?: string }[] } = JSON.parse(
    readFileSync(join(opts.dir, "script.json"), "utf8")
  );
  const n = script.scenes.length;

  // Presenter scenes: the host image is the still, and a lip-synced clip of the host
  // speaking that scene's narration chunk (from the voiceover stage) is the video.
  const presenterOn = presenterEnabled(project);
  const presenterScenes = new Set(
    presenterOn ? script.scenes.map((s, i) => (s.shot === "presenter" ? i + 1 : 0)).filter(Boolean) : []
  );
  const hostImage = presenterOn && presenterScenes.size ? await ensurePresenterImage(project) : null;

  let heroScenes: Set<number>;
  if (mode === "video") {
    heroScenes = new Set(Array.from({ length: n }, (_, i) => i + 1));
  } else if (mode === "hybrid") {
    const configured = project.config.video.heroScenes;
    if (opts.hero) {
      heroScenes = new Set(opts.hero.split(",").map((s) => Number(s.trim())));
    } else if (Array.isArray(configured)) {
      heroScenes = new Set(configured);
    } else {
      heroScenes = new Set([1, Math.min(n, Math.ceil(n * 0.7))]); // "auto": first + ~70%-through
    }
  } else {
    heroScenes = new Set();
  }

  const imagesDir = join(opts.dir, "images");
  mkdirSync(imagesDir, { recursive: true });
  const manifest: { mode: string; scenes: { n: number; type: "image" | "video" }[] } = { mode, scenes: [] };

  for (let i = 0; i < n; i++) {
    const sceneNum = i + 1;
    const prompt = `${script.scenes[i].visual_description}${script.style_note ? `. Style: ${script.style_note}` : ""}. No text or lettering in the image.`;
    const imgPath = join(imagesDir, `scene-${sceneNum}.png`);

    if (hostImage && presenterScenes.has(sceneNum)) {
      if (!existsSync(imgPath)) writeFileSync(imgPath, readFileSync(hostImage));
      const vidPath = join(imagesDir, `scene-${sceneNum}.mp4`);
      const audioPath = join(opts.dir, "audio-chunks", `scene-${sceneNum}.mp3`);
      if (existsSync(vidPath)) {
        console.log(`Scene ${sceneNum}/${n} presenter clip... exists, skipping`);
      } else if (!existsSync(audioPath)) {
        throw new Error(`Presenter scene ${sceneNum} needs ${audioPath} — run the voiceover stage first.`);
      } else {
        process.stdout.write(`Scene ${sceneNum}/${n} presenter clip (lip-sync, can take a few minutes)`);
        await generateTalkingClip(project, { imagePath: hostImage, audioPath, outPath: vidPath, prompt: script.scenes[i].visual_description });
        console.log(" done");
      }
      manifest.scenes.push({ n: sceneNum, type: "video" });
      continue;
    }

    let png: Buffer;
    if (existsSync(imgPath)) {
      console.log(`Scene ${sceneNum}/${n} image... exists, skipping`);
      png = readFileSync(imgPath);
    } else {
      process.stdout.write(`Scene ${sceneNum}/${n} image... `);
      png = await generateImageWithRetry(prompt, 3, project.config.video.imageModel);
      writeFileSync(imgPath, png);
      console.log("done");
    }

    if (heroScenes.has(sceneNum)) {
      const vidPath = join(imagesDir, `scene-${sceneNum}.mp4`);
      if (existsSync(vidPath)) {
        console.log(`Scene ${sceneNum}/${n} video... exists, skipping`);
      } else {
        // The script's motion phrase directs the image-to-video camera move so hero
        // clips vary (push-ins, drifts, orbits) instead of all animating the same way.
        process.stdout.write(`Scene ${sceneNum}/${n} video via ${clipProvider(project)} (can take a few minutes)`);
        writeFileSync(vidPath, await generateClip(project, { imagePath: imgPath, visual: script.scenes[i].visual_description, motion: script.scenes[i].motion }));
        console.log(" done");
      }
      manifest.scenes.push({ n: sceneNum, type: "video" });
    } else {
      manifest.scenes.push({ n: sceneNum, type: "image" });
    }
  }

  writeFileSync(join(opts.dir, "visuals-manifest.json"), JSON.stringify(manifest, null, 2));
  const videoCount = manifest.scenes.filter((s) => s.type === "video").length;
  console.log(`Done: ${n} scenes (${videoCount} video, ${n - videoCount} image) in ${imagesDir}`);
}
