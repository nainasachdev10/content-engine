import { NextRequest, NextResponse } from "next/server";
import { verifySession, sessionCookieName } from "./lib/auth";

const PUBLIC_PATHS = ["/login", "/api/login", "/sw.js", "/manifest.json", "/icon-192.png", "/icon-512.png", "/api/youtube/callback"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p)) || pathname.startsWith("/_next")) {
    return NextResponse.next();
  }
  const secret = process.env.DASHBOARD_SESSION_SECRET;
  if (!secret) return new NextResponse("DASHBOARD_SESSION_SECRET not set in .env", { status: 500 });

  const session = await verifySession(req.cookies.get(sessionCookieName)?.value, secret);
  if (!session) {
    if (pathname.startsWith("/api/")) return new NextResponse("Unauthorized", { status: 401 });
    const login = req.nextUrl.clone();
    login.pathname = "/login";
    login.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!favicon.ico).*)"],
};
