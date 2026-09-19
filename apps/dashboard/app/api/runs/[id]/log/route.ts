import { NextRequest, NextResponse } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../../../../../lib/engine";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^run-[a-z0-9-]+$/.test(id)) return new NextResponse("Bad id", { status: 400 });
  const path = join(repoRoot, "data", "logs", `${id}.log`);
  if (!existsSync(path)) return new NextResponse("No log", { status: 404 });
  const text = readFileSync(path, "utf8");
  // Tail the last ~200 lines to keep the response light.
  const lines = text.split("\n");
  return new NextResponse(lines.slice(-200).join("\n"));
}
