/**
 * Server-side access to the engine: repo paths, run DB (read + status updates),
 * project configs, and spawning the CLI for actions (init, upload) so the
 * dashboard stays a thin layer over packages/pipeline.
 */
import Database from "better-sqlite3";
import { existsSync, readFileSync, readdirSync, mkdirSync, openSync, writeFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn, execFile } from "node:child_process";
import { parse as parseDotenv } from "dotenv";

function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    if (existsSync(join(dir, "projects")) && existsSync(join(dir, "packages", "pipeline"))) return dir;
    dir = resolve(dir, "..");
  }
  throw new Error("Could not locate repo root (projects/ + packages/pipeline) from " + process.cwd());
}

export const repoRoot = findRepoRoot();

/** video_dir may be stored relative to the repo or absolute — normalise. */
export const absVideoDir = (videoDir: string) => resolve(repoRoot, videoDir);

let _db: Database.Database | null = null;
export function db(): Database.Database {
  if (!_db) {
    mkdirSync(join(repoRoot, "data"), { recursive: true });
    _db = new Database(join(repoRoot, "data", "engine.db"));
    _db.pragma("journal_mode = WAL");
    _db.exec(`
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, project TEXT NOT NULL, topic TEXT, video_dir TEXT, status TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS run_stages (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, stage TEXT NOT NULL, status TEXT NOT NULL, error TEXT, artifacts_json TEXT, started_at TEXT, finished_at TEXT, UNIQUE(run_id, stage));
      CREATE TABLE IF NOT EXISTS run_edits (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, instruction TEXT NOT NULL, summary TEXT, stages_json TEXT, status TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL, finished_at TEXT);
      CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint TEXT PRIMARY KEY, subscription_json TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS telegram_chats (chat_id TEXT PRIMARY KEY, name TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, project TEXT NOT NULL, run_id TEXT, title TEXT NOT NULL, body TEXT NOT NULL, path TEXT NOT NULL, created_at TEXT NOT NULL);
    `);
  }
  return _db;
}

export interface RunRow {
  id: string;
  project: string;
  topic: string | null;
  video_dir: string | null;
  status: string;
  error: string | null;
  created_at: string;
  updated_at: string;
  stages: StageRow[];
}

export interface StageRow {
  stage: string;
  status: string;
  error: string | null;
  artifacts_json: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export function getRuns(project?: string, limit = 25): RunRow[] {
  const runs = (
    project
      ? db().prepare("SELECT * FROM runs WHERE project = ? ORDER BY created_at DESC LIMIT ?").all(project, limit)
      : db().prepare("SELECT * FROM runs ORDER BY created_at DESC LIMIT ?").all(limit)
  ) as RunRow[];
  const stageStmt = db().prepare("SELECT * FROM run_stages WHERE run_id = ? ORDER BY id");
  return runs.map((r) => ({ ...r, stages: stageStmt.all(r.id) as StageRow[] }));
}

export function getRun(id: string): RunRow | null {
  const run = db().prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | undefined;
  if (!run) return null;
  run.stages = db().prepare("SELECT * FROM run_stages WHERE run_id = ? ORDER BY id").all(id) as StageRow[];
  return run;
}

export function setRunStatus(id: string, status: string, error?: string | null): void {
  db()
    .prepare("UPDATE runs SET status = ?, error = ?, updated_at = ? WHERE id = ?")
    .run(status, error ?? null, new Date().toISOString(), id);
}

/* ---------- Plain-language vocabulary shared by every page ---------- */

export const STAGE_LABELS: Record<string, string> = {
  research: "Finding a topic",
  script: "Writing the script",
  voiceover: "Recording narration",
  visuals: "Creating visuals",
  render: "Editing the video",
  captions: "Adding captions",
  music: "Mixing music",
  metadata: "Writing title & description",
  thumbnail: "Designing the thumbnail",
  validate: "Quality check",
};

export const RUN_STATUS_LABELS: Record<string, string> = {
  running: "In progress",
  stopped: "Stopped early",
  failed: "Needs attention",
  pending_approval: "Ready for review",
  editing: "Applying your changes",
  approved: "Publishing…",
  rejected: "Rejected",
  upload_failed: "Publish failed",
  uploaded: "Published",
};

export function runProgress(run: RunRow): { done: number; total: number; current: string | null; pct: number } {
  const total = run.stages.length || 1;
  const done = run.stages.filter((s) => s.status === "done" || s.status === "skipped").length;
  const running = run.stages.find((s) => s.status === "running");
  const failed = run.stages.find((s) => s.status === "failed");
  const current = running ? STAGE_LABELS[running.stage] ?? running.stage : failed ? STAGE_LABELS[failed.stage] ?? failed.stage : null;
  return { done, total, current, pct: Math.round((done / total) * 100) };
}

/* ---------- Projects (called "channels" in the UI) ---------- */

export interface ProjectSummary {
  slug: string;
  config: any;
  lastRun: { id: string; status: string; created_at: string; topic: string | null } | null;
  nextRunDue: string | null;
  youtubeConnected: boolean;
  notion: NotionStatus;
  counts: { queue: number; published: number; inProgress: number };
}

export interface NotionStatus {
  configured: boolean;
  hubUrl: string | null;
}

export function projectDir(slug: string): string {
  return join(repoRoot, "projects", slug);
}

export function readProjectEnv(slug: string): Record<string, string> {
  const p = join(projectDir(slug), ".env");
  return existsSync(p) ? parseDotenv(readFileSync(p, "utf8")) : {};
}

/** Set/replace one KEY=value line in projects/<slug>/.env (gitignored). */
export function writeProjectEnv(slug: string, key: string, value: string): void {
  const p = join(projectDir(slug), ".env");
  let env = existsSync(p) ? readFileSync(p, "utf8") : "";
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(env)) env = env.replace(re, `${key}=${value}`);
  else env += `${env.endsWith("\n") || env === "" ? "" : "\n"}${key}=${value}\n`;
  writeFileSync(p, env);
}

