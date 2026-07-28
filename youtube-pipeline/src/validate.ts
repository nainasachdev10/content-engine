/**
 * Module 10 — QA Validation (pre-upload gate)
 * Input:  output/<slug>/script.json + thumbnail.png + metadata.json (if present)
 * Output: output/<slug>/validation.json ({verdict, issues, suggestions})
 *         exits 1 on "fail" so an orchestrator can block the upload step
 *
 * Sends the full script, metadata, and the thumbnail image to a vision-capable
 * Claude model and asks whether anything violates YouTube Kids quality policies
 * (frightening/sensational content, clickbait, non-educational filler).
 *
 * Usage:  npm run validate -- --dir output/<slug>
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { config, requireKeys } from "./lib/config.js";
import { arg } from "./lib/util.js";

async function main() {
  requireKeys("anthropicApiKey");
  const dir = arg("dir");
  if (!dir) {
    console.error("Usage: npm run validate -- --dir output/<slug>");
    process.exit(1);
  }

  const script = readFileSync(join(dir, "script.json"), "utf8");
  const metadataPath = join(dir, "metadata.json");
  const metadata = existsSync(metadataPath) ? readFileSync(metadataPath, "utf8") : null;
  const thumbnailPath = join(dir, "thumbnail.png");
  const thumbnail = existsSync(thumbnailPath)
    ? readFileSync(thumbnailPath).toString("base64")
    : null;

  const content: Anthropic.ContentBlockParam[] = [];
  if (thumbnail) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: thumbnail },
    });
  }
  content.push({
    type: "text",
    text: `You are a YouTube Kids content-policy reviewer for a made-for-kids educational channel (ages 6-10) that intends to monetize. Review this video's script${metadata ? ", metadata," : ""}${thumbnail ? " and thumbnail image (attached)" : ""} against YouTube's kids quality principles.

Script JSON:
${script}
${metadata ? `\nMetadata JSON:\n${metadata}` : ""}

Check for anything that risks demonetization or a policy strike:
1. Frightening, violent, gross, or anxiety-inducing content or imagery
2. Sensationalism, shock-bait, exaggerated or misleading claims (in narration, title, description, OR thumbnail text)
3. Clickbait mismatch: thumbnail/title promising something the video doesn't deliver
4. Low-quality/inauthentic signals: keyword stuffing, repetitive filler, no genuine educational value
5. Age-inappropriate themes or language for 6-10 year olds

Respond with ONLY JSON, no other text:
{"verdict": "pass" | "fail", "issues": ["specific problem + where it is", ...], "suggestions": ["concrete fix", ...]}
Use "fail" only for real policy risks, not stylistic nitpicks; put nitpicks in suggestions with a "pass".`,
  });

  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1500,
    messages: [{ role: "user", content }],
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
  const result = JSON.parse(jsonMatch[0]);

  const outPath = join(dir, "validation.json");
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  console.log(`\nSaved to ${outPath}`);

  if (result.verdict !== "pass") {
    console.error("\nVALIDATION FAILED — fix the issues above before uploading.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
