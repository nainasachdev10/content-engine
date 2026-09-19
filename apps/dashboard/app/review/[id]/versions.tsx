"use client";
import { useState } from "react";

interface Version { v: number; instruction: string; summary: string; createdAt: string; hasVideo: boolean }

export default function Versions({ runId, videoDir, versions, canRestore }: { runId: string; videoDir: string; versions: Version[]; canRestore: boolean }) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<number | null>(null);
  const [confirmV, setConfirmV] = useState<number | null>(null);
  const [err, setErr] = useState("");
  if (!versions.length) return null;

  async function restore(v: number) {
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/runs/${runId}/rollback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: v }),
    });
    setBusy(false);
    if (res.ok) window.location.reload();
    else setErr(await res.text());
  }

  return (
    <details className="fold">
      <summary>Previous versions ({versions.length})</summary>
      {versions.slice().reverse().map((v) => (
        <div key={v.v} style={{ borderTop: "1px solid var(--border)", padding: "8px 0", fontSize: 13 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span><span className="tagq mono" style={{ marginRight: 6 }}>v{v.v}</span>{v.summary || "Original"}</span>
          </div>
          <div className="faint">Replaced by “{v.instruction}” · {new Date(v.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
          <div className="row" style={{ marginTop: 6, gap: 6 }}>
            {v.hasVideo && <button className="ghost sm" onClick={() => setPreview(preview === v.v ? null : v.v)}>{preview === v.v ? "Hide" : "Watch"}</button>}
            {canRestore && confirmV !== v.v && <button className="ghost sm" disabled={busy} onClick={() => setConfirmV(v.v)}>Go back to this</button>}
            {confirmV === v.v && (
              <>
                <span className="muted">Restore v{v.v}? The current version is kept too.</span>
                <button className="sm" disabled={busy} onClick={() => restore(v.v)}>Yes</button>
                <button className="ghost sm" onClick={() => setConfirmV(null)}>No</button>
              </>
            )}
          </div>
          {preview === v.v && (
            <video className="player" style={{ marginTop: 8 }} controls playsInline
              src={`/api/artifacts?p=${encodeURIComponent(`${videoDir}/versions/v${v.v}/final_video.mp4`)}`} />
          )}
        </div>
      ))}
      {err && <p className="error-text">{err}</p>}
    </details>
  );
}
