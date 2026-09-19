import { redirect } from "next/navigation";
import { getRuns, getProjects, videoMeta, artifactUrl, runProgress, RUN_STATUS_LABELS, publishedVideoId } from "../lib/engine";
import InboxActions from "./inbox-actions";
import LiveRefresh from "./live-refresh";

export const dynamic = "force-dynamic";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const dur = (s: number | null) => (s == null ? "" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);

/**
 * Home = the review inbox. Everything that needs a human decision is at the top.
 * Approve here is the ONLY road to YouTube — there is no automatic publishing anywhere.
 */
export default function InboxPage() {
  const projects = getProjects();
  if (projects.length === 0) redirect("/setup");
  const byslug = Object.fromEntries(projects.map((p) => [p.slug, p]));

  const runs = getRuns(undefined, 200);
  const queue = runs.filter((r) => ["pending_approval", "upload_failed"].includes(r.status));
  const active = runs.filter((r) => ["running", "editing", "approved"].includes(r.status));
  const failed = runs.filter((r) => r.status === "failed").slice(0, 3);
  const recent = runs.filter((r) => r.status === "uploaded").slice(0, 5);

  return (
    <div>
      <LiveRefresh every={active.length ? 4000 : 15000} />
      <div className="page-head">
        <div>
          <h1>{queue.length ? `${queue.length} video${queue.length > 1 ? "s" : ""} waiting for you` : "Nothing waiting for you"}</h1>
          <p className="sub">Watch each video, then approve it to publish, ask for changes, or reject it. Nothing goes live without your OK.</p>
        </div>
        <InboxActions projects={projects.map((p) => ({ slug: p.slug, name: p.config.name, busy: p.counts.inProgress > 0 }))} />
      </div>

      {queue.length === 0 && active.length === 0 && (
        <div className="empty">
          <h3>Your review queue is empty</h3>
          <p style={{ margin: "0 0 14px" }}>
            {projects.some((p) => p.config.schedule?.autoRun)
              ? "New videos are made automatically on your schedule and will appear here — we'll notify you."
              : "Make a video now, or turn on the schedule in your channel settings so videos arrive on their own."}
          </p>
        </div>
      )}

      {queue.map((r) => {
        const meta = r.video_dir ? videoMeta(r.video_dir) : null;
        const p = byslug[r.project];
        const v = meta?.validation;
        const okCount = v?.suggestions?.length ?? 0;
        return (
          <div className="inbox-item" key={r.id}>
            <a className="thumbwrap" href={`/review/${r.id}`}>
              {meta?.hasThumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={artifactUrl(r.video_dir!, "thumbnail.png")} alt="" />
              ) : (
                <div style={{ aspectRatio: "16/9", background: "var(--panel2)", borderRadius: 8 }} />
              )}
              {meta?.durationSec && <span className="dur">{dur(meta.durationSec)}</span>}
            </a>
            <div style={{ minWidth: 0 }}>
              <div className="row" style={{ gap: 8, marginBottom: 6 }}>
                <span className="tagq">{p?.config.name ?? r.project}</span>
                {r.status === "upload_failed" ? (
                  <span className="pill red">Publish failed</span>
                ) : v?.verdict === "pass" ? (
                  <span className="pill green">✓ Passed checks{okCount ? ` · ${okCount} note${okCount > 1 ? "s" : ""}` : ""}</span>
                ) : (
                  <span className="pill amber">Check the review</span>
                )}
                <span className="meta">{fmt(r.updated_at)}</span>
              </div>
              <a className="title" href={`/review/${r.id}`}>{meta?.metadata?.title ?? r.topic}</a>
              {meta?.script?.scenes?.[0]?.narration && (
                <p className="muted" style={{ margin: "6px 0 0", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                  “{meta.script.scenes[0].narration}”
                </p>
              )}
              {r.status === "upload_failed" && r.error && <p className="error-text" style={{ marginTop: 8 }}>{r.error}</p>}
              <div className="row" style={{ marginTop: 12 }}>
                <a className="btn" href={`/review/${r.id}`}>Watch & review</a>
              </div>
            </div>
          </div>
        );
      })}

      {active.length > 0 && (
        <>
          <h2>Being made right now</h2>
          {active.map((r) => {
            const pr = runProgress(r);
            const label = r.status === "approved" ? "Publishing to YouTube…" : r.status === "editing" ? "Applying your changes…" : pr.current ?? "Starting…";
            return (
              <a className="card" key={r.id} href={`/activity/${r.id}`} style={{ display: "block" }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="tagq">{byslug[r.project]?.config.name ?? r.project}</span>
                    <span style={{ fontWeight: 600, color: "var(--ink)" }}>{r.topic ?? "Choosing a topic…"}</span>
                  </div>
                  <span className="status running"><i className="d" />{label}</span>
                </div>
                {r.status === "running" && (
                  <div className="progress" style={{ marginTop: 10 }}><i style={{ width: `${Math.max(4, pr.pct)}%` }} /></div>
                )}
              </a>
            );
          })}
        </>
      )}

      {failed.length > 0 && (
        <>
          <h2>Needs attention</h2>
          {failed.map((r) => (
            <a className="card" key={r.id} href={`/activity/${r.id}`} style={{ display: "block", borderColor: "#f1c9c9" }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div className="row" style={{ gap: 8 }}>
                  <span className="tagq">{byslug[r.project]?.config.name ?? r.project}</span>
                  <span style={{ fontWeight: 600, color: "var(--ink)" }}>{r.topic ?? "Untitled"}</span>
                </div>
                <span className="status failed"><i className="d" />Couldn't finish</span>
              </div>
              <p className="muted" style={{ margin: "6px 0 0" }}>{(r.error ?? "").slice(0, 160)} — open to retry.</p>
            </a>
          ))}
        </>
      )}

      {recent.length > 0 && (
        <>
          <h2>Recently published</h2>
          <div className="card" style={{ padding: "4px 20px" }}>
            {recent.map((r) => {
              const meta = r.video_dir ? videoMeta(r.video_dir) : null;
              const vid = publishedVideoId(r.project, meta?.metadata?.title ?? r.topic ?? "");
              return (
                <div key={r.id} className="row" style={{ padding: "10px 0", borderBottom: "1px solid var(--border)", justifyContent: "space-between" }}>
                  <div className="row" style={{ gap: 8, minWidth: 0 }}>
                    <span className="status uploaded"><i className="d" />{RUN_STATUS_LABELS.uploaded}</span>
                    <a href={`/review/${r.id}`} style={{ fontWeight: 550, color: "var(--ink)" }}>{meta?.metadata?.title ?? r.topic}</a>
                  </div>
                  <div className="row" style={{ gap: 12 }}>
                    <span className="meta">{fmt(r.updated_at)}</span>
                    {vid && <a className="link" href={`https://youtu.be/${vid}`} target="_blank">YouTube ↗</a>}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

