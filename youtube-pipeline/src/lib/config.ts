import "dotenv/config";

export const config = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY ?? "",
  elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID ?? "",
  imageApiKey: process.env.IMAGE_API_KEY ?? "",
  youtubeClientId: process.env.YOUTUBE_CLIENT_ID ?? "",
  youtubeClientSecret: process.env.YOUTUBE_CLIENT_SECRET ?? "",
  youtubeRefreshToken: process.env.YOUTUBE_REFRESH_TOKEN ?? "",
  niche: process.env.NICHE ?? "history explainers",
  videoLengthMinutes: Number(process.env.VIDEO_LENGTH_MINUTES ?? 5),
  madeForKids: process.env.MADE_FOR_KIDS === "true",
  // Full-featured build (drawtext/subtitles filters); Homebrew's default ffmpeg 8 is a slim build without them.
  ffmpegPath: process.env.FFMPEG_PATH ?? "ffmpeg",
};

/** Exit with a clear message if any of the named keys are blank in .env. */
export function requireKeys(...keys: (keyof typeof config)[]): void {
  const missing = keys.filter((k) => !config[k]);
  if (missing.length > 0) {
    console.error(
      `Missing required .env value(s): ${missing.join(", ")}. ` +
        `Fill them in youtube-pipeline/.env before running this module.`
    );
    process.exit(1);
  }
}
