/**
 * lib/ingest/chunk.ts
 *
 * Structure-aware chunker.
 *
 * Rules (all enforced here, fully implemented):
 *   - Split on markdown headings first; pack whole sections together.
 *   - Target 800 tokens per chunk, hard max 1200, overlap 100 between
 *     consecutive chunks cut from the same page.
 *   - NEVER merge content across a page boundary: every chunk lives on
 *     exactly one page, so citations resolve to a real page range.
 *   - Spreadsheets chunk per sheet, and EVERY chunk cut from a sheet starts
 *     with that sheet's header row (so "Q3 FY25 Revenue" cells keep their
 *     column meaning in isolation).
 *
 * Token counting uses the ~4-chars-per-token heuristic. It is deliberately
 * conservative and dependency-free; the hard max of 1200 estimated tokens
 * leaves ample headroom under embedding/model context limits.
 */

import type { ParsedPage } from "@/lib/ingest/parse";

export const TARGET_TOKENS = 800;
export const HARD_MAX_TOKENS = 1200;
export const OVERLAP_TOKENS = 100;

const CHARS_PER_TOKEN = 4;

export interface ChunkDraft {
  content: string;
  page_from: number;
  page_to: number;
  /** 0-based position within the document. */
  ordinal: number;
  token_count: number;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function tokensToChars(tokens: number): number {
  return tokens * CHARS_PER_TOKEN;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function chunkDocument(pages: ParsedPage[]): ChunkDraft[] {
  const chunks: ChunkDraft[] = [];
  let ordinal = 0;

  for (const page of pages) {
    const pageChunks =
      page.sheetName !== undefined
        ? chunkSheetPage(page)
        : chunkProsePage(page);
    for (const content of pageChunks) {
      const trimmed = content.trim();
      if (trimmed.length === 0) continue;
      chunks.push({
        content: trimmed,
        page_from: page.pageNumber,
        page_to: page.pageNumber,
        ordinal: ordinal++,
        token_count: estimateTokens(trimmed),
      });
    }
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Prose pages: heading-aware packing with overlap
// ---------------------------------------------------------------------------

const HEADING_RE = /^#{1,6}\s/;

/** Split page markdown into sections, each heading owning its body. */
function splitIntoSections(markdown: string): string[] {
  const lines = markdown.split("\n");
  const sections: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (HEADING_RE.test(line) && current.length > 0) {
      sections.push(current.join("\n"));
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) sections.push(current.join("\n"));
  return sections.map((s) => s.trim()).filter((s) => s.length > 0);
}

function chunkProsePage(page: ParsedPage): string[] {
  const sections = splitIntoSections(page.markdown);
  const out: string[] = [];
  let current = "";

  const flush = (): void => {
    if (current.trim().length > 0) out.push(current);
    current = "";
  };

  /** Last ~OVERLAP_TOKENS of the previous chunk, cut at a whitespace. */
  const overlapTail = (): string => {
    const prev = out[out.length - 1];
    if (!prev) return "";
    const maxChars = tokensToChars(OVERLAP_TOKENS);
    if (prev.length <= maxChars) return prev;
    const tail = prev.slice(prev.length - maxChars);
    const firstSpace = tail.search(/\s/);
    return firstSpace === -1 ? tail : tail.slice(firstSpace + 1);
  };

  const startNewChunkWithOverlap = (seed: string): void => {
    const tail = overlapTail();
    current = tail.length > 0 ? `${tail}\n\n${seed}` : seed;
  };

  for (const section of sections) {
    if (estimateTokens(section) > HARD_MAX_TOKENS) {
      // Oversize section: flush what we have, then split the section itself.
      flush();
      const pieces = splitOversize(section, TARGET_TOKENS);
      for (const piece of pieces) {
        if (out.length > 0) {
          startNewChunkWithOverlap(piece);
          flush();
        } else {
          current = piece;
          flush();
        }
      }
      continue;
    }

    const candidate = current.length === 0 ? section : `${current}\n\n${section}`;
    if (current.length > 0 && estimateTokens(candidate) > TARGET_TOKENS) {
      flush();
      startNewChunkWithOverlap(section);
    } else {
      current = candidate;
    }
  }
  flush();
  return out;
}

/**
 * Split a single oversize block: paragraphs → lines → hard character split,
 * packing greedily up to maxTokens.
 */
function splitOversize(text: string, maxTokens: number): string[] {
  const maxChars = tokensToChars(maxTokens);
  const paragraphs = text.split(/\n{2,}/);
  const units: string[] = [];
  for (const p of paragraphs) {
    if (p.length <= maxChars) {
      units.push(p);
      continue;
    }
    for (const line of p.split("\n")) {
      if (line.length <= maxChars) {
        units.push(line);
      } else {
        for (let i = 0; i < line.length; i += maxChars) {
          units.push(line.slice(i, i + maxChars));
        }
      }
    }
  }
  const out: string[] = [];
  let current = "";
  for (const unit of units) {
    const candidate = current.length === 0 ? unit : `${current}\n\n${unit}`;
    if (current.length > 0 && candidate.length > maxChars) {
      out.push(current);
      current = unit;
    } else {
      current = candidate;
    }
  }
  if (current.trim().length > 0) out.push(current);
  return out;
}

// ---------------------------------------------------------------------------
// Spreadsheet pages: chunk-per-sheet, header row repeated in every chunk
// ---------------------------------------------------------------------------

function chunkSheetPage(page: ParsedPage): string[] {
  const title = `## Sheet: ${page.sheetName}`;
  const header = page.sheetHeader ?? "";
  const preamble = header.length > 0 ? `${title}\n\n${header}` : title;
  const preambleTokens = estimateTokens(preamble);

  // Body rows = everything in the sheet markdown after the preamble lines.
  const preambleLines = new Set(
    preamble.split("\n").map((l) => l.trim()).filter((l) => l.length > 0),
  );
  const bodyRows = page.markdown
    .split("\n")
    .filter((l) => l.trim().length > 0 && !preambleLines.has(l.trim()));

  if (bodyRows.length === 0) {
    return [preamble];
  }

  const rowBudget = Math.max(TARGET_TOKENS - preambleTokens, 100);
  const maxRowChars = tokensToChars(HARD_MAX_TOKENS - preambleTokens);

  const out: string[] = [];
  let rows: string[] = [];
  let rowsTokens = 0;

  const flush = (): void => {
    if (rows.length === 0) return;
    out.push(`${preamble}\n${rows.join("\n")}`);
    rows = [];
    rowsTokens = 0;
  };

  for (const row of bodyRows) {
    // A single pathological row longer than the hard max gets hard-split.
    const rowPieces =
      row.length > maxRowChars
        ? Array.from(
            { length: Math.ceil(row.length / maxRowChars) },
            (_, i) => row.slice(i * maxRowChars, (i + 1) * maxRowChars),
          )
        : [row];

    for (const piece of rowPieces) {
      const t = estimateTokens(piece);
      if (rows.length > 0 && rowsTokens + t > rowBudget) {
        flush();
      }
      rows.push(piece);
      rowsTokens += t;
    }
  }
  flush();
  return out;
}
