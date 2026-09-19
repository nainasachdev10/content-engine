import { NextResponse } from "next/server";
import { execEngine } from "../../../lib/engine";

export async function POST() {
  const res = await execEngine(["notify-test"], 60_000);
  return new NextResponse(res.out.slice(-800), { status: res.ok ? 200 : 500 });
}
