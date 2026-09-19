"use client";
import { useEffect, useState } from "react";

interface Topic { topic: string; angle: string; why_now: string }

/**
 * Topic picker → starts a run. Three ways in:
 *   1. "Surprise me" — the engine researches and picks the best topic itself.
 *   2. Pick one of the suggested topics (fresh research on demand).
 *   3. Type your own topic.
 */
export default function MakeVideo({
  slug,
  channels,
  onChannel,
  onClose,
}: {
  slug: string;
  channels: { slug: string; name: string; busy: boolean }[];
  onChannel?: (s: string) => void;
  onClose: () => void;
}) {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const channel = channels.find((c) => c.slug === slug);

  useEffect(() => {
    setTopics([]);
    fetch(`/api/research?project=${slug}`).then(async (r) => {
      if (!r.ok) return;
      const j = await r.json();
      setTopics(j.topics ?? []);
      setGeneratedAt(j.generatedAt);
    });
  }, [slug]);

  async function refresh() {
    setLoading(true);
    setErr("");
    const r = await fetch("/api/research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: slug }) });
    setLoading(false);
    if (!r.ok) return setErr(await r.text());
    const j = await r.json();
    setTopics(j.topics ?? []);
    setGeneratedAt(j.generatedAt);
  }

  async function start(topic?: string, angle?: string) {
    setBusy(true);
    setErr("");
    const r = await fetch("/api/runs/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project: slug, topic, angle }),
    });
    if (!r.ok) {
      setBusy(false);
      return setErr(await r.text());
    }
    const j = await r.json();
    window.location.href = j.runId ? `/activity/${j.runId}` : "/activity";
  }

  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div className="card modal">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
          <h3 style={{ margin: 0 }}>Make a video</h3>
          <button className="ghost sm" onClick={onClose}>Close</button>
        </div>
        <p className="muted" style={{ margin: "0 0 10px" }}>
          Takes about {channel ? "10–25 minutes" : "a while"}. It lands in your review queue — nothing is published until you approve it.
        </p>

        {channels.length > 1 && (
          <>
            <label>Channel</label>
            <select value={slug} onChange={(e) => onChannel?.(e.target.value)}>
              {channels.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </select>
          </>
        )}
        {channel?.busy && <p className="note" style={{ marginTop: 12 }}>A video is already being made for this channel. You can queue another once it finishes.</p>}

        <div className="card soft" style={{ marginTop: 14 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <div style={{ fontWeight: 600, color: "var(--ink)" }}>Let the engine choose</div>
              <div className="muted">Researches what's working in your niche right now and picks the strongest topic.</div>
            </div>
            <button disabled={busy || channel?.busy} onClick={() => start()}>{busy ? "Starting…" : "Surprise me"}</button>
          </div>
        </div>

        <div className="row" style={{ justifyContent: "space-between", marginTop: 16 }}>
          <label style={{ margin: 0 }}>Suggested topics {generatedAt && <span className="faint" style={{ fontWeight: 400 }}>· {new Date(generatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>}</label>
          <button className="ghost sm" disabled={loading} onClick={refresh}>{loading ? "Researching (≈1 min)…" : topics.length ? "Get fresh ideas" : "Find topics"}</button>
        </div>
        {topics.length === 0 && !loading && <p className="muted" style={{ margin: "8px 0 0" }}>No suggestions yet — click “Find topics”.</p>}
        {topics.map((t, i) => (
          <div key={i} className="row" style={{ padding: "10px 0", borderBottom: "1px solid var(--border)", alignItems: "flex-start", flexWrap: "nowrap" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: "var(--ink)", fontSize: 13.5 }}>{t.topic}</div>
              <div className="muted">{t.angle}</div>
            </div>
            <button className="ghost sm" disabled={busy || channel?.busy} onClick={() => start(t.topic, t.angle)}>Make this</button>
          </div>
        ))}

        <label>Or type your own topic</label>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="e.g. Why octopuses have three hearts" />
          <button disabled={busy || channel?.busy || custom.trim().length < 5} onClick={() => start(custom.trim())}>Make it</button>
        </div>
        {err && <p className="error-text" style={{ marginTop: 12 }}>{err}</p>}
      </div>
    </>
  );
}
