import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { getRun, repoRoot } from "../../../../../lib/engine";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { version } = await req.json();
  const v = Number(version);
  if (!Number.isInteger(v) || v < 1) return new NextResponse("Bad version", { status: 400 });
  const run = getRun(id);
  if (!run?.video_dir) return new NextResponse("Run not found", { status: 404 });
  if (!["pending_approval", "upload_failed"].includes(run.status)) {
    return new NextResponse(`Run is ${run.status} — only queued videos can be rolled back`, { status: 409 });
  }

  return await new Promise<NextResponse>((resolvePromise) => {
    execFile(
      "npx",
      ["tsx", "packages/pipeline/src/cli.ts", "rollback", run.project, "--dir", run.video_dir!, "--version", String(v)],
      { cwd: repoRoot, timeout: 120_000 },
      (err, stdout, stderr) => {
        if (err) resolvePromise(new NextResponse(stderr || stdout || String(err), { status: 500 }));
        else resolvePromise(new NextResponse(stdout));
      }
    );
  });
}
