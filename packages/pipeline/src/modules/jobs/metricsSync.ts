/**
 * Daily job — Metrics sync.
 *
 * Pulls real performance back into the Content Pipeline rows the client already
 * published, and flips rows older than a week to "Analysed" with a one-line read.
 *
 * Read-only against YouTube. Never uploads, never approves.
 */
import type { Project } from "../../lib/project.js";
import { anthropic, textOf } from "../../lib/claude.js";
import {
  appendRunLog,
  notionConfigured,
  P,
  pageTitle,
  propText,
  props,
  queryDatabase,
  updatePage,
} from "../../lib/notion.js";
import { analyticsFor, youtubeFor, videoIdFromUrl, NoYouTubeAuth, type JobResult } from "./yt.js";

const ANALYSE_AFTER_DAYS = 7;

interface VideoMetrics {
  videoId: string;
  title: string;
  views?: number;
  likes?: number;
  comments?: number;
  publishedAt?: string;
  averageViewDuration?: number;
  subscribersGained?: number;
  /** Impressions CTR is not exposed by the public API — stays undefined. */
  ctr?: number;
  analyticsError?: string;
}

export function daysSince(iso?: string): number | undefined {
  if (!iso) return undefined;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? (Date.now() - t) / 86_400_000 : undefined;
}

