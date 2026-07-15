/**
 * lib/retrieval/search.ts
 *
 * Permission-filtered hybrid retrieval.
 *
 * SECURITY MODEL: the permission filter is part of the SQL query itself
 * (the `allowed` CTE inside search_chunks_vector / search_chunks_fts in
 * 0002_rls.sql), never a post-filter in application code. Those RPCs are
 * EXECUTE-revoked from anon/authenticated; only this service-role worker
 * can call them. A chunk from a folder the buyer lacks (INV-2) or from an
 * ai_accessible=false document (INV-3) cannot appear in the candidate set,
 * so it cannot be reranked, cited, or leaked — under any code path.
 *
 * PIPELINE:
 *   vector cosine top-40  ∪  BM25/ts_rank top-40
 *     → Reciprocal Rank Fusion (k = 60)
 *     → top 12
 *     → rerank with claude-haiku-4-5, scoring each excerpt 0–10
 *     → keep score ≥ 6, cap at 8
 *
 * GROUNDEDNESS GATE: if the post-rerank set is empty OR the top score is
 * below 6, the system is NOT permitted to answer — return ungrounded.
 */

import { createSupabaseAdminClient } from "@/lib/db/admin";
import { embedQuery, toVectorLiteral } from "@/lib/ingest/embed";
import {
  rerankOutputSchema,
  type RetrievalResult,
  type RetrievedChunk,
} from "@/lib/schema";

export const RERANK_MODEL = "claude-haiku-4-5";

const CANDIDATES_PER_LEG = 40;
const RRF_K = 60;
const RERANK_POOL = 12;
const MIN_RERANK_SCORE = 6;
const MAX_EXCERPTS = 8;
const RERANK_EXCERPT_CHARS = 2_000;

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export interface SearchParams {
  dealId: string;
  /**
   * The asking buyer, or null when a deal admin is querying across the whole
   * corpus. NEVER pass null for buyer-originated questions.
   */
  buyerId: string | null;
  query: string;
}

interface CandidateRow {
  id: string;
  document_id: string;
  filename: string;
  page_from: number;
  page_to: number;
  content: string;
}

export async function searchChunks(
  params: SearchParams,
): Promise<RetrievalResult> {
  const admin = createSupabaseAdminClient();

  // --- Leg 1: vector cosine, permission filter inside the SQL -------------
  const queryEmbedding = await embedQuery(params.query);
  const vectorRes = await admin.rpc("search_chunks_vector", {
    p_deal_id: params.dealId,
    p_buyer_id: params.buyerId,
    p_query_embedding: toVectorLiteral(queryEmbedding),
    p_limit: CANDIDATES_PER_LEG,
  });
  if (vectorRes.error) {
    throw new Error(`vector search failed: ${vectorRes.error.message}`);
  }

  // --- Leg 2: full-text ts_rank, same in-SQL permission filter ------------
  const ftsRes = await admin.rpc("search_chunks_fts", {
    p_deal_id: params.dealId,
    p_buyer_id: params.buyerId,
    p_query: params.query,
    p_limit: CANDIDATES_PER_LEG,
  });
  if (ftsRes.error) {
    throw new Error(`fts search failed: ${ftsRes.error.message}`);
  }

  const vectorHits = (vectorRes.data ?? []) as CandidateRow[];
  const ftsHits = (ftsRes.data ?? []) as CandidateRow[];

  if (vectorHits.length === 0 && ftsHits.length === 0) {
    return { grounded: false, chunks: [], reason: "no_candidates" };
  }

  // --- Reciprocal Rank Fusion ---------------------------------------------
  const fused = reciprocalRankFusion([vectorHits, ftsHits]);
  const pool = fused.slice(0, RERANK_POOL);

  // --- Haiku rerank ---------------------------------------------------------
  const scored = await rerank(params.query, pool);

  const kept = scored
    .filter((c) => (c.rerank_score ?? 0) >= MIN_RERANK_SCORE)
    .sort((a, b) => (b.rerank_score ?? 0) - (a.rerank_score ?? 0))
    .slice(0, MAX_EXCERPTS);

  // --- Groundedness gate ----------------------------------------------------
  if (kept.length === 0) {
    const anyScored = scored.some((c) => c.rerank_score !== undefined);
    return {
      grounded: false,
      chunks: [],
      reason: anyScored ? "top_score_below_threshold" : "rerank_empty",
    };
  }

  return { grounded: true, chunks: kept };
}

