import { NextRequest, NextResponse } from "next/server";
import { getRuns } from "../../../lib/engine";

export async function GET(req: NextRequest) {
  const project = req.nextUrl.searchParams.get("project") ?? undefined;
  return NextResponse.json(getRuns(project));
}
