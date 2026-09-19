/**
 * Daily job — Ideas audit.
 *
 * The client types raw ideas into the Content Ideas database with Status "To audit".
 * This job scores each one against the channel's hub brand context, sets a verdict,
 * and for Promoted ideas creates a Content Pipeline row AND queues the idea locally
 * (projects/<slug>/state/idea-queue.json) so the next scheduled `engine run` makes
 * THAT video instead of researching a fresh topic.
 *
 * Nothing here uploads or approves anything.
 */
import type { Project } from "../../lib/project.js";
import { anthropic, textOf, parseJson } from "../../lib/claude.js";
import {
  appendRunLog,
  createPage,
  hubPromptBlock,
  notionConfigured,
  P,
  pageTitle,
  propText,
  props,
  pushIdeaQueue,
  queryDatabase,
  updatePage,
} from "../../lib/notion.js";
import type { JobResult } from "./yt.js";

interface Judgement {
  index: number;
  score: number;
  verdict: "Promote" | "Park" | "Kill";
  audit_notes: string;
  angle: string;
}

export function verdictForScore(score: number, duplicate: boolean): "Promote" | "Park" | "Kill" {
  if (duplicate) return "Kill";
  if (score >= 7) return "Promote";
  if (score >= 4) return "Park";
  return "Kill";
}

export async function runIdeasAudit(project: Project): Promise<JobResult> {
  const started = Date.now();
  const errors: string[] = [];
  let rowsProcessed = 0;
  let promoted = 0;

  if (!notionConfigured(project)) {
    return { rowsProcessed: 0, summary: "Notion not configured for this project — nothing to do.", errors: [] };
  }

  const pending = await queryDatabase(project, "ideas", {
    filter: { property: "Status", select: { equals: "To audit" } },
  });
  if (!pending.length) {
    const summary = "No ideas waiting to be audited.";
    await appendRunLog(project, {
      job: "Ideas audit",
      rowsProcessed: 0,
      summary,
      durationSec: Math.round((Date.now() - started) / 1000),
    });
    return { rowsProcessed: 0, summary, errors: [] };
  }

  const done = await queryDatabase(project, "ideas", {
    filter: { property: "Status", select: { equals: "Done" } },
  });
  const pipeline = await queryDatabase(project, "pipeline");
  const alreadyCovered = [...done.map(pageTitle), ...pipeline.map(pageTitle)].filter(Boolean);

  const hub = await hubPromptBlock(project);
  const pillars = project.config.brand?.pillars ?? [];

  const prompt = `${hub}You are the editorial gatekeeper for a YouTube channel.

Niche: ${project.config.niche}
Audience: ${project.config.audience.description}
${pillars.length ? `Content pillars: ${pillars.join(", ")}` : ""}

ALREADY COVERED (published, done, or already in the pipeline — anything that duplicates or closely overlaps these must be scored low and killed):
${alreadyCovered.length ? alreadyCovered.map((t) => `- ${t}`).join("\n") : "(nothing yet)"}

Ideas submitted by the client, to judge:
${pending
  .map((p, i) => {
    const notes = propText(p, "Notes / expectation");
    const link = propText(p, "Source link");
    return `${i}. "${pageTitle(p)}"${notes ? `\n   client notes: ${notes}` : ""}${link ? `\n   source: ${link}` : ""}`;
  })
  .join("\n")}

Score each idea 1-10 on: fit with the pillars and brand context above, click potential against 20 competing thumbnails, whether it contains one concrete surprising fact, and visual potential. Be honest — most ideas are not 8s. Anything duplicating the covered list scores 1-3.

Respond with ONLY a JSON array, one element per idea, in the same order:
[{"index": 0, "score": 8, "verdict": "Promote"|"Park"|"Kill", "audit_notes": "2-3 sentences: why this score, and what would need to change", "angle": "the one-line angle this video would take, containing the concrete hook"}]`;

  let judgements: Judgement[] = [];
  try {
    const res = await anthropic().messages.create({
      model: project.config.models.research,
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    });
    judgements = parseJson<Judgement[]>(textOf(res), "array");
  } catch (err) {
    const message = String(err instanceof Error ? err.message : err).slice(0, 300);
    errors.push(`scoring failed: ${message}`);
    await appendRunLog(project, {
      job: "Ideas audit",
      rowsProcessed: 0,
      summary: `Could not score ${pending.length} idea(s).`,
      errors: errors.join("\n"),
      durationSec: Math.round((Date.now() - started) / 1000),
    });
    return { rowsProcessed: 0, summary: `Could not score ${pending.length} idea(s).`, errors };
  }

  for (const [i, row] of pending.entries()) {
    const title = pageTitle(row);
    const j = judgements.find((x) => Number(x.index) === i) ?? judgements[i];
    if (!j) {
      errors.push(`${title}: no judgement returned by the model`);
      continue;
    }
    const score = Math.max(1, Math.min(10, Math.round(Number(j.score) || 0)));
    const verdict = (["Promote", "Park", "Kill"] as const).includes(j.verdict as any)
      ? j.verdict
      : verdictForScore(score, false);

    try {
      await updatePage(
        project,
        row.id,
        props({
          Score: P.number(score),
          Verdict: P.select(verdict),
          "Audit notes": P.rich(j.audit_notes),
          Status: P.select("Audited"),
        })
      );
      rowsProcessed++;

      if (verdict === "Promote") {
        const pipelinePageId = await createPage(
          project,
          "pipeline",
          props({
            Video: P.title(title),
            Status: P.select("Idea"),
            Format: P.select("Long-form"),
            Hook: P.rich(j.angle),
            "Source idea": P.relation([row.id]),
            "Target date": P.date(new Date().toISOString()),
          })
        );
        pushIdeaQueue(project, {
          title,
          angle: j.angle ?? "",
          notionPageId: row.id,
          pipelinePageId,
          addedAt: new Date().toISOString(),
        });
        promoted++;
        console.log(`ideas-audit: promoted "${title}" (${score}/10) → pipeline + idea queue`);
      } else {
        console.log(`ideas-audit: ${verdict.toLowerCase()} "${title}" (${score}/10)`);
      }
    } catch (err) {
      errors.push(`${title}: ${String(err instanceof Error ? err.message : err).slice(0, 300)}`);
    }
  }

  const summary = `Audited ${rowsProcessed} idea(s); promoted ${promoted} to the pipeline.`;
  await appendRunLog(project, {
    job: "Ideas audit",
    rowsProcessed,
    summary,
    errors: errors.join("\n") || undefined,
    durationSec: Math.round((Date.now() - started) / 1000),
  });
  return { rowsProcessed, summary, errors };
}
