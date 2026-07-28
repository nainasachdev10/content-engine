/**
 * Module 9 — Upload
 * Input:  output/<slug>/final_video.mp4 + thumbnail.png + metadata.json
 * Output: published (unlisted by default) YouTube video; prints the video URL
 *
 * Usage:  npm run upload -- --dir output/<slug> [--privacy unlisted|private|public]
 */
import { google } from "googleapis";
import { createReadStream, readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config, requireKeys } from "./lib/config.js";
import { arg } from "./lib/util.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  requireKeys("youtubeClientId", "youtubeClientSecret", "youtubeRefreshToken");
  const dir = arg("dir");
  if (!dir) {
    console.error("Usage: npm run upload -- --dir output/<slug> [--privacy unlisted]");
    process.exit(1);
  }
  const privacy = arg("privacy") ?? "unlisted";

  const metadata: { title: string; description: string; tags: string[] } = JSON.parse(
    readFileSync(join(dir, "metadata.json"), "utf8")
  );

  const oauth2 = new google.auth.OAuth2(config.youtubeClientId, config.youtubeClientSecret);
  oauth2.setCredentials({ refresh_token: config.youtubeRefreshToken });
  const youtube = google.youtube({ version: "v3", auth: oauth2 });

  console.log(`Uploading final_video.mp4 as "${metadata.title}" (${privacy})...`);
  const res = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title: metadata.title,
        description: metadata.description,
        tags: metadata.tags,
        categoryId: "27", // Education
      },
      status: {
        privacyStatus: privacy as "unlisted" | "private" | "public",
        selfDeclaredMadeForKids: config.madeForKids,
      },
    },
    media: { body: createReadStream(join(dir, "final_video.mp4")) },
  });

  const videoId = res.data.id!;
  console.log(`Video uploaded: https://youtu.be/${videoId}`);

  const thumbPath = join(dir, "thumbnail.png");
  if (existsSync(thumbPath)) {
    await youtube.thumbnails.set({ videoId, media: { body: createReadStream(thumbPath) } });
    console.log("Thumbnail set.");
  }

  // Record in state so research.ts stops suggesting this topic.
  const statePath = join(root, "state", "published_topics.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  state.topics.push({ topic: metadata.title, videoId, publishedAt: new Date().toISOString() });
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  console.log(`Recorded in ${statePath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