export function readConfig(slug: string): any | null {
  const p = join(projectDir(slug), "config.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

export function writeConfig(slug: string, config: any): void {
  writeFileSync(join(projectDir(slug), "config.json"), JSON.stringify(config, null, 2));
}

export function notionStatus(slug: string): NotionStatus {
  const p = join(projectDir(slug), "notion.json");
  if (!existsSync(p)) return { configured: false, hubUrl: null };
  try {
    const j = JSON.parse(readFileSync(p, "utf8"));
    return { configured: true, hubUrl: j.hubUrl ?? null };
  } catch {
    return { configured: false, hubUrl: null };
  }
}

export function getProject(slug: string): ProjectSummary | null {
  const config = readConfig(slug);
  if (!config) return null;
  const lastRun =
    (db()
      .prepare("SELECT id, status, created_at, topic FROM runs WHERE project = ? ORDER BY created_at DESC LIMIT 1")
      .get(slug) as ProjectSummary["lastRun"]) ?? null;
  let nextRunDue: string | null = null;
  if (lastRun && config.schedule?.cadencePerWeek > 0 && config.schedule?.autoRun) {
    const gapMs = (7 / config.schedule.cadencePerWeek) * 86400_000;
    nextRunDue = new Date(new Date(lastRun.created_at).getTime() + gapMs).toISOString();
  }
  const count = (statuses: string[]) =>
    (db()
      .prepare(`SELECT COUNT(*) AS n FROM runs WHERE project = ? AND status IN (${statuses.map(() => "?").join(",")})`)
      .get(slug, ...statuses) as { n: number }).n;
  return {
    slug,
    config,
    lastRun,
    nextRunDue,
    youtubeConnected: !!readProjectEnv(slug).YOUTUBE_REFRESH_TOKEN,
    notion: notionStatus(slug),
    counts: {
      queue: count(["pending_approval", "upload_failed"]),
      published: count(["uploaded"]),
      inProgress: count(["running", "editing", "approved"]),
    },
  };
}

export function getProjects(): ProjectSummary[] {
  const root = join(repoRoot, "projects");
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, d.name, "config.json")))
    .map((d) => getProject(d.name)!)
    .filter(Boolean);
}

/* ---------- Video artifacts ---------- */

export interface VideoInfo {
  metadata: any;
  validation: any;
  script: any;
  timestamps: { scene: number; start: number; end: number }[] | null;
  hasVideo: boolean;
  hasThumb: boolean;
  durationSec: number | null;
  versions: { v: number; instruction: string; summary: string; createdAt: string; hasVideo: boolean }[];
}

