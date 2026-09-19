/**
 * Daily job — Creator Teardowns.
 *
 * The client drops competitor channel URLs into the Creator Teardowns database with
 * Status "To audit". This job pulls each channel's real numbers from the YouTube Data
 * API, asks Claude to read the pattern, and fills the row in.
 *
 * Read-only against YouTube. Never touches uploads.
 */
import type { Project } from "../../lib/project.js";
import { anthropic, textOf, parseJson } from "../../lib/claude.js";
import {
  appendRunLog,
  notionConfigured,
  queryDatabase,
  updatePage,
  pageTitle,
  propText,
  props,
  P,
  hubPromptBlock,
} from "../../lib/notion.js";
import {
  fetchChannel,
  fetchRecentVideos,
  isoDurationToSec,
  resolveChannelId,
  NoYouTubeAuth,
  type JobResult,
} from "./yt.js";

interface TeardownAnalysis {
  their_pillars: string;
  hook_style: string;
  title_thumbnail_pattern: string;
  structure_pacing: string;
  caption_cta_style: string;
  cadence: string;
  steal_this: string;
  avoid_this: string;
  adaptation_notes: string;
  niche_tags: string[];
}

export async function runTeardown(project: Project): Promise<JobResult> {
  const started = Date.now();
  const errors: string[] = [];
  let rowsProcessed = 0;

  if (!notionConfigured(project)) {
    return { rowsProcessed: 0, summary: "Notion not configured for this project — nothing to do.", errors: [] };
  }

  const rows = await queryDatabase(project, "teardowns", {
    filter: { property: "Status", select: { equals: "To audit" } },
  });
  if (!rows.length) {
    const result: JobResult = { rowsProcessed: 0, summary: "No creators waiting to be audited.", errors: [] };
    await appendRunLog(project, {
      job: "Teardown",
      rowsProcessed: 0,
      summary: result.summary,
      durationSec: Math.round((Date.now() - started) / 1000),
    });
    return result;
  }

  const hub = await hubPromptBlock(project);

  for (const row of rows) {
    const creator = pageTitle(row) || "(unnamed)";
    const url = propText(row, "Channel URL");
    try {
      if (!url) throw new Error("row has no Channel URL");
      const channelId = await resolveChannelId(project, url);
      const channel = await fetchChannel(project, channelId);
      const videos = await fetchRecentVideos(project, channelId, 15);

      const analysis = await analyse(project, hub, channel, videos);

      await updatePage(
        project,
        row.id,
        props({
          Subscribers: P.number(channel.subscribers),
          Niche: P.multi((analysis.niche_tags ?? []).slice(0, 3)),
          "Their pillars": P.rich(analysis.their_pillars),
          "Hook style": P.rich(analysis.hook_style),
          "Title + thumbnail pattern": P.rich(analysis.title_thumbnail_pattern),
          "Structure / pacing": P.rich(analysis.structure_pacing),
          "Caption + CTA style": P.rich(analysis.caption_cta_style),
          Cadence: P.rich(analysis.cadence),
          "Steal this": P.rich(analysis.steal_this),
          "Avoid this": P.rich(analysis.avoid_this),
          "Adaptation notes": P.rich(analysis.adaptation_notes),
          "Last audited": P.date(new Date().toISOString()),
          Status: P.select("Audited"),
        })
      );
      rowsProcessed++;
      console.log(`teardown: audited ${creator} (${channel.subscribers ?? "?"} subs, ${videos.length} recent videos)`);
    } catch (err) {
      const message =
        err instanceof NoYouTubeAuth
          ? `Connect YouTube first — run: engine auth ${project.slug}`
          : String(err instanceof Error ? err.message : err).slice(0, 300);
      errors.push(`${creator}: ${message}`);
      console.warn(`teardown: ${creator} failed — ${message}`);
      // Surface the reason on the row itself so the client sees why it stayed "To audit".
      await updatePage(project, row.id, props({ "Adaptation notes": P.rich(`Audit failed: ${message}`) })).catch(
        () => {}
      );
      if (err instanceof NoYouTubeAuth) break; // every other row would fail identically
    }
  }

  // TODO: optional discovery — auto-find new creators in the niche and add "To audit"
  // rows for them. Deliberately skipped for now: the client curates the list.

  const summary = `Audited ${rowsProcessed} of ${rows.length} creator(s).`;
  await appendRunLog(project, {
    job: "Teardown",
    rowsProcessed,
    summary,
    errors: errors.join("\n") || undefined,
    durationSec: Math.round((Date.now() - started) / 1000),
  });
  return { rowsProcessed, summary, errors };
}

async function analyse(
  project: Project,
  hub: string,
  channel: Awaited<ReturnType<typeof fetchChannel>>,
  videos: Awaited<ReturnType<typeof fetchRecentVideos>>
): Promise<TeardownAnalysis> {
  const videoLines = videos
    .map(
      (v) =>
        `- "${v.title}" — ${isoDurationToSec(v.durationIso) ?? "?"}s, ${v.views ?? "?"} views, ` +
        `${v.likes ?? "?"} likes, published ${v.publishedAt.slice(0, 10)}`
    )
    .join("\n");

  const prompt = `${hub}You are auditing a competitor YouTube channel so our own channel can learn from it.

OUR channel's niche: ${project.config.niche}
OUR audience: ${project.config.audience.description}

THEIR channel: ${channel.title}
Subscribers: ${channel.subscribers ?? "unknown"} · Total views: ${channel.totalViews ?? "unknown"} · Videos: ${channel.videoCount ?? "unknown"}
Channel description: ${channel.description.slice(0, 800)}

Their ${videos.length} most recent videos:
${videoLines || "(none visible)"}

Read the pattern in the titles, lengths, and view spread. Be specific and concrete — cite actual titles and numbers, never generic advice.

Respond with ONLY JSON, no other text:
{"their_pillars": "the 2-4 recurring content pillars, with an example title each",
 "hook_style": "how their titles/openings create the click, with examples",
 "title_thumbnail_pattern": "the repeatable title formula and what the thumbnails likely do",
 "structure_pacing": "typical video length, structure and pacing you can infer",
 "caption_cta_style": "description/CTA style you can infer from the metadata",
 "cadence": "how often they publish, inferred from the publish dates",
 "steal_this": "the 2-3 things we should copy",
 "avoid_this": "the 2-3 things that would not work for us",
 "adaptation_notes": "concretely how to adapt their best move to OUR niche and brand context above",
 "niche_tags": ["up to 3 short niche tags"]}`;

  const res = await anthropic().messages.create({
    model: project.config.models.research,
    max_tokens: 2500,
    messages: [{ role: "user", content: prompt }],
  });
  return parseJson<TeardownAnalysis>(textOf(res));
}
