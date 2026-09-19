/**
 * Presenter ("talking head") support.
 *
 * A channel can have a presenter: a consistent on-screen host generated once per
 * project (projects/<slug>/assets/presenter.png — or a real photo the client drops
 * there). Scenes the script marks as shot:"presenter" are rendered as lip-synced
 * clips of the presenter speaking that scene's narration audio; the rest stay B-roll.
 *
 * Providers (config.presenter.provider):
 *   "omnihuman"  — Replicate bytedance/omni-human (uses IMAGE_API_KEY, testable today)
 *   "higgsfield" — Higgsfield Speech2Video via Segmind (SEGMIND_API_KEY). Higgsfield's
 *                  own developer API exposes no lipsync endpoint; Segmind hosts it.
 *
 * Both models want short audio (≤15 s), so long scenes are split into ≤14 s pieces,
 * generated separately and concatenated with ffmpeg.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { Project } from "./project.js";
import { secrets, requireSecrets } from "./env.js";
import { mediaDuration } from "./media.js";
import { generateImageWithRetry } from "../modules/visuals.js";

export type PresenterProvider = "omnihuman" | "higgsfield";

const PIECE_SEC = 14;

export function presenterEnabled(project: Project): boolean {
  return !!project.config.presenter?.enabled;
}

export function presenterImagePath(project: Project): string {
  return join(project.dir, "assets", "presenter.png");
}

/** The host image, generated once from config.presenter.description (or supplied by the client). */
export async function ensurePresenterImage(project: Project): Promise<string> {
  const path = presenterImagePath(project);
  if (existsSync(path)) return path;
  const desc =
    project.config.presenter?.description ||
    "a friendly, professional presenter in their 30s, looking directly at the camera, natural smile";
  const prompt = `Photorealistic medium shot of ${desc}. Facing the camera, head and shoulders centred, neutral relaxed mouth, soft studio lighting, shallow depth of field, tidy background matching this channel: ${project.config.niche}. 16:9, high detail, no text.`;
  mkdirSync(join(project.dir, "assets"), { recursive: true });
  process.stdout.write("Presenter image (one-time)... ");
  writeFileSync(path, await generateImageWithRetry(prompt));
  console.log(`saved → ${path}`);
  return path;
}

/** Split an mp3 into ≤PIECE_SEC pieces; returns the piece paths in order. */
function splitAudio(audioPath: string, workDir: string): string[] {
  const total = mediaDuration(audioPath);
  const n = Math.max(1, Math.ceil(total / PIECE_SEC));
  if (n === 1) return [audioPath];
  const pieceLen = total / n;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const p = join(workDir, `piece-${i + 1}.mp3`);
    execFileSync(
      secrets.ffmpegPath,
      ["-y", "-loglevel", "error", "-ss", (i * pieceLen).toFixed(3), "-t", pieceLen.toFixed(3), "-i", audioPath, "-c:a", "libmp3lame", "-q:a", "2", p]
    );
    out.push(p);
  }
  return out;
}

function concatClips(clips: string[], outPath: string): void {
  if (clips.length === 1) {
    execFileSync(secrets.ffmpegPath, ["-y", "-loglevel", "error", "-i", clips[0], "-c", "copy", outPath]);
    return;
  }
  const list = join(outPath + ".txt");
  writeFileSync(list, clips.map((c) => `file '${c.replace(/'/g, "'\\''")}'`).join("\n"));
  // Re-encode so pieces with slightly different encoder settings join cleanly.
  execFileSync(secrets.ffmpegPath, [
    "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list,
    "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-an", outPath,
  ]);
  rmSync(list, { force: true });
}

/** Lip-synced clip of the presenter speaking `audioPath`, written to outPath (video only). */
export async function generateTalkingClip(
  project: Project,
  opts: { imagePath: string; audioPath: string; outPath: string; prompt: string }
): Promise<void> {
  const provider: PresenterProvider = project.config.presenter?.provider ?? "omnihuman";
  const workDir = opts.outPath + ".work";
  mkdirSync(workDir, { recursive: true });
  const pieces = splitAudio(opts.audioPath, workDir);
  const clips: string[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const clip = join(workDir, `clip-${i + 1}.mp4`);
    if (!existsSync(clip)) {
      process.stdout.write(pieces.length > 1 ? `[part ${i + 1}/${pieces.length}] ` : "");
      const buf = provider === "higgsfield"
        ? await higgsfieldSpeak(opts.imagePath, pieces[i], opts.prompt)
        : await omniHuman(opts.imagePath, pieces[i]);
      writeFileSync(clip, buf);
    }
    clips.push(clip);
  }
  concatClips(clips, opts.outPath);
  rmSync(workDir, { recursive: true, force: true });
}

