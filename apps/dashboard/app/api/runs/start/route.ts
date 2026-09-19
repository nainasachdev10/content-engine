import { NextRequest, NextResponse } from "next/server";
import { readConfig, spawnEngine, isEngineBusy, newestRunIdFor, getRun, setRunStatus } from "../../../../lib/engine";

/** Start a new video for a channel. Optional topic/angle skips topic research.
 *  The run ends in the review queue — it can never publish by itself. */
export async function POST(req: NextRequest) {
  const { project, topic, angle } = await req.json();
  if (!project || !/^[a-z0-9-]+$/.test(project)) return new NextResponse("Bad channel", { status: 400 });
  if (!readConfig(project)) return new NextResponse("Channel not found", { status: 404 });
  if (isEngineBusy(project)) return new NextResponse("A video is already being made for this channel. Wait for it to finish first.", { status: 409 });

  const before = newestRunIdFor(project);
  const args = ["run", project];
  if (topic) args.push("--topic", String(topic).slice(0, 300));
  if (angle) args.push("--angle", String(angle).slice(0, 600));

  spawnEngine(args, `start-${project}-${Date.now()}`, (code) => {
    // Crash backstop: if the CLI died before writing a final status, don't leave the run "running".
    const id = newestRunIdFor(project);
    if (id && id !== before) {
      const r = getRun(id);
      if (r?.status === "running") setRunStatus(id, "failed", `engine exited with code ${code}`);
    }
  });

  // Give the CLI a moment to register the run so the client can navigate to it.
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const id = newestRunIdFor(project);
    if (id && id !== before) return NextResponse.json({ runId: id });
  }
  return NextResponse.json({ runId: null });
}
