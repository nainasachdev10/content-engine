import { getRun, getProject, videoMeta, artifactUrl, getEdits, publishedVideoId, RUN_STATUS_LABELS } from "../../../lib/engine";
import ReviewActions from "./review-actions";
import ScenePlayer from "./scene-player";
import Versions from "./versions";
import LiveRefresh from "../../live-refresh";

export const dynamic = "force-dynamic";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * The review page — one video, everything needed to decide.
 * Approve here is the only path to YouTube.
 */
export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) return <div className="empty"><h3>Video not found</h3><a className="link" href="/">Back to review queue</a></div>;
  const project = getProject(run.project);
  const meta = run.video_dir ? videoMeta(run.video_dir) : null;
  const edits = getEdits(run.id);
  const title = meta?.metadata?.title ?? run.topic ?? "Untitled video";
  const ytId = run.status === "uploaded" ? publishedVideoId(run.project, title) : null;
  const canAct = ["pending_approval", "upload_failed"].includes(run.status);
  const v = meta?.validation;

  return (
    <div>
      {(run.status === "editing" || run.status === "approved") && <LiveRefresh every={4000} />}
      <p style={{ margin: "0 0 10px" }}><a className="link" href="/">← Review queue</a></p>
      <div className="page-head" style={{ marginBottom: 18 }}>
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 8, marginBottom: 6 }}>
            <span className="tagq">{project?.config.name ?? run.project}</span>
            <span className={`status ${run.status}`}><i className="d" />{RUN_STATUS_LABELS[run.status] ?? run.status}</span>
            <span className="meta">{fmt(run.updated_at)}</span>
          </div>
          <h1 style={{ fontSize: 20 }}>{title}</h1>
        </div>
      </div>

      <div className="review-grid">
        <div style={{ minWidth: 0 }}>
          {meta?.hasVideo ? (
            <ScenePlayer
              src={artifactUrl(run.video_dir!, "final_video.mp4")}
              poster={meta.hasThumb ? artifactUrl(run.video_dir!, "thumbnail.png") : undefined}
              scenes={(meta.script?.scenes ?? []).map((s: any, i: number) => ({
                n: i + 1,
                narration: s.narration,
                shot: s.shot,
                start: meta.timestamps?.[i]?.start ?? null,
              }))}
              format={meta.script?.format}
              durationSec={meta.durationSec}
            />
          ) : (
            <div className="card muted">The video file isn't available yet.</div>
          )}

          <div className="card" style={{ marginTop: 12 }}>
            <h3>How it will appear on YouTube</h3>
            <div className="row" style={{ alignItems: "flex-start", gap: 16, flexWrap: "nowrap" }}>
              {meta?.hasThumb && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="thumb" src={artifactUrl(run.video_dir!, "thumbnail.png")} alt="Thumbnail" style={{ maxWidth: 200, flexShrink: 0 }} />
              )}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: "var(--ink)", fontSize: 14.5, lineHeight: 1.35 }}>{title}</div>
                <div className="faint" style={{ marginTop: 2 }}>
                  {project?.config.youtube?.channelTitle ?? project?.config.name} · will be published as <b>{project?.config.youtube?.defaultPrivacy ?? "unlisted"}</b>
                </div>
                <p className="muted" style={{ margin: "8px 0 0", whiteSpace: "pre-wrap", display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                  {meta?.metadata?.description}
                </p>
              </div>
            </div>
            <details className="fold">
              <summary>Full description &amp; tags</summary>
              <p style={{ whiteSpace: "pre-wrap" }} className="muted">{meta?.metadata?.description}</p>
              <div>{(meta?.metadata?.tags ?? []).map((t: string) => <span className="tag" key={t}>{t}</span>)}</div>
            </details>
          </div>
        </div>

        <div className="review-side">
          <div className="card">
            {run.status === "uploaded" ? (
              <>
                <h3>Published ✓</h3>
                <p className="muted" style={{ margin: 0 }}>This video is live on your channel.</p>
                {ytId && <a className="btn" style={{ marginTop: 12 }} href={`https://youtu.be/${ytId}`} target="_blank">Open on YouTube ↗</a>}
              </>
            ) : run.status === "approved" ? (
              <>
                <h3>Publishing…</h3>
                <p className="muted" style={{ margin: 0 }}>Uploading to YouTube now. This page updates by itself.</p>
              </>
            ) : run.status === "editing" ? (
              <>
                <h3>Applying your changes…</h3>
                <p className="muted" style={{ margin: 0 }}>Only the affected parts are being redone. You'll be notified when it's back.</p>
                <div className="progress amber" style={{ marginTop: 12 }}><i style={{ width: "50%" }} /></div>
              </>
            ) : run.status === "rejected" ? (
              <>
                <h3>Rejected</h3>
                <p className="muted" style={{ margin: 0 }}>This video was archived and will not be published.</p>
              </>
            ) : (
              <>
                <h3>Your decision</h3>
                {run.status === "upload_failed" && (
                  <p className="error-text" style={{ marginBottom: 12 }}>Publishing failed: {run.error}. {project?.youtubeConnected ? "You can retry." : "Connect YouTube in the channel settings first."}</p>
                )}
                {run.error?.startsWith("edit failed") && <p className="error-text" style={{ marginBottom: 12 }}>{run.error}</p>}
                <ReviewActions runId={run.id} status={run.status} title={title} youtubeConnected={!!project?.youtubeConnected} channelSlug={run.project} />
              </>
            )}
          </div>

          <div className="card">
            <h3>Quality check</h3>
            {!v && <p className="muted" style={{ margin: 0 }}>No quality check recorded.</p>}
            {v && (
              <>
                <span className={`pill ${v.verdict === "pass" ? "green" : "red"}`}>{v.verdict === "pass" ? "✓ Passed" : "✕ Did not pass"}</span>
                {v.issues?.length > 0 && (
                  <ul style={{ paddingLeft: 18, margin: "10px 0 0" }} className="muted">
                    {v.issues.map((s: string, i: number) => <li key={i}>{s}</li>)}
                  </ul>
                )}
                {v.suggestions?.length > 0 && (
                  <>
                    <div className="faint" style={{ marginTop: 10, fontWeight: 600 }}>Optional notes</div>
                    <ul style={{ paddingLeft: 18, margin: "4px 0 0" }} className="muted">
                      {v.suggestions.map((s: string, i: number) => <li key={i} style={{ marginBottom: 4 }}>{s}</li>)}
                    </ul>
                    <p className="faint" style={{ margin: "8px 0 0" }}>These are fine to ignore — or paste one into “Request changes”.</p>
                  </>
                )}
              </>
            )}
          </div>

          {(edits.length > 0 || (meta?.versions?.length ?? 0) > 0) && (
            <div className="card">
              <h3>History</h3>
              {edits.map((e) => (
                <div key={e.id} style={{ padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <span className={`status ${e.status === "done" ? "done" : e.status === "failed" ? "failed" : "running"}`}><i className="d" />{e.status === "done" ? "Applied" : e.status === "failed" ? "Failed" : "Working"}</span>
                    <span className="meta">{fmt(e.created_at)}</span>
                  </div>
                  <div className="muted">“{e.instruction}”</div>
                  {e.summary && <div className="faint">{e.summary}</div>}
                </div>
              ))}
              {run.video_dir && <Versions runId={run.id} videoDir={run.video_dir} versions={meta?.versions ?? []} canRestore={canAct} />}
            </div>
          )}
          <p className="faint" style={{ textAlign: "center" }}>
            <a href={`/activity/${run.id}`}>Technical details</a>
          </p>
        </div>
      </div>
    </div>
  );
}
