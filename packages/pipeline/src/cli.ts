/**
 * engine — multi-project pipeline CLI
 *
 *   engine list                      all projects with cadence + last run
 *   engine init <slug> --niche "..." scaffold a new project (config.json + .env + state)
 *   engine run <slug> [opts]         full pipeline through validation → pending_approval
 *       --topic "..." --angle "..."  skip research, use this topic
 *       --minutes N                  override video length
 *       --mode slideshow|hybrid|video
 *       --until <stage>              stop after this stage (e.g. --until render)
 *   engine stage <name> <slug> --dir <videoDir> [opts]   run one stage standalone
 *   engine runs [<slug>]             recent run records with per-stage status
 *
 * NOTE: `engine run` NEVER uploads. Uploads happen only through explicit approval.
 */
import { existsSync, mkdirSync, writeFileSync, createWriteStream, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./lib/env.js";

/** Tee stdout+stderr to data/logs/<runId>.log so the dashboard can tail runs live. */
function teeOutputToLog(runId: string): void {
  const logsDir = join(repoRoot, "data", "logs");
  mkdirSync(logsDir, { recursive: true });
  const file = createWriteStream(join(logsDir, `${runId}.log`), { flags: "a" });
  for (const stream of [process.stdout, process.stderr] as const) {
    const orig = stream.write.bind(stream);
    stream.write = ((chunk: any, ...args: any[]) => {
      file.write(chunk);
      return orig(chunk, ...args);
    }) as typeof stream.write;
  }
}
import { arg, flag } from "./lib/util.js";
import { listProjects, loadProject, defaultConfig, projectsRoot, type Project } from "./lib/project.js";
import { openDb } from "./lib/db.js";
import { RunTracker, recentRuns } from "./lib/tracker.js";
import { runResearch } from "./modules/research.js";
import { runScript } from "./modules/script.js";
import { runVoiceover } from "./modules/voiceover.js";
import { runVisuals } from "./modules/visuals.js";
import { runRenderFfmpeg } from "./modules/renderFfmpeg.js";
import { runRenderHf } from "./modules/renderHf.js";
import { runCaptions } from "./modules/captions.js";
import { runThumbnail } from "./modules/thumbnail.js";
import { runMetadata } from "./modules/metadata.js";
import { runValidate } from "./modules/validate.js";
import { runUpload } from "./modules/upload.js";
import { runAuth } from "./modules/auth.js";
import { runEdit, runRollback } from "./modules/edit.js";
import { runMusic } from "./lib/music.js";
import { notify, notifyStatus, registerTelegramChats } from "./lib/notify.js";
import {
  appendRunLog,
  loadNotionIds,
  notionConfigured,
  popIdeaQueue,
  setupNotion,
  syncPipelineRow,
  syncResearchIdeas,
} from "./lib/notion.js";
import { runTeardown } from "./modules/jobs/teardown.js";
import { runIdeasAudit } from "./modules/jobs/ideasAudit.js";
import { runMetricsSync } from "./modules/jobs/metricsSync.js";
import webpush from "web-push";
import { spawn } from "node:child_process";
import { openSync } from "node:fs";

const STAGES = ["research", "script", "voiceover", "visuals", "render", "captions", "music", "metadata", "thumbnail", "validate"] as const;
type Stage = (typeof STAGES)[number];

function usage(): never {
  console.error(`Usage:
  engine list
  engine init <slug> --niche "description" [--name "Display Name"]
  engine run <slug> [--topic "..."] [--angle "..."] [--minutes N] [--mode m] [--until stage]
  engine stage <${STAGES.join("|")}|upload> <slug> [--dir <videoDir>] [stage flags]
  engine runs [<slug>]
  engine edit <slug> --dir <videoDir> --instruction "..." [--run <runId>]
  engine rollback <slug> --dir <videoDir> --version N
  engine auth <slug>
  engine notion setup <slug> --page <notion page URL or id>
  engine notion status <slug>
  engine job <teardown|ideas-audit|metrics> <slug>
  engine scheduler [--interval-min 5]
  engine push-keys                 generate VAPID keys for push notifications
  engine notify-test               send a test notification through every configured channel
  engine telegram-connect          register chats that messaged the Telegram bot`);
  process.exit(1);
}

async function cmdList(): Promise<void> {
  const slugs = listProjects();
  if (!slugs.length) {
    console.log("No projects yet. Create one with: engine init <slug> --niche \"...\"");
    return;
  }
  const db = openDb();
  for (const slug of slugs) {
    const p = loadProject(slug);
    const last = recentRuns(db, slug, 1)[0];
    console.log(
      `${slug.padEnd(20)} "${p.config.name}" — ${p.config.schedule.cadencePerWeek}/week, ` +
        `${p.config.video.lengthMinutes}min ${p.config.video.renderer}` +
        (last ? ` | last run: ${last.status} (${last.created_at})` : " | no runs yet")
    );
  }
}

async function cmdInit(slug: string): Promise<void> {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error("Slug must be lowercase letters, digits, and dashes.");
  const dir = join(projectsRoot, slug);
  if (existsSync(join(dir, "config.json"))) throw new Error(`Project "${slug}" already exists.`);
  const niche = arg("niche");
  if (!niche) throw new Error('engine init requires --niche "what this channel is about"');
  const name = arg("name") ?? slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  mkdirSync(join(dir, "state"), { recursive: true });
  mkdirSync(join(dir, "output"), { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify(defaultConfig(name, niche), null, 2));
  writeFileSync(join(dir, "state", "published_topics.json"), JSON.stringify({ topics: [] }, null, 2));
  if (!existsSync(join(dir, ".env"))) writeFileSync(join(dir, ".env"), "YOUTUBE_REFRESH_TOKEN=\n");

  console.log(`Project "${slug}" created at ${dir}`);
  console.log(`Next: edit ${join(dir, "config.json")} (prompts, voice, cadence) — then: engine run ${slug}`);
}

async function cmdRun(slug: string): Promise<void> {
  const project = loadProject(slug);
  const db = openDb();
  const until = arg("until") as Stage | undefined;
  if (until && !STAGES.includes(until)) throw new Error(`--until must be one of: ${STAGES.join(", ")}`);
  const minutes = arg("minutes") ? Number(arg("minutes")) : undefined;
  const mode = arg("mode") as "slideshow" | "hybrid" | "video" | undefined;

  let topic = arg("topic");
  let angle = arg("angle");

  // A client idea promoted in Notion beats fresh research: pop it and make THAT video.
  let notionPipelinePageId: string | undefined;
  if (!topic) {
    const queued = popIdeaQueue(project);
    if (queued) {
      topic = queued.title;
      angle = queued.angle || undefined;
      notionPipelinePageId = queued.pipelinePageId;
      console.log(`Using client idea from Notion: ${topic}`);
    }
  }

  const planned: Stage[] = STAGES.filter((s) => (topic ? s !== "research" : true));
  const tracker = RunTracker.createRun(db, slug, planned, topic);
  console.log(`Run ${tracker.runId} started for project "${slug}"`);
  teeOutputToLog(tracker.runId); // dashboard reads data/logs/<runId>.log live

  let videoDir = "";
  const runStartedAt = Date.now();
  const stop = (stage: Stage) => until === stage;

  /** Mirror a lifecycle moment into the client's Notion pipeline (no-op without Notion). */
  const syncNotion = (status: Parameters<typeof syncPipelineRow>[1]["status"], error?: string) =>
    syncPipelineRow(project, {
      runId: tracker.runId,
      videoDir: videoDir || undefined,
      status,
      topic,
      pageId: notionPipelinePageId,
      error,
    }).then((id) => {
      if (id) notionPipelinePageId = id; // subsequent hooks update the same row
    });

  const execStage = async <T>(stage: Stage, fn: () => Promise<T>): Promise<T> => {
    tracker.stage(stage, "running");
    try {
      const result = await fn();
      tracker.stage(stage, "done");
      return result;
    } catch (err) {
      tracker.stage(stage, "failed", { error: String(err) });
      tracker.setStatus("failed", `${stage}: ${String(err)}`);
      throw err;
    }
  };

  try {
    if (!topic) {
      const topics = await execStage("research", () => runResearch(project));
      topic = topics[0].topic;
      angle = topics[0].angle;
      tracker.setTopic(topic);
      console.log(`Picked topic: ${topic}`);
      await syncResearchIdeas(project, topics, tracker.runId);
      await appendRunLog(project, {
        job: "Research",
        rowsProcessed: topics.length,
        summary: `${topics.length} topics researched; picked "${topic}".`,
        durationSec: Math.round((Date.now() - runStartedAt) / 1000),
      });
      if (stop("research")) return finish("research complete");
    }

    const { videoDir: dir } = await execStage("script", () =>
      runScript(project, { topic: topic!, angle, minutes, format: arg("format") })
    );
    videoDir = dir;
    tracker.setVideoDir(videoDir);
    await syncNotion("scripted");
    if (stop("script")) return finish("script complete");

    await execStage("voiceover", () => runVoiceover(project, { dir: videoDir }));
    await syncNotion("recorded");
    if (stop("voiceover")) return finish("voiceover complete");

    await execStage("visuals", () => runVisuals(project, { dir: videoDir, mode }));
    if (stop("visuals")) return finish("visuals complete");

    let renderer = project.config.video.renderer;
    await execStage("render", async () => {
      if (renderer === "hyperframes") {
        try {
          await runRenderHf(project, { dir: videoDir });
        } catch (err) {
          // HyperFrames needs a working headless Chromium; if it can't run here, the
          // ffmpeg renderer (Ken Burns + crossfades + burned SRT captions) still ships the video.
          console.warn(`\nHyperFrames render failed — falling back to the ffmpeg renderer.\n${String(err).slice(0, 400)}`);
          renderer = "ffmpeg";
          await runRenderFfmpeg(project, { dir: videoDir });
        }
      } else {
        await runRenderFfmpeg(project, { dir: videoDir });
      }
    });
    tracker.stage("render", "done", { artifacts: { video: join(videoDir, renderer === "hyperframes" ? "final_video.mp4" : "raw_video.mp4") } });
    if (stop("render")) return finish("render complete");

    // ffmpeg renderer burns captions here; hyperframes bakes them at render, SRT still written for YouTube CC.
    await execStage("captions", () => runCaptions(project, { dir: videoDir, burn: renderer === "ffmpeg" }));
    if (stop("captions")) return finish("captions complete");

    // Music bed under the finished video (no-op when config.music.enabled is false).
    await execStage("music", () => runMusic(project, { dir: videoDir }));
    await syncNotion("edited");
    if (stop("music")) return finish("music complete");

    // metadata before thumbnail: thumbnail overlay uses metadata.thumbnail_text.
    await execStage("metadata", () => runMetadata(project, { dir: videoDir }));
    if (stop("metadata")) return finish("metadata complete");

    await execStage("thumbnail", () => runThumbnail(project, { dir: videoDir }));
    if (stop("thumbnail")) return finish("thumbnail complete");

    await execStage("validate", () => runValidate(project, { dir: videoDir }));

    tracker.setStatus("pending_approval");
    // "Scheduled" in Notion means "waiting for the client's approval" — never approved here.
    await syncNotion("pending_approval");
    await appendRunLog(project, {
      job: "Video run",
      rowsProcessed: 1,
      summary: `Run ${tracker.runId} finished → pending approval: "${readTitle(videoDir) ?? topic}".`,
      durationSec: Math.round((Date.now() - runStartedAt) / 1000),
    });
    console.log(`\nRun ${tracker.runId} complete → pending approval. Video: ${join(videoDir, "final_video.mp4")}`);
    console.log("Nothing is uploaded until you approve it.");
    await notify({
      kind: "video_ready",
      project: slug,
      runId: tracker.runId,
      title: `Ready to review: ${readTitle(videoDir) ?? topic}`,
      body: `A new video for ${project.config.name} is finished and waiting for your approval. Watch it, request changes, or approve it to publish.`,
      path: `/review/${tracker.runId}`,
      thumbnailPath: join(videoDir, "thumbnail.png"),
    });
  } catch (err) {
    console.error(`\nRun ${tracker.runId} FAILED: ${String(err)}`);
    await syncNotion("failed", String(err).slice(0, 500));
    await appendRunLog(project, {
      job: "Video run",
      rowsProcessed: 0,
      summary: `Run ${tracker.runId} failed${topic ? ` on "${topic}"` : ""}.`,
      errors: String(err).slice(0, 1500),
      durationSec: Math.round((Date.now() - runStartedAt) / 1000),
    });
    await notify({
      kind: "run_failed",
      project: slug,
      runId: tracker.runId,
      title: `A video for ${project.config.name} could not be finished`,
      body: `${topic ? `"${topic}" — ` : ""}${String(err).slice(0, 240)}\n\nYou can retry it from the dashboard.`,
      path: `/activity/${tracker.runId}`,
    });
    process.exit(1);
  }

  function finish(msg: string): void {
    // Partial run stopped intentionally with --until: remaining stages stay "pending".
    tracker.setStatus("stopped");
    console.log(`\nRun ${tracker.runId}: ${msg} (stopped at --until). Video dir: ${videoDir || "(none yet)"}`);
  }
}

function readTitle(videoDir: string): string | undefined {
  try {
    return JSON.parse(readFileSync(join(videoDir, "metadata.json"), "utf8")).title;
  } catch {
    return undefined;
  }
}

async function cmdStage(stageName: string, slug: string): Promise<void> {
  const project = loadProject(slug);
  const dir = arg("dir");
  const need = (): string => {
    if (!dir) throw new Error(`engine stage ${stageName} requires --dir <videoDir>`);
    return dir;
  };
  switch (stageName) {
    case "research":
      await runResearch(project, { count: arg("count") ? Number(arg("count")) : undefined });
      break;
    case "script": {
      const topic = arg("topic");
      if (!topic) throw new Error('engine stage script requires --topic "..."');
      await runScript(project, {
        topic,
        angle: arg("angle"),
        minutes: arg("minutes") ? Number(arg("minutes")) : undefined,
        format: arg("format"),
      });
      break;
    }
    case "voiceover":
      await runVoiceover(project, { dir: need() });
      break;
    case "visuals":
      await runVisuals(project, { dir: need(), mode: arg("mode") as any, hero: arg("hero") });
      break;
    case "render":
      if ((arg("renderer") ?? project.config.video.renderer) === "hyperframes") {
        await runRenderHf(project, { dir: need(), render: !flag("no-render") });
      } else {
        await runRenderFfmpeg(project, { dir: need() });
      }
      break;
    case "captions":
      await runCaptions(project, { dir: need(), burn: (arg("renderer") ?? project.config.video.renderer) === "ffmpeg" });
      break;
    case "music":
      await runMusic(project, { dir: need() });
      break;
    case "thumbnail":
      await runThumbnail(project, { dir: need(), topic: arg("topic"), text: arg("text"), hint: arg("hint") });
      break;
    case "metadata":
      await runMetadata(project, { dir: need() });
      break;
    case "validate":
      await runValidate(project, { dir: need() });
      break;
    case "upload": {
      const runId = arg("run");
      const title = readTitle(need()) ?? "your video";
      try {
        const videoId = await runUpload(project, { dir: need(), privacy: arg("privacy") as any, runId });
        await notify({
          kind: "upload_done",
          project: slug,
          runId,
          title: `Published: ${title}`,
          body: `"${title}" is now on YouTube (${arg("privacy") ?? project.config.youtube.defaultPrivacy}).\nhttps://youtu.be/${videoId}`,
          path: runId ? `/review/${runId}` : "/",
        });
      } catch (err) {
        await notify({
          kind: "upload_failed",
          project: slug,
          runId,
          title: `Upload failed: ${title}`,
          body: `${String(err).slice(0, 240)}\n\nOpen the video to retry.`,
          path: runId ? `/review/${runId}` : "/",
        });
        throw err;
      }
      break;
    }
    default:
      throw new Error(`Unknown stage "${stageName}". Stages: ${STAGES.join(", ")}, upload`);
  }
}

async function cmdRuns(slug?: string): Promise<void> {
  const db = openDb();
  const runs = recentRuns(db, slug, 10);
  if (!runs.length) {
    console.log("No runs recorded yet.");
    return;
  }
  for (const r of runs) {
    console.log(`\n${r.id} [${r.project}] ${r.status.toUpperCase()} — ${r.topic ?? "(no topic)"}  (${r.created_at})`);
    for (const s of r.stages) {
      const time = s.started_at ? ` ${s.started_at.slice(11, 19)}→${s.finished_at?.slice(11, 19) ?? "…"}` : "";
      console.log(`   ${s.stage.padEnd(10)} ${s.status}${time}${s.error ? `  ERROR: ${s.error.slice(0, 120)}` : ""}`);
    }
    if (r.error) console.log(`   run error: ${r.error.slice(0, 200)}`);
  }
}

async function cmdEdit(slug: string): Promise<void> {
  const project = loadProject(slug);
  const dir = arg("dir");
  const instruction = arg("instruction");
  if (!dir || !instruction) throw new Error('engine edit requires --dir <videoDir> --instruction "..."');
  const db = openDb();

  // Track against the run that produced this video (dashboard passes --run explicitly).
  const runId =
    arg("run") ??
    (db.prepare("SELECT id FROM runs WHERE video_dir = ? ORDER BY created_at DESC LIMIT 1").get(dir) as
      | { id: string }
      | undefined)?.id;
  const now = () => new Date().toISOString();
  let editId: number | bigint | null = null;
  if (runId) {
    db.prepare("UPDATE runs SET status = 'editing', updated_at = ? WHERE id = ?").run(now(), runId);
    editId = db
      .prepare("INSERT INTO run_edits (run_id, instruction, status, created_at) VALUES (?, ?, 'running', ?)")
      .run(runId, instruction, now()).lastInsertRowid;
  }

  const title = readTitle(dir) ?? "your video";
  try {
    const result = await runEdit(project, { dir, instruction });
    if (runId) {
      db.prepare("UPDATE run_edits SET status = 'done', summary = ?, stages_json = ?, finished_at = ? WHERE id = ?")
        .run(result.summary, JSON.stringify(result.stagesRun), now(), editId);
      db.prepare("UPDATE runs SET status = 'pending_approval', error = NULL, updated_at = ? WHERE id = ?")
        .run(now(), runId);
    }
    await notify({
      kind: "edit_done",
      project: slug,
      runId,
      title: `Changes applied: ${readTitle(dir) ?? title}`,
      body: `${result.summary}\n\nThe updated video is back in your review queue.`,
      path: runId ? `/review/${runId}` : "/",
      thumbnailPath: join(dir, "thumbnail.png"),
    });
  } catch (err) {
    if (runId) {
      db.prepare("UPDATE run_edits SET status = 'failed', error = ?, finished_at = ? WHERE id = ?")
        .run(String(err), now(), editId);
      // The video's previous artifacts are intact (or restorable via versions/) — back to the queue.
      db.prepare("UPDATE runs SET status = 'pending_approval', error = ?, updated_at = ? WHERE id = ?")
        .run(`edit failed: ${String(err).slice(0, 300)}`, now(), runId);
    }
    await notify({
      kind: "edit_failed",
      project: slug,
      runId,
      title: `Could not apply changes: ${title}`,
      body: `"${instruction}"\n${String(err).slice(0, 240)}\n\nThe previous version is untouched.`,
      path: runId ? `/review/${runId}` : "/",
    });
    throw err;
  }
}

// --- Notion ----------------------------------------------------------------

/** `engine notion setup <slug> --page <url|id>` — idempotent; safe to re-run. */
async function cmdNotionSetup(slug: string): Promise<void> {
  const project = loadProject(slug);
  const page = arg("page");
  if (!page) {
    throw new Error(
      "engine notion setup requires --page <notion page URL or id>\n" +
        "  1. Create an internal integration: https://www.notion.so/my-integrations\n" +
        `  2. Put its token in ${join(project.dir, ".env")} as NOTION_TOKEN=\n` +
        "  3. In Notion open the parent page → ••• → Connections → add the integration\n" +
        "  4. Re-run this with that page's URL"
    );
  }
  const ids = await setupNotion(project, { parentPageId: page });
  console.log(`\nNotion hub ready for "${project.config.name}":`);
  console.log(`  ${ids.hubUrl || ids.hubPageId}`);
  for (const [key, id] of Object.entries(ids.databases)) console.log(`  ${key.padEnd(10)} ${id}`);
}

/** `engine notion status <slug>` — machine-readable status for the dashboard. */
async function cmdNotionStatus(slug: string): Promise<void> {
  const project = loadProject(slug);
  const ids = loadNotionIds(project);
  let lastJobs: Record<string, string> = {};
  try {
    lastJobs = JSON.parse(readFileSync(join(project.dir, "state", "jobs.json"), "utf8"));
  } catch {
    /* no jobs have run yet */
  }
  console.log(
    JSON.stringify(
      {
        configured: notionConfigured(project),
        hasToken: !!project.notionToken,
        hubUrl: ids?.hubUrl ?? null,
        databases: ids?.databases ?? null,
        lastJobs,
      },
      null,
      2
    )
  );
}

const JOBS = {
  teardown: runTeardown,
  "ideas-audit": runIdeasAudit,
  metrics: runMetricsSync,
} as const;
type JobName = keyof typeof JOBS;

/** `engine job <name> <slug>` — one daily job, on demand. Never uploads. */
async function cmdJob(name: string, slug: string): Promise<void> {
  const job = JOBS[name as JobName];
  if (!job) throw new Error(`Unknown job "${name}". Jobs: ${Object.keys(JOBS).join(", ")}`);
  const project = loadProject(slug);
  const result = await job(project);
  console.log(`\n${name} [${slug}]: ${result.summary}`);
  for (const e of result.errors) console.log(`  error: ${e}`);
  markJobRun(project, name);
}

const jobsStatePath = (project: Project) => join(project.dir, "state", "jobs.json");

function readJobsState(project: Project): Record<string, any> {
  try {
    return JSON.parse(readFileSync(jobsStatePath(project), "utf8"));
  } catch {
    return {};
  }
}

function markJobRun(project: Project, name: string): void {
  const state = readJobsState(project);
  state[name] = new Date().toISOString();
  try {
    mkdirSync(join(project.dir, "state"), { recursive: true });
    writeFileSync(jobsStatePath(project), JSON.stringify(state, null, 2));
  } catch (err) {
    console.warn(`jobs: could not record last-run date: ${String(err)}`);
  }
}

/** One-time: generate VAPID keys for push notifications and print the .env lines. */
function cmdPushKeys(): void {
  const keys = webpush.generateVAPIDKeys();
  console.log("Add these to the root .env (then restart the dashboard):\n");
  console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
  console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
  console.log(`VAPID_SUBJECT=mailto:you@example.com`);
}

async function cmdNotifyTest(): Promise<void> {
  const s = notifyStatus();
  console.log(`email: ${s.email ? "configured" : "off (RESEND_API_KEY + NOTIFY_EMAIL_TO)"} · push: ${s.push ? `configured, ${s.pushSubscribers} device(s)` : "off (VAPID keys)"}`);
  await notify({
    kind: "video_ready",
    project: arg("project") ?? "test",
    title: "Test notification from Content Engine",
    body: "If you can read this, notifications are working. Nothing was published.",
    path: "/",
  });
}

/** Simple in-process scheduler: checks cadence every few minutes, spawns due runs.
 *  Only projects with schedule.autoRun=true participate; runs land in the
 *  approval queue like any other — the scheduler can never publish. */
async function cmdScheduler(): Promise<void> {
  const intervalMin = Number(arg("interval-min") ?? 5);
  const db = openDb();
  console.log(`Scheduler started (checking every ${intervalMin} min). Projects opt in via schedule.autoRun=true.`);

  const tick = () => {
    for (const slug of listProjects()) {
      let project;
      try {
        project = loadProject(slug);
      } catch (err) {
        console.log(`[${new Date().toISOString()}] ${slug}: skipped (bad config: ${String(err)})`);
        continue;
      }

      maybeRunDailyJobs(project);
      reapStaleRuns(db, slug);

      const sched: any = project.config.schedule;
      if (!sched?.autoRun) {
        console.log(`[${new Date().toISOString()}] ${slug}: autoRun off, skipping`);
        continue;
      }
      const active = db
        .prepare("SELECT COUNT(*) AS n FROM runs WHERE project = ? AND status IN ('running','editing')")
        .get(slug) as { n: number };
      if (active.n > 0) {
        console.log(`[${new Date().toISOString()}] ${slug}: a run is already active, skipping`);
        continue;
      }
      if (maybeAutoRetry(db, project)) continue;
      const last = db
        .prepare("SELECT created_at FROM runs WHERE project = ? ORDER BY created_at DESC LIMIT 1")
        .get(slug) as { created_at: string } | undefined;
      const gapMs = (7 / project.config.schedule.cadencePerWeek) * 86400_000;
      const due = !last || Date.now() - new Date(last.created_at).getTime() >= gapMs;
      if (!due) {
        const nextAt = new Date(new Date(last!.created_at).getTime() + gapMs).toISOString();
        console.log(`[${new Date().toISOString()}] ${slug}: not due (next at ${nextAt})`);
        continue;
      }
      const logsDir = join(repoRoot, "data", "logs");
      mkdirSync(logsDir, { recursive: true });
      const fd = openSync(join(logsDir, `scheduler-${slug}-${Date.now()}.log`), "a");
      spawn("npx", ["tsx", "packages/pipeline/src/cli.ts", "run", slug], {
        cwd: repoRoot,
        stdio: ["ignore", fd, fd],
      });
      console.log(`[${new Date().toISOString()}] ${slug}: DUE — spawned engine run (lands in approval queue)`);
    }
  };

  tick();
  setInterval(tick, intervalMin * 60_000);
  await new Promise(() => {}); // run until killed
}

/** A run whose process died leaves status "running" forever and blocks the schedule.
 *  Nothing in a healthy run goes 3h without a stage update, so mark those failed. */
function reapStaleRuns(db: ReturnType<typeof openDb>, slug: string): void {
  const cutoff = new Date(Date.now() - 3 * 3600_000).toISOString();
  const stale = db
    .prepare("SELECT id FROM runs WHERE project = ? AND status IN ('running','editing') AND updated_at < ?")
    .all(slug, cutoff) as { id: string }[];
  for (const r of stale) {
    db.prepare("UPDATE runs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?")
      .run("Stopped responding for 3 hours (the engine process probably died). Retry from the dashboard.", new Date().toISOString(), r.id);
    db.prepare("UPDATE run_stages SET status = 'failed', finished_at = ? WHERE run_id = ? AND status = 'running'")
      .run(new Date().toISOString(), r.id);
    console.log(`[${new Date().toISOString()}] ${slug}: ${r.id} marked failed (stale)`);
  }
}

/** Retry the most recent failed run ONCE (transient API errors are common; a second
 *  failure waits for a human). Returns true when a retry was spawned this tick. */
function maybeAutoRetry(db: ReturnType<typeof openDb>, project: Project): boolean {
  const last = db
    .prepare("SELECT id, status, topic, error FROM runs WHERE project = ? ORDER BY created_at DESC LIMIT 1")
    .get(project.slug) as { id: string; status: string; topic: string | null; error: string | null } | undefined;
  if (!last || last.status !== "failed") return false;
  // Don't burn credits on failures a retry cannot fix.
  if (/quota|credits|insufficient|Missing required \.env|Validation failed|unauthorized|401|403/i.test(last.error ?? "")) return false;
  const state = readJobsState(project);
  const retried: string[] = state.autoRetried ?? [];
  if (retried.includes(last.id)) return false;
  state.autoRetried = [...retried.slice(-20), last.id];
  mkdirSync(join(project.dir, "state"), { recursive: true });
  writeFileSync(jobsStatePath(project), JSON.stringify(state, null, 2));

  const logsDir = join(repoRoot, "data", "logs");
  mkdirSync(logsDir, { recursive: true });
  const fd = openSync(join(logsDir, `scheduler-retry-${project.slug}-${Date.now()}.log`), "a");
  const args = ["tsx", "packages/pipeline/src/cli.ts", "run", project.slug];
  if (last.topic) args.push("--topic", last.topic);
  spawn("npx", args, { cwd: repoRoot, stdio: ["ignore", fd, fd] });
  console.log(`[${new Date().toISOString()}] ${project.slug}: auto-retrying failed run ${last.id} once`);
  return true;
}

/**
 * Once per calendar day per Notion-connected project, run teardown → ideas-audit →
 * metrics as child processes (sequentially, so they share the Notion rate limit).
 * Read-only jobs: they can never publish.
 */
const dailyJobsRunning = new Set<string>();

function maybeRunDailyJobs(project: Project): void {
  if (!notionConfigured(project) || dailyJobsRunning.has(project.slug)) return;
  const today = new Date().toISOString().slice(0, 10);
  const state = readJobsState(project);
  if (state.dailyJobs?.slice(0, 10) === today) return;

  // Claim the day up front so a slow job cannot be spawned twice.
  state.dailyJobs = new Date().toISOString();
  try {
    mkdirSync(join(project.dir, "state"), { recursive: true });
    writeFileSync(jobsStatePath(project), JSON.stringify(state, null, 2));
  } catch (err) {
    console.warn(`jobs: could not record daily-job date for ${project.slug}: ${String(err)}`);
    return;
  }

  dailyJobsRunning.add(project.slug);
  const names: JobName[] = ["teardown", "ideas-audit", "metrics"];
  const logsDir = join(repoRoot, "data", "logs");
  mkdirSync(logsDir, { recursive: true });

  const runNext = (i: number): void => {
    if (i >= names.length) {
      dailyJobsRunning.delete(project.slug);
      console.log(`[${new Date().toISOString()}] ${project.slug}: daily Notion jobs finished`);
      return;
    }
    const name = names[i];
    const fd = openSync(join(logsDir, `job-${project.slug}-${name}-${Date.now()}.log`), "a");
    const child = spawn("npx", ["tsx", "packages/pipeline/src/cli.ts", "job", name, project.slug], {
      cwd: repoRoot,
      stdio: ["ignore", fd, fd],
    });
    console.log(`[${new Date().toISOString()}] ${project.slug}: spawned job ${name}`);
    child.on("exit", () => runNext(i + 1));
    child.on("error", () => runNext(i + 1));
  };
  runNext(0);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2).filter((a, i, all) => {
    // positional args = everything before the first --flag
    const firstFlag = all.findIndex((x) => x.startsWith("--"));
    return firstFlag === -1 || i < firstFlag;
  });

  switch (cmd) {
    case "list":
      return cmdList();
    case "init":
      if (!rest[0]) usage();
      return cmdInit(rest[0]);
    case "run":
      if (!rest[0]) usage();
      return cmdRun(rest[0]);
    case "stage":
      if (!rest[0] || !rest[1]) usage();
      return cmdStage(rest[0], rest[1]);
    case "runs":
      return cmdRuns(rest[0]);
    case "auth":
      if (!rest[0]) usage();
      return runAuth(loadProject(rest[0]));
    case "edit":
      if (!rest[0]) usage();
      return cmdEdit(rest[0]);
    case "rollback":
      if (!rest[0]) usage();
      return runRollback(loadProject(rest[0]), {
        dir: (() => {
          const d = arg("dir");
          if (!d) throw new Error("engine rollback requires --dir <videoDir>");
          return d;
        })(),
        version: Number(arg("version") ?? NaN) || (() => { throw new Error("engine rollback requires --version N"); })(),
      });
    case "notion": {
      if (!rest[0] || !rest[1]) usage();
      if (rest[0] === "setup") return cmdNotionSetup(rest[1]);
      if (rest[0] === "status") return cmdNotionStatus(rest[1]);
      throw new Error(`Unknown notion subcommand "${rest[0]}". Use: setup | status`);
    }
    case "job":
      if (!rest[0] || !rest[1]) usage();
      return cmdJob(rest[0], rest[1]);
    case "scheduler":
      return cmdScheduler();
    case "push-keys":
      return cmdPushKeys();
    case "notify-test":
      return cmdNotifyTest();
    case "telegram-connect": {
      const r = await registerTelegramChats();
      console.log(JSON.stringify(r));
      return;
    }
    default:
      usage();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
