import { NextResponse } from "next/server";
import { sessionCookieName } from "../../../lib/auth";

export async function GET() {
  const res = NextResponse.redirect(new URL("/login", "http://localhost:3777"));
  res.cookies.set(sessionCookieName, "", { path: "/", maxAge: 0 });
  return res;
}
