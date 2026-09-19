import { NextRequest, NextResponse } from "next/server";
import { checkCredentials, signSession, sessionCookieName } from "../../../lib/auth";

export async function POST(req: NextRequest) {
  const { password } = await req.json();
  const user = checkCredentials(password ?? "");
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const token = await signSession(user, process.env.DASHBOARD_SESSION_SECRET!);
  const res = new NextResponse("ok");
  res.cookies.set(sessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 86400,
  });
  return res;
}
