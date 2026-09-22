import { NextRequest, NextResponse } from "next/server";
import { CONNECTION_KEYS, connectionStatus, writeConnections, keyValue } from "../../../lib/engine";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(connectionStatus());
}

/** Save keys typed in the dashboard. Values are never echoed back. */
export async function PUT(req: NextRequest) {
  const body = await req.json();
  const patch: Record<string, string> = {};
  for (const k of CONNECTION_KEYS) {
    if (typeof body[k] === "string") patch[k] = body[k];
  }
  writeConnections(patch);
  return NextResponse.json(connectionStatus());
}

/** Verify a key actually works before the client relies on it. */
export async function POST(req: NextRequest) {
  const { service } = await req.json();
  try {
    if (service === "anthropic") {
      const r = await fetch("https://api.anthropic.com/v1/models", { headers: { "x-api-key": keyValue("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01" } });
      return new NextResponse(r.ok ? "ok" : `Anthropic rejected the key (${r.status})`, { status: r.ok ? 200 : 400 });
    }
    if (service === "elevenlabs") {
      const r = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": keyValue("ELEVENLABS_API_KEY") } });
      return new NextResponse(r.ok ? "ok" : `ElevenLabs rejected the key (${r.status})`, { status: r.ok ? 200 : 400 });
    }
    if (service === "replicate") {
      const r = await fetch("https://api.replicate.com/v1/account", { headers: { Authorization: `Bearer ${keyValue("IMAGE_API_KEY")}` } });
      return new NextResponse(r.ok ? "ok" : `Replicate rejected the key (${r.status})`, { status: r.ok ? 200 : 400 });
    }
    if (service === "resend") {
      const r = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${keyValue("RESEND_API_KEY")}` } });
      return new NextResponse(r.ok ? "ok" : `Resend rejected the key (${r.status})`, { status: r.ok ? 200 : 400 });
    }
    return new NextResponse("Unknown service", { status: 400 });
  } catch (err) {
    return new NextResponse(`Could not reach the service: ${String(err).slice(0, 120)}`, { status: 502 });
  }
}
