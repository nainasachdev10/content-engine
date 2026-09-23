import { NextRequest, NextResponse } from "next/server";

/** Behind Railway/Caddy the app sees http://; DASHBOARD_URL is the address Google must match. */
const publicOrigin = (req: NextRequest) => (process.env.DASHBOARD_URL ?? "").replace(/\/$/, "") || req.nextUrl.origin;
import { readConfig, writeConfig, writeProjectEnv } from "../../../../lib/engine";

/** Google redirects here after consent. Exchanges the code for a refresh token,
 *  stores it in projects/<slug>/.env, and records the channel name/URL in config. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  let state: { slug: string; back: string };
  try {
    state = JSON.parse(q.get("state") ?? "{}");
  } catch {
    return new NextResponse("Bad state", { status: 400 });
  }
  const back = new URL(state.back || "/", publicOrigin(req));
  const fail = (msg: string) => {
    back.searchParams.set("yt", "error");
    back.searchParams.set("msg", msg.slice(0, 200));
    return NextResponse.redirect(back);
  };
  if (q.get("error")) return fail(q.get("error")!);
  const code = q.get("code");
  if (!code || !state.slug || !readConfig(state.slug)) return fail("Missing code or channel");

  const clientId = process.env.YOUTUBE_CLIENT_ID ?? "";
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET ?? "";
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${publicOrigin(req)}/api/youtube/callback`,
      grant_type: "authorization_code",
    }),
  });
  const tokens = await tokenRes.json();
  if (!tokenRes.ok || !tokens.refresh_token) {
    return fail(tokens.error_description || tokens.error || "Google returned no refresh token — remove the app at myaccount.google.com/permissions and try again");
  }
  writeProjectEnv(state.slug, "YOUTUBE_REFRESH_TOKEN", tokens.refresh_token);

  // Record which channel was connected so the dashboard can show it.
  try {
    const ch = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    }).then((r) => r.json());
    const item = ch.items?.[0];
    if (item) {
      const config = readConfig(state.slug);
      config.youtube = {
        ...config.youtube,
        channelUrl: item.snippet?.customUrl ? `https://www.youtube.com/${item.snippet.customUrl}` : `https://www.youtube.com/channel/${item.id}`,
        channelTitle: item.snippet?.title ?? "",
        channelId: item.id,
      };
      writeConfig(state.slug, config);
    }
  } catch {
    /* channel info is cosmetic */
  }
  back.searchParams.set("yt", "connected");
  return NextResponse.redirect(back);
}
