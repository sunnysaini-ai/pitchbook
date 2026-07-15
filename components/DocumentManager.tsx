"use client";

import { useState, useRef } from "react";

type Doc = {
  id: string;
  filename: string;
  status: string;
  ai_accessible: boolean;
  error_detail?: string | null;
};

const STATUS_STYLE: Record<string, string> = {
  ready: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  uploaded: "bg-slate-100 text-slate-600",
  parsing: "bg-blue-100 text-blue-700",
  chunking: "bg-blue-100 text-blue-700",
  embedding: "bg-blue-100 text-blue-700",
};

// Seller document panel: upload → auto-ingest (parse→chunk→embed→classify) →
// per-doc AI-access toggle (INV-3). Statuses update live as ingest runs.
export function DocumentManager({ dealId, initialDocs }: { dealId: string; initialDocs: Doc[] }) {
  const [docs, setDocs] = useState<Doc[]>(initialDocs);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function patch(id: string, next: Partial<Doc>) {
    setDocs((d) => d.map((x) => (x.id === id ? { ...x, ...next } : x)));
  }

  async function ingest(id: string) {
    patch(id, { status: "parsing" });
    const res = await fetch(`/api/deals/${dealId}/documents/${id}/ingest`, { method: "POST" });
    const json = await res.json();
    if (res.ok) patch(id, { status: json.data.status, error_detail: json.data.error ?? null });
    else patch(id, { status: "failed", error_detail: json.error?.message });
  }

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files?.length) return;
    setBusy(true);
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/deals/${dealId}/documents`, { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) {
        alert(`Upload failed: ${json.error?.message}`);
        continue;
      }
      const doc: Doc = { ...json.data, ai_accessible: true };
      setDocs((d) => [...d, doc]);
      await ingest(doc.id); // run the pipeline right away
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function toggleAi(doc: Doc) {
    const next = !doc.ai_accessible;
    patch(doc.id, { ai_accessible: next });
    const res = await fetch(`/api/deals/${dealId}/documents/${doc.id}/ai-access`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ai_accessible: next }),
    });
    if (!res.ok) patch(doc.id, { ai_accessible: doc.ai_accessible }); // revert
  }

  return (
    <div className="card space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium">Source documents</span>
        <label className={`btn-ghost ${busy ? "opacity-50" : "cursor-pointer"}`}>
          {busy ? "Uploading…" : "+ Upload"}
          <input ref={inputRef} type="file" multiple className="hidden" onChange={onFiles} disabled={busy} />
        </label>
      </div>

      {docs.length === 0 && <p className="text-slate-400">No documents yet. Upload financials, contracts, etc.</p>}

      {docs.map((d) => (
        <div key={d.id} className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
          <div className="min-w-0">
            <div className="truncate">{d.filename}</div>
            {d.status === "failed" && d.error_detail && (
              <div className="truncate text-xs text-red-500">{d.error_detail}</div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className={`badge ${STATUS_STYLE[d.status] ?? "bg-slate-100 text-slate-600"}`}>{d.status}</span>
            {d.status === "failed" && (
              <button className="text-xs text-[color:var(--color-accent)]" onClick={() => ingest(d.id)}>
                Retry
              </button>
            )}
            <button
              className={`badge ${d.ai_accessible ? "bg-green-50 text-green-700" : "bg-slate-200 text-slate-500"}`}
              onClick={() => toggleAi(d)}
              title="Whether the analyst may cite this document"
            >
              {d.ai_accessible ? "AI on" : "AI off"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
