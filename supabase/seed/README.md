# Meridian Logistics — seed fixture

A synthetic sell-side process ("Project Meridian"): a $40M-EV regional 3PL
(contract warehousing, dedicated fleet, brokerage). The corpus is ~25
documents chosen to exercise every ingest and safety failure mode the
platform must survive, plus two buyers with different folder access so the
RLS gate can be demonstrated on realistic data.

`manifest.ts` is the single source of truth. A seed script consumes it in
this order:

1. **Deal** — insert `MERIDIAN_DEAL` (`answer_mode='strict'`), owner = a
   seeded seller user; add that user to `deal_admins`.
2. **Folders** — insert `SEED_FOLDERS` (keys → folder ids kept in a map).
3. **Documents** — for each `SEED_DOCUMENTS` entry:
   - insert the `documents` row (`filename`, `mime_type`, `ai_accessible`,
     folder id from the map, `storage_path = deals/<dealId>/<filename>`);
   - if `pages` present and `expectedStatus='ready'`: run the pages through
     `lib/ingest/chunk.ts` → `lib/ingest/embed.ts`, insert `chunks`, set
     status `ready` (this is the REAL ingest path minus the binary parse);
   - if `expectedStatus='failed'`: set status `failed` with `errorDetail`
     (the scanned lease) — no chunks;
   - write an `ingest.document_ready` / `ingest.parse_failed` audit row via
     `writeAudit` for each.
4. **Buyers** — insert `SEED_BUYERS`, create an auth user per buyer, grant
   `buyer_folder_access` for each `folderKeys` entry. Print/export the deal
   id and the golden buyer's id as `GOLDEN_DEAL_ID` / `GOLDEN_BUYER_ID` for
   `tests/golden.spec.ts`.

No binary fixtures ship in the repo: documents that matter to retrieval
carry synthetic `pages` markdown; the rest are metadata-only.

## The deliberate failure modes

| Document | Failure mode | What it proves |
| --- | --- | --- |
| `Meridian P&L and Balance Sheet FY23-FY25.xlsx` | `multi_sheet_merged_headers` | Multi-sheet workbook with merged fiscal-year header groups. Chunker must chunk **per sheet** and repeat the header row in every chunk so figures keep column meaning (golden #1, #15). |
| `Atlas Freight Master Services Agreement (Executed).pdf` | `change_of_control` | §14.2 change-of-control consent clause buried on page 7. Retrieval must find and cite it (golden #2). |
| `Warehouse Lease - 4800 Fisher Rd Columbus OH (Scanned).pdf` | `scanned_pdf_ocr` | No text layer. Ingest must mark `failed` / `likely_scanned` (avg <50 chars/page), never index an empty document. |
| `Meridian Org Chart June 2025.pdf` | `image_heavy` | Boxes-and-lines graphic; near-zero prose. Exercises low-text extraction without tripping the scan heuristic. |
| `Meridian Cap Table (Fully Diluted).xlsx` | `cap_table` | Precise ownership figures the analyst must reproduce exactly, with citation (golden #13). |
| `Litigation Memo - Delgado v. Meridian (Privileged).pdf` | `restricted_not_ai_accessible` | `ai_accessible=false` **and chunked on purpose**: proves the §5.1 in-SQL filter (INV-3). Golden #5 must refuse without acknowledging the memo exists; `golden.spec.ts#5b` asserts its chunks never enter retrieval. |

## Buyers

- **Crestline Capital Partners** — all folders except `07 Restricted`. This
  is the golden buyer (`GOLDEN_BUYER_ID`).
- **Harbourview Industrial Holdings** — phase-1 access only (no Legal, no
  HR). Crestline↔Harbourview visibility is disjoint enough to re-run the
  INV-2 assertions from `tests/rls.spec.ts` against realistic data.

Neither buyer ever has access to `07 Restricted` — that folder exists for
deal admins, and its one document is additionally `ai_accessible=false`,
so it is doubly unreachable (folder grant AND the retrieval SQL filter).

## Numbers that must stay internally consistent

FY25 revenue **$57.4M**, EBITDA **$5.5M** (P&L sheet, audited statements,
and the EV range $35–45M ≈ 6.4–8.2x EBITDA all agree). If you edit one,
edit all three — golden #1 cites the P&L and cross-checks are cheap for a
model to notice.
