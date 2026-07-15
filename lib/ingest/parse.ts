/**
 * lib/ingest/parse.ts
 *
 * Document → page-anchored markdown.
 *
 * Strategy:
 *   1. LlamaParse (markdown mode, JSON result so every page carries its page
 *      number — page anchors are load-bearing for citations).
 *   2. Fallbacks by mime type when LlamaParse is unavailable or fails:
 *        - PDF   → unpdf (per-page text extraction)
 *        - XLSX  → xlsx (one logical "page" per sheet, header row preserved)
 *        - DOCX  → mammoth (raw text, single page)
 *   3. Scanned-PDF heuristic: if the average extracted characters per page
 *      is < 50, the file is almost certainly a scan with no text layer —
 *      mark it failed with reason 'likely_scanned' so the UI can route it
 *      to OCR instead of silently indexing an empty document.
 */

const LLAMAPARSE_BASE = "https://api.cloud.llamaindex.ai/api/parsing";
const LIKELY_SCANNED_AVG_CHARS_PER_PAGE = 50;
const LLAMAPARSE_POLL_INTERVAL_MS = 2_000;
const LLAMAPARSE_POLL_TIMEOUT_MS = 10 * 60_000;

export interface ParsedPage {
  /** 1-based page number. For spreadsheets, the 1-based sheet index. */
  pageNumber: number;
  /** Markdown content of the page. */
  markdown: string;
  /** Present only for spreadsheet sheets. */
  sheetName?: string;
  /**
   * Present only for spreadsheet sheets: the rendered header row, which the
   * chunker must prepend to every chunk cut from this sheet.
   */
  sheetHeader?: string;
}

export type ParserName = "llamaparse" | "unpdf" | "xlsx" | "mammoth";

export type ParseResult =
  | {
      ok: true;
      parser: ParserName;
      pages: ParsedPage[];
      pageCount: number;
    }
  | {
      ok: false;
      /** Maps onto documents.status='failed' + documents.error_detail. */
      reason: "likely_scanned" | "unsupported_mime" | "parse_error";
      detail: string;
    };

export interface ParseInput {
  /** Raw file bytes. */
  data: Uint8Array;
  filename: string;
  mimeType: string;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function parseDocument(input: ParseInput): Promise<ParseResult> {
  // Spreadsheets never go to LlamaParse: sheet structure and header rows
  // must survive intact for chunk-per-sheet chunking.
  if (isSpreadsheet(input.mimeType, input.filename)) {
    return parseWithXlsx(input);
  }

  if (process.env.LLAMA_CLOUD_API_KEY) {
    try {
      const result = await parseWithLlamaParse(input);
      return applyScannedHeuristic(result);
    } catch (err) {
      // Fall through to the local fallback for this mime type.
      // (The caller's worker logs this via writeAudit ingest.parse_failed
      // only if the fallback also fails.)
      console.error(
        `LlamaParse failed for ${input.filename}, trying fallback:`,
        err,
      );
    }
  }

  if (isPdf(input.mimeType, input.filename)) {
    return applyScannedHeuristic(await parseWithUnpdf(input));
  }
  if (isDocx(input.mimeType, input.filename)) {
    return parseWithMammoth(input);
  }
  return {
    ok: false,
    reason: "unsupported_mime",
    detail: `No parser available for mime type ${input.mimeType} (${input.filename}) without LLAMA_CLOUD_API_KEY.`,
  };
}

// ---------------------------------------------------------------------------
// Heuristics / mime detection
// ---------------------------------------------------------------------------

function isPdf(mime: string, filename: string): boolean {
  return mime === "application/pdf" || filename.toLowerCase().endsWith(".pdf");
}

function isDocx(mime: string, filename: string): boolean {
  return (
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    filename.toLowerCase().endsWith(".docx")
  );
}

function isSpreadsheet(mime: string, filename: string): boolean {
  const f = filename.toLowerCase();
  return (
    mime ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mime === "application/vnd.ms-excel" ||
    f.endsWith(".xlsx") ||
    f.endsWith(".xls") ||
    f.endsWith(".csv")
  );
}

function applyScannedHeuristic(result: ParseResult): ParseResult {
  if (!result.ok) return result;
  const totalChars = result.pages.reduce((s, p) => s + p.markdown.length, 0);
  const avg = result.pages.length === 0 ? 0 : totalChars / result.pages.length;
  if (avg < LIKELY_SCANNED_AVG_CHARS_PER_PAGE) {
    return {
      ok: false,
      reason: "likely_scanned",
      detail:
        `Average ${avg.toFixed(1)} chars/page across ${result.pages.length} ` +
        `page(s) — below the ${LIKELY_SCANNED_AVG_CHARS_PER_PAGE} threshold. ` +
        `This file is likely a scan without a text layer; OCR is required.`,
    };
  }
  return result;
}

// ---------------------------------------------------------------------------
// LlamaParse (primary)
// ---------------------------------------------------------------------------

interface LlamaParseJsonPage {
  page: number;
  md?: string;
  text?: string;
}

async function parseWithLlamaParse(input: ParseInput): Promise<ParseResult> {
  const apiKey = process.env.LLAMA_CLOUD_API_KEY;
  if (!apiKey) {
    throw new Error(
      "LLAMA_CLOUD_API_KEY is not set — cannot call LlamaParse.",
    );
  }
  const headers = { Authorization: `Bearer ${apiKey}` };

  // 1. Upload
  const form = new FormData();
  form.append(
    "file",
    new Blob([input.data as BlobPart], { type: input.mimeType }),
    input.filename,
  );
  form.append("result_type", "markdown");
  const uploadRes = await fetch(`${LLAMAPARSE_BASE}/upload`, {
    method: "POST",
    headers,
    body: form,
  });
  if (!uploadRes.ok) {
    throw new Error(
      `LlamaParse upload failed: ${uploadRes.status} ${await uploadRes.text()}`,
    );
  }
  const { id: jobId } = (await uploadRes.json()) as { id: string };

  // 2. Poll
  const deadline = Date.now() + LLAMAPARSE_POLL_TIMEOUT_MS;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(`LlamaParse job ${jobId} timed out.`);
    }
    const statusRes = await fetch(`${LLAMAPARSE_BASE}/job/${jobId}`, {
      headers,
    });
    if (!statusRes.ok) {
      throw new Error(`LlamaParse status check failed: ${statusRes.status}`);
    }
    const { status } = (await statusRes.json()) as { status: string };
    if (status === "SUCCESS") break;
    if (status === "ERROR" || status === "CANCELED") {
      throw new Error(`LlamaParse job ${jobId} ended with status ${status}.`);
    }
    await sleep(LLAMAPARSE_POLL_INTERVAL_MS);
  }

  // 3. Fetch the JSON result — it carries per-page markdown with page numbers
  //    (page anchors), which the plain markdown endpoint flattens away.
  const resultRes = await fetch(
    `${LLAMAPARSE_BASE}/job/${jobId}/result/json`,
    { headers },
  );
  if (!resultRes.ok) {
    throw new Error(`LlamaParse result fetch failed: ${resultRes.status}`);
  }
  const body = (await resultRes.json()) as { pages: LlamaParseJsonPage[] };
  const pages: ParsedPage[] = body.pages.map((p) => ({
    pageNumber: p.page,
    markdown: (p.md ?? p.text ?? "").trim(),
  }));
  return { ok: true, parser: "llamaparse", pages, pageCount: pages.length };
}

