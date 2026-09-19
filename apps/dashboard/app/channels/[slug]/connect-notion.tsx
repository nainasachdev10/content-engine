"use client";
import { useState } from "react";

export default function ConnectNotion({ slug, configured }: { slug: string; configured: boolean }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [pageUrl, setPageUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [runMsg, setRunMsg] = useState("");

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/channels/${slug}/notion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, pageUrl }),
    });
    setBusy(false);
    if (!res.ok) return setErr(await res.text());
    window.location.reload();
  }

  async function job(name: string) {
    setRunMsg("");
    const res = await fetch("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: slug, job: name }) });
    setRunMsg(res.ok ? "Started — results appear in Notion in a few minutes." : await res.text());
  }

  if (configured) {
    return (
      <div className="row" style={{ marginTop: 8, gap: 6 }}>
        <button className="ghost sm" onClick={() => job("ideas-audit")}>Check new ideas now</button>
        <button className="ghost sm" onClick={() => job("teardown")}>Audit creators now</button>
        <button className="ghost sm" onClick={() => job("metrics")}>Update results now</button>
        <button className="ghost sm" onClick={() => setOpen(!open)}>Reconnect</button>
        {runMsg && <span className="muted">{runMsg}</span>}
        {open && form()}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 8 }}>
      {!open && <button className="sm" onClick={() => setOpen(true)}>Connect Notion</button>}
      {open && form()}
    </div>
  );

  function form() {
    return (
      <form onSubmit={connect} className="card soft" style={{ marginTop: 10, width: "100%" }}>
        <ol className="muted" style={{ paddingLeft: 18, margin: 0, lineHeight: 1.7 }}>
          <li>Go to <a className="link" href="https://www.notion.so/my-integrations" target="_blank">notion.so/my-integrations</a> → <b>New integration</b> → copy the <b>Internal Integration Secret</b>.</li>
          <li>In Notion, open (or create) the page where your channel workspace should live → <b>•••</b> → <b>Connections</b> → add the integration.</li>
          <li>Paste both below. The engine builds the hub page and databases for you.</li>
        </ol>
        <label>Integration secret</label>
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ntn_…" required={!configured} autoComplete="off" />
        <label>Notion page link</label>
        <input value={pageUrl} onChange={(e) => setPageUrl(e.target.value)} placeholder="https://www.notion.so/My-Channel-…" required />
        {err && <p className="error-text" style={{ marginTop: 10 }}>{err}</p>}
        <div className="row" style={{ marginTop: 12 }}>
          <button type="submit" disabled={busy}>{busy ? "Building your workspace (≈1 min)…" : "Connect"}</button>
          <button type="button" className="ghost" onClick={() => setOpen(false)}>Cancel</button>
        </div>
      </form>
    );
  }
}
