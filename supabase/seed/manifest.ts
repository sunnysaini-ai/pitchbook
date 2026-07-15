/**
 * supabase/seed/manifest.ts
 *
 * The "Meridian Logistics" fixture — a $40M-EV sell-side process for a
 * regional third-party logistics (3PL) company. This manifest DRIVES
 * seeding: a seed script walks DEAL → FOLDERS → DOCUMENTS → BUYERS in
 * order, creating rows and (where `pages` is present) inserting chunks
 * directly through lib/ingest/chunk.ts + lib/ingest/embed.ts, so the
 * golden set (tests/golden.spec.ts) has real retrievable content without
 * shipping binary fixtures in the repo.
 *
 * Deliberate failure modes baked into the corpus (each tagged):
 *   - multi_sheet_merged_headers : P&L + BS workbook with merged header rows
 *   - change_of_control          : contract clause golden case #2 must find
 *   - scanned_pdf_ocr            : lease with no text layer → likely_scanned
 *   - image_heavy                : org chart that parses to almost no text
 *   - cap_table                  : precise ownership figures (golden #13)
 *   - restricted_not_ai_accessible: litigation memo, ai_accessible=false —
 *     INV-3 says the AI must never see it, golden #5 asserts the refusal.
 */

export interface SeedDeal {
  name: string;
  sector: string;
  ev_low: number;
  ev_high: number;
  answer_mode: "strict" | "fast";
}

export interface SeedFolder {
  key: string;
  name: string;
  sort_order: number;
}

export interface SeedPage {
  pageNumber: number;
  markdown: string;
  sheetName?: string;
  sheetHeader?: string;
}

export interface SeedDocument {
  filename: string;
  folderKey: string;
  mimeType: string;
  aiAccessible: boolean;
  /** What this document is, for humans reading the manifest. */
  description: string;
  /** Which ingest/AI failure modes this doc exercises, if any. */
  failureModes?: string[];
  /**
   * Synthetic page content. When present the seed script chunks + embeds it
   * directly and marks the document 'ready'. When absent (or when
   * expectedStatus is 'failed') the document is seeded as metadata only.
   */
  pages?: SeedPage[];
  expectedStatus: "ready" | "failed" | "uploaded";
  errorDetail?: string;
}

export interface SeedBuyer {
  orgName: string;
  contactEmail: string;
  /** Folder keys this buyer may see. NEVER includes "restricted". */
  folderKeys: string[];
  /** The buyer used by tests/golden.spec.ts (GOLDEN_BUYER_ID). */
  goldenBuyer?: boolean;
}

// ---------------------------------------------------------------------------
// Deal
// ---------------------------------------------------------------------------

export const MERIDIAN_DEAL: SeedDeal = {
  name: "Project Meridian — Meridian Logistics Holdings, LLC",
  sector: "Third-party logistics (3PL) — regional contract warehousing & freight",
  ev_low: 35_000_000,
  ev_high: 45_000_000,
  answer_mode: "strict",
};

// ---------------------------------------------------------------------------
// Folder tree (flat VDR top level; parent_id null for all)
// ---------------------------------------------------------------------------

export const SEED_FOLDERS: SeedFolder[] = [
  { key: "corporate", name: "01 Corporate", sort_order: 1 },
  { key: "financials", name: "02 Financials", sort_order: 2 },
  { key: "legal", name: "03 Legal", sort_order: 3 },
  { key: "commercial", name: "04 Commercial", sort_order: 4 },
  { key: "hr", name: "05 HR", sort_order: 5 },
  { key: "technology", name: "06 Technology", sort_order: 6 },
  { key: "restricted", name: "07 Restricted — Advisor Eyes Only", sort_order: 7 },
];

// ---------------------------------------------------------------------------
// Documents (~25)
// ---------------------------------------------------------------------------

const PL_HEADER =
  "| Line Item | FY23 | FY24 | FY25 |\n| --- | --- | --- | --- |";

