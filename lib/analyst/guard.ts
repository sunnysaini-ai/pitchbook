/**
 * lib/analyst/guard.ts
 *
 * §6.2 — the completion guard. Runs on EVERY analyst completion.
 *
 * Checks:
 *   1. Output is valid JSON matching the analyst zod schema.
 *   2. grounded=true but citations empty.
 *   3. Any [n] marker in the answer with no matching citations entry.
 *   4. Any citations[].excerpt_id not in the set of chunk_ids actually sent
 *      to the model (hallucinated-citation check — highest value).
 *   5. Any citations[].quote not a verbatim substring of that chunk's
 *      content (whitespace-normalized). A fabricated quote is an IMMEDIATE
 *      hard fail (no retry) → escalation, logged as ai.quote_fabricated
 *      with severity "high".
 *
 * Policy: reject + retry once; on second failure (or any fabricated quote)
 * hard-fail to escalation. Every attempt and outcome is written to
 * audit_log (INV-4).
 */

import { analystOutputSchema, type AnalystOutput } from "@/lib/schema";
import type { RetrievedChunk } from "@/lib/schema";
import { writeAudit, type AuditAction } from "@/lib/audit/writeAudit";

// ---------------------------------------------------------------------------
// Pure validation
// ---------------------------------------------------------------------------

export type GuardCheck = 1 | 2 | 3 | 4 | 5;

export interface GuardFailure {
  check: GuardCheck;
  code:
    | "invalid_json"
    | "grounded_without_citations"
    | "orphan_citation_marker"
    | "hallucinated_citation"
    | "fabricated_quote";
  detail: string;
}

export type GuardVerdict =
  | { ok: true; output: AnalystOutput }
  | { ok: false; fatal: boolean; failures: GuardFailure[] };

