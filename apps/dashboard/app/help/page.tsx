export default function HelpPage() {
  return (
    <div style={{ maxWidth: 680 }}>
      <div className="page-head">
        <div>
          <h1>How it works</h1>
          <p className="sub">The engine makes the videos. You stay in charge of what gets published.</p>
        </div>
      </div>

      <div className="card">
        <h3>1. A video gets made</h3>
        <p className="muted">
          Either on your schedule or when you press “Make a video”. The engine researches a topic, writes a script in one of several
          narrative formats, records the narration, creates the visuals, edits everything together with music and captions, writes the
          title and description, designs a thumbnail, and runs a quality check. This takes 10–25 minutes.
        </p>
      </div>
      <div className="card">
        <h3>2. You get notified</h3>
        <p className="muted">
          When a video is ready you'll get an email and/or a push notification (set these up in Settings). Open it on your phone or
          computer — the dashboard works on both.
        </p>
      </div>
      <div className="card">
        <h3>3. You review it</h3>
        <p className="muted">
          Watch the video, skim the script (click a scene to jump to it), and read the quality-check notes. Then:
        </p>
        <ul className="muted" style={{ paddingLeft: 18, margin: "6px 0 0" }}>
          <li><b>Approve & publish</b> — uploads to your YouTube channel with the title, description, tags and thumbnail shown.</li>
          <li><b>Request changes</b> — type what you want in plain words (“shorten the intro”, “make the thumbnail bluer”, “scene 4 image should show a coral reef”). Only the affected parts are redone, and the previous version is kept so you can compare or go back.</li>
          <li><b>Reject</b> — archives the video. Nothing is uploaded.</li>
        </ul>
      </div>
      <div className="card">
        <h3>4. Nothing is ever auto-published</h3>
        <p className="muted">
          The approve button is the only way a video reaches YouTube. Scheduled videos, edits, retries — everything stops in your review
          queue and waits for you.
        </p>
      </div>
      <div className="card">
        <h3>On-camera host (optional)</h3>
        <p className="muted">
          Turn on <i>On-camera host</i> in a channel's settings and describe the presenter. A consistent host is created once and
          delivers the hook, transitions and ending to camera with lip-synced speech; the rest of the video stays visuals.
        </p>
      </div>
      <div className="card">
        <h3>Channels</h3>
        <p className="muted">
          Each channel has its own YouTube connection, style, voice, schedule and (optionally) a Notion workspace where ideas, videos and
          results are tracked. Describe a new channel in a sentence or two and the engine sets up everything else — you can fine-tune it
          any time in the channel's settings.
        </p>
      </div>
    </div>
  );
}
