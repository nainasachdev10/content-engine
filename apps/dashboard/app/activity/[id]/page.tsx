import { getRun, getProject, videoMeta, artifactUrl, repoRoot, absVideoDir, STAGE_LABELS, RUN_STATUS_LABELS } from "../../../lib/engine";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import LogTail from "./log-tail";
import RetryButton from "./retry-button";
import LiveRefresh from "../../live-refresh";

export const dynamic = "force-dynamic";

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "");
const secs = (a: string | null, b: string | null) => (a && b ? `${Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000)}s` : "");

/** Step-by-step progress of one video, in plain language, with a technical log folded away. */
export default async function ActivityDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) return <div className="empty"><h3>Not found</h3></div>;
  const project = getProject(run.project);
  const vd = run.video_dir;
  const meta = vd ? videoMeta(vd) : null;
  const imagesDir = vd ? join(absVideoDir(vd), "images") : null;
  const sceneImages = imagesDir && existsSync(imagesDir)
    ? readdirSync(imagesDir).filter((f) => /^scene-\d+\.png$/.test(f)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
    : [];
  const live = ["running", "editing", "approved"].includes(run.status);
  const failedStage = run.stages.find((s) => s.status === "failed");

  return (
    <div>
      {live && <LiveRefresh every={3500} />}
      <p style={{ margin: "0 0 10px" }}><a className="link" href="/activity">← Activity</a></p>
      <div className="page-head" style={{ marginBottom: 18 }}>
        <div>
          <div className="row" style={{ gap: 8, marginBottom: 6 }}>
            <span className="tagq">{project?.config.name ?? run.project}</span>
            <span className={`status ${run.status}`}><i className="d" />{RUN_STATUS_LABELS[run.status] ?? run.status}</span>
          </div>
          <h1 style={{ fontSize: 20 }}>{run.topic ?? "Choosing a topic…"}</h1>
        </div>
        <div className="row">
          {["pending_approval", "upload_failed", "uploaded"].includes(run.status) && <a className="btn" href={`/review/${run.id}`}>Open review</a>}
          {["failed", "stopped", "rejected"].includes(run.status) && <RetryButton runId={run.id} busy={project ? project.counts.inProgress > 0 : false} />}
        </div>
      </div>

      {run.status === "failed" && (
        <div className="error-text" style={{ marginBottom: 14 }}>
          <b>What went wrong:</b> {friendlyError(run.error ?? failedStage?.error ?? "unknown")}
        </div>
      )}

      <div className="card">
        <div className="steplist">
          {run.stages.map((s) => (
            <div key={s.stage} className={`item ${s.status}`}>
              <span className="dot" />
              <span>{STAGE_LABELS[s.stage] ?? s.stage}</span>
              <span className="t">{s.status === "running" ? `started ${time(s.started_at)}` : s.status === "done" ? secs(s.started_at, s.finished_at) : s.status === "failed" ? "failed" : ""}</span>
            </div>
          ))}
        </div>
      </div>

      {vd && (
        <>
          {meta?.hasVideo && (
            <div className="card">
              <video className="player" controls playsInline src={artifactUrl(vd, "final_video.mp4")} poster={meta.hasThumb ? artifactUrl(vd, "thumbnail.png") : undefined} />
            </div>
          )}
          {existsSync(join(absVideoDir(vd), "voiceover.mp3")) && (
            <div className="card">
              <h3>Narration</h3>
              <audio controls src={artifactUrl(vd, "voiceover.mp3")} style={{ width: "100%" }} />
            </div>
          )}
          {sceneImages.length > 0 && (
            <div className="card">
              <h3>Scene visuals</h3>
              <div className="imgrid">
                {sceneImages.map((f) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={f} src={artifactUrl(vd, `images/${f}`)} alt={f} title={f} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <details className="fold" style={{ borderTop: "none" }}>
        <summary>Technical log</summary>
        <p className="faint mono">{run.id}{vd ? ` · ${vd.replace(repoRoot + "/", "")}` : ""}</p>
        <LogTail runId={run.id} />
      </details>
    </div>
  );
}

function friendlyError(e: string): string {
  if (/quota|429|credits|insufficient/i.test(e)) return "A service we rely on ran out of credits or hit its limit. " + e.slice(0, 200);
  if (/Validation failed/i.test(e)) return "The quality check flagged this video, so it was not sent for review. " + e.replace(/^.*Validation failed:\s*/i, "");
  if (/Missing required \.env/i.test(e)) return "A required service key is missing in the engine's configuration. " + e.slice(0, 200);
  return e.slice(0, 400);
}
