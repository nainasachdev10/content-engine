"use client";
import { useState } from "react";

export default function RetryButton({ runId, busy }: { runId: string; busy: boolean }) {
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState("");
  async function retry() {
    setWorking(true);
    setErr("");
    const res = await fetch(`/api/runs/${runId}/retry`, { method: "POST" });
    if (!res.ok) {
      setWorking(false);
      return setErr(await res.text());
    }
    const j = await res.json();
    window.location.href = j.runId ? `/activity/${j.runId}` : "/activity";
  }
  return (
    <span className="row">
      <button disabled={working || busy} onClick={retry} title={busy ? "Wait for the current video to finish" : ""}>{working ? "Starting…" : "Try again"}</button>
      {err && <span className="error-text">{err}</span>}
    </span>
  );
}
