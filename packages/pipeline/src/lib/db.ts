/**
 * Run-tracking database: data/engine.db (SQLite via better-sqlite3).
 *
 * better-sqlite3 over Prisma: synchronous API suits a CLI, no codegen/migration
 * toolchain for a 2-table schema, and the Phase B Next.js dashboard can read the
 * same file directly.
 */
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./env.js";

export type RunStatus =
  | "running"
  | "stopped" // intentionally halted early via --until
  | "failed"
  | "pending_approval" // rendered + validated, waiting in the approval queue (Phase B)
  | "editing" // a prompt-edit is re-running stages; returns to pending_approval
  | "approved" // approval given, upload in progress
  | "rejected"
  | "upload_failed" // retryable from the approval queue
  | "uploaded";

export type StageStatus = "pending" | "running" | "done" | "failed" | "skipped";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id          TEXT PRIMARY KEY,
  project     TEXT NOT NULL,
  topic       TEXT,
  video_dir   TEXT,
  status      TEXT NOT NULL,
  error       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS run_stages (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id         TEXT NOT NULL REFERENCES runs(id),
  stage          TEXT NOT NULL,
  status         TEXT NOT NULL,
  error          TEXT,
  artifacts_json TEXT,
  started_at     TEXT,
  finished_at    TEXT,
  UNIQUE(run_id, stage)
);
CREATE TABLE IF NOT EXISTS run_edits (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id       TEXT NOT NULL REFERENCES runs(id),
  instruction  TEXT NOT NULL,
  summary      TEXT,
  stages_json  TEXT,
  status       TEXT NOT NULL,
  error        TEXT,
  created_at   TEXT NOT NULL,
  finished_at  TEXT
);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint          TEXT PRIMARY KEY,
  subscription_json TEXT NOT NULL,
  created_at        TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,
  project    TEXT NOT NULL,
  run_id     TEXT,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  path       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_project ON runs(project, created_at);
CREATE INDEX IF NOT EXISTS idx_stages_run ON run_stages(run_id);
CREATE INDEX IF NOT EXISTS idx_edits_run ON run_edits(run_id);
`;

let db: Database.Database | null = null;

export function openDb(): Database.Database {
  if (db) return db;
  const dataDir = join(repoRoot, "data");
  mkdirSync(dataDir, { recursive: true });
  db = new Database(join(dataDir, "engine.db"));
  db.pragma("journal_mode = WAL"); // dashboard reads while the CLI writes
  db.exec(SCHEMA);
  return db;
}
