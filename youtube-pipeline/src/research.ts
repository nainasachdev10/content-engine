/**
 * Module 1 — Topic Research
 * Input:  niche (from --niche or .env NICHE), state/published_topics.json
 * Output: candidate topics + angles, printed and saved to output/research-<timestamp>.json
 *
 * Usage:  npm run research -- [--niche "science facts"] [--count 7]
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config, requireKeys } from "./lib/config.js";
import { arg } from "./lib/util.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  requireKeys("anthropicApiKey");
  const niche = arg("niche") ?? config.niche;
  const count = Number(arg("count") ?? 7);

  const published: { topics: { topic: string }[] } = JSON.parse(
    readFileSync(join(root, "state/published_topics.json"), "utf8")
  );
  const publishedList = published.topics.map((t) => t.topic);

  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const prompt = `You are a YouTube content strategist for a channel in the niche: "${niche}".
Target video length: ${config.videoLengthMinutes} minutes.

Use web search to find what is currently interesting, trending, or under-served in this niche, then propose ${count} candidate video topics.

Already-published topics (do NOT repeat or closely overlap these):
${publishedList.length ? publishedList.map((t) => `- ${t}`).join("\n") : "(none yet)"}

Respond with ONLY a JSON array, no other text, where each element is:
{"topic": "...", "angle": "one-sentence unique angle/hook", "why_now": "why this would perform well right now"}`;

  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 4000,
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.error("Model did not return a JSON array. Raw output:\n" + text);
    process.exit(1);
  }
  const topics = JSON.parse(jsonMatch[0]);

  mkdirSync(join(root, "output"), { recursive: true });
  const outPath = join(root, `output/research-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify({ niche, generatedAt: new Date().toISOString(), topics }, null, 2));

  console.log(JSON.stringify(topics, null, 2));
  console.log(`\nSaved to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
