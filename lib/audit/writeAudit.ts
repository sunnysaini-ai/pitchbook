/**
 * lib/audit/writeAudit.ts
 *
 * THE single append-only audit writer (INV-4). Every AI generation and every
 * human override in the system flows through this function — there is no
 * other code path that inserts into audit_log, and RLS grants authenticated
 * users no insert policy, so this (service-role) path is the only one that
 * physically works.
 *
 * audit_log is append-only at the database: no UPDATE/DELETE policy for any
 * role, hard REVOKEs, and a BEFORE trigger that raises on mutation.
 */

import { createSupabaseAdminClient } from "@/lib/db/admin";
import type { ActorType, Json } from "@/lib/db/server";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Action vocabulary — closed set so dashboards and alerts can rely on it
// ---------------------------------------------------------------------------

export const auditActionSchema = z.enum([
  // AI lifecycle
  "ai.retrieval_executed",
  "ai.answer_generated",
  "ai.answer_ungrounded",
  "ai.guard_retry",
  "ai.guard_failed",
  "ai.quote_fabricated",
  "ai.answer_escalated",
  "ai.classification",
  // Human overrides / moderation
  "human.answer_approved",
  "human.answer_rejected",
  "human.answer_edited",
  "human.answer_released",
  "human.doc_ai_access_changed",
  // Ingest
  "ingest.parse_failed",
  "ingest.document_ready",
]);
export type AuditAction = z.infer<typeof auditActionSchema>;

export const auditSeveritySchema = z.enum(["info", "warn", "high"]);
export type AuditSeverity = z.infer<typeof auditSeveritySchema>;

/**
 * Payload contract. For AI generations the caller MUST supply the full
 * prompt, the model id, the exact chunk_ids retrieved/sent, and the raw
 * completion. For human overrides the caller MUST supply the diff.
 * `.passthrough()` lets callers attach extra context without schema churn —
 * but the core forensic fields are typed and validated.
 */
export const auditPayloadSchema = z
  .object({
    severity: auditSeveritySchema.default("info"),
    /** Full prompt sent to the model (system + user turns). AI actions. */
    prompt: z
      .object({
        system: z.string(),
        user: z.string(),
      })
      .optional(),
    /** Exact model identifier, e.g. "claude-sonnet-4-6". AI actions. */
    model: z.string().optional(),
    /** chunk_ids retrieved and actually sent to the model. AI actions. */
    chunk_ids: z.array(z.string().uuid()).optional(),
    /** Raw, unmodified completion text (pre-parse). AI actions. */
    raw_completion: z.string().optional(),
    /** Human override diff. Human actions. */
    diff: z
      .object({
        before: z.string(),
        after: z.string(),
      })
      .optional(),
  })
  .passthrough();
export type AuditPayload = z.input<typeof auditPayloadSchema>;

export interface WriteAuditParams {
  dealId: string;
  actorType: ActorType;
  /** auth.users id for humans; null for system/ai. */
  actorId?: string | null;
  action: AuditAction;
  /** Row the action concerns (answer id, document id, question id, ...). */
  subjectId?: string | null;
  payload: AuditPayload;
}

/** Actions for which the forensic AI fields are mandatory (INV-4). */
const AI_GENERATION_ACTIONS: ReadonlySet<AuditAction> = new Set([
  "ai.answer_generated",
  "ai.answer_ungrounded",
  "ai.guard_retry",
  "ai.guard_failed",
  "ai.quote_fabricated",
]);

const HUMAN_OVERRIDE_ACTIONS: ReadonlySet<AuditAction> = new Set([
  "human.answer_edited",
]);

/**
 * Append one audit row. Throws on failure — an audit write that fails must
 * fail the operation it records, never be swallowed.
 */
export async function writeAudit(params: WriteAuditParams): Promise<void> {
  const action = auditActionSchema.parse(params.action);
  const payload = auditPayloadSchema.parse(params.payload);

  if (AI_GENERATION_ACTIONS.has(action)) {
    if (!payload.prompt || !payload.model || !payload.chunk_ids) {
      throw new Error(
        `writeAudit(${action}): AI generation audit rows must carry the full ` +
          `prompt, model, and retrieved chunk_ids (INV-4).`,
      );
    }
    if (action !== "ai.answer_ungrounded" && payload.raw_completion === undefined) {
      throw new Error(
        `writeAudit(${action}): AI generation audit rows must carry the raw completion (INV-4).`,
      );
    }
  }
  if (HUMAN_OVERRIDE_ACTIONS.has(action) && !payload.diff) {
    throw new Error(
      `writeAudit(${action}): human edits must carry the before/after diff (INV-4).`,
    );
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("audit_log").insert({
    deal_id: params.dealId,
    actor_type: params.actorType,
    actor_id: params.actorId ?? null,
    action,
    subject_id: params.subjectId ?? null,
    payload: payload as Json,
  });

  if (error) {
    throw new Error(`audit_log insert failed (${action}): ${error.message}`);
  }
}
