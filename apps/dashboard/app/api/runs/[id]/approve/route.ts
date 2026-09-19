import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { getRun, setRunStatus, spawnEngine } from "../../../../../lib/engine";

/**
 * The ONLY path to YouTube. Marks the run approved, then spawns
 * `engine stage upload <project> --dir <video_dir>`; on exit the run becomes
 * uploaded or upload_failed (retryable from the queue).
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = getRun(id);
  if (!run) return new NextResponse("Run not found", { status: 404 });
  if (!["pending_approval", "upload_failed"].includes(run.status)) {
    return new NextResponse(`Run is ${run.status}, not awaiting approval`, { status: 409 });
  }
  if (!run.video_dir) return new NextResponse("Run has no video_dir", { status: 409 });

  setRunStatus(id, "approved");
  spawnEngine(["stage", "upload", run.project, "--dir", run.video_dir], `${id}-upload`, (code, logPath) => {
    if (code === 0) {
      setRunStatus(id, "uploaded");
    } else {
      let tail = "";
      try {
        tail = readFileSync(logPath, "utf8").trim().split("\n").slice(-3).join(" | ");
      } catch {}
      setRunStatus(id, "upload_failed", tail.slice(0, 500) || `upload exited with code ${code}`);
    }
  });
  return new NextResponse("approved, upload started");
}
