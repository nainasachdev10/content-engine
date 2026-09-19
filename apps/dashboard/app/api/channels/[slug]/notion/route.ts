import { NextRequest, NextResponse } from "next/server";
import { readConfig, writeProjectEnv, execEngine, notionStatus } from "../../../../../lib/engine";

/** Connect a channel to Notion: store the integration token (gitignored per-channel .env)
 *  and build the hub page + databases under the page the client shared. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (!readConfig(slug)) return new NextResponse("Channel not found", { status: 404 });
  const { token, pageUrl } = await req.json();
  if (!pageUrl || typeof pageUrl !== "string") return new NextResponse("Paste the Notion page link", { status: 400 });
  if (token && typeof token === "string" && token.trim()) writeProjectEnv(slug, "NOTION_TOKEN", token.trim());

  const res = await execEngine(["notion", "setup", slug, "--page", pageUrl.trim()], 300_000);
  if (!res.ok) return new NextResponse(res.out.slice(-800), { status: 500 });
  return NextResponse.json(notionStatus(slug));
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  return NextResponse.json(notionStatus(slug));
}
