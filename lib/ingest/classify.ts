/**
 * lib/ingest/classify.ts
 *
 * Document category classification: claude-haiku-4-5 over the FIRST TWO
 * chunks + the filename → exactly one of
 * {Financials, Legal, Commercial, HR, Technology, Other}.
 *
 * Classification is metadata, not a factual claim to a buyer, so it does not
 * pass through the analyst guard — but the ingest worker records the result
 * to audit_log via writeAudit("ai.classification", ...).
 */

import { z } from "zod";
import {
  classifyOutputSchema,
  docCategorySchema,
  type DocCategory,
} from "@/lib/schema";

export const CLASSIFY_MODEL = "claude-haiku-4-5";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_EXCERPT_CHARS = 3_000;

const SYSTEM_PROMPT = `You classify documents in an M&A data room into exactly one category.
Categories (choose exactly one, verbatim):
- Financials: P&L, balance sheet, cash flow, budgets, cap tables, tax returns, audited statements
- Legal: contracts, leases, litigation, corporate records, IP assignments, regulatory filings
- Commercial: customers, pipeline, pricing, marketing, market studies, sales materials
- HR: org charts, employment agreements, compensation, benefits, headcount
- Technology: systems, architecture, security, product/engineering documentation
- Other: anything that does not clearly fit the above

Respond with ONLY valid JSON: {"category": "<one of the six>"}`;

interface AnthropicMessageResponse {
  content: Array<{ type: string; text?: string }>;
  stop_reason: string | null;
}

async function callHaiku(userContent: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set — document classification cannot run.",
    );
  }
  const res = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLASSIFY_MODEL,
      max_tokens: 64,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Anthropic classify request failed (${res.status}): ${await res.text()}`,
    );
  }
  const body = (await res.json()) as AnthropicMessageResponse;
  const text = body.content.find((b) => b.type === "text")?.text;
  if (!text) {
    throw new Error("Anthropic classify response contained no text block.");
  }
  return text;
}

export interface ClassifyInput {
  filename: string;
  /** The first two chunks of the document, in order. */
  firstChunks: string[];
}

export interface ClassifyResult {
  category: DocCategory;
  model: string;
  /** Raw completion, so the caller can record it to audit_log. */
  rawCompletion: string;
}

export async function classifyDocument(
  input: ClassifyInput,
): Promise<ClassifyResult> {
  const excerpts = input.firstChunks
    .slice(0, 2)
    .map(
      (c, i) =>
        `--- chunk ${i + 1} ---\n${c.slice(0, MAX_EXCERPT_CHARS)}`,
    )
    .join("\n\n");

  const userContent = `Filename: ${input.filename}\n\n${excerpts}`;
  const raw = await callHaiku(userContent);

  const category = parseCategory(raw);
  return { category, model: CLASSIFY_MODEL, rawCompletion: raw };
}

/**
 * Strict JSON parse first; if the model wrapped the JSON in prose, salvage
 * the first JSON object; if a bare category name is all we can find, accept
 * it; otherwise fall back to "Other" (a wrong-but-safe label for metadata —
 * never for facts).
 */
function parseCategory(raw: string): DocCategory {
  const tryParse = (s: string): DocCategory | null => {
    try {
      const parsed = classifyOutputSchema.safeParse(JSON.parse(s));
      return parsed.success ? parsed.data.category : null;
    } catch {
      return null;
    }
  };

  const direct = tryParse(raw.trim());
  if (direct) return direct;

  const jsonMatch = raw.match(/\{[\s\S]*?\}/);
  if (jsonMatch) {
    const salvaged = tryParse(jsonMatch[0]);
    if (salvaged) return salvaged;
  }

  const bare = z
    .string()
    .transform((s) => s.trim())
    .pipe(docCategorySchema)
    .safeParse(raw);
  if (bare.success) return bare.data;

  return "Other";
}
