# DealDesk

AI-run sell-side M&A data room. A seller uploads their document set; buyers get a
link; an AI analyst answers diligence questions **with citations back to the source
documents** — and refuses (escalates) when the documents don't support an answer.
The seller controls what's answerable, reviews what goes out, and every AI output +
human override is captured in an immutable audit log.

This is **Chunk 2** per `AGENT_SPEC.md`: the trust-critical core + a Next.js 15 app.

## Quick start
See **`docs/RUNBOOK.md`** — zero-to-live-buyer-room, written for an operator who
directs the build. TL;DR:

```bash
npm install
cp .env.example .env.local     # add Supabase + Anthropic + OpenAI + LlamaParse keys
# apply supabase/migrations/0001 + 0002 to your Supabase project
npm run dev
```

## Verified in this build
`npm run build` ✓ clean · `tsc --noEmit` ✓ clean · `vitest` ✓ (gate suites load & skip-with-reason).

## The two release GATES (run against your Supabase before shipping)
- `npm run test:rls` — buyer isolation (INV-2)
- `npm run test:golden` — grounded answers + refusals (INV-1/6); cases 4–8 must refuse

## Layout
- `supabase/migrations/` — schema (0001) + RLS & retrieval RPCs (0002)
- `lib/analyst/` — system prompt + anti-hallucination guardrails (the core IP)
- `lib/retrieval/` — permission-filtered hybrid search
- `lib/ingest/` — parse → chunk → embed → classify
- `lib/audit/` — the single append-only audit writer
- `app/(seller)/` · `app/(buyer)/` — seller console + buyer room
- `docs/DECISIONS.md` — every architectural decision + rationale
