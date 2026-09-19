import { getRuns, getProjects, runProgress, STAGE_LABELS, RUN_STATUS_LABELS } from "../../lib/engine";
import LiveRefresh from "../live-refresh";

export const dynamic = "force-dynamic";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Every video the engine has worked on, newest first, in plain language. */
export default function ActivityPage({ searchParams }: { searchParams?: Promise<{ channel?: string }> }) {
  const projects = getProjects();
  const names = Object.fromEntries(projects.map((p) => [p.slug, p.config.name]));
  const runs = getRuns(undefined, 100);
  const anyActive = runs.some((r) => ["running", "editing", "approved"].includes(r.status));

  return (
    <div>
      <LiveRefresh every={anyActive ? 4000 : 20000} />
      <div className="page-head">
        <div>
          <h1>Activity</h1>
          <p className="sub">Everything the engine has worked on. Open one for the step-by-step progress.</p>
        </div>
      </div>
      {runs.length === 0 && <div className="empty"><h3>No videos yet</h3><p>Press “Make a video” on the Review page to start the first one.</p></div>}
      {runs.map((r) => {
        const pr = runProgress(r);
        const done = ["uploaded", "rejected", "pending_approval"].includes(r.status);
        return (
          <a className="card" key={r.id} href={r.status === "pending_approval" || r.status === "uploaded" || r.status === "upload_failed" ? `/review/${r.id}` : `/activity/${r.id}`} style={{ display: "block" }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div className="row" style={{ gap: 8, minWidth: 0 }}>
                <span className="tagq">{names[r.project] ?? r.project}</span>
                <span style={{ fontWeight: 600, color: "var(--ink)" }}>{r.topic ?? <span className="muted" style={{ fontWeight: 450 }}>Choosing a topic…</span>}</span>
              </div>
              <div className="row" style={{ gap: 10 }}>
                <span className={`status ${r.status}`}><i className="d" />{RUN_STATUS_LABELS[r.status] ?? r.status}</span>
                <span className="meta">{fmt(r.created_at)}</span>
              </div>
            </div>
            {!done && r.status !== "failed" && (
              <div style={{ marginTop: 10 }}>
                <div className="progress"><i style={{ width: `${Math.max(4, pr.pct)}%` }} /></div>
                <div className="faint" style={{ marginTop: 4 }}>{pr.current ?? (r.status === "approved" ? "Publishing to YouTube…" : "")} · step {Math.min(pr.done + 1, pr.total)} of {pr.total}</div>
              </div>
            )}
            {r.status === "failed" && (
              <p className="muted" style={{ margin: "6px 0 0" }}>Stopped at “{pr.current ?? "unknown step"}” — open to see why and retry.</p>
            )}
          </a>
        );
      })}
    </div>
  );
}
