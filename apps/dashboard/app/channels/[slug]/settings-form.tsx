"use client";
import { useState } from "react";

const ALL_FORMATS: [string, string][] = [
  ["story", "Story"], ["mystery", "Mystery"], ["countdown", "Countdown"], ["versus", "Versus"],
  ["journey", "Journey"], ["mythbusting", "Myth-busting"], ["how-it-works", "How it works"], ["what-if", "What if"],
];

/** Channel settings in plain language; the raw prompts are under "Advanced". */
export default function SettingsForm({ slug, initial }: { slug: string; initial: any }) {
  const [c, setC] = useState(initial);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (path: string, value: any) => {
    setC((prev: any) => {
      const next = structuredClone(prev);
      const keys = path.split(".");
      let o = next;
      for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]] ??= {};
      o[keys[keys.length - 1]] = value;
      return next;
    });
    setMsg("");
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    const res = await fetch(`/api/channels/${slug}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(c),
    });
    const text = await res.text();
    setBusy(false);
    setMsg(res.ok ? "Saved." : `Couldn't save: ${text}`);
  }

  const num = (v: string) => (v === "" ? 0 : Number(v));
  const formats: string[] = c.video.formats?.length ? c.video.formats : ALL_FORMATS.map((f) => f[0]);

  return (
    <form onSubmit={save}>
      <div className="card">
        <h3>Publishing</h3>
        <div className="switch">
          <input type="checkbox" checked={!!c.schedule.autoRun} onChange={(e) => set("schedule.autoRun", e.target.checked)} />
          <div>
            <div className="k">Make videos on a schedule</div>
            <div className="d">New videos are made automatically and wait in your review queue. They are never published without your approval.</div>
          </div>
        </div>
        <div className="row" style={{ gap: 16 }}>
          <div style={{ flex: 1 }}>
            <label>Videos per week</label>
            <select value={c.schedule.cadencePerWeek} onChange={(e) => set("schedule.cadencePerWeek", num(e.target.value))}>
              {[1, 2, 3, 4, 5, 6, 7, 10, 14].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label>When approved, publish as</label>
            <select value={c.youtube.defaultPrivacy} onChange={(e) => set("youtube.defaultPrivacy", e.target.value)}>
              <option value="public">Public — visible to everyone</option>
              <option value="unlisted">Unlisted — only with the link</option>
              <option value="private">Private — only you</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Videos</h3>
        <div className="row" style={{ gap: 16 }}>
          <div style={{ flex: 1 }}>
            <label>Length</label>
            <select value={c.video.lengthMinutes} onChange={(e) => set("video.lengthMinutes", num(e.target.value))}>
              {[1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20].map((m) => <option key={m} value={m}>{m} minute{m > 1 ? "s" : ""}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label>Visuals</label>
            <select value={c.video.visualsMode} onChange={(e) => set("video.visualsMode", e.target.value)}>
              <option value="slideshow">Illustrated scenes with camera motion (lowest cost)</option>
              <option value="hybrid">Key scenes animated (recommended)</option>
              <option value="video">Every scene animated (highest cost)</option>
            </select>
          </div>
        </div>
        <label>Storytelling styles the channel may use</label>
        <div className="choices">
          {ALL_FORMATS.map(([k, label]) => {
            const on = formats.includes(k);
            return (
              <button type="button" key={k} className={`choice ${on ? "on" : ""}`}
                onClick={() => set("video.formats", on ? formats.filter((x) => x !== k) : [...formats, k])}>{label}</button>
            );
          })}
        </div>
        <p className="help">The engine picks the best fit per topic and avoids repeating the same style back-to-back.</p>

        <div className="row" style={{ gap: 16 }}>
          <div style={{ flex: 1 }}>
            <label>Narrator liveliness</label>
            <input type="range" min={0} max={1} step={0.05} value={1 - (c.voice.settings?.stability ?? 0.4)}
              onChange={(e) => set("voice.settings.stability", Math.round((1 - Number(e.target.value)) * 100) / 100)} />
            <div className="row" style={{ justifyContent: "space-between" }}><span className="faint">Steady</span><span className="faint">Expressive</span></div>
          </div>
          <div style={{ flex: 1 }}>
            <label>Background music level</label>
            <input type="range" min={-36} max={-10} step={1} value={c.music?.gainDb ?? -21} onChange={(e) => set("music.gainDb", num(e.target.value))} />
            <div className="row" style={{ justifyContent: "space-between" }}><span className="faint">Quiet</span><span className="faint">Present</span></div>
          </div>
        </div>
        <div className="switch">
          <input type="checkbox" checked={!!c.music?.enabled} onChange={(e) => set("music.enabled", e.target.checked)} />
          <div>
            <div className="k">Background music</div>
            <div className="d">A music bed made once for this channel, kept quiet under the narration.</div>
          </div>
        </div>
        <div className="switch">
          <input type="checkbox" checked={!!c.presenter?.enabled} onChange={(e) => set("presenter.enabled", e.target.checked)} />
          <div style={{ flex: 1 }}>
            <div className="k">On-camera host (talking head)</div>
            <div className="d">A consistent AI presenter speaks the hook, transitions and ending to camera; the rest stays visuals. Adds roughly $1–2 per minute of on-camera time.</div>
            {c.presenter?.enabled && (
              <div style={{ marginTop: 8 }}>
                <label style={{ marginTop: 6 }}>Describe the host</label>
                <input value={c.presenter?.description ?? ""} onChange={(e) => set("presenter.description", e.target.value)}
                  placeholder="a warm woman in her 40s with short grey hair, marine-biologist vibe, bright lab" />
                <p className="help">Generated once and reused for every video. To use a real person, drop a 16:9 photo at <code>projects/{slug}/assets/presenter.png</code>.</p>
                <div className="row" style={{ gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ marginTop: 6 }}>How much on camera</label>
                    <select value={c.presenter?.share ?? 0.35} onChange={(e) => set("presenter.share", num(e.target.value))}>
                      <option value={0.2}>A little (hook + ending)</option>
                      <option value={0.35}>About a third</option>
                      <option value={0.5}>Half the video</option>
                      <option value={0.8}>Mostly on camera</option>
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ marginTop: 6 }}>Lip-sync engine</label>
                    <select value={c.presenter?.provider ?? "omnihuman"} onChange={(e) => set("presenter.provider", e.target.value)}>
                      <option value="omnihuman">OmniHuman (Replicate)</option>
                      <option value="higgsfield">Higgsfield Speech2Video (needs SEGMIND_API_KEY)</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <h3>About the channel</h3>
        <label>Display name</label>
        <input value={c.name} onChange={(e) => set("name", e.target.value)} required />
        <label>What it's about</label>
        <textarea rows={2} value={c.niche} onChange={(e) => set("niche", e.target.value)} required />
        <label>Who watches it</label>
        <textarea rows={2} value={c.audience.description} onChange={(e) => set("audience.description", e.target.value)} required />
        <div className="switch">
          <input type="checkbox" checked={c.audience.madeForKids} onChange={(e) => set("audience.madeForKids", e.target.checked)} />
          <div>
            <div className="k">Made for kids</div>
            <div className="d">Marks uploads as made for kids on YouTube and applies stricter content rules.</div>
          </div>
        </div>
      </div>

      <details className="fold card" style={{ borderTop: "1px solid var(--border)", paddingTop: 18 }}>
        <summary>Advanced — style guide, voice and music prompts</summary>
        <p className="help">These were written from your channel description. Edit them if you want to steer the writing, visuals or checks in a specific direction.</p>
        {(
          [
            ["scriptRules", "Writing rules", 8],
            ["visualStyle", "Visual style", 3],
            ["thumbnailStyle", "Thumbnail style", 3],
            ["metadataGuidance", "Title & description rules", 3],
            ["validationChecklist", "Quality-check list", 4],
          ] as [string, string, number][]
        ).map(([k, label, rows]) => (
          <div key={k}>
            <label>{label}</label>
            <textarea rows={rows} value={c.prompts[k]} onChange={(e) => set(`prompts.${k}`, e.target.value)} required />
          </div>
        ))}
        <label>Music description</label>
        <textarea rows={2} value={c.music?.prompt ?? ""} onChange={(e) => set("music.prompt", e.target.value)} />
        <label>Narrator voice (ElevenLabs voice ID)</label>
        <input value={c.voice.voiceId} onChange={(e) => set("voice.voiceId", e.target.value)} required />
        <label>Expressiveness (0–1)</label>
        <input type="number" step={0.05} min={0} max={1} value={c.voice.settings?.style ?? 0.3} onChange={(e) => set("voice.settings.style", num(e.target.value))} />
        <label>Clip engine (animated hero scenes)</label>
        <select value={c.video.clipProvider ?? "replicate"} onChange={(e) => set("video.clipProvider", e.target.value)}>
          <option value="replicate">Replicate — Kling 2.5 Turbo Pro (default)</option>
          <option value="higgsfield">Higgsfield — DoP cinematic presets (needs Higgsfield API keys)</option>
        </select>
        <label>Clip model id (optional override)</label>
        <input value={c.video.clipModel ?? ""} onChange={(e) => set("video.clipModel", e.target.value || undefined)}
          placeholder={c.video.clipProvider === "higgsfield" ? "higgsfield-ai/dop/standard" : "kwaivgi/kling-v2.5-turbo-pro"} />
        <label>Image model (Replicate id)</label>
        <input value={c.video.imageModel ?? ""} onChange={(e) => set("video.imageModel", e.target.value || undefined)} placeholder="black-forest-labs/flux-1.1-pro (default) — or google/imagen-4, bytedance/seedream-4" />
        <label>Renderer</label>
        <select value={c.video.renderer} onChange={(e) => set("video.renderer", e.target.value)}>
          <option value="hyperframes">Animated word-by-word captions</option>
          <option value="ffmpeg">Classic subtitle captions</option>
        </select>
      </details>

      <div className="row" style={{ margin: "16px 0 40px" }}>
        <button type="submit" className="lg" disabled={busy}>{busy ? "Saving…" : "Save settings"}</button>
        {msg && <span className={msg === "Saved." ? "note ok" : "error-text"} style={{ padding: "6px 12px" }}>{msg}</span>}
      </div>
    </form>
  );
}
