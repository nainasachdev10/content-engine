/**
 * Shared account-level secrets from the repo-root .env.
 * Channel/project-specific values live in projects/<slug>/config.json (+ .env) — see project.ts.
 */
import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

// packages/pipeline/src/lib → repo root is four levels up.
export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

loadDotenv({ path: join(repoRoot, ".env") });

// Keys entered in the dashboard (data/connections.json) win over host env.
try {
  const p = join(repoRoot, "data", "connections.json");
  if (existsSync(p)) {
    const c = JSON.parse(readFileSync(p, "utf8")) as Record<string, string>;
    for (const [k, v] of Object.entries(c)) if (v) process.env[k] = v;
  }
} catch {
  /* unreadable connections file — host env applies */
}

export const secrets = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY ?? "",
  imageApiKey: process.env.IMAGE_API_KEY ?? "",
  // Only for presenter.provider = "higgsfield" (Higgsfield Speech2Video is served through Segmind).
  segmindApiKey: process.env.SEGMIND_API_KEY ?? "",
  // Only for video.clipProvider = "higgsfield" (DoP cinematic clips via Higgsfield's own API).
  higgsfieldKeyId: process.env.HIGGSFIELD_API_KEY_ID ?? "",
  higgsfieldKeySecret: process.env.HIGGSFIELD_API_KEY_SECRET ?? "",
  youtubeClientId: process.env.YOUTUBE_CLIENT_ID ?? "",
  youtubeClientSecret: process.env.YOUTUBE_CLIENT_SECRET ?? "",
  // Full-featured build (drawtext/subtitles filters); Homebrew's default ffmpeg 8 is a slim build without them.
  ffmpegPath: process.env.FFMPEG_PATH ?? "ffmpeg",
};

/** Throw with a clear message if any of the named keys are blank in the root .env. */
export function requireSecrets(...keys: (keyof typeof secrets)[]): void {
  const missing = keys.filter((k) => !secrets[k]);
  if (missing.length > 0) {
    throw new Error(
      `Missing key(s): ${missing.join(", ")}. Add them in the dashboard under Settings → Connections (or the host .env).`
    );
  }
}

export const ffprobePath = (): string => secrets.ffmpegPath.replace(/ffmpeg([^/\\]*)$/, "ffprobe$1");
