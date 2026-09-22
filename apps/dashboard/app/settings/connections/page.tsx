import { connectionStatus } from "../../../lib/engine";
import ConnectionsForm from "./connections-form";

export const dynamic = "force-dynamic";

/** Where the client enters the accounts the engine bills against. Values are write-only. */
export default function ConnectionsPage() {
  const s = connectionStatus();
  return (
    <div style={{ maxWidth: 720 }}>
      <p style={{ margin: "0 0 10px" }}><a className="link" href="/settings">← Settings</a></p>
      <div className="page-head">
        <div>
          <h1>Connections</h1>
          <p className="sub">The accounts your videos are made with. Keys are stored on your engine only and never shown again after saving.</p>
        </div>
      </div>
      {!s.coreReady && <div className="note" style={{ marginBottom: 14 }}>Three keys are required before the first video: Anthropic (writing), ElevenLabs (narration) and Replicate (visuals).</div>}
      <ConnectionsForm status={s} />
      <div className="card">
        <h3>YouTube app</h3>
        <p className="muted" style={{ margin: 0 }}>
          {s.youtubeApp
            ? "Configured by your administrator. Connect each channel from its channel page."
            : "Not configured — your administrator needs to set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET on the host."}
          {s.dashboardUrl && <><br />Google redirect URL to register: <code>{s.dashboardUrl}/api/youtube/callback</code></>}
        </p>
      </div>
    </div>
  );
}