/* ---------------- Replicate: bytedance/omni-human ---------------- */

async function omniHuman(imagePath: string, audioPath: string): Promise<Buffer> {
  requireSecrets("imageApiKey");
  const input = {
    image: `data:image/png;base64,${readFileSync(imagePath).toString("base64")}`,
    audio: `data:audio/mpeg;base64,${readFileSync(audioPath).toString("base64")}`,
  };
  const res = await fetch("https://api.replicate.com/v1/models/bytedance/omni-human/predictions", {
    method: "POST",
    headers: { Authorization: `Bearer ${secrets.imageApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
  });
  if (!res.ok) throw new Error(`Replicate ${res.status}: ${(await res.text()).slice(0, 300)}`);
  let prediction = (await res.json()) as any;
  const start = Date.now();
  while (!["succeeded", "failed", "canceled"].includes(prediction.status)) {
    if (Date.now() - start > 15 * 60 * 1000) throw new Error("Talking-head generation timed out after 15 minutes");
    await new Promise((r) => setTimeout(r, 5000));
    prediction = await (await fetch(prediction.urls.get, { headers: { Authorization: `Bearer ${secrets.imageApiKey}` } })).json();
    process.stdout.write(".");
  }
  if (prediction.status !== "succeeded" || !prediction.output) {
    throw new Error(`OmniHuman failed: ${prediction.error ?? prediction.status}`);
  }
  const url = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  return Buffer.from(await (await fetch(url)).arrayBuffer());
}

/* ---------------- Higgsfield Speech2Video (hosted by Segmind) ---------------- */

/** Segmind wants public URLs, so inputs are staged through Replicate's file store (temporary public URLs). */
async function stageFile(path: string, type: string): Promise<string> {
  requireSecrets("imageApiKey");
  const form = new FormData();
  form.append("content", new Blob([readFileSync(path)], { type }), path.split("/").pop());
  const res = await fetch("https://api.replicate.com/v1/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${secrets.imageApiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Replicate file upload ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as any;
  return j.urls.get;
}

async function higgsfieldSpeak(imagePath: string, audioPath: string, prompt: string): Promise<Buffer> {
  requireSecrets("segmindApiKey");
  const [input_image, input_audio] = await Promise.all([stageFile(imagePath, "image/png"), stageFile(audioPath, "audio/mpeg")]);
  const sec = mediaDuration(audioPath);
  const duration = sec <= 5 ? 5 : sec <= 10 ? 10 : 15;
  const submit = await fetch("https://api.segmind.com/v2/higgsfield-speech2video", {
    method: "POST",
    headers: { "x-api-key": secrets.segmindApiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ input_image, input_audio, prompt, duration, quality: "high", enhance_prompt: false }),
  });
  if (!submit.ok) throw new Error(`Segmind ${submit.status}: ${(await submit.text()).slice(0, 300)}`);
  const { request_id } = (await submit.json()) as any;
  const start = Date.now();
  for (;;) {
    if (Date.now() - start > 15 * 60 * 1000) throw new Error("Higgsfield speech2video timed out after 15 minutes");
    await new Promise((r) => setTimeout(r, 5000));
    const st = (await (await fetch(`https://api.segmind.com/v2/requests/${request_id}/status`, { headers: { "x-api-key": secrets.segmindApiKey } })).json()) as any;
    process.stdout.write(".");
    if (st.status === "FAILED") throw new Error(`Higgsfield speech2video failed: ${st.error ?? "unknown"}`);
    if (st.status === "COMPLETED") break;
  }
  const result = (await (await fetch(`https://api.segmind.com/v2/requests/${request_id}`, { headers: { "x-api-key": secrets.segmindApiKey } })).json()) as any;
  const url: string | undefined = result.output?.video_url ?? result.output?.url ?? result.video_url ?? result.url;
  if (!url) throw new Error(`Higgsfield speech2video returned no video URL: ${JSON.stringify(result).slice(0, 200)}`);
  // Segmind clips carry the audio; strip it — the render mixes the master voiceover.
  const raw = Buffer.from(await (await fetch(url)).arrayBuffer());
  const tmp = audioPath + ".hf.mp4";
  writeFileSync(tmp, raw);
  const out = execFileSync(secrets.ffmpegPath, ["-y", "-loglevel", "error", "-i", tmp, "-an", "-c:v", "copy", "-f", "mp4", "-movflags", "frag_keyframe+empty_moov", "pipe:1"], { maxBuffer: 512 * 1024 * 1024 });
  rmSync(tmp, { force: true });
  return out;
}
