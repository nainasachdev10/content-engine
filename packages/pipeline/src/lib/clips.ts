/**
 * Image-to-video clip providers for hero scenes.
 *
 *   replicate  (default) — one key for everything; model configurable, default Kling 2.5 Turbo Pro.
 *                          Accepts base64 inputs, so no file hosting is needed.
 *   higgsfield           — Higgsfield's own API (DoP cinematic model, or its Kling 2.5 endpoint).
 *                          Better only when a channel has Higgsfield credits and wants DoP's camera
 *                          presets; needs HIGGSFIELD_API_KEY_ID + HIGGSFIELD_API_KEY_SECRET and public
 *                          image URLs (staged through Replicate's file store).
 *
 * The script's per-scene "motion" phrase drives the camera move on both providers.
 */
import { readFileSync } from "node:fs";
import type { Project } from "./project.js";
import { secrets, requireSecrets } from "./env.js";

export type ClipProvider = "replicate" | "higgsfield";

export const DEFAULT_REPLICATE_CLIP_MODEL = "kwaivgi/kling-v2.5-turbo-pro";
export const DEFAULT_HIGGSFIELD_CLIP_MODEL = "higgsfield-ai/dop/standard";

export function clipProvider(project: Project): ClipProvider {
  return project.config.video.clipProvider ?? "replicate";
}

export async function generateClip(
  project: Project,
  opts: { imagePath: string; visual: string; motion?: string }
): Promise<Buffer> {
  const prompt = `${opts.visual}. Camera: ${opts.motion ?? "subtle cinematic camera motion"}. Natural, smooth movement — no warping or morphing, no text.`;
  return clipProvider(project) === "higgsfield"
    ? higgsfieldClip(project, opts.imagePath, prompt, opts.motion)
    : replicateClip(project, opts.imagePath, prompt);
}

/* ---------------- Replicate ---------------- */

async function fetchRetry(url: string, init?: RequestInit, attempts = 6): Promise<Response> {
  let last = "";
  for (let i = 0; i < attempts; i++) {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      last = String(err);
      await new Promise((r) => setTimeout(r, 5000 * (i + 1)));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      last = `${res.status}: ${(await res.text()).slice(0, 200)}`;
      process.stdout.write(`[replicate ${res.status}, retrying] `);
      await new Promise((r) => setTimeout(r, 10_000 * (i + 1)));
      continue;
    }
    return res;
  }
  throw new Error(`Replicate unreachable after ${attempts} attempts: ${last}`);
}

async function modelInputFields(model: string): Promise<string[]> {
  const res = await fetchRetry(`https://api.replicate.com/v1/models/${model}`, {
    headers: { Authorization: `Bearer ${secrets.imageApiKey}` },
  });
  if (!res.ok) throw new Error(`Replicate model lookup ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as any;
  return Object.keys(data.latest_version.openapi_schema.components.schemas.Input.properties);
}

async function replicateClip(project: Project, imagePath: string, prompt: string): Promise<Buffer> {
  requireSecrets("imageApiKey");
  const model = project.config.video.clipModel ?? DEFAULT_REPLICATE_CLIP_MODEL;
  const fields = await modelInputFields(model);
  // Models disagree on the first-frame field name; pick whatever this one exposes.
  const imageField =
    fields.find((k) => /(start|first|init).*image|image.*(start|first|init)/i.test(k)) ??
    fields.find((k) => /^image$/i.test(k)) ??
    fields.find((k) => /image/i.test(k) && !/(end|last|final)/i.test(k)) ??
    "image";
  const input: Record<string, unknown> = {
    prompt,
    [imageField]: `data:image/png;base64,${readFileSync(imagePath).toString("base64")}`,
  };
  const durationField = fields.find((k) => /duration/i.test(k));
  if (durationField) input[durationField] = 5;
  const aspectField = fields.find((k) => /aspect/i.test(k));
  if (aspectField) input[aspectField] = "16:9";
  if (fields.includes("generate_audio")) input.generate_audio = false;

  const create = await fetchRetry(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secrets.imageApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
  });
  if (!create.ok) throw new Error(`Replicate ${create.status}: ${(await create.text()).slice(0, 300)}`);
  let prediction = (await create.json()) as any;
  const start = Date.now();
  while (!["succeeded", "failed", "canceled"].includes(prediction.status)) {
    if (Date.now() - start > 15 * 60 * 1000) throw new Error("Clip generation timed out after 15 minutes");
    await new Promise((r) => setTimeout(r, 5000));
    prediction = await (await fetchRetry(prediction.urls.get, { headers: { Authorization: `Bearer ${secrets.imageApiKey}` } })).json();
    process.stdout.write(".");
  }
  if (prediction.status !== "succeeded" || !prediction.output) {
    throw new Error(`Clip prediction failed (${model}): ${prediction.error ?? prediction.status}`);
  }
  const url = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  return Buffer.from(await (await fetch(url)).arrayBuffer());
}

/** Public, temporary URL for a local file (Higgsfield only accepts URLs). */
export async function stagePublicFile(path: string, type: string): Promise<string> {
  requireSecrets("imageApiKey");
  const form = new FormData();
  form.append("content", new Blob([readFileSync(path)], { type }), path.split("/").pop());
  const res = await fetch("https://api.replicate.com/v1/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${secrets.imageApiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`File staging ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()) as any).urls.get;
}

