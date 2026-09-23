/**
 * Stage — Thumbnail
 * Base image from Replicate Flux (style prompt from config), overlay text via ffmpeg drawtext.
 * Overlay text comes from metadata.json's thumbnail_text when present (so it matches content).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import type { Project } from "../lib/project.js";
import { secrets, requireSecrets } from "../lib/env.js";
import { generateImageWithRetry } from "./visuals.js";

export async function runThumbnail(
  project: Project,
  opts: { dir: string; topic?: string; text?: string; hint?: string }
): Promise<void> {
  requireSecrets("imageApiKey");
  const { dir } = opts;

  // Topic from script.json unless given; overlay text from metadata.thumbnail_text unless given.
  let topic = opts.topic;
  if (!topic && existsSync(join(dir, "script.json"))) {
    topic = (JSON.parse(readFileSync(join(dir, "script.json"), "utf8")) as { topic: string }).topic;
  }
  if (!topic) throw new Error("Thumbnail needs a topic (none given and no script.json in dir)");

  let text = opts.text;
  if (!text && existsSync(join(dir, "metadata.json"))) {
    text = (JSON.parse(readFileSync(join(dir, "metadata.json"), "utf8")) as { thumbnail_text?: string })
      .thumbnail_text;
  }
  text = (text ?? topic).toUpperCase();

  // Ground the image in the video's actual opening scene unless a hint is given.
  let hint = opts.hint;
  if (!hint && existsSync(join(dir, "script.json"))) {
    const script = JSON.parse(readFileSync(join(dir, "script.json"), "utf8")) as {
      scenes?: { visual_description: string }[];
    };
    hint = script.scenes?.[0]?.visual_description;
  }

  const basePath = join(dir, "thumbnail_base.png");
  if (!existsSync(basePath)) {
    const prompt = `YouTube thumbnail image for a video about "${topic}". ${hint ? `Scene concept: ${hint}. ` : ""}${project.config.prompts.thumbnailStyle} No text or lettering anywhere in the image.`;
    writeFileSync(basePath, await generateImageWithRetry(prompt, 3, project.config.video.imageModel));
  }

  const outPath = join(dir, "thumbnail.png");
  const escapedText = text.replace(/([\\':])/g, "\\$1");
  execFileSync(
    secrets.ffmpegPath,
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
  console.log(`Saved ${outPath} (text: "${text}")`);
}
