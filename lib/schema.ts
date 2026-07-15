/**
 * lib/schema.ts
 *
 * zod schemas for every trust boundary:
 *   - inbound API payloads (buyer/admin requests)
 *   - LLM completions (the analyst's JSON output — the most hostile input
 *     in the system; see lib/analyst/guard.ts)
 *   - worker/job payloads
 *
 * Nothing crosses a boundary unparsed.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const uuidSchema = z.string().uuid();

export const answerModeSchema = z.enum(["strict", "fast"]);
export const answerStatusSchema = z.enum([
  "draft",
  "approved",
  "rejected",
  "escalated",
  "released",
]);
export const docStatusSchema = z.enum([
  "uploaded",
  "parsing",
  "chunking",
  "embedding",
  "ready",
  "failed",
]);
export const actorTypeSchema = z.enum([
  "seller",
  "advisor",
  "buyer",
  "system",
  "ai",
]);

/** Document categories assigned by lib/ingest/classify.ts. Closed set. */
export const docCategorySchema = z.enum([
  "Financials",
  "Legal",
  "Commercial",
  "HR",
  "Technology",
  "Other",
]);
export type DocCategory = z.infer<typeof docCategorySchema>;

// ---------------------------------------------------------------------------
// Inbound API payloads
// ---------------------------------------------------------------------------

/** POST /api/deals/[dealId]/questions — a buyer asking the analyst. */
export const askQuestionRequestSchema = z.object({
  deal_id: uuidSchema,
  body: z
    .string()
    .trim()
    .min(3, "Question too short")
    .max(4000, "Question too long"),
});
export type AskQuestionRequest = z.infer<typeof askQuestionRequestSchema>;

/** POST /api/deals/[dealId]/documents — admin registering an upload. */
export const registerDocumentRequestSchema = z.object({
  deal_id: uuidSchema,
  folder_id: uuidSchema.nullable(),
  filename: z.string().trim().min(1).max(512),
  storage_path: z.string().trim().min(1).max(1024),
  mime_type: z.string().trim().min(1).max(255),
  ai_accessible: z.boolean().default(true),
});
export type RegisterDocumentRequest = z.infer<
  typeof registerDocumentRequestSchema
>;

/** PATCH /api/answers/[answerId] — human moderation of a draft answer. */
export const moderateAnswerRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), answer_id: uuidSchema }),
  z.object({
    action: z.literal("reject"),
    answer_id: uuidSchema,
    reason: z.string().trim().min(1).max(2000),
  }),
  z.object({
    action: z.literal("edit"),
    answer_id: uuidSchema,
    /** Full replacement body; writeAudit records the before/after diff. */
    body: z.string().trim().min(1).max(20000),
  }),
]);
export type ModerateAnswerRequest = z.infer<typeof moderateAnswerRequestSchema>;

/** POST /api/deals/[dealId]/buyers — inviting a buyer + folder grants. */
export const inviteBuyerRequestSchema = z.object({
  deal_id: uuidSchema,
  org_name: z.string().trim().min(1).max(255),
  contact_email: z.string().email(),
  folder_ids: z.array(uuidSchema).max(500),
});
export type InviteBuyerRequest = z.infer<typeof inviteBuyerRequestSchema>;

// ---------------------------------------------------------------------------
// Analyst output (§6.1 OUTPUT FORMAT) — the schema guard.ts validates against
// ---------------------------------------------------------------------------

export const analystCitationSchema = z.object({
  /** The [n] marker used in the answer body. */
  n: z.number().int().positive(),
  /** Must be one of the chunk_ids actually sent to the model (guard check #4). */
  excerpt_id: z.string().min(1),
  /** Must be a verbatim substring of that chunk (guard check #5). */
  quote: z.string().min(1),
});
export type AnalystCitation = z.infer<typeof analystCitationSchema>;

export const analystOutputSchema = z.object({
  grounded: z.boolean(),
  answer: z.string(),
  citations: z.array(analystCitationSchema),
  escalate: z.boolean(),
  escalation_reason: z.string(),
});
export type AnalystOutput = z.infer<typeof analystOutputSchema>;

/** Classifier output (lib/ingest/classify.ts). */
export const classifyOutputSchema = z.object({
  category: docCategorySchema,
});

/** Reranker output (lib/retrieval/search.ts): excerpt_id → 0–10 score. */
export const rerankOutputSchema = z.object({
  scores: z.array(
    z.object({
      excerpt_id: z.string().min(1),
      score: z.number().min(0).max(10),
    }),
  ),
});
export type RerankOutput = z.infer<typeof rerankOutputSchema>;

// ---------------------------------------------------------------------------
// Retrieval shapes shared across the pipeline
// ---------------------------------------------------------------------------

export const retrievedChunkSchema = z.object({
  id: uuidSchema,
  document_id: uuidSchema,
  filename: z.string(),
  page_from: z.number().int(),
  page_to: z.number().int(),
  content: z.string(),
  /** Reciprocal-rank-fusion score (pre-rerank). */
  rrf_score: z.number(),
  /** Haiku rerank score 0–10; present after rerank. */
  rerank_score: z.number().min(0).max(10).optional(),
});
export type RetrievedChunk = z.infer<typeof retrievedChunkSchema>;

export const retrievalResultSchema = z.discriminatedUnion("grounded", [
  z.object({
    grounded: z.literal(true),
    chunks: z.array(retrievedChunkSchema).min(1),
  }),
  z.object({
    grounded: z.literal(false),
    chunks: z.array(retrievedChunkSchema).length(0),
    reason: z.enum(["no_candidates", "rerank_empty", "top_score_below_threshold"]),
  }),
]);
export type RetrievalResult = z.infer<typeof retrievalResultSchema>;

// ---------------------------------------------------------------------------
// Worker/job payloads
// ---------------------------------------------------------------------------

export const ingestJobSchema = z.object({
  document_id: uuidSchema,
  deal_id: uuidSchema,
});
export type IngestJob = z.infer<typeof ingestJobSchema>;
