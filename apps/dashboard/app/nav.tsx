"use client";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const svg = (d: React.ReactNode, size = 16) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
);
const ic = {
  inbox: svg(<><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>),
  channels: svg(<><rect x="2" y="4" width="20" height="14" rx="3" /><path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none" /></>),
  activity: svg(<path d="M22 12h-4l-3 8L9 4l-3 8H2" />),
  settings: svg(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>),
  logout: svg(<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></>),
  bell: svg(<><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>),
  help: svg(<><circle cx="12" cy="12" r="10" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></>),
};

const LINKS = [
  { href: "/", label: "Review", icon: ic.inbox, match: (p: string) => p === "/" || p.startsWith("/review") },
  { href: "/channels", label: "Channels", icon: ic.channels, match: (p: string) => p.startsWith("/channels") },
  { href: "/activity", label: "Activity", icon: ic.activity, match: (p: string) => p.startsWith("/activity") },
  { href: "/settings", label: "Settings", icon: ic.settings, match: (p: string) => p.startsWith("/settings") },
];

interface Counts { queue: number; active: number }

export default function Nav() {
  const path = usePathname();
  const [counts, setCounts] = useState<Counts>({ queue: 0, active: 0 });
  const [notes, setNotes] = useState<{ id: number; title: string; body: string; path: string; created_at: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<number>(0);

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const res = await fetch("/api/overview");
        if (!res.ok || !alive) return;
        const j = await res.json();
        setCounts(j.counts);
        setNotes(j.notifications);
      } catch {}
    }
    poll();
    const t = setInterval(poll, 8_000);
    try {
      setSeen(Number(localStorage.getItem("seenNotification") ?? 0));
    } catch {}
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [path]);

  if (path === "/login" || path.startsWith("/setup")) return null;

  const unseen = notes.filter((n) => n.id > seen).length;
  const markSeen = () => {
    const top = notes[0]?.id ?? 0;
    setSeen(top);
    try {
      localStorage.setItem("seenNotification", String(top));
    } catch {}
  };

  const bell = (
    <div style={{ position: "relative" }}>
      <button
        className="ghost sm bell"
        aria-label="Notifications"
        onClick={() => {
          setOpen(!open);
          if (!open) markSeen();
        }}
      >
        {ic.bell}
        {unseen > 0 && <span className="n">{unseen}</span>}
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 45 }} />
          <div className="dropdown">
            {notes.length === 0 && <div className="muted" style={{ padding: 12 }}>No notifications yet.</div>}
            {notes.map((n) => (
              <a key={n.id} className="item" href={n.path} onClick={() => setOpen(false)}>
                <div className="t">{n.title}</div>
                <div className="b">{n.body}</div>
                <div className="meta">{new Date(n.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
              </a>
            ))}
            <a className="item" href="/settings#notifications" style={{ textAlign: "center", fontSize: 12.5, color: "var(--accent)" }}>Notification settings</a>
          </div>
        </>
      )}
    </div>
  );

  return (
    <>
      <aside className="sidebar">
        <div className="brand">
          <span className="logo">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M6 3.5v17l14-8.5z" /></svg>
          </span>
          Content Engine
          <span style={{ marginLeft: "auto" }}>{bell}</span>
        </div>
        {LINKS.map((l) => (
          <a key={l.href} className={`nav ${l.match(path) ? "active" : ""}`} href={l.href}>
            {l.icon}
            {l.label}
            {l.href === "/" && counts.queue > 0 && <span className="badge hot">{counts.queue}</span>}
            {l.href === "/activity" && counts.active > 0 && <span className="badge">{counts.active}</span>}
          </a>
        ))}
        <div className="spacer" />
        <a className="nav" href="/help">{ic.help} How it works</a>
        <a className="nav" href="/api/logout">{ic.logout} Log out</a>
      </aside>

      <div className="topbar">
        <span>Content Engine</span>
        {bell}
      </div>
      <nav className="tabbar">
        {LINKS.map((l) => (
          <a key={l.href} className={l.match(path) ? "active" : ""} href={l.href}>
            {l.icon}
            {l.label}
            {l.href === "/" && counts.queue > 0 && <span className="badge hot">{counts.queue}</span>}
          </a>
        ))}
      </nav>
    </>
  );
}
