import { getProjects, notificationSetup } from "../../lib/engine";
import NewChannel from "../channels/new-channel";
import PushToggle from "../settings/push-toggle";

export const dynamic = "force-dynamic";

/**
 * First-run wizard. Step 1 creates the channel from a description; steps 2–3
 * (connect YouTube, notifications) happen on the channel page it lands on.
 */
export default async function SetupPage({ searchParams }: { searchParams: Promise<{ step?: string; channel?: string }> }) {
  const q = await searchParams;
  const projects = getProjects();
  const notif = notificationSetup();

  if (projects.length === 0 || q.step === "channel") {
    return (
      <div className="wizard">
        <div className="dots"><i className="on" /><i /><i /></div>
        <div className="stepnum">Step 1 of 3</div>
        <h1>Tell us about your channel</h1>
        <p className="lead">A couple of sentences is enough. The engine writes the full style guide, research rules and quality checks from this — you can adjust everything later.</p>
        <NewChannel inline />
      </div>
    );
  }

  const p = projects.find((x) => x.slug === q.channel) ?? projects[0];
  if (!p.youtubeConnected) {
    return (
      <div className="wizard">
        <div className="dots"><i className="on" /><i className="on" /><i /></div>
        <div className="stepnum">Step 2 of 3</div>
        <h1>Connect YouTube</h1>
        <p className="lead">Sign in with the Google account that owns <b>{p.config.name}</b>. This lets the engine publish videos <i>after</i> you approve them — nothing is uploaded on its own.</p>
        <a className="btn lg" href={`/api/youtube/connect?project=${p.slug}&back=/setup?channel=${p.slug}`}>Connect YouTube</a>
        <p className="help" style={{ marginTop: 14 }}>You can skip this and connect later from the channel page. <a className="link" href={`/setup?channel=${p.slug}&skipyt=1`}>Skip for now</a></p>
      </div>
    );
  }

  return (
    <div className="wizard">
      <div className="dots"><i className="on" /><i className="on" /><i className="on" /></div>
      <div className="stepnum">Step 3 of 3</div>
      <h1>Get notified</h1>
      <p className="lead">Videos take 10–25 minutes to make. We'll tell you the moment one is ready for your approval.</p>
      <div className="checkrow">
        <span className={`ic ${notif.pushDevices ? "ok" : ""}`}>📱</span>
        <div style={{ flex: 1 }}>
          <div className="k">Push notifications on this device</div>
          <div className="d">{notif.push ? "Recommended — works on desktop and Android; on iPhone add the site to your Home Screen first." : "Not available until push keys are added to the engine."}</div>
        </div>
        <div className="act">{notif.push && <PushToggle publicKey={notif.vapidPublicKey} />}</div>
      </div>
      <div className="checkrow">
        <span className={`ic ${notif.email ? "ok" : ""}`}>✉</span>
        <div style={{ flex: 1 }}>
          <div className="k">Email</div>
          <div className="d">{notif.email ? `Ready — sending to ${notif.emailTo}.` : "Ask your administrator to add an email address to the engine, or enable push above."}</div>
        </div>
      </div>
      <div className="row" style={{ marginTop: 22 }}>
        <a className="btn lg" href={`/channels/${p.slug}?new=1`}>Finish — go to my channel</a>
      </div>
    </div>
  );
}
