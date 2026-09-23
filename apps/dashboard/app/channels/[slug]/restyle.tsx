"use client";
import { useState } from "react";

/** "The look isn't right" → describe what you want; the engine rewrites the style guide. */
export default function Restyle({ slug, current }: { slug: string; current: string }) {
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function go() {
    setBusy(true);
    setMsg("");
    const res = await fetch(`/api/channels/${slug}/restyle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ direction }) });
    setBusy(false);
    if (!res.ok) return setMsg(await res.text());
    setMsg("Style guide rewritten — it applies to the next video (or use “Request changes” on a video to redo its visuals).");
    setTimeout(() => window.location.reload(), 1600);
  }

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h3>Visual style</h3>
          <p className="muted" style={{ margin: 0, display: "-webkit-box", WebkitLineClamp: open ? 99 : 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{current}</p>
        </div>
        {!open && <button className="ghost sm" onClick={() => setOpen(true)}>Change the look</button>}
      </div>
      {open && (
        <div style={{ marginTop: 12 }}>
          <label>Describe the look you want</label>
          <textarea rows={3} value={direction} onChange={(e) => setDirection(e.target.value)} autoFocus
            placeholder='e.g. "Classical Indian miniature painting meets Raja Ravi Varma oil portraits — natural skin tones, traditional iconography, muted earth pigments and gold. No glossy CGI, no glowing eyes."' />
          <div className="choices" style={{ margin: "8px 0" }}>
            {[
              "Photorealistic documentary — natural light, real textures, muted grade",
              "Painterly — visible brushwork, classical composition, restrained palette",
              "Hand-drawn animation look — clean lines, flat colour, warm",
              "Vintage illustration — mid-century book plates, textured paper",
            ].map((s) => (
              <button type="button" key={s} className="choice" style={{ fontSize: 12 }} onClick={() => setDirection(s)}>{s}</button>
            ))}
          </div>
          <p className="help">Be specific: name a tradition, medium, palette and what to avoid. The engine rewrites the full style guide (and the writing and thumbnail rules to match).</p>
          <div className="row" style={{ marginTop: 8 }}>
            <button disabled={busy || direction.trim().length < 10} onClick={go}>{busy ? "Rewriting (≈30s)…" : "Rewrite style guide"}</button>
            <button className="ghost" onClick={() => setOpen(false)}>Cancel</button>
          </div>
          {msg && <p className={msg.startsWith("Style") ? "note ok" : "error-text"} style={{ marginTop: 10 }}>{msg}</p>}
        </div>
      )}
    </div>
  );
}
