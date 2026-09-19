/**
 * RunTracker — records a pipeline run and its per-stage progress in engine.db.
 * Stages write status transitions as they execute so the dashboard can poll live.
 */
import type { Database } from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { RunStatus, StageStatus } from "./db.js";

const now = () => new Date().toISOString();

export class RunTracker {
  constructor(
    private db: Database,
    public readonly runId: string
  ) {}

  static createRun(db: Database, project: string, stages: string[], topic?: string): RunTracker {
    const runId = `run-${randomUUID().slice(0, 8)}`;
    db.prepare(
      "INSERT INTO runs (id, project, topic, status, created_at, updated_at) VALUES (?, ?, ?, 'running', ?, ?)"
    ).run(runId, project, topic ?? null, now(), now());
    const insertStage = db.prepare(
      "INSERT INTO run_stages (run_id, stage, status) VALUES (?, ?, 'pending')"
    );
    for (const s of stages) insertStage.run(runId, s);
    return new RunTracker(db, runId);
  }

  private touch(): void {
    this.db.prepare("UPDATE runs SET updated_at = ? WHERE id = ?").run(now(), this.runId);
  }

  setTopic(topic: string): void {
    this.db.prepare("UPDATE runs SET topic = ? WHERE id = ?").run(topic, this.runId);
    this.touch();
  }

  setVideoDir(dir: string): void {
    this.db.prepare("UPDATE runs SET video_dir = ? WHERE id = ?").run(dir, this.runId);
    this.touch();
  }

  setStatus(status: RunStatus, error?: string): void {
    this.db
      .prepare("UPDATE runs SET status = ?, error = ?, updated_at = ? WHERE id = ?")
      .run(status, error ?? null, now(), this.runId);
  }

  stage(name: string, status: StageStatus, extra?: { error?: string; artifacts?: Record<string, string> }): void {
    const sets: string[] = ["status = ?"];
    const vals: unknown[] = [status];
    if (status === "running") {
      sets.push("started_at = ?");
      vals.push(now());
    }
    if (status === "done" || status === "failed" || status === "skipped") {
      sets.push("finished_at = ?");
      vals.push(now());
    }
    if (extra?.error !== undefined) {
      sets.push("error = ?");
      vals.push(extra.error);
    }
    if (extra?.artifacts !== undefined) {
      sets.push("artifacts_json = ?");
      vals.push(JSON.stringify(extra.artifacts));
    }
    vals.push(this.runId, name);
    this.db.prepare(`UPDATE run_stages SET ${sets.join(", ")} WHERE run_id = ? AND stage = ?`).run(...vals);
    this.touch();
  }
}

/** Recent runs with their stage rows, newest first (CLI `engine runs`, dashboard). */
export function recentRuns(db: Database, project?: string, limit = 10) {
  const runs = project
    ? db.prepare("SELECT * FROM runs WHERE project = ? ORDER BY created_at DESC LIMIT ?").all(project, limit)
    : db.prepare("SELECT * FROM runs ORDER BY created_at DESC LIMIT ?").all(limit);
  const stageStmt = db.prepare("SELECT * FROM run_stages WHERE run_id = ? ORDER BY id");
  return (runs as any[]).map((r) => ({ ...r, stages: stageStmt.all(r.id) }));
}
