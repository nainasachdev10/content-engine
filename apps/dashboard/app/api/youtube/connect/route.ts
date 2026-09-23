import { NextRequest, NextResponse } from "next/server";

/** Behind Railway/Caddy the app sees http://; DASHBOARD_URL is the address Google must match. */
const publicOrigin = (req: NextRequest) => (process.env.DASHBOARD_URL ?? "").replace(/\/$/, "") || req.nextUrl.origin;
import { readConfig } from "../../../../lib/engine";

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
];

/** Send the client to Google's consent screen for THIS channel. The callback stores the refresh token. */
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("project") ?? "";
  if (!readConfig(slug)) return new NextResponse("Channel not found", { status: 404 });
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  if (!clientId) return new NextResponse("YOUTUBE_CLIENT_ID is not set in .env", { status: 500 });
  const redirect = `${publicOrigin(req)}/api/youtube/callback`;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("state", JSON.stringify({ slug, back: req.nextUrl.searchParams.get("back") ?? `/channels/${slug}` }));
  return NextResponse.redirect(url.toString());
}
