"use client";
import { useState } from "react";

/**
 * Approve / Request changes / Reject. Approve is a deliberate two-step
 * (button → inline confirmation naming the video) — never a browser dialog.
 */
export default function ReviewActions({
  runId, status, title, youtubeConnected, channelSlug,
}: { runId: string; status: string; title: string; youtubeConnected: boolean; channelSlug: string }) {
  const [mode, setMode] = useState<"idle" | "approve" | "changes" | "reject">("idle");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);

  async function post(path: string, body?: unknown) {
    setBusy(true);
    setMsg(null);
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    setBusy(false);
    if (!res.ok) {
      setMsg({ text, err: true });
      return false;
    }
    return true;
  }

  async function approve() {
    if (await post(`/api/runs/${runId}/approve`)) {
      setMsg({ text: "Approved — uploading to YouTube now. You'll be notified when it's live." });
      setTimeout(() => window.location.reload(), 1200);
    }
  }
  async function reject() {
    if (await post(`/api/runs/${runId}/reject`)) {
      setMsg({ text: "Rejected and archived." });
      setTimeout(() => (window.location.href = "/"), 900);
    }
  }
  async function changes() {
    if (await post(`/api/runs/${runId}/edit`, { instruction: instruction.trim() })) {
      setMsg({ text: "Got it — redoing the affected parts. This usually takes a few minutes." });
      setTimeout(() => window.location.reload(), 1200);
    }
  }

  const SUGGESTIONS = ["Shorten the intro", "Make the thumbnail text bigger", "Change the title to a question", "Slow down the ending"];

  return (
    <div className="actions">
      {mode === "idle" && (
        <>
          {youtubeConnected ? (
            <button className="lg block primary" disabled={busy} onClick={() => setMode("approve")}>
              {status === "upload_failed" ? "Retry publishing" : "Approve & publish"}
            </button>
          ) : (
            <a className="btn lg block ghost" href={`/channels/${channelSlug}`}>Connect YouTube to publish</a>
          )}
          <button className="ghost block" disabled={busy} onClick={() => setMode("changes")}>Request changes</button>
          <button className="danger block" disabled={busy} onClick={() => setMode("reject")}>Reject</button>
        </>
      )}

      {mode === "approve" && (
        <div className="confirm">
          <div className="q">Publish “{title}” to your YouTube channel now?</div>
          <div className="muted" style={{ marginBottom: 12 }}>It goes up with the title, description, tags and thumbnail shown here. You can still change details on YouTube afterwards.</div>
          <div className="row">
            <button className="primary" disabled={busy} onClick={approve}>{busy ? "Publishing…" : "Yes, publish it"}</button>
            <button className="ghost" disabled={busy} onClick={() => setMode("idle")}>Not yet</button>
          </div>
        </div>
      )}

      {mode === "changes" && (
        <div className="confirm">
          <div className="q">What should change?</div>
          <textarea
            rows={3}
            autoFocus
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder='Say it like you would to an editor — e.g. "cut the first 10 seconds" or "scene 4 should show a coral reef"'
          />
          <div className="row" style={{ gap: 6, margin: "8px 0 10px" }}>
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="choice" style={{ fontSize: 12 }} onClick={() => setInstruction((v) => (v ? `${v}. ${s}` : s))}>{s}</button>
            ))}
          </div>
          <div className="muted" style={{ marginBottom: 10 }}>Only the affected parts are redone; the current version is saved so you can compare or go back.</div>
          <div className="row">
            <button disabled={busy || instruction.trim().length < 5} onClick={changes}>{busy ? "Sending…" : "Make these changes"}</button>
            <button className="ghost" disabled={busy} onClick={() => setMode("idle")}>Cancel</button>
          </div>
        </div>
      )}

      {mode === "reject" && (
        <div className="confirm">
          <div className="q">Reject “{title}”?</div>
          <div className="muted" style={{ marginBottom: 12 }}>It will be archived and never published. The topic can be used again later.</div>
          <div className="row">
            <button className="danger" disabled={busy} onClick={reject}>{busy ? "Rejecting…" : "Yes, reject"}</button>
            <button className="ghost" disabled={busy} onClick={() => setMode("idle")}>Keep it</button>
          </div>
        </div>
      )}

      {msg && <p className={msg.err ? "error-text" : "note ok"} style={{ margin: 0 }}>{msg.text}</p>}
    </div>
  );
}
