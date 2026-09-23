"use client";
import { useState } from "react";

type Row = { set: boolean; source: string };
type Status = { anthropic: Row; elevenlabs: Row; replicate: Row; resend: Row; emailTo: string; segmind: Row; higgsfield: Row; telegram: Row };

const SERVICES: { key: string; service: string; label: string; help: string; link: string; required?: boolean }[] = [
  { key: "ANTHROPIC_API_KEY", service: "anthropic", label: "Anthropic", help: "Research, scripts, quality checks, edits.", link: "https://console.anthropic.com/settings/keys", required: true },
  { key: "ELEVENLABS_API_KEY", service: "elevenlabs", label: "ElevenLabs", help: "Narration. Creator plan or higher for regular videos.", link: "https://elevenlabs.io/app/settings/api-keys", required: true },
  { key: "IMAGE_API_KEY", service: "replicate", label: "Replicate", help: "Images, animated clips, presenter, music. Add credit to the account.", link: "https://replicate.com/account/api-tokens", required: true },
  { key: "RESEND_API_KEY", service: "resend", label: "Resend (email notifications)", help: "Optional. Free tier is enough.", link: "https://resend.com/api-keys" },
  { key: "TELEGRAM_BOT_TOKEN", service: "telegram", label: "Telegram bot (notifications on your phone)", help: "Optional, recommended. In Telegram open @BotFather → /newbot → copy the token. Then connect your chat under Settings → Notifications.", link: "https://t.me/BotFather" },
  { key: "SEGMIND_API_KEY", service: "", label: "Segmind (Higgsfield lip-sync)", help: "Optional — only if a channel uses the Higgsfield presenter engine.", link: "https://cloud.segmind.com/console/api-keys" },
];

export default function ConnectionsForm({ status }: { status: Status }) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [emailTo, setEmailTo] = useState(status.emailTo);
  const [hfId, setHfId] = useState("");
  const [hfSecret, setHfSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [tests, setTests] = useState<Record<string, string>>({});

  const rowFor = (service: string): Row | undefined => (status as any)[service];

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    const body: Record<string, string> = { ...vals, NOTIFY_EMAIL_TO: emailTo };
    if (hfId) body.HIGGSFIELD_API_KEY_ID = hfId;
    if (hfSecret) body.HIGGSFIELD_API_KEY_SECRET = hfSecret;
    const res = await fetch("/api/connections", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) return setMsg(`Couldn't save: ${await res.text()}`);
    setMsg("Saved.");
    setTimeout(() => window.location.reload(), 700);
  }

  async function test(service: string) {
    setTests((t) => ({ ...t, [service]: "Checking…" }));
    const res = await fetch("/api/connections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ service }) });
    setTests((t) => ({ ...t, [service]: res.ok ? "✓ Works" : `✕ ${""}` }));
    if (!res.ok) setTests((t) => ({ ...t, [service]: `✕ ${""}` }));
    const text = await res.text();
    setTests((t) => ({ ...t, [service]: res.ok ? "✓ Works" : `✕ ${text}` }));
  }

  return (
    <form onSubmit={save}>
      <div className="card">
        {SERVICES.map((s) => {
          const row = s.service ? rowFor(s.service) : rowFor("segmind");
          return (
            <div key={s.key} className="checkrow" style={{ alignItems: "flex-start" }}>
              <span className={`ic ${row?.set ? "ok" : s.required ? "warn" : ""}`}>{row?.set ? "✓" : "·"}</span>
              <div style={{ flex: 1 }}>
                <div className="k">{s.label}{s.required && <span className="faint" style={{ fontWeight: 400 }}> · required</span>}</div>
                <div className="d">{s.help} <a className="link" href={s.link} target="_blank">Get a key ↗</a></div>
                <div className="row" style={{ marginTop: 6, flexWrap: "nowrap" }}>
                  <input type="password" autoComplete="off" value={vals[s.key] ?? ""} onChange={(e) => setVals({ ...vals, [s.key]: e.target.value })}
                    placeholder={row?.set ? `Set (${row.source === "dashboard" ? "entered here" : "by administrator"}) — paste to replace` : "Paste key"} />
                  {row?.set && s.service && <button type="button" className="ghost sm" onClick={() => test(s.service)}>Test</button>}
                </div>
                {tests[s.service] && <div className={tests[s.service].startsWith("✓") ? "muted" : "error-text"} style={{ marginTop: 6 }}>{tests[s.service]}</div>}
              </div>
            </div>
          );
        })}
        <div className="checkrow" style={{ alignItems: "flex-start" }}>
          <span className={`ic ${status.emailTo ? "ok" : ""}`}>✉</span>
          <div style={{ flex: 1 }}>
            <div className="k">Notification email address</div>
            <div className="d">Where "ready to review" emails go (needs the Resend key above). Comma-separate several.</div>
            <input style={{ marginTop: 6 }} value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="you@example.com" />
          </div>
        </div>
        <details className="fold">
          <summary>Higgsfield (optional cinematic clip engine)</summary>
          <p className="help">Only if a channel selects Higgsfield DoP as its clip engine. Keys from cloud.higgsfield.ai. {status.higgsfield.set && "Currently set."}</p>
          <label>API key</label>
          <input type="password" autoComplete="off" value={hfSecret} onChange={(e) => setHfSecret(e.target.value)} placeholder="Paste the key exactly as Higgsfield shows it (a single value, or id:secret)" />
          <label>Key ID <span className="faint" style={{ fontWeight: 400 }}>— only if Higgsfield gave you a separate ID</span></label>
          <input type="password" autoComplete="off" value={hfId} onChange={(e) => setHfId(e.target.value)} />
        </details>
      </div>
      <div className="row" style={{ margin: "4px 0 24px" }}>
        <button type="submit" className="lg" disabled={busy}>{busy ? "Saving…" : "Save connections"}</button>
        {msg && <span className={msg === "Saved." ? "note ok" : "error-text"} style={{ padding: "6px 12px" }}>{msg}</span>}
      </div>
    </form>
  );
}
