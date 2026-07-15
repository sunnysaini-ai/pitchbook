"use client";

import { useEffect, useState, useCallback } from "react";

type Citation = {
  id: string;
  ordinal: number;
  quote: string;
  document_id: string;
  page_from: number;
  page_to: number;
};
type Answer = {
  id: string;
  body: string;
  status: string;
  is_grounded: boolean;
  questions: { body: string } | { body: string }[] | null;
  citations: Citation[];
};
type DocLite = { id: string; filename: string };

type Selected = {
  documentId: string;
  page: number;
  quote: string;
  filename: string;
  url: string;
  mime: string;
} | null;

function qBody(a: Answer): string {
  if (!a.questions) return "";
  return Array.isArray(a.questions) ? a.questions[0]?.body ?? "" : a.questions.body;
}

export function BuyerRoomClient({
  dealId,
  deal,
  documents,
}: {
  dealId: string;
  deal: { name: string; sector: string | null };
  documents: DocLite[];
}) {
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [selected, setSelected] = useState<Selected>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const loadAnswers = useCallback(async () => {
    const res = await fetch(`/api/deals/${dealId}/answers`);
    const json = await res.json();
    if (res.ok) setAnswers(json.data as Answer[]);
  }, [dealId]);

  useEffect(() => {
    loadAnswers();
  }, [loadAnswers]);

  // Resolve a citation → open the source document to the cited page. This is
  // the trust story: no answer stands without a verifiable source (INV-1).
  async function openCitation(c: Citation) {
    const res = await fetch(`/api/deals/${dealId}/documents/${c.document_id}/view`);
    const json = await res.json();
    if (!res.ok) {
      alert(json.error?.message ?? "Could not open the source document.");
      return;
    }
    setSelected({
      documentId: c.document_id,
      page: c.page_from,
      quote: c.quote,
      filename: json.data.filename,
      url: json.data.url,
      mime: json.data.mime_type,
    });
  }

  async function openDoc(d: DocLite) {
    const res = await fetch(`/api/deals/${dealId}/documents/${d.id}/view`);
    const json = await res.json();
    if (res.ok)
      setSelected({ documentId: d.id, page: 1, quote: "", filename: json.data.filename, url: json.data.url, mime: json.data.mime_type });
  }

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    const question = q;
    setQ("");
    await fetch(`/api/deals/${dealId}/questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: question }),
    });
    await loadAnswers();
    setBusy(false);
  }

  return (
    <div className="grid h-screen grid-cols-2">
      {/* LEFT: document viewer */}
      <div className="flex h-screen flex-col border-r border-slate-200 bg-white">
        {selected ? (
          <>
            <div className="border-b border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">{selected.filename}</div>
                <button className="text-xs text-slate-400" onClick={() => setSelected(null)}>Close</button>
              </div>
              <div className="text-xs text-slate-500">Page {selected.page}</div>
              {selected.quote && (
                <div className="mt-2 rounded border-l-4 border-[color:var(--color-accent)] bg-blue-50 p-2 text-xs text-slate-700">
                  <span className="font-semibold text-[color:var(--color-accent)]">Cited passage: </span>
                  “{selected.quote}”
                </div>
              )}
            </div>
            <iframe
              key={selected.documentId + selected.page}
              title={selected.filename}
              className="flex-1"
              src={
                selected.mime.includes("pdf")
                  ? `${selected.url}#page=${selected.page}&view=FitH`
                  : selected.url
              }
            />
            {!selected.mime.includes("pdf") && (
              <div className="border-t border-slate-200 p-2 text-xs text-slate-500">
                This file type can't jump to a page in-browser — the cited passage is shown above.{" "}
                <a href={selected.url} target="_blank" rel="noreferrer" className="text-[color:var(--color-accent)]">Open file</a>
              </div>
            )}
          </>
        ) : (
          <div className="overflow-y-auto p-6">
            <h1 className="text-lg font-bold">{deal.name}</h1>
            <p className="mb-4 text-sm text-slate-500">{deal.sector} · Data room</p>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Documents shared with you</h2>
            <ul className="space-y-1 text-sm">
              {documents.map((d) => (
                <li key={d.id}>
                  <button className="rounded px-2 py-1 text-left hover:bg-slate-50" onClick={() => openDoc(d)}>{d.filename}</button>
                </li>
              ))}
              {documents.length === 0 && <li className="text-slate-400">No documents are shared with you yet.</li>}
            </ul>
            <p className="mt-6 text-xs text-slate-400">Ask a question on the right; click a citation chip to open its source here.</p>
          </div>
        )}
      </div>

      {/* RIGHT: analyst chat */}
      <div className="flex h-screen flex-col">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-500">
          Answers are drawn only from this deal's data room, each backed by a citation you can open.
          When the documents don't support an answer, the analyst says so.
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {answers.length === 0 && <p className="text-sm text-slate-400">Ask a diligence question to begin.</p>}
          {answers.map((a) => (
            <div key={a.id}>
              <div className="text-sm font-medium">You: {qBody(a)}</div>
              <div className="mt-1 rounded bg-slate-50 p-3 text-sm text-slate-700">
                {a.status === "escalated" ? (
                  <span className="text-slate-500">{a.body}</span>
                ) : (
                  <AnswerBody body={a.body} citations={a.citations} onCite={openCitation} />
                )}
              </div>
            </div>
          ))}
        </div>
        <form onSubmit={ask} className="flex gap-2 border-t border-slate-200 p-3">
          <input className="input" placeholder="e.g. What was FY25 revenue?" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn-primary" disabled={busy}>{busy ? "…" : "Ask"}</button>
        </form>
      </div>
    </div>
  );
}

// Render an answer body, turning [n] markers into clickable citation chips
// that resolve to citations[n-1] (analyst emits 1-based n; ordinal is 0-based).
function AnswerBody({
  body,
  citations,
  onCite,
}: {
  body: string;
  citations: Citation[];
  onCite: (c: Citation) => void;
}) {
  const parts = body.split(/(\[\d+\])/g);
  return (
    <span className="whitespace-pre-wrap">
      {parts.map((part, i) => {
        const m = part.match(/^\[(\d+)\]$/);
        if (m) {
          const n = parseInt(m[1]!, 10);
          const cit = citations.find((c) => c.ordinal === n - 1) ?? citations[n - 1];
          if (cit) {
            return (
              <button key={i} className="chip" onClick={() => onCite(cit)} title={`Open source · page ${cit.page_from}`}>
                [{n}]
              </button>
            );
          }
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}