export async function runMetricsSync(project: Project): Promise<JobResult> {
  const started = Date.now();
  const errors: string[] = [];
  let rowsProcessed = 0;

  if (!notionConfigured(project)) {
    return { rowsProcessed: 0, summary: "Notion not configured for this project — nothing to do.", errors: [] };
  }

  const published = (
    await queryDatabase(project, "pipeline", {
      filter: { property: "Status", select: { equals: "Published" } },
    })
  ).filter((row) => !!propText(row, "Publish URL"));

  if (!published.length) {
    const summary = "No published rows with a Publish URL to sync.";
    await appendRunLog(project, {
      job: "Metrics sync",
      rowsProcessed: 0,
      summary,
      durationSec: Math.round((Date.now() - started) / 1000),
    });
    return { rowsProcessed: 0, summary, errors: [] };
  }

  // Fetch statistics for every row in one videos.list call.
  const targets = published
    .map((row) => ({ row, videoId: videoIdFromUrl(propText(row, "Publish URL")) }))
    .filter((t): t is { row: any; videoId: string } => !!t.videoId);
  for (const { row } of published.filter((r) => !videoIdFromUrl(propText(r, "Publish URL")))) {
    errors.push(`${pageTitle(row)}: Publish URL is not a YouTube video URL`);
  }

  const metrics = new Map<string, VideoMetrics>();
  try {
    const youtube = youtubeFor(project);
    const res = await youtube.videos.list({
      part: ["snippet", "statistics"],
      id: targets.map((t) => t.videoId),
    });
    const num = (v?: string | null) => (v == null ? undefined : Number(v));
    for (const v of res.data.items ?? []) {
      metrics.set(v.id!, {
        videoId: v.id!,
        title: v.snippet?.title ?? "",
        views: num(v.statistics?.viewCount),
        likes: num(v.statistics?.likeCount),
        comments: num(v.statistics?.commentCount),
        publishedAt: v.snippet?.publishedAt ?? undefined,
      });
    }
  } catch (err) {
    const message =
      err instanceof NoYouTubeAuth
        ? `Connect YouTube first — run: engine auth ${project.slug}`
        : String(err instanceof Error ? err.message : err).slice(0, 300);
    errors.push(`statistics: ${message}`);
    await appendRunLog(project, {
      job: "Metrics sync",
      rowsProcessed: 0,
      summary: "Could not read YouTube statistics.",
      errors: errors.join("\n"),
      durationSec: Math.round((Date.now() - started) / 1000),
    });
    return { rowsProcessed: 0, summary: "Could not read YouTube statistics.", errors };
  }

  // Analytics (needs the yt-analytics.readonly scope; older tokens do not have it).
  let analyticsUnavailable: string | null = null;
  for (const { videoId } of targets) {
    const m = metrics.get(videoId);
    if (!m) continue;
    if (analyticsUnavailable) {
      m.analyticsError = analyticsUnavailable;
      continue;
    }
    try {
      const startDate = (m.publishedAt ?? "2005-01-01T00:00:00Z").slice(0, 10);
      const res = await analyticsFor(project).reports.query({
        ids: "channel==MINE",
        startDate,
        endDate: new Date().toISOString().slice(0, 10),
        metrics: "views,estimatedMinutesWatched,averageViewDuration,subscribersGained",
        filters: `video==${videoId}`,
      });
      const headers = (res.data.columnHeaders ?? []).map((h) => h.name ?? "");
      const rowValues = (res.data.rows ?? [])[0] as (number | string)[] | undefined;
      if (rowValues) {
        const get = (name: string) => {
          const i = headers.indexOf(name);
          return i >= 0 ? Number(rowValues[i]) : undefined;
        };
        m.averageViewDuration = get("averageViewDuration");
        m.subscribersGained = get("subscribersGained");
      }
    } catch (err) {
      analyticsUnavailable = `YouTube Analytics unavailable (${String(
        (err as any)?.message ?? err
      ).slice(0, 120)}). Re-run \`engine auth ${project.slug}\` to grant the analytics scope.`;
      m.analyticsError = analyticsUnavailable;
    }
  }
  if (analyticsUnavailable) errors.push(analyticsUnavailable);

  const viewCounts = [...metrics.values()].map((m) => m.views ?? 0).filter((v) => v > 0);
  const average = viewCounts.length ? Math.round(viewCounts.reduce((a, b) => a + b, 0) / viewCounts.length) : 0;

  const notes = await summarise(project, [...metrics.values()], average);

  for (const { row, videoId } of targets) {
    const m = metrics.get(videoId);
    if (!m) {
      errors.push(`${pageTitle(row)}: video ${videoId} not returned by the API (deleted or private?)`);
      continue;
    }
    const age = daysSince(m.publishedAt);
    const analysed = age !== undefined && age >= ANALYSE_AFTER_DAYS;
    const noteParts = [
      notes.get(videoId) ?? "",
      m.ctr === undefined ? "CTR is not available through the YouTube API — read it in YouTube Studio." : "",
      m.analyticsError ?? "",
    ].filter(Boolean);

    try {
      await updatePage(
        project,
        row.id,
        props({
          Views: P.number(m.views),
          "Avg view duration": P.number(m.averageViewDuration),
          "Subs gained": P.number(m.subscribersGained),
          CTR: P.number(m.ctr),
          "Result notes": P.rich(noteParts.join(" ")),
          ...(analysed ? { Status: P.select("Analysed") } : {}),
        })
      );
      rowsProcessed++;
    } catch (err) {
      errors.push(`${pageTitle(row)}: ${String(err instanceof Error ? err.message : err).slice(0, 300)}`);
    }
  }

  const summary = `Synced metrics for ${rowsProcessed} video(s); channel average ${average} views.`;
  await appendRunLog(project, {
    job: "Metrics sync",
    rowsProcessed,
    summary,
    errors: errors.join("\n") || undefined,
    durationSec: Math.round((Date.now() - started) / 1000),
  });
  return { rowsProcessed, summary, errors };
}

/** One cheap Claude call for all rows → a one-line read per video. Failure is non-fatal. */
async function summarise(
  project: Project,
  all: VideoMetrics[],
  average: number
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!all.length || !average) return out;
  try {
    const lines = all
      .map((m) => `${m.videoId} | "${m.title}" | ${m.views ?? 0} views | ${m.likes ?? 0} likes`)
      .join("\n");
    const res = await anthropic().messages.create({
      model: project.config.models.validate,
      max_tokens: 800,
      messages: [
        {
          role: "user",
          content: `Channel average views per video: ${average}.

Videos:
${lines}

For each video write ONE short sentence comparing it to the channel average and naming the likely reason (title/topic fit). No preamble.
Respond as lines of "videoId: sentence", nothing else.`,
        },
      ],
    });
    for (const line of textOf(res).split("\n")) {
      const m = line.match(/^\s*([\w-]{6,})\s*[:|-]\s*(.+)$/);
      if (m) out.set(m[1], m[2].trim());
    }
  } catch (err) {
    console.warn(`metrics: summary pass skipped — ${String(err).slice(0, 160)}`);
  }
  return out;
}
