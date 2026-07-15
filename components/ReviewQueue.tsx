"use client";

import { useEffect, useState } from "react";

type QueueItem = {
  id: string;
  body: string;
  status: string;
  is_grounded: boolean;
  questions: { body: string } | null;
};

// Strict-mode review queue: AI drafts + escalations awaiting a human decision.
// Approving flips status to 'approved', at which point RLS lets the buyer see
// it (INV-5) — the client never bypasses that.
export function ReviewQueue({ dealId }: { dealId: string }) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const res = await fetch(`/api/deals/${dealId}/queue`);
    const json = await res.json();
    setItems(res.ok ? json.data : []);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, [dealId]);

  async function moderate(id: string, action: "approve" | "reject") {
    const body: any = { action };
    if (action === "reject") body.reason = "Rejected by seller";
    await fetch(`/api/answers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    load();
  }

  if (loading) return <div className="card text-sm text-slate-400">Loading…</div>;
  if (items.length === 0)
    return <div className="card text-sm text-slate-400">Nothing awaiting review.</div>;

  return (
    <div className="space-y-3">
      {items.map((it) => (
        <div key={it.id} className="card">
          <p className="text-sm font-medium">Q: {it.questions?.body}</p>
          <p className="mt-1 text-xs text-slate-400">
            {it.status === "escalated" ? "Escalated — no grounded answer" : "AI draft"}
          </p>
          <div className="mt-2 whitespace-pre-wrap rounded bg-slate-50 p-3 text-sm">{it.body}</div>
          <div className="mt-3 flex gap-2">
            <button className="btn-primary" onClick={() => moderate(it.id, "approve")} disabled={it.status === "escalated"}>
              Approve & release
            </button>
            <button className="btn-ghost" onClick={() => moderate(it.id, "reject")}>Reject</button>
          </div>
        </div>
      ))}
    </div>
  );
}