export const SEED_DOCUMENTS: SeedDocument[] = [
  // ===== 01 Corporate ========================================================
  {
    filename: "Meridian - Corporate Overview.pdf",
    folderKey: "corporate",
    mimeType: "application/pdf",
    aiAccessible: true,
    description: "CIM-style overview: history, footprint, service lines.",
    expectedStatus: "ready",
    pages: [
      {
        pageNumber: 1,
        markdown:
          "# Meridian Logistics Holdings, LLC — Corporate Overview\n\n" +
          "Founded 2009, headquartered in Columbus, Ohio. Meridian provides contract " +
          "warehousing, dedicated fleet, and freight brokerage services to consumer " +
          "products and industrial customers across the Midwest. The company operates " +
          "four warehouses totaling 1.1M sq ft and a fleet of 84 tractors.",
      },
    ],
  },
  {
    filename: "Certificate of Incorporation and Amendments.pdf",
    folderKey: "corporate",
    mimeType: "application/pdf",
    aiAccessible: true,
    description: "Delaware formation documents and LLC agreement amendments.",
    expectedStatus: "ready",
    pages: [
      {
        pageNumber: 1,
        markdown:
          "# Certificate of Formation\n\nMeridian Logistics Holdings, LLC, formed under the " +
          "Delaware Limited Liability Company Act on March 12, 2009. Registered agent: CSC.",
      },
    ],
  },
  {
    filename: "Meridian Cap Table (Fully Diluted).xlsx",
    folderKey: "corporate",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    aiAccessible: true,
    description:
      "Cap table: units by holder, fully diluted, option pool. Golden case #13.",
    failureModes: ["cap_table"],
    expectedStatus: "ready",
    pages: [
      {
        pageNumber: 1,
        sheetName: "Cap Table",
        sheetHeader:
          "| Holder | Class | Units | Fully Diluted % |\n| --- | --- | --- | --- |",
        markdown:
          "## Sheet: Cap Table\n\n" +
          "| Holder | Class | Units | Fully Diluted % |\n| --- | --- | --- | --- |\n" +
          "| Whitacre Family Trust | Class A | 6,200,000 | 62.0% |\n" +
          "| D. Okafor (CEO) | Class A | 1,800,000 | 18.0% |\n" +
          "| Riverbend Growth Partners | Class B | 1,500,000 | 15.0% |\n" +
          "| Employee Option Pool (issued) | Options | 500,000 | 5.0% |\n" +
          "| Total | — | 10,000,000 | 100.0% |",
      },
    ],
  },
  {
    filename: "Board Minutes FY25 (Redacted).pdf",
    folderKey: "corporate",
    mimeType: "application/pdf",
    aiAccessible: true,
    description: "Quarterly board minutes for FY25, customer names redacted.",
    expectedStatus: "ready",
    pages: [
      {
        pageNumber: 1,
        markdown:
          "# Board of Managers — Meeting Minutes FY25\n\nQuarterly meetings held Sep 2024, " +
          "Dec 2024, Mar 2025, Jun 2025. Approved: FY26 budget, warehouse 5 lease " +
          "negotiation mandate, engagement of sell-side advisor.",
      },
    ],
  },

  // ===== 02 Financials =======================================================
  {
    filename: "Meridian P&L and Balance Sheet FY23-FY25.xlsx",
    folderKey: "financials",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    aiAccessible: true,
    description:
      "THE core financials workbook: multi-sheet (P&L, Balance Sheet, Notes) " +
      "with merged header cells spanning fiscal-year column groups — the " +
      "exact shape that breaks naive parsers. Golden cases #1 and #15 cite it.",
    failureModes: ["multi_sheet_merged_headers"],
    expectedStatus: "ready",
    pages: [
      {
        pageNumber: 1,
        sheetName: "P&L",
        sheetHeader: PL_HEADER,
        markdown:
          "## Sheet: P&L\n\n" +
          PL_HEADER +
          "\n| Revenue | $48,900,000 | $52,600,000 | $57,400,000 |" +
          "\n| Cost of services | $38,200,000 | $40,900,000 | $44,300,000 |" +
          "\n| Gross profit | $10,700,000 | $11,700,000 | $13,100,000 |" +
          "\n| Gross margin | 21.9% | 22.2% | 22.8% |" +
          "\n| SG&A | $6,400,000 | $6,900,000 | $7,600,000 |" +
          "\n| EBITDA | $4,300,000 | $4,800,000 | $5,500,000 |" +
          "\n| EBITDA margin | 8.8% | 9.1% | 9.6% |",
      },
      {
        pageNumber: 2,
        sheetName: "Balance Sheet",
        sheetHeader:
          "| Line Item | FY24 | FY25 |\n| --- | --- | --- |",
        markdown:
          "## Sheet: Balance Sheet\n\n" +
          "| Line Item | FY24 | FY25 |\n| --- | --- | --- |\n" +
          "| Cash | $2,100,000 | $2,800,000 |\n" +
          "| Accounts receivable | $6,300,000 | $6,900,000 |\n" +
          "| Net PP&E (fleet, racking) | $9,800,000 | $10,400,000 |\n" +
          "| Total assets | $19,400,000 | $21,600,000 |\n" +
          "| Revolver drawn | $1,500,000 | $1,000,000 |\n" +
          "| Equipment term loan | $4,200,000 | $3,600,000 |\n" +
          "| Members' equity | $9,100,000 | $12,300,000 |",
      },
      {
        pageNumber: 3,
        sheetName: "Notes",
        sheetHeader: "| Note | Detail |\n| --- | --- |",
        markdown:
          "## Sheet: Notes\n\n| Note | Detail |\n| --- | --- |\n" +
          "| 1 | Fiscal year ends June 30. FY25 = twelve months ended June 30, 2025. |\n" +
          "| 2 | Revenue recognized over time as logistics services are performed. |",
      },
    ],
  },
  {
    filename: "FY25 Audited Financial Statements.pdf",
    folderKey: "financials",
    mimeType: "application/pdf",
    aiAccessible: true,
    description: "Audited statements (regional firm), unqualified opinion.",
    expectedStatus: "ready",
    pages: [
      {
        pageNumber: 1,
        markdown:
          "# Independent Auditor's Report — FY25\n\nIn our opinion, the financial statements " +
          "present fairly, in all material respects, the financial position of Meridian " +
          "Logistics Holdings, LLC as of June 30, 2025. Revenue for the year ended June 30, " +
          "2025 was $57.4 million (FY24: $52.6 million).",
      },
    ],
  },
  {
    filename: "Monthly Management Accounts FY26 YTD.xlsx",
    folderKey: "financials",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    aiAccessible: true,
    description: "Month-by-month P&L for FY26 to date (Jul–May).",
    expectedStatus: "ready",
    pages: [
      {
        pageNumber: 1,
        sheetName: "FY26 YTD",
        sheetHeader: "| Month | Revenue | EBITDA |\n| --- | --- | --- |",
        markdown:
          "## Sheet: FY26 YTD\n\n| Month | Revenue | EBITDA |\n| --- | --- | --- |\n" +
          "| Jul 2025 | $4,900,000 | $470,000 |\n| Aug 2025 | $4,850,000 | $455,000 |\n" +
          "| Sep 2025 | $5,100,000 | $505,000 |\n| ... (through May 2026) | — | — |",
      },
    ],
  },
  {
    filename: "Debt Schedule and Facility Agreements Summary.xlsx",
    folderKey: "financials",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    aiAccessible: true,
    description: "Outstanding facilities, rates, maturities, covenants.",
    expectedStatus: "ready",
    pages: [
      {
        pageNumber: 1,
        sheetName: "Debt",
        sheetHeader:
          "| Facility | Lender | Balance (6/30/25) | Rate | Maturity |\n| --- | --- | --- | --- | --- |",
        markdown:
          "## Sheet: Debt\n\n" +
          "| Facility | Lender | Balance (6/30/25) | Rate | Maturity |\n| --- | --- | --- | --- | --- |\n" +
          "| Revolver ($5.0M commitment) | Huntington | $1,000,000 | SOFR+2.50% | Nov 2027 |\n" +
          "| Equipment term loan | Huntington | $3,600,000 | 6.85% fixed | Mar 2029 |",
      },
    ],
  },
  {
    filename: "Working Capital Analysis.xlsx",
    folderKey: "financials",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    aiAccessible: true,
    description: "12-month NWC build with peg proposal.",
    expectedStatus: "ready",
    pages: [
      {
        pageNumber: 1,
        sheetName: "NWC",
        sheetHeader: "| Month | AR | AP | Accrued | NWC |\n| --- | --- | --- | --- | --- |",
        markdown:
          "## Sheet: NWC\n\n| Month | AR | AP | Accrued | NWC |\n| --- | --- | --- | --- | --- |\n" +
          "| Jun 2025 | $6,900,000 | $3,300,000 | $1,100,000 | $2,500,000 |\n" +
          "| Trailing 12-month average NWC | — | — | — | $2,350,000 |",
      },
    ],
  },
  {
    filename: "Fixed Asset and Fleet Register.xlsx",
    folderKey: "financials",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    aiAccessible: true,
    description: "Tractors, trailers, forklifts, racking; age and NBV.",
    expectedStatus: "ready",
    pages: [
      {
        pageNumber: 1,
        sheetName: "Fleet",
        sheetHeader:
          "| Asset class | Count | Avg age (yrs) | NBV |\n| --- | --- | --- | --- |",
        markdown:
          "## Sheet: Fleet\n\n| Asset class | Count | Avg age (yrs) | NBV |\n| --- | --- | --- | --- |\n" +
          "| Tractors | 84 | 3.8 | $5,900,000 |\n| Trailers | 210 | 6.1 | $2,700,000 |\n" +
          "| Forklifts | 62 | 4.5 | $800,000 |",
      },
    ],
  },

  // ===== 03 Legal ============================================================
  {
    filename: "Atlas Freight Master Services Agreement (Executed).pdf",
    folderKey: "legal",
    mimeType: "application/pdf",
    aiAccessible: true,
    description:
      "MSA with largest customer Atlas Freight Systems. Section 14.2 is a " +
      "change-of-control consent clause — golden case #2 must find and cite it.",
    failureModes: ["change_of_control"],
    expectedStatus: "ready",
    pages: [
      {
        pageNumber: 1,
        markdown:
          "# Master Services Agreement — Atlas Freight Systems, Inc. and Meridian Logistics\n\n" +
          "Effective January 1, 2023. Initial term three (3) years, auto-renewing for " +
          "successive one-year terms. Dedicated warehousing (Columbus DC-2) and " +
          "transportation services.",
      },
      {
        pageNumber: 7,
        markdown:
          "## Section 14 — Assignment; Change of Control\n\n" +
          "14.1 Neither party may assign this Agreement without the prior written consent " +
          "of the other party.\n\n" +
          "14.2 A Change of Control of Service Provider — meaning any transaction or series " +
          "of transactions resulting in the transfer of more than fifty percent (50%) of the " +
          "voting interests of Service Provider — shall be deemed an assignment requiring " +
          "Customer's prior written consent, such consent not to be unreasonably withheld. " +
          "Failure to obtain such consent entitles Customer to terminate this Agreement on " +
          "ninety (90) days' written notice.",
      },
    ],
  },
  {
    filename: "Warehouse Lease - 4800 Fisher Rd Columbus OH (Scanned).pdf",
    folderKey: "legal",
    mimeType: "application/pdf",
    aiAccessible: true,
    description:
      "1998-vintage scanned lease, photocopied — NO text layer. Ingest must " +
      "flag it failed/'likely_scanned' and route it to OCR, never index it empty.",
    failureModes: ["scanned_pdf_ocr"],
    expectedStatus: "failed",
    errorDetail:
      "likely_scanned: average 11.2 chars/page across 42 pages — below the 50 " +
      "threshold. OCR required.",
  },
  {
    filename: "Insurance Policy Schedule FY26.pdf",
    folderKey: "legal",
    mimeType: "application/pdf",
    aiAccessible: true,
    description: "Auto liability, cargo, warehouse legal liability, umbrella.",
    expectedStatus: "ready",
    pages: [
      {
        pageNumber: 1,
        markdown:
          "# Insurance Schedule FY26\n\nAuto liability $1M/$2M (Great West). Motor truck cargo " +
          "$250k per occurrence. Warehouse legal liability $2M. Umbrella $10M (Chubb). " +
          "All policies current; renewal date September 1, 2026.",
      },
    ],
  },
  {
    filename: "IP and Trademark Register.pdf",
    folderKey: "legal",
    mimeType: "application/pdf",
    aiAccessible: true,
    description: "Registered marks and domain portfolio.",
    expectedStatus: "ready",
    pages: [
      {
        pageNumber: 1,
        markdown:
          '# IP Register\n\nUS trademark "MERIDIAN LOGISTICS" (Reg. 5,842,113, Class 39). ' +
          "Domains: meridianlogistics.com and 6 defensive variants. No patents.",
      },
    ],
  },
  {
    filename: "Supplier and Carrier Agreements Summary.pdf",
    folderKey: "legal",
    mimeType: "application/pdf",
    aiAccessible: true,
    description: "Top 15 carrier/vendor agreements, terms, termination rights.",
    expectedStatus: "ready",
    pages: [
      {
        pageNumber: 1,
        markdown:
          "# Carrier & Supplier Agreements Summary\n\n15 material agreements. Standard 30–60 day " +
          "termination for convenience. No supplier exceeds 8% of cost of services. No " +
          "change-of-control provisions in carrier agreements.",
      },
    ],
  },

  // ===== 04 Commercial =======================================================
  {
    filename: "Customer Concentration Analysis FY25.xlsx",
    folderKey: "commercial",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    aiAccessible: true,
    description: "Revenue by customer, top-10 concentration. Golden case #3/#11.",
    expectedStatus: "ready",
    pages: [
      {
        pageNumber: 1,
        sheetName: "Concentration",
        sheetHeader:
          "| Customer | FY25 Revenue | % of Total |\n| --- | --- | --- |",
        markdown:
          "## Sheet: Concentration\n\n| Customer | FY25 Revenue | % of Total |\n| --- | --- | --- |\n" +
          "| Atlas Freight Systems | $13,200,000 | 23.0% |\n" +
          "| Buckeye Consumer Brands | $6,900,000 | 12.0% |\n" +
          "| Lakeshore Industrial | $4,600,000 | 8.0% |\n" +
          "| Hartwell Foods | $3,400,000 | 5.9% |\n" +
          "| Portside Retail Group | $2,900,000 | 5.1% |\n" +
          "| Top 5 subtotal | $31,000,000 | 54.0% |\n" +
          "| All other (~60 accounts) | $26,400,000 | 46.0% |",
      },
    ],
  },
  {
    filename: "Top 20 Customer Contracts Summary.pdf",
    folderKey: "commercial",
    mimeType: "application/pdf",
    aiAccessible: true,
    description: "Term, renewal, pricing mechanism per top-20 account.",
    expectedStatus: "ready",
    pages: [
      {
        pageNumber: 1,
        markdown:
          "# Top 20 Customer Contracts\n\nWeighted average remaining term 1.9 years. 14 of 20 " +
          "auto-renew. Annual CPI-linked rate escalators in 11 of 20. Only the Atlas Freight " +
          "MSA contains a change-of-control consent requirement.",
      },
    ],
  },
  {
    filename: "Pricing and Rate Card 2026.pdf",
    folderKey: "commercial",
    mimeType: "application/pdf",
    aiAccessible: true,
    description: "Standard storage/handling/transportation rates.",
    expectedStatus: "ready",
    pages: [
      {
        pageNumber: 1,
        markdown:
          "# 2026 Rate Card\n\nStorage: $14.50/pallet/month. Handling: $4.25 in / $3.75 out. " +
          "Dedicated fleet: $92/hour all-in. Brokerage margin target: 14%.",
      },
    ],
  },
  {
    filename: "Churn and Retention Analysis FY23-FY25.pdf",
    folderKey: "commercial",
    mimeType: "application/pdf",
    aiAccessible: true,
    description: "Logo and revenue retention by cohort. Golden case #20.",
    expectedStatus: "ready",
    pages: [
      {
        pageNumber: 1,
        markdown:
          "# Churn & Retention\n\nGross revenue retention: FY23 94.1%, FY24 95.3%, FY25 96.0%. " +
          "Logo churn FY25: 4 accounts (all sub-$200k). Net revenue retention FY25: 104.7%.",
      },
    ],
  },
  {
    filename: "Sales Pipeline Snapshot Q4 FY25.xlsx",
    folderKey: "commercial",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    aiAccessible: true,
    description: "Weighted pipeline by stage (historical snapshot, not a projection).",
    expectedStatus: "ready",
    pages: [
      {
        pageNumber: 1,
        sheetName: "Pipeline",
        sheetHeader:
          "| Opportunity | Stage | Annual value | Weighted |\n| --- | --- | --- | --- |",
        markdown:
          "## Sheet: Pipeline\n\n| Opportunity | Stage | Annual value | Weighted |\n| --- | --- | --- | --- |\n" +
          "| Midwest DTC apparel co. | Proposal | $1,800,000 | $900,000 |\n" +
          "| Industrial fastener OEM | Qualified | $1,100,000 | $330,000 |",
      },
    ],
  },

  // ===== 05 HR ===============================================================
  {
    filename: "Meridian Org Chart June 2025.pdf",
    folderKey: "hr",
    mimeType: "application/pdf",
    aiAccessible: true,
    description:
      "Image-heavy org chart (boxes-and-lines graphic exported to PDF). " +
      "Parses to almost no text — exercises the low-text path without being " +
      "a scan; LlamaParse extracts the box labels below.",
    failureModes: ["image_heavy"],
    expectedStatus: "ready",
    pages: [
      {
        pageNumber: 1,
        markdown:
          "# Organization Chart — June 2025\n\nCEO: D. Okafor. CFO: L. Marsh. VP Operations: " +
          "T. Reyes (4 warehouse GMs). VP Sales: K. Adler. Director of IT: S. Pham. " +
          "Total headcount: 412 FTE (348 warehouse/driver, 64 salaried).",
      },
    ],
  },
  {
    filename: "Employee Census (De-identified).xlsx",
    folderKey: "hr",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    aiAccessible: true,
    description: "Headcount by function, tenure, comp bands. No PII.",
    expectedStatus: "ready",
    pages: [
      {
        pageNumber: 1,
        sheetName: "Census",
        sheetHeader:
          "| Function | Headcount | Avg tenure (yrs) | Comp band |\n| --- | --- | --- | --- |",
        markdown:
          "## Sheet: Census\n\n| Function | Headcount | Avg tenure (yrs) | Comp band |\n| --- | --- | --- | --- |\n" +
          "| Warehouse associates | 296 | 3.2 | $38k–$52k |\n" +
          "| Drivers (CDL) | 52 | 4.6 | $62k–$78k |\n" +
          "| Salaried/admin | 64 | 5.1 | $55k–$180k |\n" +
          "| Total | 412 | — | — |",
      },
    ],
  },
  {
    filename: "Key Employment Agreements Summary.pdf",
    folderKey: "hr",
    mimeType: "application/pdf",
    aiAccessible: true,
    description: "CEO/CFO/VP agreements: severance, non-competes, retention.",
    expectedStatus: "ready",
    pages: [
      {
        pageNumber: 1,
        markdown:
          "# Key Employment Agreements\n\nCEO and CFO: 12-month severance on termination " +
          "without cause; 24-month non-compete. VP-level: 6-month severance. No " +
          "single-trigger change-of-control payments.",
      },
    ],
  },

  // ===== 06 Technology =======================================================
  {
    filename: "Technology Stack Overview.pdf",
    folderKey: "technology",
    mimeType: "application/pdf",
    aiAccessible: true,
    description: "Systems map: WMS, TMS, finance, integrations.",
    expectedStatus: "ready",
    pages: [
      {
        pageNumber: 1,
        markdown:
          "# Technology Stack\n\nWMS: Körber (HighJump) hosted, upgraded 2023. TMS: McLeod. " +
          "Finance: Sage Intacct. EDI via SPS Commerce with top 12 customers. " +
          "No custom software of material value.",
      },
    ],
  },
  {
    filename: "WMS Implementation and Security Overview.pdf",
    folderKey: "technology",
    mimeType: "application/pdf",
    aiAccessible: true,
    description: "Hosting, backup/DR, access control, incident history.",
    expectedStatus: "ready",
    pages: [
      {
        pageNumber: 1,
        markdown:
          "# WMS & Security Overview\n\nWMS hosted in vendor cloud, 99.8% uptime FY25. Nightly " +
          "backups, 4-hour RPO. MFA enforced for remote access. One ransomware attempt " +
          "(Feb 2024) blocked at endpoint; no data loss, disclosed to insurer.",
      },
    ],
  },

  // ===== 07 Restricted — advisor eyes only ==================================
  {
    filename: "Litigation Memo - Delgado v. Meridian (Privileged).pdf",
    folderKey: "restricted",
    mimeType: "application/pdf",
    aiAccessible: false, // INV-3: the AI must NEVER retrieve this document.
    description:
      "Privileged counsel memo on a pending wage-and-hour class claim. " +
      "Seeded WITH content and WITH chunks on purpose: the INV-3 test is " +
      "that retrieval can never surface them (ai_accessible=false is " +
      "filtered inside the SQL), and golden case #5 must come back as a " +
      "refusal that does not acknowledge the memo exists.",
    failureModes: ["restricted_not_ai_accessible"],
    expectedStatus: "ready",
    pages: [
      {
        pageNumber: 1,
        markdown:
          "# PRIVILEGED & CONFIDENTIAL — Attorney Work Product\n\n" +
          "Delgado v. Meridian Logistics Holdings, LLC (S.D. Ohio). Putative class of " +
          "warehouse associates alleging unpaid donning/doffing time. Counsel estimates " +
          "exposure range $600k–$1.4M; mediation scheduled October 2026. " +
          "THIS CONTENT MUST NEVER APPEAR IN ANY AI ANSWER.",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Buyers — disjoint from "restricted" always; buyer 2 gets a narrower slice
// so the two-buyer RLS gate (tests/rls.spec.ts pattern) holds on this deal too.
// ---------------------------------------------------------------------------

export const SEED_BUYERS: SeedBuyer[] = [
  {
    orgName: "Crestline Capital Partners",
    contactEmail: "diligence@crestlinecap.example.com",
    folderKeys: ["corporate", "financials", "legal", "commercial", "hr", "technology"],
    goldenBuyer: true, // export its buyers.id as GOLDEN_BUYER_ID
  },
  {
    orgName: "Harbourview Industrial Holdings",
    contactEmail: "deals@harbourview.example.com",
    // Phase-1 access only: no HR, no Legal.
    folderKeys: ["corporate", "financials", "commercial", "technology"],
  },
];

/** Documents seeded per folder — convenience for the seed script's audit trail. */
export const SEED_DOC_COUNT = SEED_DOCUMENTS.length;