// ---------------------------------------------------------------------------
// Fallback: unpdf (PDF)
// ---------------------------------------------------------------------------

async function parseWithUnpdf(input: ParseInput): Promise<ParseResult> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  const pdf = await getDocumentProxy(input.data);
  const { text } = await extractText(pdf, { mergePages: false });
  const pageTexts: string[] = Array.isArray(text) ? text : [text];
  const pages: ParsedPage[] = pageTexts.map((t, i) => ({
    pageNumber: i + 1,
    markdown: t.trim(),
  }));
  return { ok: true, parser: "unpdf", pages, pageCount: pages.length };
}

// ---------------------------------------------------------------------------
// Fallback: xlsx (spreadsheets) — one logical page per sheet, markdown table,
// header row captured separately so the chunker can repeat it in every chunk.
// ---------------------------------------------------------------------------

async function parseWithXlsx(input: ParseInput): Promise<ParseResult> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(input.data, { type: "array" });
  const pages: ParsedPage[] = [];

  workbook.SheetNames.forEach((sheetName, sheetIdx) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return;
    // header: 1 → array-of-arrays; defval "" keeps merged/blank cells aligned.
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      blankrows: false,
    });
    if (rows.length === 0) return;

    const renderRow = (row: unknown[]): string =>
      `| ${row.map((c) => String(c ?? "").replace(/\|/g, "\\|").trim()).join(" | ")} |`;

    const headerRow = renderRow(rows[0] ?? []);
    const separator = `| ${(rows[0] ?? []).map(() => "---").join(" | ")} |`;
    const bodyRows = rows.slice(1).map(renderRow);

    const markdown = [
      `## Sheet: ${sheetName}`,
      "",
      headerRow,
      separator,
      ...bodyRows,
    ].join("\n");

    pages.push({
      pageNumber: sheetIdx + 1,
      markdown,
      sheetName,
      sheetHeader: `${headerRow}\n${separator}`,
    });
  });

  if (pages.length === 0) {
    return {
      ok: false,
      reason: "parse_error",
      detail: `Workbook ${input.filename} contains no non-empty sheets.`,
    };
  }
  return { ok: true, parser: "xlsx", pages, pageCount: pages.length };
}

// ---------------------------------------------------------------------------
// Fallback: mammoth (DOCX) — raw text, treated as a single page (DOCX has no
// fixed pagination without rendering).
// ---------------------------------------------------------------------------

async function parseWithMammoth(input: ParseInput): Promise<ParseResult> {
  const mammoth = await import("mammoth");
  const buffer = Buffer.from(input.data);
  const { value } = await mammoth.extractRawText({ buffer });
  const text = value.trim();
  if (text.length === 0) {
    return {
      ok: false,
      reason: "parse_error",
      detail: `mammoth extracted no text from ${input.filename}.`,
    };
  }
  return {
    ok: true,
    parser: "mammoth",
    pages: [{ pageNumber: 1, markdown: text }],
    pageCount: 1,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
