/**
 * Stage — Metadata
 * Writes <videoDir>/metadata.json (title, description, tags, thumbnail_text).
 * thumbnail_text feeds the thumbnail stage so the overlay matches the actual content.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "../lib/project.js";
import { anthropic, textOf, parseJson } from "../lib/claude.js";

export interface Metadata {
  title: string;
  description: string;
  tags: string[];
  thumbnail_text: string;
}

export async function runMetadata(project: Project, opts: { dir: string }): Promise<Metadata> {
  const { config } = project;
  const script: { topic: string; scenes: { narration: string }[] } = JSON.parse(
    readFileSync(join(opts.dir, "script.json"), "utf8")
  );
  const fullNarration = script.scenes.map((s) => s.narration).join("\n");

  const response = await anthropic().messages.create({
    model: config.models.metadata,
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: `Write YouTube metadata for this video.

Channel niche: ${config.niche}
Audience: ${config.audience.description}
Topic: ${script.topic}
Script:
${fullNarration}

${config.prompts.metadataGuidance}

Also include "thumbnail_text": a punchy 2-4 word phrase to overlay on the thumbnail — it must be honest and match what the video actually delivers.

Respond with ONLY JSON: {"title": "...", "description": "...", "tags": ["..."], "thumbnail_text": "..."}`,
      },
    ],
  });

  const metadata = parseJson<Metadata>(textOf(response));
  const outPath = join(opts.dir, "metadata.json");
  writeFileSync(outPath, JSON.stringify(metadata, null, 2));
  console.log(`"${metadata.title}" (${metadata.tags.length} tags) → ${outPath}`);
  return metadata;
}
