import { NextRequest, NextResponse } from "next/server";
import { getRun, setRunStatus, spawnEngine } from "../../../../../lib/engine";

/** Prompt-based edit: delegates to `engine edit`, which snapshots a version,
 *  re-runs only the affected stages, and returns the run to pending_approval. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { instruction } = await req.json();
  if (!instruction || typeof instruction !== "string" || instruction.trim().length < 5) {
    return new NextResponse("Instruction too short", { status: 400 });
  }
  const run = getRun(id);
  if (!run) return new NextResponse("Run not found", { status: 404 });
  if (!["pending_approval", "upload_failed"].includes(run.status)) {
    return new NextResponse(`Run is ${run.status} — only queued videos can be edited`, { status: 409 });
  }
  if (!run.video_dir) return new NextResponse("Run has no video_dir", { status: 409 });

  spawnEngine(
    ["edit", run.project, "--dir", run.video_dir, "--run", id, "--instruction", instruction.trim()],
    `${id}-edit-${Date.now()}`,
    (code) => {
      // The CLI normally writes final statuses itself; this is a crash backstop.
      const after = getRun(id);
      if (after?.status === "editing") {
        setRunStatus(id, "pending_approval", code === 0 ? null : `edit process exited with code ${code}`);
      }
    }
  );
  return new NextResponse("edit started");
}
