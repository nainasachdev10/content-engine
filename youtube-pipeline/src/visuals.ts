/**
 * Module 4 — Visuals
 * Input:  output/<slug>/script.json (scene visual_descriptions)
 * Output: output/<slug>/images/scene-<n>.png (every scene)
 *         output/<slug>/images/scene-<n>.mp4 (hero scenes only, in hybrid/video mode)
 *         output/<slug>/visuals-manifest.json (which scenes are image vs video)
 *
 * Image provider: Replicate running Flux Schnell.
 * Video provider: Replicate running Kling (image-to-video, seeded with the Flux frame).
 * Both use IMAGE_API_KEY = Replicate API token — one account covers both.
 *
 * Usage:  npm run visuals -- --dir output/<slug> [--mode slideshow|hybrid|video] [--hero "1,4"]
 *   slideshow (default): every scene is a static image — cheapest, ~$0.003/scene
 *   hybrid: hero scenes (default: first + ~70%-through scene, or pass --hero "2,5")
 *           become short video clips, the rest stay images
 *   video: every scene becomes a video clip — most expensive
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { config, requireKeys } from "./lib/config.js";
import { arg } from "./lib/util.js";

const VIDEO_MODEL = "kwaivgi/kling-v2.1";

/** fetch that retries on 429 (accounts under $5 credit are limited to 6 requests/min). */
async function fetchWithRetry(url: string, init?: RequestInit, attempts = 6): Promise<Response> {
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(url, init);
    if (res.status !== 429) return res;
    const body = await res.text();
    const retryAfter = Number(JSON.parse(body).retry_after ?? 10);
    const waitSec = Math.max(retryAfter, 10) + 2;
    process.stdout.write(`[rate-limited, waiting ${waitSec}s] `);
    await new Promise((r) => setTimeout(r, waitSec * 1000));
  }
  throw new Error("Replicate 429: still rate-limited after retries");
}

async function generateImage(prompt: string): Promise<Buffer> {
  const res = await fetchWithRetry("https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.imageApiKey}`,
      "Content-Type": "application/json",
      Prefer: "wait",
    },
    body: JSON.stringify({
      input: { prompt, aspect_ratio: "16:9", output_format: "png" },
    }),
  });
  if (!res.ok) throw new Error(`Replicate ${res.status}: ${await res.text()}`);
  const prediction = (await res.json()) as { status: string; output?: string[]; error?: string };
  if (prediction.status !== "succeeded" || !prediction.output?.[0]) {
    throw new Error(`Prediction failed: ${prediction.error ?? prediction.status}`);
  }
  const img = await fetch(prediction.output[0]);
  return Buffer.from(await img.arrayBuffer());
}

/** Introspects the model's input schema so we submit whatever field names Replicate expects. */
async function getModelInputSchema(model: string): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.replicate.com/v1/models/${model}`, {
    headers: { Authorization: `Bearer ${config.imageApiKey}` },
  });
  if (!res.ok) throw new Error(`Replicate model lookup ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as any;
  return data.latest_version.openapi_schema.components.schemas.Input.properties;
}

