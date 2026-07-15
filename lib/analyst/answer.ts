/**
 * lib/analyst/answer.ts
 *
 * The answer lifecycle (§6.3):
 *
 *   buyer asks
 *     → retrieval (permission filter in SQL; INV-2/INV-3)
 *     → groundedness gate
 *         → ungrounded  → answers row status='escalated' (refusal copy)
 *         → grounded    → generate under guard (§6.2)
 *             → guard pass → answers row status='draft'
 *                 → deal strict → sits in the approval queue (INV-5: RLS
 *                   hides it from the buyer until approved)
 *                 → deal fast   → auto 'approved'
 *             → guard hard-fail → answers row status='escalated'
 *
 *   writeAudit at EVERY step (INV-4).
 *
 * This module runs as the AI worker (service-role): buyers have no insert
 * policy on answers, and drafts must exist before any human can see them.
 * Buyer visibility is still governed end-to-end by RLS, never by this code.
 */

import { createSupabaseAdminClient } from "@/lib/db/admin";
import { writeAudit } from "@/lib/audit/writeAudit";
import { searchChunks } from "@/lib/retrieval/search";
import { ANALYST_SYSTEM_PROMPT, buildUserTurn } from "@/lib/analyst/prompt";
import { guardedGenerate } from "@/lib/analyst/guard";
import type { AnalystOutput, RetrievedChunk } from "@/lib/schema";
import type { AnswerStatus } from "@/lib/db/server";

export const ANSWER_MODEL = "claude-sonnet-4-6";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

/**
 * Standard escalation copy — the ONLY body a buyer ever sees for an
 * ungrounded/failed question. Contains no AI-generated content.
 */
export const ESCALATION_COPY =
  "This question has been escalated to the deal team. The data room does " +
  "not contain material that allows a grounded answer, or the question is " +
  "outside the scope of AI-assisted responses. A member of the deal team " +
  "will respond directly.";

export interface AnswerQuestionParams {
  questionId: string;
  dealId: string;
  buyerId: string;
  questionBody: string;
}

export interface AnswerQuestionResult {
  answerId: string;
  status: AnswerStatus;
  isGrounded: boolean;
}

