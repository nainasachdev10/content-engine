import { NextRequest, NextResponse } from "next/server";
import { readConfig, spawnEngine } from "../../../lib/engine";

const JOBS = new Set(["teardown", "ideas-audit", "metrics"]);

/** Run one of the daily Notion jobs right now (they also run automatically once a day). */
export async function POST(req: NextRequest) {
  const { project, job } = await req.json();
  if (!project || !readConfig(project)) return new NextResponse("Channel not found", { status: 404 });
  if (!JOBS.has(job)) return new NextResponse("Unknown job", { status: 400 });
  spawnEngine(["job", job, project], `job-${project}-${job}-${Date.now()}`);
  return new NextResponse("started");
}
