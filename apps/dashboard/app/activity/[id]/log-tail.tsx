"use client";
import { useEffect, useRef, useState } from "react";

/** Tails data/logs/<runId>.log while a run is active. */
export default function LogTail({ runId }: { runId: string }) {
  const [text, setText] = useState("");
  const pre = useRef<HTMLPreElement>(null);
  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const res = await fetch(`/api/runs/${runId}/log`);
        if (res.ok && alive) {
          const t = await res.text();
          setText(t);
          requestAnimationFrame(() => {
            if (pre.current) pre.current.scrollTop = pre.current.scrollHeight;
          });
        }
      } catch {}
    }
    poll();
    const t = setInterval(poll, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [runId]);
  return <pre className="log" ref={pre}>{text || "No log yet."}</pre>;
}
