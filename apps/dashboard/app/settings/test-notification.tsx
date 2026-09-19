"use client";
import { useState } from "react";

export default function TestNotification() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function send() {
    setBusy(true);
    setMsg("");
    const res = await fetch("/api/notify-test", { method: "POST" });
    const text = await res.text();
    setBusy(false);
    setMsg(res.ok ? `Sent. ${text.split("\n").filter(Boolean).slice(-2).join(" · ")}` : `Failed: ${text.slice(-200)}`);
  }
  return (
    <>
      <button className="ghost" disabled={busy} onClick={send}>{busy ? "Sending…" : "Send a test notification"}</button>
      {msg && <span className="muted">{msg}</span>}
    </>
  );
}
