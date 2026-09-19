import { NextRequest, NextResponse } from "next/server";
import { getRun, spawnEngine, isEngineBusy, newestRunIdFor } from "../../../../../lib/engine";

/** Start a fresh run for the same topic after a failure. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = getRun(id);
  if (!run) return new NextResponse("Run not found", { status: 404 });
  if (!["failed", "stopped", "rejected"].includes(run.status)) {
    return new NextResponse("Only failed or stopped videos can be retried", { status: 409 });
  }
  if (isEngineBusy(run.project)) return new NextResponse("A video is already being made for this channel.", { status: 409 });

  const before = newestRunIdFor(run.project);
  const args = ["run", run.project];
  if (run.topic) args.push("--topic", run.topic);
  spawnEngine(args, `retry-${id}-${Date.now()}`);
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const nid = newestRunIdFor(run.project);
    if (nid && nid !== before) return NextResponse.json({ runId: nid });
  }
  return NextResponse.json({ runId: null });
}
