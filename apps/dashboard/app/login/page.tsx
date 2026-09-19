"use client";
import { useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (res.ok) {
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = next && next.startsWith("/") ? next : "/";
    } else setError("That password isn't right.");
  }

  return (
    <div className="login-wrap">
      <form className="card login-box" onSubmit={submit}>
        <div className="row" style={{ gap: 9, marginBottom: 14 }}>
          <span className="logo" style={{ width: 28, height: 28, borderRadius: 8, background: "var(--ink)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M6 3.5v17l14-8.5z" /></svg>
          </span>
          <h1 style={{ margin: 0 }}>Content Engine</h1>
        </div>
        <p className="muted" style={{ margin: 0 }}>Sign in to review and approve your channel's videos.</p>
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="current-password" />
        {error && <p className="error-text" style={{ marginTop: 10 }}>{error}</p>}
        <div style={{ marginTop: 16 }}>
          <button type="submit" className="block" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        </div>
      </form>
    </div>
  );
}
