/**
 * Stage 1 — Topic Research
 * Finds candidate topics for the project's niche, avoiding already-published ones.
 * Writes projects/<slug>/output/research-<timestamp>.json
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "../lib/project.js";
import { anthropic, textOf, parseJson } from "../lib/claude.js";
import { hubPromptBlock } from "../lib/notion.js";

export interface Topic {
  topic: string;
  angle: string;
  why_now: string;
}

export async function runResearch(project: Project, opts: { count?: number } = {}): Promise<Topic[]> {
  const count = opts.count ?? 7;
  const { config } = project;

  const published: { topics: { topic: string }[] } = JSON.parse(readFileSync(project.stateFile, "utf8"));
  const publishedList = published.topics.map((t) => t.topic);

  // Empty string unless the project has a Notion hub the client maintains.
  const hub = await hubPromptBlock(project);

  const prompt = `${hub}You are a YouTube content strategist for a channel in the niche: "${config.niche}".
Audience: ${config.audience.description}.
Target video length: ${config.video.lengthMinutes} minutes.

Use web search to find what is currently interesting, trending, or under-served in this niche, then propose ${count} candidate video topics.

Every topic must pass these bars — reject your own candidates that don't:
- THE 20-THUMBNAIL TEST: among 20 competing videos, would this specific concept get the click? Generic surveys ("All about X") never pass; a specific tension does ("The lake that turns animals to stone").
- ONE CONCRETE HOOK: the angle must contain a specific, verifiable, surprising fact — a number, an event, a paradox — not a vague promise of interestingness.
- VISUAL POTENTIAL: the topic must suggest striking, variable imagery scene after scene (a topic that is all talking-head abstraction makes a bad video here).
- UNDER-SERVED: prefer angles the big channels in this niche haven't already done to death, or a genuinely fresh take when they have.

Already-published topics (do NOT repeat or closely overlap these):
${publishedList.length ? publishedList.map((t) => `- ${t}`).join("\n") : "(none yet)"}

Respond with ONLY a JSON array, no other text, ordered best-first, where each element is:
{"topic": "...", "angle": "one-sentence unique angle/hook containing the concrete surprising fact", "why_now": "why this would perform well right now"}`;

  const response = await anthropic().messages.create({
    model: config.models.research,
    max_tokens: 4000,
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
    messages: [{ role: "user", content: prompt }],
  });

  const topics = parseJson<Topic[]>(textOf(response), "array");

  mkdirSync(project.outputRoot, { recursive: true });
  const outPath = join(project.outputRoot, `research-${Date.now()}.json`);
  writeFileSync(
    outPath,
    JSON.stringify({ niche: config.niche, generatedAt: new Date().toISOString(), topics }, null, 2)
  );
  console.log(`${topics.length} topics researched → ${outPath}`);
  return topics;
}
