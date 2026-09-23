import { NextRequest, NextResponse } from "next/server";
import { execEngine, db, keyValue } from "../../../lib/engine";

export const dynamic = "force-dynamic";

/** Register chats that have messaged the bot, and report the bot's @name. */
export async function POST() {
  if (!keyValue("TELEGRAM_BOT_TOKEN")) return new NextResponse("Add the Telegram bot token under Connections first", { status: 400 });
  const res = await execEngine(["telegram-connect"], 60_000);
  if (!res.ok) return new NextResponse(res.out.slice(-300), { status: 500 });
  const line = res.out.trim().split("\n").pop() ?? "{}";
  return new NextResponse(line, { headers: { "Content-Type": "application/json" } });
}

export async function DELETE(req: NextRequest) {
  const { chat_id } = await req.json();
  if (chat_id) db().prepare("DELETE FROM telegram_chats WHERE chat_id = ?").run(String(chat_id));
  return new NextResponse("ok");
}

export async function GET() {
  const token = keyValue("TELEGRAM_BOT_TOKEN");
  if (!token) return NextResponse.json({ configured: false });
  try {
    const me = (await (await fetch(`https://api.telegram.org/bot${token}/getMe`)).json()) as any;
    return NextResponse.json({ configured: true, ok: !!me.ok, username: me.result?.username ?? null, error: me.ok ? null : me.description });
  } catch (err) {
    return NextResponse.json({ configured: true, ok: false, error: String(err).slice(0, 120) });
  }
}