export function videoMeta(videoDir: string): VideoInfo {
  const abs = absVideoDir(videoDir);
  const read = (f: string) => {
    try {
      return existsSync(join(abs, f)) ? JSON.parse(readFileSync(join(abs, f), "utf8")) : null;
    } catch {
      return null;
    }
  };
  const versions = ((read("versions/versions.json") as any[]) ?? []).map((v) => ({
    ...v,
    hasVideo: existsSync(join(abs, "versions", `v${v.v}`, "final_video.mp4")),
  }));
  // timestamps.json = { totalDuration, sceneStarts: number[], words: [...] }
  const ts = read("timestamps.json");
  let timestamps: VideoInfo["timestamps"] = null;
  if (Array.isArray(ts?.sceneStarts)) {
    const starts: number[] = ts.sceneStarts;
    const total: number = ts.totalDuration ?? starts[starts.length - 1] ?? 0;
    timestamps = starts.map((s, i) => ({ scene: i + 1, start: s, end: starts[i + 1] ?? total }));
  }
  const last = ts?.totalDuration ?? (timestamps?.length ? timestamps[timestamps.length - 1].end : null);
  return {
    metadata: read("metadata.json"),
    validation: read("validation.json"),
    script: read("script.json"),
    timestamps,
    hasVideo: existsSync(join(abs, "final_video.mp4")),
    hasThumb: existsSync(join(abs, "thumbnail.png")),
    durationSec: last && last > 0 ? last : null,
    versions,
  };
}

export const artifactUrl = (videoDir: string, file: string) =>
  `/api/artifacts?p=${encodeURIComponent(`${absVideoDir(videoDir)}/${file}`)}`;

export function getEdits(runId: string) {
  try {
    return db()
      .prepare("SELECT * FROM run_edits WHERE run_id = ? ORDER BY id DESC")
      .all(runId) as {
      id: number;
      instruction: string;
      summary: string | null;
      stages_json: string | null;
      status: string;
      error: string | null;
      created_at: string;
    }[];
  } catch {
    return [];
  }
}

/* ---------- Research (topic suggestions) ---------- */

export interface Topic {
  topic: string;
  angle: string;
  why_now: string;
}

