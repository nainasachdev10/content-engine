/**
 * Module 7 — Thumbnail
 * Input:  topic (--topic) + overlay text (--text, defaults to topic)
 * Output: output/<slug>/thumbnail.png (1280x720, generated image + bold text overlay)
 *
 * Image: Replicate Flux (same provider as visuals). Text overlay: ffmpeg drawtext
 * (avoids adding a canvas/PIL-style native dependency).
 *
 * Usage:  npm run thumbnail -- --dir output/<slug> --topic "..." [--text "SHORT HOOK"]
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { config, requireKeys } from "./lib/config.js";
import { arg, slugify } from "./lib/util.js";

async function generateImage(prompt: string): Promise<Buffer> {
  const res = await fetch("https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.imageApiKey}`,
      "Content-Type": "application/json",
      Prefer: "wait",
    },
    body: JSON.stringify({ input: { prompt, aspect_ratio: "16:9", output_format: "png" } }),
  });
  if (!res.ok) throw new Error(`Replicate ${res.status}: ${await res.text()}`);
  const prediction = (await res.json()) as { status: string; output?: string[]; error?: string };
  if (prediction.status !== "succeeded" || !prediction.output?.[0]) {
    throw new Error(`Prediction failed: ${prediction.error ?? prediction.status}`);
  }
  const img = await fetch(prediction.output[0]);
  return Buffer.from(await img.arrayBuffer());
}

async function main() {
  requireKeys("imageApiKey");
  const topic = arg("topic");
  if (!topic) {
    console.error('Usage: npm run thumbnail -- --topic "..." [--dir output/<slug>] [--text "SHORT HOOK"]');
    process.exit(1);
  }
  const dir = arg("dir") ?? join("output", slugify(topic));
  const text = (arg("text") ?? topic).toUpperCase();
  mkdirSync(dir, { recursive: true });

  const basePath = join(dir, "thumbnail_base.png");
  if (!existsSync(basePath)) {
    const hint = arg("hint");
    const prompt = `YouTube thumbnail for a kids' educational video about "${topic}". ${hint ? `Scene: ${hint}. ` : ""}A cute 3D-animated family-film-style character (Pixar-like) positioned in the right two-thirds (rule of thirds), with a warm, joyful expression of genuine wonder — bright smile, sparkling curious eyes, gesturing toward the fascinating subject of the video beside them. The subject pops with soft glowing rim lighting. Vibrant saturated colors with strong complementary contrast (orange/teal or purple/yellow), simple clean uncluttered background, and a clearly darker, empty area covering the left third reserved for text. Friendly, inviting, and honest — never scary, shocked, or exaggerated. No text or lettering anywhere.`;
    writeFileSync(basePath, await generateImage(prompt));
  }

  const outPath = join(dir, "thumbnail.png");
  const escapedText = text.replace(/([\\':])/g, "\\$1");
  execFileSync(
    config.ffmpegPath,
    [
      "-y",
      "-i", resolve(basePath),
      "-vf",
      `scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,` +
        `drawtext=text='${escapedText}':fontsize=88:fontcolor=white:borderw=6:bordercolor=black:shadowcolor=black@0.6:shadowx=5:shadowy=5:x=40:y=h-th-60:font='Arial Black'`,
      "-frames:v", "1",
      outPath,
    ],
    { stdio: ["ignore", "ignore", "inherit"] }
  );

  console.log(`Saved ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
