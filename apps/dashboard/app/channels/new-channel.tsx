"use client";
import { useState } from "react";
import ChannelForm from "./channel-form";

export default function NewChannel({ inline }: { inline?: boolean }) {
  const [open, setOpen] = useState(!!inline);
  if (!open) return <button className="lg" onClick={() => setOpen(true)}>+ New channel</button>;
  if (inline) return <ChannelForm onDone={(slug) => (window.location.href = `/channels/${slug}?new=1`)} />;
  return (
    <>
      <div className="backdrop" onClick={() => setOpen(false)} />
      <div className="card modal">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>New channel</h3>
          <button className="ghost sm" onClick={() => setOpen(false)}>Close</button>
        </div>
        <ChannelForm onDone={(slug) => (window.location.href = `/channels/${slug}?new=1`)} />
      </div>
    </>
  );
}