/* ---------------- Higgsfield (official API) ---------------- */

const HF_API = "https://api.higgsfield.ai";

/** Higgsfield auth is "Key <id>:<secret>". Accept the pair, a single "id:secret" string, or a bare key. */
function hfHeaders(): Record<string, string> {
  let id = secrets.higgsfieldKeyId;
  let secret = secrets.higgsfieldKeySecret;
  const single = id || secret;
  if ((!id || !secret) && single.includes(":")) [id, secret] = single.split(":", 2);
  const token = id && secret ? `${id}:${secret}` : single;
  if (!token) throw new Error("Missing key(s): Higgsfield. Add it in the dashboard under Settings → Connections.");
  return { Authorization: `Key ${token}`, "Content-Type": "application/json" };
}

async function higgsfieldClip(project: Project, imagePath: string, prompt: string, motion?: string): Promise<Buffer> {
  const model = project.config.video.clipModel ?? DEFAULT_HIGGSFIELD_CLIP_MODEL;
  const image_url = await stagePublicFile(imagePath, "image/png");
  const body: Record<string, unknown> = model.startsWith("kling-video/")
    ? { prompt, image_url, duration: 5 }
    : { prompt, image_url, enhance_prompt: true }; // DoP: the motion phrase in the prompt selects the camera move
  const submit = await fetch(`${HF_API}/${model}`, { method: "POST", headers: hfHeaders(), body: JSON.stringify(body) });
  if (!submit.ok) throw new Error(`Higgsfield ${submit.status}: ${(await submit.text()).slice(0, 300)}`);
  const req = (await submit.json()) as any;
  const statusUrl: string = req.status_url ?? `${HF_API}/requests/${req.request_id}/status`;
  const start = Date.now();
  let st: any;
  for (;;) {
    if (Date.now() - start > 15 * 60 * 1000) throw new Error("Higgsfield clip timed out after 15 minutes");
    await new Promise((r) => setTimeout(r, 5000));
    st = await (await fetch(statusUrl, { headers: hfHeaders() })).json();
    process.stdout.write(".");
    const s = String(st.status ?? "").toLowerCase();
    if (["failed", "error", "cancelled", "canceled", "nsfw"].includes(s)) throw new Error(`Higgsfield clip failed: ${st.error ?? st.status}`);
    if (["completed", "succeeded", "success", "done"].includes(s)) break;
  }
  const url = findVideoUrl(st);
  if (!url) throw new Error(`Higgsfield returned no video URL: ${JSON.stringify(st).slice(0, 300)}`);
  return Buffer.from(await (await fetch(url)).arrayBuffer());
}

/** The completed-request shape isn't pinned in Higgsfield's public spec; look for the first .mp4 URL. */
function findVideoUrl(obj: unknown): string | null {
  if (typeof obj === "string") return /^https?:\/\/.*\.(mp4|mov|webm)(\?|$)/i.test(obj) ? obj : null;
  if (Array.isArray(obj)) {
    for (const v of obj) {
      const u = findVideoUrl(v);
      if (u) return u;
    }
    return null;
  }
  if (obj && typeof obj === "object") {
    for (const k of ["url", "video_url", "video", "videos", "output", "result", "data"]) {
      if (k in (obj as any)) {
        const u = findVideoUrl((obj as any)[k]);
        if (u) return u;
      }
    }
    for (const v of Object.values(obj as any)) {
      const u = findVideoUrl(v);
      if (u) return u;
    }
  }
  return null;
}