export function latestResearch(slug: string): { generatedAt: string; topics: Topic[] } | null {
  const out = join(projectDir(slug), "output");
  if (!existsSync(out)) return null;
  const files = readdirSync(out)
    .filter((f) => /^research-\d+\.json$/.test(f))
    .map((f) => ({ f, m: statSync(join(out, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  if (!files.length) return null;
  try {
    const j = JSON.parse(readFileSync(join(out, files[0].f), "utf8"));
    return { generatedAt: j.generatedAt, topics: j.topics ?? [] };
  } catch {
    return null;
  }
}

/** YouTube id recorded at upload time (projects/<slug>/state/published_topics.json), matched by title. */
export function publishedVideoId(slug: string, title: string): string | null {
  try {
    const s = JSON.parse(readFileSync(join(projectDir(slug), "state", "published_topics.json"), "utf8"));
    return s.topics.find((t: any) => t.topic === title)?.videoId ?? null;
  } catch {
    return null;
  }
}

/* ---------- Connections (account-level keys entered in the dashboard) ---------- */

export const CONNECTION_KEYS = [
  "ANTHROPIC_API_KEY", "ELEVENLABS_API_KEY", "IMAGE_API_KEY",
  "RESEND_API_KEY", "NOTIFY_EMAIL_TO", "NOTIFY_EMAIL_FROM",
  "SEGMIND_API_KEY", "HIGGSFIELD_API_KEY_ID", "HIGGSFIELD_API_KEY_SECRET", "TELEGRAM_BOT_TOKEN",
] as const;
export type ConnectionKey = (typeof CONNECTION_KEYS)[number];

const connectionsPath = () => join(repoRoot, "data", "connections.json");

export function readConnections(): Partial<Record<ConnectionKey, string>> {
  try {
    return existsSync(connectionsPath()) ? JSON.parse(readFileSync(connectionsPath(), "utf8")) : {};
  } catch {
    return {};
  }
}

export function writeConnections(patch: Partial<Record<ConnectionKey, string>>): void {
  const current = readConnections();
  for (const k of CONNECTION_KEYS) {
    const v = patch[k];
    if (v === undefined) continue;
    if (v === "") delete current[k];
    else current[k] = v.trim();
  }
  mkdirSync(join(repoRoot, "data"), { recursive: true });
  writeFileSync(connectionsPath(), JSON.stringify(current, null, 2), { mode: 0o600 });
}

/** Effective value: dashboard-entered key, else host env. */
export function keyValue(k: ConnectionKey): string {
  return readConnections()[k] || process.env[k] || "";
}

/** What the client sees: which keys are set and where from — never the values. */
export function connectionStatus() {
  const c = readConnections();
  const row = (k: ConnectionKey) => ({ set: !!(c[k] || process.env[k]), source: c[k] ? "dashboard" : process.env[k] ? "host" : "none" });
  return {
    anthropic: row("ANTHROPIC_API_KEY"),
    elevenlabs: row("ELEVENLABS_API_KEY"),
    replicate: row("IMAGE_API_KEY"),
    resend: row("RESEND_API_KEY"),
    emailTo: keyValue("NOTIFY_EMAIL_TO"),
    segmind: row("SEGMIND_API_KEY"),
    higgsfield: { set: !!(keyValue("HIGGSFIELD_API_KEY_ID") || keyValue("HIGGSFIELD_API_KEY_SECRET")), source: c.HIGGSFIELD_API_KEY_ID ? "dashboard" : process.env.HIGGSFIELD_API_KEY_ID ? "host" : "none" },
    telegram: row("TELEGRAM_BOT_TOKEN"),
    youtubeApp: !!(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET),
    dashboardUrl: process.env.DASHBOARD_URL ?? "",
    coreReady: !!(keyValue("ANTHROPIC_API_KEY") && keyValue("ELEVENLABS_API_KEY") && keyValue("IMAGE_API_KEY")),
  };
}

/* ---------- Notifications ---------- */

export function getNotifications(limit = 20) {
  return db()
    .prepare("SELECT * FROM notifications ORDER BY id DESC LIMIT ?")
    .all(limit) as { id: number; kind: string; project: string; run_id: string | null; title: string; body: string; path: string; created_at: string }[];
}

export function notificationSetup(): { email: boolean; emailTo: string; push: boolean; pushDevices: number; vapidPublicKey: string; telegram: boolean; telegramChats: { chat_id: string; name: string | null }[] } {
  const pushDevices = (db().prepare("SELECT COUNT(*) AS n FROM push_subscriptions").get() as { n: number }).n;
  const telegramChats = db().prepare("SELECT chat_id, name FROM telegram_chats ORDER BY created_at").all() as { chat_id: string; name: string | null }[];
  return {
    telegram: !!keyValue("TELEGRAM_BOT_TOKEN"),
    telegramChats,
    email: !!(keyValue("RESEND_API_KEY") && keyValue("NOTIFY_EMAIL_TO")),
    emailTo: keyValue("NOTIFY_EMAIL_TO"),
    push: !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
    pushDevices,
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? "",
  };
}

/* ---------- Engine process control ---------- */

/** Spawn an engine CLI command detached-ish, teeing output to data/logs/<logName>.log.
 *  onExit fires in this (long-lived dev/prod server) process to update run status. */
export function spawnEngine(args: string[], logName: string, onExit?: (code: number, logPath: string) => void): void {
  const logsDir = join(repoRoot, "data", "logs");
  mkdirSync(logsDir, { recursive: true });
  const logPath = join(logsDir, `${logName}.log`);
  const fd = openSync(logPath, "a");
  const child = spawn("npx", ["tsx", "packages/pipeline/src/cli.ts", ...args], {
    cwd: repoRoot,
    stdio: ["ignore", fd, fd],
  });
  child.on("exit", (code) => onExit?.(code ?? 1, logPath));
}

/** Run an engine command to completion and return its stdout (for short, synchronous actions). */
export function execEngine(args: string[], timeoutMs = 120_000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolvePromise) => {
    execFile(
      "npx",
      ["tsx", "packages/pipeline/src/cli.ts", ...args],
      { cwd: repoRoot, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => resolvePromise({ ok: !err, out: (err ? stderr || stdout || String(err) : stdout).toString() })
    );
  });
}

/** Read the last run that produced a given topic so "Retry" can reuse it. */
export function newestRunIdFor(project: string): string | null {
  const r = db().prepare("SELECT id FROM runs WHERE project = ? ORDER BY created_at DESC LIMIT 1").get(project) as
    | { id: string }
    | undefined;
  return r?.id ?? null;
}

export function isEngineBusy(project: string): boolean {
  const r = db()
    .prepare("SELECT COUNT(*) AS n FROM runs WHERE project = ? AND status IN ('running','editing')")
    .get(project) as { n: number };
  return r.n > 0;
}
