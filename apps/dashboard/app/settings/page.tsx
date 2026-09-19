import { notificationSetup, getProjects } from "../../lib/engine";
import PushToggle from "./push-toggle";
import TestNotification from "./test-notification";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const n = notificationSetup();
  const projects = getProjects();
  return (
    <div style={{ maxWidth: 720 }}>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="sub">Notifications and account. Channel-specific settings live on each channel's page.</p>
        </div>
      </div>

      <div className="card" id="notifications">
        <h3>Notifications</h3>
        <p className="muted" style={{ marginTop: 0 }}>You'll be told when a video is ready to review, when it's been published, and if anything goes wrong.</p>

        <div className="checkrow">
          <span className={`ic ${n.push ? (n.pushDevices ? "ok" : "") : "warn"}`}>{n.pushDevices ? "✓" : "📱"}</span>
          <div style={{ flex: 1 }}>
            <div className="k">Push notifications on this device</div>
            <div className="d">
              {n.push
                ? `${n.pushDevices} device${n.pushDevices === 1 ? "" : "s"} subscribed. Works on desktop and Android; on iPhone add this page to your Home Screen first (Share → Add to Home Screen).`
                : "Not available yet — the engine needs push keys (run `npm run engine -- push-keys` and add them to .env)."}
            </div>
          </div>
          <div className="act">{n.push && <PushToggle publicKey={n.vapidPublicKey} />}</div>
        </div>

        <div className="checkrow">
          <span className={`ic ${n.email ? "ok" : "warn"}`}>{n.email ? "✓" : "✉"}</span>
          <div style={{ flex: 1 }}>
            <div className="k">Email</div>
            <div className="d">
              {n.email
                ? `Sending to ${n.emailTo}.`
                : "Not set up — add RESEND_API_KEY and NOTIFY_EMAIL_TO to the engine's .env to receive emails with the thumbnail and a review link."}
            </div>
          </div>
        </div>

        <div className="row" style={{ marginTop: 14 }}>
          <TestNotification />
        </div>
      </div>

      <div className="card">
        <h3>Channels</h3>
        {projects.map((p) => (
          <div key={p.slug} className="row" style={{ justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
            <span style={{ fontWeight: 550, color: "var(--ink)" }}>{p.config.name}</span>
            <span className="row" style={{ gap: 8 }}>
              <span className={`pill ${p.youtubeConnected ? "green" : "amber"}`}>{p.youtubeConnected ? "YouTube ✓" : "YouTube not connected"}</span>
              <span className={`pill ${p.notion.configured ? "green" : ""}`}>{p.notion.configured ? "Notion ✓" : "No Notion"}</span>
              <a className="link" href={`/channels/${p.slug}`}>Open</a>
            </span>
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Account</h3>
        <p className="muted" style={{ margin: 0 }}>Signed in with the dashboard password. <a className="link" href="/api/logout">Log out</a></p>
      </div>
    </div>
  );
}