/** Collapse all whitespace runs to a single space and trim. */
export function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function runGuardChecks(
  rawCompletion: string,
  sentChunks: RetrievedChunk[],
): GuardVerdict {
  const failures: GuardFailure[] = [];

  // --- Check 1: valid JSON matching the schema ----------------------------
  let output: AnalystOutput;
  try {
    const parsed = analystOutputSchema.safeParse(
      JSON.parse(rawCompletion.trim()),
    );
    if (!parsed.success) {
      return {
        ok: false,
        fatal: false,
        failures: [
          {
            check: 1,
            code: "invalid_json",
            detail: `Schema mismatch: ${parsed.error.message}`,
          },
        ],
      };
    }
    output = parsed.data;
  } catch (err) {
    return {
      ok: false,
      fatal: false,
      failures: [
        {
          check: 1,
          code: "invalid_json",
          detail: `Not parseable JSON: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }

  // --- Check 2: grounded=true requires at least one citation --------------
  if (output.grounded && output.citations.length === 0) {
    failures.push({
      check: 2,
      code: "grounded_without_citations",
      detail: "grounded=true but citations array is empty (INV-1).",
    });
  }

  // --- Check 3: every [n] marker in the answer resolves to a citation -----
  const citedNs = new Set(output.citations.map((c) => c.n));
  const markerRe = /\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  const orphanNs = new Set<number>();
  while ((m = markerRe.exec(output.answer)) !== null) {
    const n = Number(m[1]);
    if (!citedNs.has(n)) orphanNs.add(n);
  }
  if (orphanNs.size > 0) {
    failures.push({
      check: 3,
      code: "orphan_citation_marker",
      detail: `Answer contains markers [${[...orphanNs].join("], [")}] with no matching citations entry.`,
    });
  }

  // --- Check 4: excerpt_id must be a chunk actually sent (hallucination) --
  const sentById = new Map(sentChunks.map((c) => [c.id, c]));
  for (const citation of output.citations) {
    if (!sentById.has(citation.excerpt_id)) {
      failures.push({
        check: 4,
        code: "hallucinated_citation",
        detail: `citations[n=${citation.n}].excerpt_id "${citation.excerpt_id}" was never sent to the model.`,
      });
    }
  }

  // --- Check 5: quotes must be verbatim substrings (fatal on failure) -----
  let fabricated = false;
  for (const citation of output.citations) {
    const chunk = sentById.get(citation.excerpt_id);
    if (!chunk) continue; // already failed check 4
    const haystack = normalizeWhitespace(chunk.content);
    const needle = normalizeWhitespace(citation.quote);
    if (needle.length === 0 || !haystack.includes(needle)) {
      fabricated = true;
      failures.push({
        check: 5,
        code: "fabricated_quote",
        detail:
          `citations[n=${citation.n}] quote is not a verbatim substring of chunk ` +
          `${citation.excerpt_id} (whitespace-normalized).`,
      });
    }
  }

  if (failures.length === 0) {
    return { ok: true, output };
  }
  return { ok: false, fatal: fabricated, failures };
}

// ---------------------------------------------------------------------------
// Guarded generation loop: attempt → validate → retry once → hard fail
// ---------------------------------------------------------------------------

export interface GuardAuditContext {
  dealId: string;
  /** questions.id (subject of the audit rows). */
  questionId: string;
  model: string;
  prompt: { system: string; user: string };
  chunkIds: string[];
}

export interface GuardAttempt {
  rawCompletion: string;
  verdict: GuardVerdict;
}

export type GuardedGenerateResult =
  | { ok: true; output: AnalystOutput; rawCompletion: string; attempts: GuardAttempt[] }
  | {
      ok: false;
      reason: "quote_fabricated" | "guard_failed";
      failures: GuardFailure[];
      attempts: GuardAttempt[];
    };

/**
 * Run generation under the guard. `generate` produces one raw completion per
 * call (the caller owns the actual model call). Retries exactly once on
 * non-fatal failure; a fabricated quote never retries.
 */
export async function guardedGenerate(
  generate: () => Promise<string>,
  sentChunks: RetrievedChunk[],
  audit: GuardAuditContext,
): Promise<GuardedGenerateResult> {
  const attempts: GuardAttempt[] = [];

  for (let attempt = 1; attempt <= 2; attempt++) {
    const rawCompletion = await generate();
    const verdict = runGuardChecks(rawCompletion, sentChunks);
    attempts.push({ rawCompletion, verdict });

    if (verdict.ok) {
      return { ok: true, output: verdict.output, rawCompletion, attempts };
    }

    if (verdict.fatal) {
      // Fabricated quote: immediate hard fail, severity high (INV-1).
      await auditGuardEvent("ai.quote_fabricated", "high", audit, rawCompletion, verdict.failures, attempt);
      return {
        ok: false,
        reason: "quote_fabricated",
        failures: verdict.failures,
        attempts,
      };
    }

    if (attempt === 1) {
      await auditGuardEvent("ai.guard_retry", "warn", audit, rawCompletion, verdict.failures, attempt);
      continue;
    }

    // Second non-fatal failure → hard fail to escalation.
    await auditGuardEvent("ai.guard_failed", "high", audit, rawCompletion, verdict.failures, attempt);
    return {
      ok: false,
      reason: "guard_failed",
      failures: verdict.failures,
      attempts,
    };
  }

  // Unreachable, but TypeScript needs the exhaustiveness anchor.
  throw new Error("guardedGenerate: loop exited without a verdict");
}

async function auditGuardEvent(
  action: Extract<AuditAction, "ai.guard_retry" | "ai.guard_failed" | "ai.quote_fabricated">,
  severity: "warn" | "high",
  audit: GuardAuditContext,
  rawCompletion: string,
  failures: GuardFailure[],
  attempt: number,
): Promise<void> {
  await writeAudit({
    dealId: audit.dealId,
    actorType: "ai",
    action,
    subjectId: audit.questionId,
    payload: {
      severity,
      prompt: audit.prompt,
      model: audit.model,
      chunk_ids: audit.chunkIds,
      raw_completion: rawCompletion,
      guard_failures: failures,
      attempt,
    },
  });
}
