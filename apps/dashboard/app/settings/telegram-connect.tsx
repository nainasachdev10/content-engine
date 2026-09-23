"use client";
import { useEffect, useState } from "react";

/** Client-side flow: open the bot, press Start, come back and click "Check". */
export default function TelegramConnect({ chats }: { chats: { chat_id: string; name: string | null }[] }) {
  const [bot, setBot] = useState<{ configured: boolean; ok?: boolean; username?: string | null; error?: string | null } | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/telegram").then((r) => r.json()).then(setBot).catch(() => setBot({ configured: false }));
  }, []);

  async function check() {
    setBusy(true);
    setMsg("");
    const res = await fetch("/api/telegram", { method: "POST" });
    setBusy(false);
    if (!res.ok) return setMsg(await res.text());
    const j = await res.json();
    setMsg(j.added ? `Connected ${j.added} new chat${j.added > 1 ? "s" : ""}.` : j.total ? "No new chats — already connected." : "No message received yet. Open the bot, press Start, then click Check again.");
    if (j.added) setTimeout(() => window.location.reload(), 900);
  }

  async function remove(chat_id: string) {
    await fetch("/api/telegram", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id }) });
    window.location.reload();
  }

  if (!bot) return null;
  if (!bot.configured) return <a className="btn sm ghost" href="/settings/connections">Add bot token</a>;
  if (!bot.ok) return <span className="error-text">Bot token rejected: {bot.error}</span>;

  return (
    <div>
      {chats.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {chats.map((c) => (
            <span key={c.chat_id} className="pill green" style={{ marginRight: 6, marginBottom: 4 }}>
              {c.name || c.chat_id} <button type="button" className="ghost sm" style={{ padding: "0 5px", marginLeft: 4, border: "none", background: "transparent", color: "inherit" }} onClick={() => remove(c.chat_id)} title="Disconnect">×</button>
            </span>
          ))}
        </div>
      )}
      <div className="row" style={{ gap: 8 }}>
        <a className="btn sm" href={`https://t.me/${bot.username}`} target="_blank">1. Open @{bot.username} and press Start</a>
        <button className="ghost sm" disabled={busy} onClick={check}>{busy ? "Checking…" : "2. Check connection"}</button>
      </div>
      {msg && <div className="muted" style={{ marginTop: 6 }}>{msg}</div>}
    </div>
  );
}
