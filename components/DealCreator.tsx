"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DealCreator() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [sector, setSector] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    const res = await fetch("/api/deals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, sector: sector || undefined }),
    });
    setBusy(false);
    const json = await res.json();
    if (res.ok) router.push(`/deals/${json.data.id}`);
    else alert(json.error?.message || "Failed to create deal");
  }

  if (!open) return <button className="btn-primary" onClick={() => setOpen(true)}>+ New deal</button>;

  return (
    <div className="card w-80">
      <h3 className="mb-2 font-semibold">New deal</h3>
      <div className="space-y-2">
        <input className="input" placeholder="Project name (e.g. Project Meridian)" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" placeholder="Sector (optional)" value={sector} onChange={(e) => setSector(e.target.value)} />
        <div className="flex gap-2">
          <button className="btn-primary flex-1" disabled={busy || !name} onClick={create}>Create</button>
          <button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
