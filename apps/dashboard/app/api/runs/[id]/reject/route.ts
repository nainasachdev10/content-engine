import { NextRequest, NextResponse } from "next/server";
import { getRun, setRunStatus, spawnEngine } from "../../../../../lib/engine";

/** Reject = archive: run record + artifacts stay on disk, excluded from the queue. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = getRun(id);
  if (!run) return new NextResponse("Run not found", { status: 404 });
  if (!["pending_approval", "upload_failed", "approved"].includes(run.status)) {
    return new NextResponse(`Run is ${run.status}, not rejectable`, { status: 409 });
  }
  setRunStatus(id, "rejected");
  if (run.video_dir) spawnEngine(["prune", "--dir", run.video_dir, "--shrink"], `${id}-prune`);
  return new NextResponse("rejected");
}
