/**
 * Stage — QA Validation (pre-upload gate)
 * Vision-reviews script + metadata + thumbnail against the project's checklist.
 * Writes <videoDir>/validation.json; throws on "fail" so the run is blocked.
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "../lib/project.js";
import { anthropic, textOf, parseJson } from "../lib/claude.js";

export interface Validation {
  verdict: "pass" | "fail";
  issues: string[];
  suggestions: string[];
}

export async function runValidate(project: Project, opts: { dir: string }): Promise<Validation> {
  const { config } = project;
  const script = readFileSync(join(opts.dir, "script.json"), "utf8");
  const metadataPath = join(opts.dir, "metadata.json");
  const metadata = existsSync(metadataPath) ? readFileSync(metadataPath, "utf8") : null;
  const thumbnailPath = join(opts.dir, "thumbnail.png");
  const thumbnail = existsSync(thumbnailPath) ? readFileSync(thumbnailPath).toString("base64") : null;

  const content: Anthropic.ContentBlockParam[] = [];
  if (thumbnail) {
    content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: thumbnail } });
  }
  content.push({
    type: "text",
    text: `You are a content-quality and policy reviewer for a YouTube channel.
Channel niche: ${config.niche}
Audience: ${config.audience.description}${
      config.audience.madeForKids
        ? "\nThis channel is made-for-kids and monetized — it must satisfy YouTube Kids quality/monetization policy."
        : ""
    }

Review this video's script${metadata ? ", metadata," : ""}${thumbnail ? " and thumbnail image (attached)" : ""}.

Script JSON:
${script}
${metadata ? `\nMetadata JSON:\n${metadata}` : ""}

Check for anything that risks demonetization, a policy strike, or viewer distrust:
${config.prompts.validationChecklist}

Respond with ONLY JSON, no other text:
{"verdict": "pass" | "fail", "issues": ["specific problem + where it is", ...], "suggestions": ["concrete fix", ...]}
Use "fail" only for real policy risks, not stylistic nitpicks; put nitpicks in suggestions with a "pass".`,
  });

  const response = await anthropic().messages.create({
    model: config.models.validate,
    max_tokens: 1500,
    messages: [{ role: "user", content }],
  });

  const result = parseJson<Validation>(textOf(response));
  const outPath = join(opts.dir, "validation.json");
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`Validation: ${result.verdict}${result.issues.length ? ` — ${result.issues.join("; ")}` : ""} → ${outPath}`);

  if (result.verdict !== "pass") {
    throw new Error(`Validation failed: ${result.issues.join("; ") || "see validation.json"}`);
  }
  return result;
}
