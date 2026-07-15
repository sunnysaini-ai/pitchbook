# DealDesk — RUNBOOK

How to take this repo from zero to a live buyer room. Written for an operator
who directs the build rather than hand-writing code. Follow top to bottom.

---

## What's built (Chunk 2, this repo)

- **Next.js 15 app** (App Router, React 19, Tailwind v4) — `npm run build` passes clean.
- **Fable-built core** — schema + RLS migrations, permission-filtered hybrid retrieval,
  the analyst prompt + guardrails, the ingestion pipeline (parse → chunk → embed → classify),
  the single append-only audit writer, and the RLS/golden test suites.
- **Seller console** (`/deals/[dealId]`): review queue, documents, buyers.
- **Buyer room** (`/room/[dealId]`): document index + analyst chat.
- **API** per AGENT_SPEC §7 (deals, questions, queue, answer moderation, buyer invite).

## What still needs YOU (nothing here can run without your accounts)

The two release GATES — **T-04** (buyer isolation) and **T-15** (golden refusals Q4–Q8) —
are written but must be run against *your* Supabase + API keys. Steps below.

---

## BLOCKED — OPERATOR ACTION REQUIRED

### 1. Create the accounts + keys (~20 min)
1. **Supabase** → new project. Copy `Project URL`, `anon` key, and `service_role` key
   (Settings → API). The service-role key is a secret — server only.
2. **Anthropic** → console.anthropic.com → API keys → create one. Add a little credit
   (Billing). *This is separate from your Claude Max plan; Max gives no API credit.*
3. **OpenAI** → platform.openai.com → API keys → create one. Add a little credit.
   (Used only for embeddings — cheap.)
4. **LlamaParse** → cloud.llamaindex.ai → API key.

### 2. Wire env (2 min)
```bash
cp .env.example .env.local
# paste the 6 values into .env.local
```

### 3. Install + apply the database (5 min)
```bash
npm install
# Option A — Supabase CLI (recommended):
npx supabase link --project-ref <your-ref>
npx supabase db push          # applies supabase/migrations/0001 + 0002
# Option B — no CLI: open Supabase → SQL Editor → paste 0001_init.sql, Run;
# then paste 0002_rls.sql, Run.
```
Then create the private storage bucket: Supabase → Storage → New bucket →
name `deal-docs`, **uncheck Public**.

> Note: `chunks.embedding` uses `halfvec(3072)` (not `vector`) so the HNSW index
> builds — pgvector caps `vector` HNSW at 2000 dims. This is intentional (DECISIONS #3).

### 4. Run the app
```bash
npm run dev        # http://localhost:3000
```
Sign in with a magic link (check Supabase → Authentication for the email, or use a real inbox).

### 5. Run the GATES (do NOT ship until both are green)
```bash
# T-04 — buyer isolation (INV-2). Needs the 3 Supabase env vars + migrations applied.
npm run test:rls

# T-15 — golden refusals. Seed the Meridian fixture first (supabase/seed/),
# set GOLDEN_DEAL_ID + GOLDEN_BUYER_ID, then:
npm run test:golden
```
Both suites **skip loudly** (not pass) if env is missing — that's by design so a
green run always means the gate actually ran.

### 6. Deploy (10 min)
1. Push this repo to your GitHub (already integrated).
2. Vercel → New Project → import the repo.
3. Add the 6 env vars under Settings → Environment Variables.
4. Deploy. Open a buyer link cold in an incognito window to confirm isolation.

---

## Where things live (so you can direct changes precisely)

| You want to change… | File |
|---|---|
| The analyst's rules / voice | `lib/analyst/prompt.ts` |
| The anti-hallucination guardrails | `lib/analyst/guard.ts` |
| Who can see what (security) | `supabase/migrations/0002_rls.sql` |
| Retrieval quality (how it finds evidence) | `lib/retrieval/search.ts` |
| The data model | `supabase/migrations/0001_init.sql` |
| Seller console screens | `app/(seller)/deals/[dealId]/` + `components/ReviewQueue.tsx` |
| Buyer room | `app/(buyer)/room/[dealId]/` + `components/BuyerChat.tsx` |

## Now built (this iteration)
- **Document upload + auto-ingest** (T-05): seller console → "+ Upload" stores the file and
  runs parse → chunk → embed → classify → ready, with a per-document **AI-access toggle** (INV-3).
- **Citation viewer** (T-12): in the buyer room, `[1]` chips in an answer are clickable and
  open the source document to the cited page with the quoted passage shown.

## Known follow-ups (see the action sheet)
- **Buyer folder-access matrix + revoke button** (T-13): AI toggle is done; the per-buyer
  folder grants UI and one-click revoke are the next seller-console wiring.
- **Activity feed + audit CSV export** (T-14): `doc_view` events are now emitted; the seller
  activity feed and `/audit.csv` export remain.
- **Pixel-level PDF highlight** (T-12 polish): the viewer jumps to the page and shows the quote;
  highlighting the exact span in-page needs a PDF.js text layer.
- **Async questions + SSE streaming** (§7): questions currently resolve synchronously.
- **Object-level storage RLS**: uploads/views are authorized app-layer today (DECISIONS #29).
- **shadcn/ui**: the scaffold uses lightweight CSS primitives; `npx shadcn@latest init` adopts
  the component library the spec names.