export async function answerQuestion(
  params: AnswerQuestionParams,
): Promise<AnswerQuestionResult> {
  const admin = createSupabaseAdminClient();

  // -------------------------------------------------------------------------
  // 0. Deal mode (strict vs fast) governs the post-draft transition.
  // -------------------------------------------------------------------------
  const dealRes = await admin
    .from("deals")
    .select("answer_mode")
    .eq("id", params.dealId)
    .single();
  if (dealRes.error || !dealRes.data) {
    throw new Error(
      `answerQuestion: deal ${params.dealId} not found: ${dealRes.error?.message}`,
    );
  }
  const answerMode = dealRes.data.answer_mode;

  // -------------------------------------------------------------------------
  // 1. Retrieval — permission filter inside the SQL (never post-filtered).
  // -------------------------------------------------------------------------
  const retrieval = await searchChunks({
    dealId: params.dealId,
    buyerId: params.buyerId,
    query: params.questionBody,
  });

  await writeAudit({
    dealId: params.dealId,
    actorType: "ai",
    action: "ai.retrieval_executed",
    subjectId: params.questionId,
    payload: {
      severity: "info",
      question: params.questionBody,
      buyer_id: params.buyerId,
      grounded: retrieval.grounded,
      chunk_ids: retrieval.grounded ? retrieval.chunks.map((c) => c.id) : [],
      ...(retrieval.grounded ? {} : { ungrounded_reason: retrieval.reason }),
    },
  });

  // -------------------------------------------------------------------------
  // 2. Groundedness gate — ungrounded means NOT PERMITTED to answer (INV-1).
  // -------------------------------------------------------------------------
  if (!retrieval.grounded) {
    const prompt = {
      system: ANALYST_SYSTEM_PROMPT,
      user: buildUserTurn(params.questionBody, []),
    };
    await writeAudit({
      dealId: params.dealId,
      actorType: "ai",
      action: "ai.answer_ungrounded",
      subjectId: params.questionId,
      payload: {
        severity: "warn",
        prompt,
        model: ANSWER_MODEL,
        chunk_ids: [],
        ungrounded_reason: retrieval.reason,
      },
    });
    return escalate(params, "retrieval_ungrounded");
  }

  // -------------------------------------------------------------------------
  // 3. Generation under the §6.2 guard (retry once, hard-fail to escalation).
  // -------------------------------------------------------------------------
  const chunks = retrieval.chunks;
  const userTurn = buildUserTurn(params.questionBody, chunks);
  const prompt = { system: ANALYST_SYSTEM_PROMPT, user: userTurn };
  const chunkIds = chunks.map((c) => c.id);

  const result = await guardedGenerate(
    () => callSonnet(userTurn),
    chunks,
    {
      dealId: params.dealId,
      questionId: params.questionId,
      model: ANSWER_MODEL,
      prompt,
      chunkIds,
    },
  );

  if (!result.ok) {
    // guard.ts already logged ai.quote_fabricated / ai.guard_failed.
    return escalate(params, result.reason);
  }

  const output = result.output;

  await writeAudit({
    dealId: params.dealId,
    actorType: "ai",
    action: "ai.answer_generated",
    subjectId: params.questionId,
    payload: {
      severity: "info",
      prompt,
      model: ANSWER_MODEL,
      chunk_ids: chunkIds,
      raw_completion: result.rawCompletion,
      grounded: output.grounded,
      escalate: output.escalate,
    },
  });

  // -------------------------------------------------------------------------
  // 4. Persist. The model may itself refuse/escalate (INV-6: refusal is a
  //    correct output) — that lands as 'escalated', not as buyer-visible AI
  //    prose. Otherwise: strict → 'draft' (queued; hidden by RLS until
  //    approved, INV-5), fast → auto 'approved'.
  // -------------------------------------------------------------------------
  if (output.escalate || !output.grounded) {
    await writeAudit({
      dealId: params.dealId,
      actorType: "ai",
      action: "ai.answer_escalated",
      subjectId: params.questionId,
      payload: {
        severity: "info",
        reason: output.escalation_reason || "model_declined",
        model: ANSWER_MODEL,
      },
    });
    return escalate(params, output.escalation_reason || "model_declined");
  }

  const status: AnswerStatus = answerMode === "fast" ? "approved" : "draft";
  const answerId = await insertAnswer(params, output.answer, status, true);
  await insertCitations(answerId, output, chunks);

  return { answerId, status, isGrounded: true };
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

async function insertAnswer(
  params: AnswerQuestionParams,
  body: string,
  status: AnswerStatus,
  isGrounded: boolean,
): Promise<string> {
  const admin = createSupabaseAdminClient();
  const res = await admin
    .from("answers")
    .insert({
      question_id: params.questionId,
      deal_id: params.dealId,
      buyer_id: params.buyerId,
      body,
      status,
      is_grounded: isGrounded,
      model: ANSWER_MODEL,
    })
    .select("id")
    .single();
  if (res.error || !res.data) {
    throw new Error(`answers insert failed: ${res.error?.message}`);
  }
  return res.data.id;
}

async function insertCitations(
  answerId: string,
  output: AnalystOutput,
  chunks: RetrievedChunk[],
): Promise<void> {
  if (output.citations.length === 0) return;
  const admin = createSupabaseAdminClient();
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const rows = output.citations.map((c, idx) => {
    const chunk = byId.get(c.excerpt_id);
    if (!chunk) {
      // Impossible post-guard (check #4), but never trust it silently.
      throw new Error(
        `citation excerpt_id ${c.excerpt_id} missing from sent chunks after guard pass`,
      );
    }
    return {
      answer_id: answerId,
      chunk_id: chunk.id,
      document_id: chunk.document_id,
      page_from: chunk.page_from,
      page_to: chunk.page_to,
      quote: c.quote,
      ordinal: idx,
    };
  });
  const res = await admin.from("citations").insert(rows);
  if (res.error) {
    throw new Error(`citations insert failed: ${res.error.message}`);
  }
}

async function escalate(
  params: AnswerQuestionParams,
  reason: string,
): Promise<AnswerQuestionResult> {
  const answerId = await insertAnswer(params, ESCALATION_COPY, "escalated", false);
  await writeAudit({
    dealId: params.dealId,
    actorType: "system",
    action: "ai.answer_escalated",
    subjectId: answerId,
    payload: {
      severity: "info",
      question_id: params.questionId,
      reason,
    },
  });
  return { answerId, status: "escalated", isGrounded: false };
}

// ---------------------------------------------------------------------------
// Model call (claude-sonnet-4-6)
// ---------------------------------------------------------------------------

async function callSonnet(userTurn: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set — the analyst cannot run.");
  }
  const res = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANSWER_MODEL,
      max_tokens: 2048,
      temperature: 0,
      system: ANALYST_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userTurn }],
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Anthropic answer request failed (${res.status}): ${await res.text()}`,
    );
  }
  const body = (await res.json()) as {
    content: Array<{ type: string; text?: string }>;
  };
  const text = body.content.find((b) => b.type === "text")?.text;
  if (!text) {
    throw new Error("Anthropic answer response contained no text block.");
  }
  return text;
}
