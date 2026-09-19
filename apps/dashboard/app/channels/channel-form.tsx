"use client";
import { useState } from "react";

/** Describe the channel in plain words; the engine writes all the production prompts. */
export default function ChannelForm({ onDone }: { onDone: (slug: string) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [audience, setAudience] = useState("");
  const [kids, setKids] = useState(false);
  const [tone, setTone] = useState("");
  const [presenter, setPresenter] = useState(false);
  const [presenterDesc, setPresenterDesc] = useState("");
  const [lengthMinutes, setLength] = useState(5);
  const [perWeek, setPerWeek] = useState(3);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const res = await fetch("/api/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description, audience, kids, tone, lengthMinutes, perWeek, presenter, presenterDesc }),
    });
    if (!res.ok) {
      setBusy(false);
      return setErr(await res.text());
    }
    const j = await res.json();
    onDone(j.slug);
  }

  return (
    <form onSubmit={submit}>
      <label>Channel name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ocean Curiosities" required autoFocus />

      <label>What is the channel about?</label>
      <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} required
        placeholder="Deep-sea discoveries and strange ocean science, explained for curious adults who like documentaries." />
      <p className="help">Write it the way you'd tell a friend. The engine turns this into the research, writing and visual style rules.</p>

      <label>Who watches it?</label>
      <input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="Adults 25–45 who watch science and nature videos" />

      <label className="row" style={{ gap: 8, marginTop: 12 }}>
        <input type="checkbox" checked={kids} onChange={(e) => setKids(e.target.checked)} />
        This is a channel for children (made for kids on YouTube)
      </label>

      <label>Video style</label>
      <div className="choices">
        <button type="button" className={`choice ${!presenter ? "on" : ""}`} onClick={() => setPresenter(false)}>Narrated visuals</button>
        <button type="button" className={`choice ${presenter ? "on" : ""}`} onClick={() => setPresenter(true)}>Talking-head host + visuals</button>
      </div>
      {presenter && (
        <>
          <label>Describe the host</label>
          <input value={presenterDesc} onChange={(e) => setPresenterDesc(e.target.value)} placeholder="a warm woman in her 40s with short grey hair, marine-biologist vibe, bright lab" />
          <p className="help">A consistent AI host is generated once from this and appears on camera for the hook, transitions and ending (about a third of each video). You can replace it with a real photo later.</p>
        </>
      )}

      <label>Tone</label>
      <div className="choices">
        {["Calm & documentary", "Energetic & fun", "Warm & friendly", "Mysterious & dramatic"].map((t) => (
          <button type="button" key={t} className={`choice ${tone === t ? "on" : ""}`} onClick={() => setTone(tone === t ? "" : t)}>{t}</button>
        ))}
      </div>

      <div className="row" style={{ gap: 16 }}>
        <div style={{ flex: 1 }}>
          <label>Video length</label>
          <select value={lengthMinutes} onChange={(e) => setLength(Number(e.target.value))}>
            {[1, 2, 3, 5, 8, 10, 15].map((m) => <option key={m} value={m}>{m} minute{m > 1 ? "s" : ""}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label>Videos per week</label>
          <select value={perWeek} onChange={(e) => setPerWeek(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 7].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>

      {err && <p className="error-text" style={{ marginTop: 12 }}>{err}</p>}
      <div className="row" style={{ marginTop: 18, justifyContent: "flex-end" }}>
        <button type="submit" className="lg" disabled={busy || description.length < 15}>{busy ? "Setting up your channel (≈30s)…" : "Create channel"}</button>
      </div>
    </form>
  );
}