async function generateVideo(imagePng: Buffer, prompt: string): Promise<Buffer> {
  const schema = await getModelInputSchema(VIDEO_MODEL);
  const fields = Object.keys(schema);
  // Prefer the first-frame field; some models expose both start_image and end_image.
  const imageField =
    fields.find((k) => /(start|first|init).*image|image.*(start|first|init)/i.test(k)) ??
    fields.find((k) => /image/i.test(k) && !/(end|last|final)/i.test(k)) ??
    "start_image";
  const durationField = fields.find((k) => /duration/i.test(k));
  const aspectField = fields.find((k) => /aspect/i.test(k));

  const input: Record<string, unknown> = {
    prompt,
    [imageField]: `data:image/png;base64,${imagePng.toString("base64")}`,
  };
  if (durationField) input[durationField] = 5;
  if (aspectField) input[aspectField] = "16:9";

  const createRes = await fetchWithRetry(`https://api.replicate.com/v1/models/${VIDEO_MODEL}/predictions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.imageApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input }),
  });
  if (!createRes.ok) throw new Error(`Replicate ${createRes.status}: ${await createRes.text()}`);
  let prediction = (await createRes.json()) as any;

  const getUrl: string = prediction.urls.get;
  const start = Date.now();
  while (!["succeeded", "failed", "canceled"].includes(prediction.status)) {
    if (Date.now() - start > 10 * 60 * 1000) throw new Error("Video generation timed out after 10 minutes");
    await new Promise((r) => setTimeout(r, 5000));
    const pollRes = await fetch(getUrl, { headers: { Authorization: `Bearer ${config.imageApiKey}` } });
    prediction = await pollRes.json();
    process.stdout.write(".");
  }
  if (prediction.status !== "succeeded" || !prediction.output) {
    throw new Error(`Video prediction failed: ${prediction.error ?? prediction.status}`);
  }
  const videoUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  const vid = await fetch(videoUrl);
  return Buffer.from(await vid.arrayBuffer());
}

async function main() {
  requireKeys("imageApiKey");
  const dir = arg("dir");
  if (!dir) {
    console.error('Usage: npm run visuals -- --dir output/<slug> [--mode slideshow|hybrid|video] [--hero "1,4"]');
    process.exit(1);
  }
  const mode = (arg("mode") ?? "slideshow") as "slideshow" | "hybrid" | "video";

  const script: { style_note?: string; scenes: { visual_description: string }[] } = JSON.parse(
    readFileSync(join(dir, "script.json"), "utf8")
  );
  const n = script.scenes.length;

  let heroScenes: Set<number>;
  if (mode === "video") {
    heroScenes = new Set(Array.from({ length: n }, (_, i) => i + 1));
  } else if (mode === "hybrid") {
    const heroArg = arg("hero");
    heroScenes = heroArg
      ? new Set(heroArg.split(",").map((s) => Number(s.trim())))
      : new Set([1, Math.min(n, Math.ceil(n * 0.7))]);
  } else {
    heroScenes = new Set();
  }

  const imagesDir = join(dir, "images");
  mkdirSync(imagesDir, { recursive: true });

  const manifest: { mode: string; scenes: { n: number; type: "image" | "video" }[] } = { mode, scenes: [] };

  for (let i = 0; i < n; i++) {
    const sceneNum = i + 1;
    const prompt = `${script.scenes[i].visual_description}${script.style_note ? `. Style: ${script.style_note}` : ""}. No text or lettering in the image.`;
    const imgPath = join(imagesDir, `scene-${sceneNum}.png`);
    let png: Buffer;
    if (existsSync(imgPath)) {
      console.log(`Scene ${sceneNum}/${n} image... exists, skipping`);
      png = readFileSync(imgPath);
    } else {
      process.stdout.write(`Scene ${sceneNum}/${n} image... `);
      png = await generateImage(prompt);
      writeFileSync(imgPath, png);
      console.log(imgPath);
    }

    if (heroScenes.has(sceneNum)) {
      const vidPath = join(imagesDir, `scene-${sceneNum}.mp4`);
      if (existsSync(vidPath)) {
        console.log(`Scene ${sceneNum}/${n} video... exists, skipping`);
      } else {
        process.stdout.write(`Scene ${sceneNum}/${n} video (can take a few minutes)`);
        const mp4 = await generateVideo(png, prompt);
        writeFileSync(vidPath, mp4);
        console.log(` ${vidPath}`);
      }
      manifest.scenes.push({ n: sceneNum, type: "video" });
    } else {
      manifest.scenes.push({ n: sceneNum, type: "image" });
    }
  }

  writeFileSync(join(dir, "visuals-manifest.json"), JSON.stringify(manifest, null, 2));
  const videoCount = manifest.scenes.filter((s) => s.type === "video").length;
  console.log(`\nDone: ${n} scenes (${videoCount} video, ${n - videoCount} image) in ${imagesDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
