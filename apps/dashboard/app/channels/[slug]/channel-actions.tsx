"use client";
import { useState } from "react";
import MakeVideo from "../../make-video";

export default function ChannelActions({ slug, name, busy }: { slug: string; name: string; busy: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="lg" onClick={() => setOpen(true)}>+ Make a video</button>
      {open && <MakeVideo slug={slug} channels={[{ slug, name, busy }]} onClose={() => setOpen(false)} />}
    </>
  );
}
