# DealDesk core — architectural decisions (Chunk 2)

Each entry: decision → one-line rationale.

> Decisions 22–27 (scaffold layer) are appended at the end of this file.

1. **Hand-written `Database` type lives in `lib/db/server.ts`; admin/browser import it with `import type`** — the file boundary forbids a separate `lib/db/types.ts`, and type-only imports are erased at compile so the `next/headers` import never leaks into non-Next contexts.

2. **Retrieval RPCs (`search_chunks_vector`, `search_chunks_fts`) live in `supabase/migrations/0002_rls.sql`** — the §5.1 permission filter is a security control enforced in SQL, so it belongs in the security migration; supabase-js cannot run raw SQL, so the filter ships as `security definer` functions with EXECUTE revoked from `anon`/`authenticated` (service-role worker only).

3. **`0001_init.sql` transcribed verbatim, including `hnsw` on `vector(3072)` — flagged risk** — pgvector's HNSW index caps the `vector` type at 2,000 dimensions, so this index will fail to build on stock pgvector; spec owner should choose `halfvec(3072)` + `halfvec_cosine_ops` or drop to no index / IVFFlat. Transcribed anyway because the spec says verbatim.

4. **Anthropic/OpenAI called via raw `fetch`, with a small private wrapper duplicated in classify/search/answer** — the file boundary allows no shared HTTP module, retry/backoff policy must be ours, and ~25 duplicated lines beat a wrong dependency edge (retrieval importing analyst or vice versa).

5. **Token counting = `ceil(chars/4)`** — no tokenizer is in the pinned stack; the heuristic is conservative and the 1,200-token hard max leaves ample headroom under model limits.

6. **`audit_log` immutability is triple-enforced: no UPDATE/DELETE policy + hard `REVOKE` + a `BEFORE` trigger that raises** — "no policy" alone doesn't bind the service role (it bypasses RLS); the trigger makes history immutable for everyone (INV-4).

7. **A single `ESCALATION_COPY` constant is the only body ever written for ungrounded/failed/escalated answers** — no AI prose can reach a buyer through a failure path, and golden refusal tests can assert equality, not vibes.

8. **The answer worker (`lib/analyst/answer.ts`) runs on the service-role client** — buyers have no INSERT policy on `answers` and drafts must exist before approval; buyer *visibility* remains 100% RLS-governed (INV-5), the worker only writes.

9. **Rerank fails closed** — if haiku returns unparseable scores after one retry, every candidate is left unscored, the post-rerank set is empty, and the groundedness gate refuses (INV-1 beats availability).

10. **Guard owns the retry loop (`guardedGenerate`) and its own audit writes** — §6.2's "retry once, fabricated quote never retries, log ai.quote_fabricated severity high" is policy that must be impossible to skip by calling the checks à la carte.

11. **`writeAudit` validates that AI-generation actions carry prompt+model+chunk_ids+raw_completion and human edits carry the diff, and throws otherwise** — INV-4 is a payload-completeness guarantee, not just a row-exists guarantee; a failed audit write fails the operation it records.

12. **Spreadsheets never go to LlamaParse; they parse locally via `xlsx`, one logical page per sheet with the header row captured separately** — chunk-per-sheet with the header repeated in every chunk (merged-header P&Ls keep column meaning) requires structure LlamaParse's markdown flattens.

13. **Scanned-PDF heuristic (<50 avg chars/page → `likely_scanned`) is applied AFTER whichever parser ran** — a scan fails identically whether LlamaParse or unpdf extracted it, and an empty index entry is worse than a failed status.

14. **`classifyDocument` falls back to `"Other"` on unparseable output** — the category is metadata, never a buyer-visible factual claim, so a wrong-but-safe label beats blocking ingest (the raw completion is still audited).

15. **Model refusals (`grounded=false` or `escalate=true` in valid output) persist as `status='escalated'` with the standard copy, not as the model's own text** — INV-6 says refusal is a correct output, but even refusal prose is unreviewed AI text and stays out of buyer view.

16. **Query embeddings cross the RPC boundary as pgvector literal strings (`[0.1,...]`)** — PostgREST has no native vector parameter type; the literal is cast server-side by the function signature.

17. **Seed litigation memo is chunked ON PURPOSE despite `ai_accessible=false`** — INV-3 must be proven against real rows in the index, not by the memo conveniently having no chunks; `golden.spec.ts#5b` asserts retrieval can never surface them.

