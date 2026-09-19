"use client";
import { useEffect, useState } from "react";

function b64ToBytes(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Subscribe / unsubscribe this browser to push notifications. */
export default function PushToggle({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<"unsupported" | "off" | "on" | "denied" | "loading">("loading");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return setState("unsupported");
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  async function enable() {
    setMsg("");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setState("denied");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) as BufferSource });
      const res = await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      if (!res.ok) throw new Error(await res.text());
      setState("on");
      setMsg("This device will now get notifications.");
      setTimeout(() => window.location.reload(), 900);
    } catch (err) {
      setMsg(`Couldn't enable: ${String(err).slice(0, 120)}`);
    }
  }

  async function disable() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push/subscribe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    }
    setState("off");
    setTimeout(() => window.location.reload(), 500);
  }

  if (state === "loading") return null;
  if (state === "unsupported") return <span className="faint">Not supported in this browser</span>;
  if (state === "denied") return <span className="faint">Blocked in browser settings</span>;
  return (
    <span className="row">
      {state === "on" ? <button className="ghost sm" onClick={disable}>Turn off here</button> : <button className="sm" onClick={enable}>Enable on this device</button>}
      {msg && <span className="muted">{msg}</span>}
    </span>
  );
}
