/**
 * Module 2 — Script Generation
 * Input:  a chosen topic (--topic "..." plus optional --angle "...")
 * Output: output/<slug>/script.json  (scenes: narration + visual_description)
 *
 * Usage:  npm run script -- --topic "The fall of Constantinople" [--angle "..."] [--niche "..."]
 */
import Anthropic from "@anthropic-ai/sdk";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config, requireKeys } from "./lib/config.js";
import { slugify, arg } from "./lib/util.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  requireKeys("anthropicApiKey");
  const topic = arg("topic");
  if (!topic) {
    console.error('Usage: npm run script -- --topic "Your topic here" [--angle "..."]');
    process.exit(1);
  }
  const angle = arg("angle");
  const niche = arg("niche") ?? config.niche;
  const minutes = Number(arg("minutes") ?? config.videoLengthMinutes);
  // ~150 spoken words per minute
  const targetWords = minutes * 150;

  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const prompt = `Write a YouTube video script for a channel in the niche "${niche}".

Topic: ${topic}
${angle ? `Angle: ${angle}` : ""}
Target length: ${minutes} minutes (~${targetWords} words of narration total).

Structure it as 8-14 scenes. This channel targets kids aged 6-10 and must satisfy BOTH high watch-time retention AND YouTube Kids quality/monetization policy. Follow all rules strictly:

RETENTION (keep them watching):
- SCENE 1 (the hook): open cold with the single most fascinating fact or question of the whole video in the FIRST sentence — no greetings, no "today we'll learn about". Then promise a payoff ("stick around, because the answer is amazing").
- CURIOSITY LOOPS: open a question early that only gets answered near the end, and remind viewers it's coming ("remember those mysterious spots? We're getting close...").
- RE-HOOKS: every 3-4 scenes, drop a wonder-based pattern interrupt — "but here's the coolest part", "and this is where it gets really interesting", or a direct question to the viewer.
- INTERACTIVE MOMENTS: 1-2 places where the narrator asks kids to guess, count, or shout an answer at the screen before revealing it.
- ENDING: deliver the payoff of the opening question, then end with an open question that teases the next video, plus a quick like/subscribe ask.

KIDS-POLICY SAFETY (violating any of these risks demonetization):
- TONE: calm-but-enthusiastic, warm, and encouraging. Curiosity and wonder — never shock, fear, dread, or anxiety. No frightening, violent, gross, or unsettling framing, even for dramatic topics.
- HONESTY: no sensationalism, exaggeration, or misleading claims. Every fact must be genuinely true and educational — a parent watching along should think "my kid is actually learning something".
- LANGUAGE: short clear sentences, vivid comparisons kids know (school buses, swimming pools, playgrounds), zero jargon without an instant fun explanation.

Each scene has:
- "narration": the exact words the voiceover will speak (conversational, no stage directions)
- "visual_description": a detailed prompt for an AI image generator depicting that scene. Mandate a vibrant, high-quality 3D-animated family-film style (Pixar/Disney-like): rounded friendly shapes, warm cinematic lighting, and characters with natural, positive expressions (curious, delighted, amazed — never scared or distressed). No text in the image. Keep the style consistent across scenes, and make each composition dynamic — action mid-motion, interesting camera angles — not static portraits.

Respond with ONLY JSON, no other text:
{"topic": "...", "style_note": "one-line shared visual style for all scenes", "scenes": [{"narration": "...", "visual_description": "..."}]}`;

  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 8000,
    messages: [{ role: "user", content: prompt }],
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
  const script = JSON.parse(jsonMatch[0]);

  const dir = join(root, "output", slugify(topic));
  mkdirSync(dir, { recursive: true });
  const outPath = join(dir, "script.json");
  writeFileSync(outPath, JSON.stringify(script, null, 2));

  const words = script.scenes.reduce((n: number, s: any) => n + s.narration.split(/\s+/).length, 0);
  console.log(`${script.scenes.length} scenes, ~${words} narration words (~${(words / 150).toFixed(1)} min)`);
  console.log(`Saved to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
