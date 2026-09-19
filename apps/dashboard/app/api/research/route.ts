import { NextRequest, NextResponse } from "next/server";
import { latestResearch, execEngine, readConfig } from "../../../lib/engine";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const project = req.nextUrl.searchParams.get("project") ?? "";
  if (!readConfig(project)) return new NextResponse("Channel not found", { status: 404 });
  return NextResponse.json(latestResearch(project) ?? { generatedAt: null, topics: [] });
}

/** Run topic research now (takes ~1 minute) and return the ranked suggestions. */
export async function POST(req: NextRequest) {
  const { project } = await req.json();
  if (!project || !readConfig(project)) return new NextResponse("Channel not found", { status: 404 });
  const res = await execEngine(["stage", "research", project], 240_000);
  if (!res.ok) return new NextResponse(res.out.slice(-600), { status: 500 });
  return NextResponse.json(latestResearch(project) ?? { generatedAt: null, topics: [] });
}
