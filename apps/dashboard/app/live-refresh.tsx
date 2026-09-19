"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-renders a server page on an interval so progress stays live without a manual refresh. */
export default function LiveRefresh({ every = 5000 }: { every?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, every);
    return () => clearInterval(t);
  }, [every, router]);
  return null;
}