// ---------------------------------------------------------------------------
// Reciprocal Rank Fusion: score(c) = Σ_legs 1 / (k + rank_leg(c)), k = 60
// ---------------------------------------------------------------------------

function reciprocalRankFusion(legs: CandidateRow[][]): RetrievedChunk[] {
  const byId = new Map<string, { row: CandidateRow; score: number }>();
  for (const leg of legs) {
    leg.forEach((row, idx) => {
      const rank = idx + 1; // 1-based
      const contribution = 1 / (RRF_K + rank);
      const existing = byId.get(row.id);
      if (existing) {
        existing.score += contribution;
      } else {
        byId.set(row.id, { row, score: contribution });
      }
    });
  }
  return [...byId.values()]
    .sort((a, b) => b.score - a.score)
    .map(({ row, score }) => ({
      id: row.id,
      document_id: row.document_id,
      filename: row.filename,
      page_from: row.page_from,
      page_to: row.page_to,
      content: row.content,
      rrf_score: score,
    }));
}

// ---------------------------------------------------------------------------
// Rerank: claude-haiku-4-5 scores each excerpt 0–10 for relevance to the
// question. Fails CLOSED: if the reranker cannot produce parseable scores
// after one retry, retrieval returns ungrounded rather than guessing.
// ---------------------------------------------------------------------------

const RERANK_SYSTEM = `You score data-room excerpts for how well they answer a diligence question.
For each excerpt, output a relevance score from 0 to 10:
- 10: directly and completely answers the question
- 6–9: contains material information that partially answers it
- 1–5: topically adjacent but does not answer it
- 0: irrelevant

Respond with ONLY valid JSON:
{"scores": [{"excerpt_id": "<id>", "score": <0-10>}, ...]}
Include every excerpt exactly once.`;

async function rerank(
  query: string,
  pool: RetrievedChunk[],
): Promise<RetrievedChunk[]> {
  if (pool.length === 0) return [];
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set — rerank cannot run.");
  }

  const excerptBlock = pool
    .map(
      (c) =>
        `<excerpt id="${c.id}" doc="${c.filename}" pages="${c.page_from}-${c.page_to}">\n` +
        `${c.content.slice(0, RERANK_EXCERPT_CHARS)}\n</excerpt>`,
    )
    .join("\n\n");
  const userContent = `Question: ${query}\n\n${excerptBlock}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: RERANK_MODEL,
        max_tokens: 1024,
        temperature: 0,
        system: RERANK_SYSTEM,
        messages: [{ role: "user", content: userContent }],
      }),
    });
    if (!res.ok) {
      if (attempt === 0 && (res.status === 429 || res.status >= 500)) {
        await new Promise((r) => setTimeout(r, 2_000));
        continue;
      }
      throw new Error(
        `Anthropic rerank request failed (${res.status}): ${await res.text()}`,
      );
    }
    const body = (await res.json()) as {
      content: Array<{ type: string; text?: string }>;
    };
    const text = body.content.find((b) => b.type === "text")?.text ?? "";
    const parsed = safeParseScores(text);
    if (parsed) {
      const scoreById = new Map(
        parsed.scores.map((s) => [s.excerpt_id, s.score]),
      );
      return pool.map((c) => ({
        ...c,
        // An excerpt the reranker skipped gets no score → filtered out later.
        rerank_score: scoreById.get(c.id),
      }));
    }
    // parse failure → one retry, then fall through to fail-closed
  }

  // Fail closed: no scores at all → callers see an empty post-rerank set.
  return pool.map((c) => ({ ...c, rerank_score: undefined }));
}

function safeParseScores(
  raw: string,
): { scores: Array<{ excerpt_id: string; score: number }> } | null {
  const candidates = [raw.trim(), raw.match(/\{[\s\S]*\}/)?.[0] ?? ""];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = rerankOutputSchema.safeParse(JSON.parse(candidate));
      if (parsed.success) return parsed.data;
    } catch {
      // try next candidate
    }
  }
  return null;
}
