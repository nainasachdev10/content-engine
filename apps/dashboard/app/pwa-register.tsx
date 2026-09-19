"use client";
import { useEffect } from "react";

/** Registers the service worker that receives push notifications (no-op where unsupported). */
export default function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}
