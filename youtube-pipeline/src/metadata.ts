/**
 * Module 8 — Metadata
 * Input:  output/<slug>/script.json
 * Output: output/<slug>/metadata.json (title, description, tags)
 *
 * Usage:  npm run metadata -- --dir output/<slug>
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config, requireKeys } from "./lib/config.js";
import { arg } from "./lib/util.js";

async function main() {
  requireKeys("anthropicApiKey");
  const dir = arg("dir");
  if (!dir) {
    console.error("Usage: npm run metadata -- --dir output/<slug>");
    process.exit(1);
  }

  const script: { topic: string; scenes: { narration: string }[] } = JSON.parse(
    readFileSync(join(dir, "script.json"), "utf8")
  );
  const fullNarration = script.scenes.map((s) => s.narration).join("\n");

  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: `Write YouTube metadata for this video.

Topic: ${script.topic}
Script:
${fullNarration}

This is a kids' educational channel (made-for-kids, monetized), so metadata must be honest and parent-friendly:
- title: under 70 chars, curiosity-driven but completely accurate — a real question or fact, never clickbait, shock words, or ALL-CAPS hype
- description: 2-3 paragraphs written so a PARENT deciding what their kid watches trusts it; first 2 lines carry the hook (they show above the fold), plainly state what the child will learn, end with 3-5 relevant hashtags
- tags: 15-25 genuinely relevant tags, mix of broad and specific — no keyword stuffing or trending-but-unrelated terms

Respond with ONLY JSON: {"title": "...", "description": "...", "tags": ["..."]}`,
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error("Model did not return JSON. Raw output:\n" + text);
    process.exit(1);
  }
  const metadata = JSON.parse(jsonMatch[0]);

  const outPath = join(dir, "metadata.json");
  writeFileSync(outPath, JSON.stringify(metadata, null, 2));
  console.log(JSON.stringify(metadata, null, 2));
  console.log(`\nSaved to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
