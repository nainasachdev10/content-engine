import { getProject, getRuns, latestResearch, notificationSetup } from "../../../lib/engine";
import ChannelActions from "./channel-actions";
import ConnectNotion from "./connect-notion";
import SettingsForm from "./settings-form";

export const dynamic = "force-dynamic";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function ChannelPage({
  params, searchParams,
}: { params: Promise<{ slug: string }>; searchParams: Promise<{ yt?: string; msg?: string; new?: string; tab?: string }> }) {
  const { slug } = await params;
  const q = await searchParams;
  const p = getProject(slug);
  if (!p) return <div className="empty"><h3>Channel not found</h3></div>;
  const runs = getRuns(slug, 8);
  const notif = notificationSetup();
  const c = p.config;

  return (
    <div>
      <p style={{ margin: "0 0 10px" }}><a className="link" href="/channels">← Channels</a></p>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <h1>{c.name}</h1>
          <p className="sub">{c.niche}</p>
        </div>
        <ChannelActions slug={slug} name={c.name} busy={p.counts.inProgress > 0} />
      </div>

      {q.new && <div className="note ok" style={{ marginBottom: 14 }}>Channel created. The engine wrote a full style guide from your description — finish the two connections below and make your first video.</div>}
      {q.yt === "connected" && <div className="note ok" style={{ marginBottom: 14 }}>YouTube connected{c.youtube?.channelTitle ? ` — ${c.youtube.channelTitle}` : ""}. You can now publish approved videos.</div>}
      {q.yt === "error" && <div className="error-text" style={{ marginBottom: 14 }}>YouTube connection failed: {q.msg}</div>}

      <div className="card">
        <h3>Setup</h3>
        <div className="checkrow">
          <span className={`ic ${p.youtubeConnected ? "ok" : "warn"}`}>{p.youtubeConnected ? "✓" : "1"}</span>
          <div>
            <div className="k">YouTube</div>
            <div className="d">{p.youtubeConnected ? `Connected${c.youtube?.channelTitle ? ` to ${c.youtube.channelTitle}` : ""} — approved videos publish as ${c.youtube?.defaultPrivacy ?? "unlisted"}.` : "Connect the Google account that owns this channel so approved videos can be published."}</div>
          </div>
          <div className="act">
            <a className={`btn sm ${p.youtubeConnected ? "ghost" : ""}`} href={`/api/youtube/connect?project=${slug}&back=/channels/${slug}`}>{p.youtubeConnected ? "Reconnect" : "Connect YouTube"}</a>
          </div>
        </div>
        <div className="checkrow">
          <span className={`ic ${p.notion.configured ? "ok" : ""}`}>{p.notion.configured ? "✓" : "2"}</span>
          <div style={{ flex: 1 }}>
            <div className="k">Notion workspace <span className="faint" style={{ fontWeight: 400 }}>(optional)</span></div>
            <div className="d">
              {p.notion.configured
                ? <>Ideas, the video pipeline, creator research and results are kept up to date in Notion. <a className="link" href={p.notion.hubUrl ?? "#"} target="_blank">Open hub ↗</a></>
                : "Track ideas, every video's progress, competitor research and results in your own Notion workspace. Add ideas there and the engine will make them."}
            </div>
            <ConnectNotion slug={slug} configured={p.notion.configured} />
          </div>
        </div>
        <div className="checkrow">
          <span className={`ic ${notif.email || notif.pushDevices > 0 ? "ok" : ""}`}>{notif.email || notif.pushDevices > 0 ? "✓" : "3"}</span>
          <div>
            <div className="k">Notifications</div>
            <div className="d">{notif.email || notif.pushDevices > 0 ? `You'll be notified when a video is ready${notif.email ? ` (email to ${notif.emailTo}${notif.pushDevices ? " + push" : ""})` : " (push)"}.` : "Get an email or push notification whenever a video needs your approval."}</div>
          </div>
          <div className="act"><a className="btn sm ghost" href="/settings#notifications">Set up</a></div>
        </div>
      </div>

      <div className="grid cols-2" style={{ marginBottom: 12 }}>
        <div className="card" style={{ marginBottom: 0 }}>
          <h3>Schedule</h3>
          {c.schedule?.autoRun ? (
            <p className="muted" style={{ margin: 0 }}>
              Making <b>{c.schedule.cadencePerWeek} video{c.schedule.cadencePerWeek > 1 ? "s" : ""} a week</b> automatically. Each one waits for your approval.
              {p.nextRunDue && <><br />Next one starts around {fmt(p.nextRunDue)}.</>}
            </p>
          ) : (
            <p className="muted" style={{ margin: 0 }}>Manual — videos are only made when you press “Make a video”. Turn on the schedule in settings below to have them arrive on their own.</p>
          )}
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <h3>At a glance</h3>
          <div className="row" style={{ gap: 28 }}>
            <div className="stat"><span className="bignum">{p.counts.queue}</span><span className="k">waiting for you</span></div>
            <div className="stat"><span className="bignum">{p.counts.inProgress}</span><span className="k">in progress</span></div>
            <div className="stat"><span className="bignum">{p.counts.published}</span><span className="k">published</span></div>
          </div>
        </div>
      </div>

      {runs.length > 0 && (
        <div className="card">
          <h3>Recent videos</h3>
          {runs.map((r) => (
            <a key={r.id} href={["pending_approval", "uploaded", "upload_failed"].includes(r.status) ? `/review/${r.id}` : `/activity/${r.id}`}
              className="row" style={{ padding: "8px 0", borderBottom: "1px solid var(--border)", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 550, color: "var(--ink)", minWidth: 0 }}>{r.topic ?? "Choosing a topic…"}</span>
              <span className="row" style={{ gap: 10 }}>
                <span className={`status ${r.status}`}><i className="d" />{r.status.replace(/_/g, " ")}</span>
                <span className="meta">{fmt(r.created_at)}</span>
              </span>
            </a>
          ))}
        </div>
      )}

      <h2 id="settings">Settings</h2>
      <SettingsForm slug={slug} initial={c} />
    </div>
  );
}
