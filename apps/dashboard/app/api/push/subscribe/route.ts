import { NextRequest, NextResponse } from "next/server";
import { db } from "../../../../lib/engine";

/** Register (or remove) this browser as a push-notification device. */
export async function POST(req: NextRequest) {
  const sub = await req.json();
  if (!sub?.endpoint) return new NextResponse("Bad subscription", { status: 400 });
  db()
    .prepare("INSERT OR REPLACE INTO push_subscriptions (endpoint, subscription_json, created_at) VALUES (?, ?, ?)")
    .run(sub.endpoint, JSON.stringify(sub), new Date().toISOString());
  return new NextResponse("ok");
}

export async function DELETE(req: NextRequest) {
  const { endpoint } = await req.json();
  if (endpoint) db().prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
  return new NextResponse("ok");
}
