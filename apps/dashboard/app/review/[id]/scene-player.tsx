"use client";
import { useRef, useState } from "react";

interface Scene { n: number; narration: string; shot?: string; start: number | null }
const t = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Video player with the script beside it — click a scene to jump to it. */
export default function ScenePlayer({
  src, poster, scenes, format, durationSec,
}: { src: string; poster?: string; scenes: Scene[]; format?: string; durationSec: number | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [cur, setCur] = useState(0);

  const active = scenes.reduce((a, s, i) => (s.start != null && cur >= s.start - 0.05 ? i : a), 0);

  return (
    <>
      <video
        ref={ref}
        className="player"
        controls
        playsInline
        src={src}
        poster={poster}
        onTimeUpdate={(e) => setCur((e.target as HTMLVideoElement).currentTime)}
      />
      <div className="card" style={{ marginTop: 12 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Script</h3>
          <span className="faint">
            {format && <span className="tagq" style={{ marginRight: 8 }}>{format} format</span>}
            {scenes.length} scenes{durationSec ? ` · ${t(durationSec)}` : ""}
          </span>
        </div>
        <div style={{ marginTop: 6 }}>
          {scenes.map((s, i) => (
            <div
              key={s.n}
              className="scene"
              style={i === active ? { background: "var(--accent-soft)", margin: "0 -10px", padding: "9px 10px", borderRadius: 8 } : undefined}
              onClick={() => {
                if (s.start == null || !ref.current) return;
                ref.current.currentTime = s.start;
                ref.current.play().catch(() => {});
              }}
            >
              <span className="t">{s.start != null ? t(s.start) : `#${s.n}`}</span>
              <span>
                {s.narration}
                {s.shot && <div className="shot">{s.shot}</div>}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