18. **Tests construct raw `@supabase/supabase-js` clients instead of importing `lib/db/*`** — `lib/db/admin.ts` imports `server-only` (correct for prod) which throws under vitest; the app scaffold's vitest config should alias `server-only` to a no-op if it ever needs the real modules in tests.

19. **RLS tests assert both directions** — Buyer A sees 0 of Buyer B's rows on every scoped table AND can read their own grants, so a policy that denies everything can't masquerade as isolation.

20. **`answers_buyer_read` grants visibility on `approved`/`released` regardless of mode, plus everything in `fast` mode** — encodes INV-5 exactly: in `strict` mode nothing short of approval is visible, and the check lives in the policy, not the UI.

21. **Ungrounded questions still produce an `answers` row (`status='escalated'`)** — the buyer needs a stable "we're on it" artifact, the deal team needs a queue item, and the audit trail needs a subject id.

---

## Scaffold decisions (Opus — Next.js 15 app layer)

22. **`chunks.embedding` changed `vector(3072)` → `halfvec(3072)`** (resolves the flagged risk in #3). pgvector's HNSW index caps `vector` at 2000 dims; `halfvec` supports up to 4000. Retrieval RPCs cast the query with `::halfvec(3072)`. The one deviation from the "verbatim" schema — made because the verbatim version fails at migration time.

23. **`@supabase/supabase-js` pinned to exactly `2.45.4`** — 2.110+ tightened the `GenericSchema` generic so the hand-written `Database` type degraded every `.from()` to `never`. Pinning restores type inference. Revisit when regenerating types from the live DB via `supabase gen types`.

24. **Buyer questions resolve synchronously** (not the §7 async-job + SSE stream). The trust-critical path — retrieval → groundedness gate → guarded generation → audited answer — is complete; streaming is a UX layer deferred so the gates could be reached first.

25. **Lightweight CSS primitives instead of shadcn/ui for the scaffold** — keeps the build dependency-light and green now. shadcn is the intended path (`npx shadcn@latest init`).

26. **Tailwind v4 component classes written as plain CSS** — v4's `@apply` does not compose custom class names; pages still use Tailwind utilities directly.

27. **Verification in this environment:** `tsc --noEmit` clean, `next build` clean, `vitest` loads both gate suites and skips-with-reason (no silent pass). DB-dependent gates T-04/T-15 must be run by the operator against live Supabase (see RUNBOOK).

28. **Ingestion runs synchronously inside `POST …/documents/[docId]/ingest`** (`lib/ingest/run.ts`) — the orchestrator body is the future Edge Function + pg_cron worker (§4) and moves behind a queue unchanged. Idempotent: it deletes prior chunks before re-inserting, so retries are safe.

29. **Object-level storage authorization is app-layer (service role + deal-admin/RLS check), not storage RLS policies** — AGENT_SPEC's storage section didn't specify object policies. Uploads/downloads use the service role *after* the route authorizes the caller (deal admin for upload; the RLS-scoped `documents` SELECT for buyer view). Adding `storage.objects` RLS keyed on `<dealId>` path is a recommended hardening follow-up.

30. **Citation resolution (T-12) uses a signed-URL iframe with `#page=N` + a quote callout** — resolves to the correct document and jumps to the cited page natively (PDFs), with the verbatim cited passage shown. Pixel-level in-page highlight needs a PDF.js text layer and is a follow-up; the trust requirement (verifiable source at the right page) is met now.

31. **BUGFIX (found in production): browser client env vars must be STATIC `process.env.NEXT_PUBLIC_*` accesses** — `lib/db/browser.ts` originally read them via a dynamic `process.env[name]` helper. Next.js only inlines NEXT_PUBLIC_ vars into the client bundle for static member expressions; the dynamic form compiles to a runtime read that is always undefined in the browser, so sign-in threw "Missing required environment variable" on every deploy regardless of correct Vercel settings. Diagnostic tell: the `page-*.js` chunk hash never changed across builds. Server-side dynamic reads (admin.ts, server.ts) are fine — Node has a runtime env.

32. **Guard check 1 strips a wrapping markdown code fence before `JSON.parse`** (`stripCodeFence`, `lib/analyst/guard.ts`). Found running T-15 live: claude-sonnet-4-6 fences its JSON (```json … ```) often enough that grounded golden cases (#1, #2, #13, #20) hard-failed to escalation on a formatting artifact, despite the underlying JSON and citations being valid. The fence carries no content; checks 2–5 run unchanged on the parsed object, so no guard property is weakened.

33. **Check 5 (quote-verbatim) normalizes pipe runs, not just whitespace** (`normalizeForQuoteCheck`). Found via golden #13: quoting consecutive markdown-table rows serializes as `… 62.0% | D. Okafor …` while the chunk contains `… 62.0% |\n| D. Okafor …` — whitespace normalization alone yields `| |` vs `|` and flags a faithful, in-order quote as fabricated. Collapsing any pipes-and-whitespace run to a single `|` equates table row and cell boundaries for comparison ONLY; cell text must still match exactly, in order, contiguously — an invented value or a row-skipping stitch still hard-fails.

34. **`scripts/seed.ts` seeds the Meridian fixture per `supabase/seed/README.md`** — walks the manifest (deal → folders → documents → chunks via the real `chunkDocument` + `embedTexts` path → buyers + auth users + folder grants), writes `ingest.*` audit rows, is idempotent (re-run prints the existing GOLDEN_DEAL_ID/GOLDEN_BUYER_ID), and never touches storage (synthetic pages only, per the manifest's no-binaries design).

35. **GATES RUN GREEN against live Supabase (2026-07-15, project tdpwcblukcxevyerfiyh):** T-04 `test:rls` 10/10 passed — Buyer A sees 0 rows across all Buyer-B-scoped tables. T-15 `test:golden` 21/21 passed — Q1–Q3 grounded with resolvable citations, Q4–Q8 (+#17–19) all refuse with the standard escalation copy, and #5b proves litigation-memo chunks are unreachable by retrieval (INV-3). Fixture: 25 docs ready (28 chunks embedded), scanned lease correctly `failed`, two buyers with disjoint access.

36. **T-13/T-14 (seller buyer management + activity/audit) complete.** Added three RLS-bound route handlers: `POST …/buyers/:buyerId/revoke` (idempotent — an already-revoked buyer keeps its original `revoked_at` rather than bumping it), `PUT …/buyers/:buyerId/access` (wholesale delete+insert of `buyer_folder_access`, deny-by-default so `folder_ids: []` is a valid "revoke all folders" call), and a batched `GET …/buyers/access` that returns every buyer's grants in one round trip (added at `buyers/access` rather than per-buyer, per §7's spirit — the seller console renders the whole matrix at once, not one buyer at a time) so the console doesn't fan out N requests. `GET …/audit.csv` streams the full `audit_log` as RFC-4180 CSV, gated by `requireDealAdmin` for a clean 403 ahead of the `audit_admin_read` RLS policy that would otherwise just return zero rows. Two action names joined the closed `auditActionSchema` vocabulary: `human.buyer_revoked`, `human.buyer_access_changed`. UI: `components/BuyerManager.tsx` replaces the read-only buyers list on the seller console with invite + per-buyer folder-access checkboxes + two-click revoke (no `confirm()`, matching the rest of the console's restrained tone); the seller page gained a server-rendered activity feed (last 50 `activity_events`, labeled via the already-fetched buyers/documents arrays rather than a joined query) with a "Download audit CSV" link. `npm run typecheck` and `npm run build` both clean; `tests/rls.spec.ts` (untouched, not modified) skips with its documented reason in this shell (no live Supabase env) rather than failing to compile.

37. **User turn carries mechanical citation-quoting rules** (`buildUserTurn`, lib/analyst/prompt.ts). Found on the production deploy: asked for two figures at once ("FY25 revenue and EBITDA"), the model quoted the P&L table by stitching non-adjacent cells with "..." — check 5 correctly hard-failed it (fabricated-quote path, no retry, per §6.2) and the answer escalated. The §6.1 system prompt is untouched (spec: verbatim); the user turn now states that each quote must be one contiguous ≤240-char span from a single excerpt, never ellipsis-joined — use multiple citations instead. Full golden set re-run green (21/21) after the change.

38. **Deal creation bootstraps the first `deal_admins` row via the service role** (app/api/deals/route.ts). Found by Sunny creating a real deal: `deal_admins_admin_all`'s WITH CHECK requires `is_deal_admin(deal_id)`, but the row being inserted IS the first admin row — an RLS chicken-and-egg the fixture never hit (seeding used the service role). Authorization is proven, not assumed: the preceding `deals` insert runs under the caller's RLS-bound client with `owner_id = auth.uid()`, so the deal's existence proves the caller owns it. Migration `0003_deal_admin_bootstrap.sql` (written, not yet applied) adds an owner-bootstrap insert policy; once applied, the service-role step can revert to the RLS client. Also fixed `fail()` in lib/api.ts to surface `.message` from non-Error objects (PostgrestError) — the original symptom was an opaque "Unknown error".
