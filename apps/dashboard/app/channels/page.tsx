import { getProjects } from "../../lib/engine";
import NewChannel from "./new-channel";

export const dynamic = "force-dynamic";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function ChannelsPage() {
  const projects = getProjects();
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Channels</h1>
          <p className="sub">One channel per YouTube account. Each has its own style, voice, schedule and connections.</p>
        </div>
        <NewChannel />
      </div>

      {projects.length === 0 && <div className="empty"><h3>No channels yet</h3><p>Create your first channel to get started.</p></div>}

      <div className="grid cols-2">
        {projects.map((p) => {
          const setupDone = p.youtubeConnected;
          return (
            <a className="card" key={p.slug} href={`/channels/${p.slug}`} style={{ marginBottom: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span style={{ fontWeight: 650, fontSize: 15, color: "var(--ink)" }}>{p.config.name}</span>
                {setupDone ? (
                  p.config.schedule?.autoRun ? <span className="pill green">On schedule · {p.config.schedule.cadencePerWeek}/wk</span> : <span className="pill">Manual</span>
                ) : (
                  <span className="pill amber">Finish setup</span>
                )}
              </div>
              <p className="muted" style={{ margin: 0, minHeight: 36, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.config.niche}</p>
              <div className="row" style={{ gap: 24 }}>
                <div className="stat"><span className="k">Waiting</span><span className="v">{p.counts.queue}</span></div>
                <div className="stat"><span className="k">Published</span><span className="v">{p.counts.published}</span></div>
                <div className="stat"><span className="k">Length</span><span className="v">{p.config.video?.lengthMinutes} min</span></div>
                <div className="stat"><span className="k">Last activity</span><span className="v">{p.lastRun ? fmt(p.lastRun.created_at) : "—"}</span></div>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
