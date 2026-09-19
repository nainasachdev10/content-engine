/**
 * Stage — Prompt-based editing of a produced video.
 *
 * Claude interprets a natural-language instruction against the current script/
 * metadata, returns a minimal change plan, and only the affected stages re-run:
 *   narration change  → voiceover (chunk cache re-bills only changed scenes) + render
 *   image change      → that scene's visual + render
 *   metadata change   → written directly (the plan already contains it)
 *   thumbnail change  → thumbnail stage with new text/hint
 * Validation always re-runs; the result lands back in the approval queue.
 *
 * Before applying anything, the current state is snapshotted to
 * <videoDir>/versions/v<N>/ so every prior version stays comparable and
 * restorable (see runRollback).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "../lib/project.js";
import { anthropic, textOf, parseJson } from "../lib/claude.js";
import { runVoiceover } from "./voiceover.js";
import { runVisuals } from "./visuals.js";
import { runRenderFfmpeg } from "./renderFfmpeg.js";
import { runRenderHf } from "./renderHf.js";
import { runCaptions } from "./captions.js";
import { runMusic } from "../lib/music.js";
import { runThumbnail } from "./thumbnail.js";
import { runValidate } from "./validate.js";
import type { Script } from "./script.js";

interface EditPlan {
  summary: string;
  script: Script | null;
  metadata: { title: string; description: string; tags: string[]; thumbnail_text: string } | null;
  thumbnail: { text?: string; hint?: string } | null;
}

const VERSIONED_FILES = [
  "script.json",
  "metadata.json",
  "validation.json",
  "thumbnail.png",
  "thumbnail_base.png",
  "final_video.mp4",
  "captions.srt",
];

export function snapshotVersion(dir: string, instruction: string, summary: string): number {
  const versionsDir = join(dir, "versions");
  mkdirSync(versionsDir, { recursive: true });
  const indexPath = join(versionsDir, "versions.json");
  const index: { v: number; instruction: string; summary: string; createdAt: string }[] = existsSync(indexPath)
    ? JSON.parse(readFileSync(indexPath, "utf8"))
    : [];
  const v = index.length + 1;
  const vDir = join(versionsDir, `v${v}`);
  mkdirSync(vDir, { recursive: true });
  for (const f of VERSIONED_FILES) {
    if (existsSync(join(dir, f))) copyFileSync(join(dir, f), join(vDir, f));
  }
  index.push({ v, instruction, summary, createdAt: new Date().toISOString() });
  writeFileSync(indexPath, JSON.stringify(index, null, 2));
  return v;
}

export async function runEdit(
  project: Project,
  opts: { dir: string; instruction: string }
): Promise<{ summary: string; stagesRun: string[] }> {
  const { dir, instruction } = opts;
  const script: Script = JSON.parse(readFileSync(join(dir, "script.json"), "utf8"));
  const metadataPath = join(dir, "metadata.json");
  const metadata = existsSync(metadataPath) ? readFileSync(metadataPath, "utf8") : null;

  const response = await anthropic().messages.create({
    model: project.config.models.script,
    max_tokens: 8000,
    messages: [
      {
        role: "user",
        content: `You are editing an already-produced YouTube video. Apply the editor's instruction with the MINIMAL possible change — every modified scene costs money to regenerate (voiceover + image), so scenes not affected by the instruction must be copied through byte-identical.

Channel niche: ${project.config.niche}
Audience: ${project.config.audience.description}

Current script JSON:
${JSON.stringify(script, null, 2)}
${metadata ? `\nCurrent metadata JSON:\n${metadata}` : ""}

Editor's instruction: "${instruction}"

Script content rules (must still hold after the edit):
${project.config.prompts.scriptRules}

Respond with ONLY JSON, no other text:
{
  "summary": "one sentence describing exactly what changed",
  "script": <the FULL updated script JSON with the same structure, or null if the instruction needs no script change. Unaffected scenes MUST be byte-identical copies (same narration string, same visual_description string)>,
  "metadata": <the full updated metadata JSON {"title","description","tags","thumbnail_text"}, or null if unchanged>,
  "thumbnail": <{"text": "...", "hint": "..."} to regenerate the thumbnail (hint = new image concept), or null if unchanged>
}`,
      },
    ],
  });

  const plan = parseJson<EditPlan>(textOf(response));
  console.log(`Edit plan: ${plan.summary}`);

  // Diff scenes to find the minimal stage set.
  const newScript = plan.script;
  let narrationChanged = false;
  const changedVisualScenes: number[] = [];
  if (newScript) {
    const oldScenes = script.scenes;
    const newScenes = newScript.scenes;
    if (oldScenes.length !== newScenes.length) narrationChanged = true;
    for (let i = 0; i < newScenes.length; i++) {
      const old = oldScenes[i];
      if (!old || old.narration !== newScenes[i].narration) narrationChanged = true;
      if (!old || old.visual_description !== newScenes[i].visual_description) changedVisualScenes.push(i + 1);
    }
  }
  const contentChanged = narrationChanged || changedVisualScenes.length > 0;
  if (!contentChanged && !plan.metadata && !plan.thumbnail) {
    throw new Error(`The instruction produced no changes (plan summary: ${plan.summary})`);
  }

  // Snapshot the current state before touching anything.
  const v = snapshotVersion(dir, instruction, plan.summary);
  console.log(`Current state saved as version v${v}`);

  const stagesRun: string[] = [];

  if (newScript && contentChanged) {
    writeFileSync(join(dir, "script.json"), JSON.stringify(newScript, null, 2));
    for (const n of changedVisualScenes) {
      for (const f of [`scene-${n}.png`, `scene-${n}.mp4`, `scene-${n}-lastframe.png`]) {
        rmSync(join(dir, "images", f), { force: true });
      }
    }
    // A presenter clip is tied to its narration audio, so changed narration invalidates it too.
    if (narrationChanged && project.config.presenter?.enabled) {
      for (let i = 0; i < newScript.scenes.length; i++) {
        if (newScript.scenes[i].shot === "presenter" && script.scenes[i]?.narration !== newScript.scenes[i].narration) {
          for (const f of [`scene-${i + 1}.mp4`, `scene-${i + 1}-lastframe.png`]) rmSync(join(dir, "images", f), { force: true });
        }
      }
    }
  }

  if (narrationChanged) {
    console.log("\n→ voiceover (only changed scenes re-billed)");
    await runVoiceover(project, { dir });
    stagesRun.push("voiceover");
  }
  if (contentChanged) {
    const manifest = existsSync(join(dir, "visuals-manifest.json"))
      ? JSON.parse(readFileSync(join(dir, "visuals-manifest.json"), "utf8"))
      : { mode: "slideshow" };
    console.log("\n→ visuals (only deleted/missing scenes regenerate)");
    await runVisuals(project, { dir, mode: manifest.mode });
    stagesRun.push("visuals");

    console.log("\n→ render");
    if (project.config.video.renderer === "hyperframes") {
      await runRenderHf(project, { dir });
    } else {
      await runRenderFfmpeg(project, { dir });
    }
    stagesRun.push("render");
    await runCaptions(project, { dir, burn: project.config.video.renderer === "ffmpeg" });
    stagesRun.push("captions");
    await runMusic(project, { dir }); // no-op when the project has music disabled
    stagesRun.push("music");
  }

  if (plan.metadata) {
    writeFileSync(metadataPath, JSON.stringify(plan.metadata, null, 2));
    console.log("→ metadata updated from plan");
    stagesRun.push("metadata");
  }
  if (plan.thumbnail) {
    if (plan.thumbnail.hint) rmSync(join(dir, "thumbnail_base.png"), { force: true });
    console.log("\n→ thumbnail");
    await runThumbnail(project, { dir, text: plan.thumbnail.text, hint: plan.thumbnail.hint });
    stagesRun.push("thumbnail");
  }

  console.log("\n→ validate");
  await runValidate(project, { dir });
  stagesRun.push("validate");

  console.log(`\nEdit complete: ${plan.summary} (stages: ${stagesRun.join(", ")})`);
  return { summary: plan.summary, stagesRun };
}

/** Restore a snapshot from versions/v<N>. The pre-rollback state is snapshotted first. */
export async function runRollback(project: Project, opts: { dir: string; version: number }): Promise<void> {
  const { dir, version } = opts;
  const vDir = join(dir, "versions", `v${version}`);
  if (!existsSync(vDir)) throw new Error(`No version v${version} in ${dir}/versions`);
  snapshotVersion(dir, `(rollback to v${version})`, `state before rolling back to v${version}`);
  for (const f of VERSIONED_FILES) {
    if (existsSync(join(vDir, f))) copyFileSync(join(vDir, f), join(dir, f));
  }
  console.log(`Rolled back to v${version} (previous state saved as a new version).`);
}
