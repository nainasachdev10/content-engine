/**
 * Stage 2 — Script Generation
 * Writes projects/<slug>/output/<video-slug>/script.json (scenes: narration + visual_description + shot/motion).
 *
 * Two-pass generation:
 *   1. Draft — picks the best narrative format for the topic (avoiding formats
 *      recent videos used) and writes to that format's beat sheet with real
 *      cinematography per scene.
 *   2. Punch-up — a ruthless script-doctor pass that kills AI-tell phrasing,
 *      swaps vague superlatives for concrete specifics, and tunes rhythm for the ear.
 *
 * All niche-specific rules come from config.prompts — no hardcoded audience assumptions.
 */
import { writeFileSync, mkdirSync, readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "../lib/project.js";
import { anthropic, textOf, parseJson } from "../lib/claude.js";
import { slugify } from "../lib/util.js";
import { FORMATS, ALL_FORMAT_KEYS, formatMenu } from "../lib/formats.js";
import { hubPromptBlock } from "../lib/notion.js";

export interface Scene {
  narration: string;
  visual_description: string;
  /** e.g. "establishing wide", "close-up", "aerial", "macro", "POV", "low-angle" */
  shot?: string;
  /** short camera-move phrase used by Ken Burns direction + image-to-video prompts */
  motion?: string;
}

export interface Script {
  topic: string;
  format?: string;
  style_note: string;
  scenes: Scene[];
}

/** Universal writing rules — these are what make narration sound human instead of generated.
 *  Niche-specific tone/safety rules live in config.prompts.scriptRules on top of these. */
const WRITING_RULES = `WRITE FOR THE EAR, NOT THE PAGE:
- Vary sentence length deliberately. Follow a long sentence with a three-word one. Rhythm is retention.
- Every scene must connect to the next with "but" or "therefore" — never "and then". If a scene could be deleted without breaking the chain, delete it.
- CONCRETE beats VAGUE, always: "34 times hotter than boiling water", not "incredibly hot"; "the length of two school buses", not "really long". Every scene needs at least one specific number, name, place, or sensory detail.
- Rhetorical questions max twice in the whole script, and never as the opening line.

BANNED PHRASES (these instantly mark a script as AI-generated — never use them or close variants):
"dive into", "let's explore", "in this video", "buckle up", "get ready to", "have you ever wondered", "the answer might surprise you", "little did they know", "but here's the kicker", "unlock the secrets", "the fascinating world of", "it's important to note", "imagine a world", "hidden gem", "game-changer", "take a journey", "so there you have it", "wrapped up", "nature's way of", "a testament to".

CINEMATOGRAPHY (each scene is a film shot, not an illustration):
- Give every scene a "shot" (choose from: establishing wide, medium, close-up, extreme close-up, aerial, POV, low-angle, over-the-shoulder) — never the same shot twice in a row, and use at least 4 different shot types across the video.
- Give every scene a "motion": one short camera-move phrase ("slow push-in toward the anglerfish's lure", "drift right past the rows of amphorae").
- Write visual_description like a film still: subject mid-action, foreground AND background layers, a named light source ("bioluminescent glow from below", "late-afternoon sun through dust"). No static centered portraits.`;

/** Extra rules when the channel has an on-camera host: some scenes are the presenter talking. */
function presenterRules(config: Project["config"]): string {
  if (!config.presenter?.enabled) return "";
  const pct = Math.round((config.presenter.share ?? 0.35) * 100);
  return `
PRESENTER (this channel has an on-camera host): mark about ${pct}% of scenes with "shot": "presenter" — always the opening hook and the closing payoff, plus the re-hook/transition moments where a host talking straight to camera lands best. Presenter-scene rules:
- narration is spoken to camera, first person plural or second person ("you"), max 45 words per presenter scene (split a longer beat into two scenes);
- "visual_description" describes only the host's setting/mood for that beat (e.g. "leaning in, lit by a screen glow, excited") — never a new character;
- "motion" is "static — host speaking to camera".
All other scenes are B-roll and follow the normal cinematography rules.`;
}

function recentFormats(outputRoot: string, limit = 4): string[] {
  if (!existsSync(outputRoot)) return [];
  const dirs = readdirSync(outputRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(outputRoot, d.name, "script.json")))
    .map((d) => ({ name: d.name, mtime: statSync(join(outputRoot, d.name, "script.json")).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);
  const out: string[] = [];
  for (const d of dirs) {
    try {
      const s = JSON.parse(readFileSync(join(outputRoot, d.name, "script.json"), "utf8"));
      if (s.format) out.push(s.format);
    } catch {
      /* unreadable old script — irrelevant */
    }
  }
  return out;
}

export async function runScript(
  project: Project,
  opts: { topic: string; angle?: string; minutes?: number; format?: string }
): Promise<{ videoDir: string; script: Script }> {
  const { config } = project;
  const minutes = opts.minutes ?? config.video.lengthMinutes;
  const targetWords = Math.round(minutes * 150); // ~150 spoken words per minute
  // Scene count scales with length: ~5min → 8-14, ~1min → 3-5.
  const sceneMin = Math.max(3, Math.round(minutes * 1.6));
  const sceneMax = Math.max(sceneMin + 2, Math.round(minutes * 2.8));

  const language = config.language && config.language !== "en" ? config.language : null;

  const allowed = (config.video.formats?.length ? config.video.formats : ALL_FORMAT_KEYS).filter(
    (k) => FORMATS[k]
  );
  if (opts.format && !FORMATS[opts.format]) {
    throw new Error(`Unknown format "${opts.format}". Available: ${ALL_FORMAT_KEYS.join(", ")}`);
  }
  const forced = opts.format;
  const used = recentFormats(project.outputRoot);

  const formatSection = forced
    ? `Use EXACTLY this narrative format:\n\n${formatMenu([forced])}`
    : `First, pick the ONE narrative format below that best fits this topic. ${
        used.length ? `Recent videos on this channel used: ${used.join(", ")} — prefer a different format unless the fit is clearly better.` : ""
      }\n\n${formatMenu(allowed)}`;

  // Empty string unless the project has a Notion hub the client maintains.
  const hub = await hubPromptBlock(project);

  const draftPrompt = `${hub}Write a YouTube video script for a channel in the niche "${config.niche}".

Topic: ${opts.topic}
${opts.angle ? `Angle: ${opts.angle}` : ""}
Target length: ${minutes} minutes (~${targetWords} words of narration total).
Audience: ${config.audience.description}.
${language ? `Write all narration in ${language}.` : ""}

${formatSection}

Structure it as ${sceneMin}-${sceneMax} scenes following the chosen format's beats. Follow ALL rules strictly:

${WRITING_RULES}

CHANNEL-SPECIFIC RULES:
${config.prompts.scriptRules}

Each scene has:
- "narration": the exact words the voiceover will speak (conversational, no stage directions)
- "visual_description": a detailed prompt for an AI image generator depicting that scene. Visual style mandate: ${config.prompts.visualStyle} No text in the image.
- "shot": the shot type
- "motion": the camera-move phrase
${presenterRules(config)}

Respond with ONLY JSON, no other text:
{"topic": "...", "format": "<format key>", "style_note": "one-line shared visual style for all scenes", "scenes": [{"narration": "...", "visual_description": "...", "shot": "...", "motion": "..."}]}`;

  const draftRes = await anthropic().messages.create({
    model: config.models.script,
    max_tokens: 8000,
    messages: [{ role: "user", content: draftPrompt }],
  });
  const draft = parseJson<Script>(textOf(draftRes));
  console.log(`Draft: ${draft.scenes.length} scenes, format "${draft.format ?? "?"}" — running punch-up pass...`);

  const punchUpPrompt = `You are a ruthless script doctor for YouTube. Below is a draft script. Rewrite it to be genuinely worth watching — most AI-written scripts are informative but forgettable; your job is to make this one land.

Draft script JSON:
${JSON.stringify(draft, null, 2)}

Editing mandate — rewrite narration wherever it falls short:
1. THE HOOK: the first sentence must be un-scroll-past-able. If it isn't the single most arresting concrete fact of the video, replace it.
2. Hunt down every vague superlative ("amazing", "incredible", "massive", "fascinating") and replace it with the specific fact that earns it. If no specific fact exists, cut the claim.
3. Kill any remaining AI-tell phrasing (${'"dive into", "let\'s explore", "buckle up", "have you ever wondered"'} and their relatives) — rewrite in plain, confident, spoken English.
4. Read every sentence aloud in your head. Break up anything you'd stumble on. Vary rhythm: at least one deliberately short sentence (≤5 words) every 2-3 scenes.
5. Check the format's promise is honored: does the payoff scene actually deliver what the hook promised? If it's weak, strengthen the payoff, not the hype.
6. Scene-to-scene: every scene must end pulling the viewer into the next (an open question, an unresolved tension, a "but"). Fix any scene that ends flat.
7. Do NOT inflate length — keep total narration within ±10% of the draft's word count (${draft.scenes.reduce((n, s) => n + s.narration.split(/\s+/).length, 0)} words). Keep the same number of scenes. Keep visual_description/shot/motion unchanged UNLESS the narration change makes a visual mismatch — then update it (same style mandate).${config.presenter?.enabled ? ' Scenes with "shot": "presenter" must keep that shot value and stay ≤45 words.' : ""}

These channel rules must still hold:
${config.prompts.scriptRules}

Respond with ONLY the full corrected script JSON, same schema, no other text.`;

  const finalRes = await anthropic().messages.create({
    model: config.models.script,
    max_tokens: 8000,
    messages: [{ role: "user", content: punchUpPrompt }],
  });
  const script = parseJson<Script>(textOf(finalRes));
  if (!script.format) script.format = draft.format;

  const videoDir = join(project.outputRoot, slugify(opts.topic));
  mkdirSync(videoDir, { recursive: true });
  writeFileSync(join(videoDir, "script.json"), JSON.stringify(script, null, 2));

  const words = script.scenes.reduce((n, s) => n + s.narration.split(/\s+/).length, 0);
  console.log(
    `${script.scenes.length} scenes [${script.format}], ~${words} narration words (~${(words / 150).toFixed(1)} min) → ${join(videoDir, "script.json")}`
  );
  return { videoDir, script };
}
