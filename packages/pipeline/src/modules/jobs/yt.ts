/**
 * Shared YouTube Data/Analytics API access for the Notion jobs.
 * Same OAuth construction as modules/upload.ts: the PROJECT's refresh token.
 */
import { google } from "googleapis";
import type { Project } from "../../lib/project.js";
import { secrets, requireSecrets } from "../../lib/env.js";

/** Every daily job returns this and writes the same shape into the Notion Run Log. */
export interface JobResult {
  rowsProcessed: number;
  summary: string;
  errors: string[];
}

export class NoYouTubeAuth extends Error {
  constructor(slug: string) {
    super(`Connect YouTube first — project "${slug}" has no YOUTUBE_REFRESH_TOKEN. Run: engine auth ${slug}`);
    this.name = "NoYouTubeAuth";
  }
}

export function oauthFor(project: Project) {
  requireSecrets("youtubeClientId", "youtubeClientSecret");
  if (!project.youtubeRefreshToken) throw new NoYouTubeAuth(project.slug);
  const oauth2 = new google.auth.OAuth2(secrets.youtubeClientId, secrets.youtubeClientSecret);
  oauth2.setCredentials({ refresh_token: project.youtubeRefreshToken });
  return oauth2;
}

export const youtubeFor = (project: Project) => google.youtube({ version: "v3", auth: oauthFor(project) });
export const analyticsFor = (project: Project) =>
  google.youtubeAnalytics({ version: "v2", auth: oauthFor(project) });

/** Parsed shape of a channel URL, before hitting the API. */
export function parseChannelUrl(url: string): { kind: "id" | "handle" | "username" | "custom"; value: string } | null {
  const clean = url.trim().replace(/^https?:\/\//, "").replace(/^www\./, "");
  const m = clean.match(/^(?:m\.|music\.)?youtube\.com\/(.+)$/i) ?? clean.match(/^(@[^/?#]+)/);
  const path = (m?.[1] ?? "").replace(/[?#].*$/, "").replace(/\/+$/, "");
  if (!path) return null;
  if (path.startsWith("channel/")) return { kind: "id", value: path.slice("channel/".length).split("/")[0] };
  if (path.startsWith("user/")) return { kind: "username", value: path.slice("user/".length).split("/")[0] };
  if (path.startsWith("c/")) return { kind: "custom", value: path.slice("c/".length).split("/")[0] };
  if (path.startsWith("@")) return { kind: "handle", value: path.split("/")[0] };
  return { kind: "custom", value: path.split("/")[0] };
}

/** Resolve any channel URL form to a UC… channel id. */
export async function resolveChannelId(project: Project, url: string): Promise<string> {
  const parsed = parseChannelUrl(url);
  if (!parsed) throw new Error(`Not a YouTube channel URL: "${url}"`);
  if (parsed.kind === "id") return parsed.value;

  const youtube = youtubeFor(project);
  if (parsed.kind === "username") {
    const res = await youtube.channels.list({ part: ["id"], forUsername: parsed.value });
    const id = res.data.items?.[0]?.id;
    if (id) return id;
  }
  if (parsed.kind === "handle") {
    // forHandle is newer than the typings in googleapis v144.
    const res = await youtube.channels.list({ part: ["id"], forHandle: parsed.value } as any);
    const id = res.data.items?.[0]?.id;
    if (id) return id;
  }
  const search = await youtube.search.list({
    part: ["snippet"],
    q: parsed.value.replace(/^@/, ""),
    type: ["channel"],
    maxResults: 1,
  });
  const id = search.data.items?.[0]?.snippet?.channelId ?? (search.data.items?.[0]?.id as any)?.channelId;
  if (!id) throw new Error(`Could not resolve a channel id from "${url}"`);
  return id;
}

export interface ChannelSummary {
  id: string;
  title: string;
  description: string;
  subscribers?: number;
  totalViews?: number;
  videoCount?: number;
  publishedAt?: string;
}

export async function fetchChannel(project: Project, channelId: string): Promise<ChannelSummary> {
  const res = await youtubeFor(project).channels.list({
    part: ["snippet", "statistics"],
    id: [channelId],
  });
  const c = res.data.items?.[0];
  if (!c) throw new Error(`Channel ${channelId} not found (or not public)`);
  const num = (v?: string | null) => (v == null ? undefined : Number(v));
  return {
    id: channelId,
    title: c.snippet?.title ?? "",
    description: c.snippet?.description ?? "",
    subscribers: num(c.statistics?.subscriberCount),
    totalViews: num(c.statistics?.viewCount),
    videoCount: num(c.statistics?.videoCount),
    publishedAt: c.snippet?.publishedAt ?? undefined,
  };
}

export interface VideoSummary {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  durationIso?: string;
  views?: number;
  likes?: number;
  comments?: number;
}

/** The channel's most recent N uploads with statistics + durations. */
export async function fetchRecentVideos(project: Project, channelId: string, max = 15): Promise<VideoSummary[]> {
  const youtube = youtubeFor(project);
  const search = await youtube.search.list({
    part: ["snippet"],
    channelId,
    order: "date",
    type: ["video"],
    maxResults: Math.min(50, max),
  });
  const ids = (search.data.items ?? []).map((i) => (i.id as any)?.videoId).filter(Boolean) as string[];
  if (!ids.length) return [];

  const details = await youtube.videos.list({
    part: ["snippet", "statistics", "contentDetails"],
    id: ids,
  });
  const num = (v?: string | null) => (v == null ? undefined : Number(v));
  return (details.data.items ?? []).map((v) => ({
    id: v.id!,
    title: v.snippet?.title ?? "",
    description: (v.snippet?.description ?? "").slice(0, 400),
    publishedAt: v.snippet?.publishedAt ?? "",
    durationIso: v.contentDetails?.duration ?? undefined,
    views: num(v.statistics?.viewCount),
    likes: num(v.statistics?.likeCount),
    comments: num(v.statistics?.commentCount),
  }));
}

/** "PT4M13S" → 253. Returns undefined for unparseable input. */
export function isoDurationToSec(iso?: string): number | undefined {
  if (!iso) return undefined;
  const m = iso.match(/^P(?:([\d.]+)D)?T?(?:([\d.]+)H)?(?:([\d.]+)M)?(?:([\d.]+)S)?$/);
  if (!m) return undefined;
  const [, d, h, mi, s] = m;
  const total = (Number(d) || 0) * 86400 + (Number(h) || 0) * 3600 + (Number(mi) || 0) * 60 + (Number(s) || 0);
  return Number.isFinite(total) ? Math.round(total) : undefined;
}

/** Extract a video id from a watch/youtu.be/shorts URL. */
export function videoIdFromUrl(url: string): string | null {
  const s = url.trim();
  const patterns = [/[?&]v=([\w-]{6,})/, /youtu\.be\/([\w-]{6,})/, /\/shorts\/([\w-]{6,})/, /\/embed\/([\w-]{6,})/];
  for (const p of patterns) {
    const m = s.match(p);
    if (m) return m[1];
  }
  return /^[\w-]{11}$/.test(s) ? s : null;
}
