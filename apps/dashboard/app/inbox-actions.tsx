"use client";
import { useState } from "react";
import MakeVideo from "./make-video";

/** "Make a video" entry point from the inbox: pick a channel, then the topic flow. */
export default function InboxActions({ projects }: { projects: { slug: string; name: string; busy: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState(projects[0]?.slug ?? "");
  if (!projects.length) return null;
  return (
    <>
      <button className="lg" onClick={() => setOpen(true)}>+ Make a video</button>
      {open && (
        <MakeVideo
          slug={slug}
          channels={projects}
          onChannel={setSlug}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
