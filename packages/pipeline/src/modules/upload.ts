/**
 * Stage — Upload (YouTube Data API)
 * Uses the PROJECT's own channel: refresh token from projects/<slug>/.env.
 * Never called by `engine run` — uploads happen only via explicit approval (Phase B queue).
 */
import { google } from "googleapis";
import { createReadStream, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "../lib/project.js";
import { secrets, requireSecrets } from "../lib/env.js";
import { pruneVideoDir } from "../lib/prune.js";
import { syncPipelineRow } from "../lib/notion.js";

export async function runUpload(
  project: Project,
  opts: { dir: string; privacy?: "private" | "unlisted" | "public"; runId?: string }
): Promise<string> {
  requireSecrets("youtubeClientId", "youtubeClientSecret");
  if (!project.youtubeRefreshToken) {
    throw new Error(
      `Project "${project.slug}" has no YOUTUBE_REFRESH_TOKEN in ${join(project.dir, ".env")}. ` +
        `Run the one-time OAuth setup for this channel first.`
    );
  }
  const { dir } = opts;
  const privacy = opts.privacy ?? project.config.youtube.defaultPrivacy;

  const videoPath = join(dir, "final_video.mp4");
  if (!existsSync(videoPath)) throw new Error(`No final_video.mp4 in ${dir} — render first.`);

  const metadata: { title: string; description: string; tags: string[] } = JSON.parse(
    readFileSync(join(dir, "metadata.json"), "utf8")
  );

  const oauth2 = new google.auth.OAuth2(secrets.youtubeClientId, secrets.youtubeClientSecret);
  oauth2.setCredentials({ refresh_token: project.youtubeRefreshToken });
  const youtube = google.youtube({ version: "v3", auth: oauth2 });

  console.log(`Uploading final_video.mp4 as "${metadata.title}" (${privacy})...`);
  const res = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title: metadata.title,
        description: metadata.description,
        tags: metadata.tags,
        categoryId: project.config.youtube.categoryId,
      },
      status: {
        privacyStatus: privacy,
        selfDeclaredMadeForKids: project.config.audience.madeForKids,
      },
    },
    media: { body: createReadStream(videoPath) },
  });

  const videoId = res.data.id!;
  console.log(`Video uploaded: https://youtu.be/${videoId}`);

  const thumbPath = join(dir, "thumbnail.png");
  if (existsSync(thumbPath)) {
    await youtube.thumbnails.set({ videoId, media: { body: createReadStream(thumbPath) } });
    console.log("Thumbnail set.");
  }

  // Record in project state so research stops suggesting this topic.
  const state = JSON.parse(readFileSync(project.stateFile, "utf8"));
  state.topics.push({ topic: metadata.title, videoId, publishedAt: new Date().toISOString() });
  writeFileSync(project.stateFile, JSON.stringify(state, null, 2));
  console.log(`Recorded in ${project.stateFile}`);
  // YouTube now holds the full-quality file; keep only a lean review copy on disk.
  const { freedMb } = pruneVideoDir(dir, { shrinkFinal: true });
  if (freedMb) console.log(`Cleaned up ${freedMb} MB of intermediates.`);

  // Mirror the publish into the client's Notion pipeline (no-op without Notion).
  await syncPipelineRow(project, {
    runId: opts.runId ?? `upload-${videoId}`,
    videoDir: dir,
    status: "uploaded",
    topic: metadata.title,
    publishUrl: `https://youtu.be/${videoId}`,
  });

  return videoId;
}
