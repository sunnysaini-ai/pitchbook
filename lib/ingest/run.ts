/**
 * lib/ingest/run.ts
 *
 * The ingestion orchestrator: drives ONE document through the state machine
 *   uploaded → parsing → chunking → embedding → ready   (any step → failed)
 *
 * Idempotent: re-running deletes prior chunks for the document first, so a
 * retry never leaves duplicate or half-written chunks. Runs as the service
 * role (chunks/embeddings are internal; buyers never touch them) — callers
 * MUST authorize the requester (deal admin) before invoking this.
 *
 * Scaffold note: invoked synchronously from an API route. AGENT_SPEC §1/§4
 * calls for a Supabase Edge Function + pg_cron worker; the logic here is the
 * worker body and moves behind a queue unchanged.
 */

import "server-only";
import { createSupabaseAdminClient } from "@/lib/db/admin";
import { writeAudit } from "@/lib/audit/writeAudit";
import { parseDocument } from "@/lib/ingest/parse";
import { chunkDocument } from "@/lib/ingest/chunk";
import { embedTexts, toVectorLiteral } from "@/lib/ingest/embed";
import { classifyDocument } from "@/lib/ingest/classify";
import type { DocStatus } from "@/lib/db/server";

const STORAGE_BUCKET = "deal-docs";

export interface IngestResult {
  documentId: string;
  status: DocStatus;
  chunks?: number;
  category?: string;
  error?: string;
}

export async function ingestDocument(documentId: string): Promise<IngestResult> {
  const admin = createSupabaseAdminClient();

  const { data: doc, error } = await admin
    .from("documents")
    .select("id, deal_id, filename, storage_path, mime_type")
    .eq("id", documentId)
    .single();
  if (error || !doc) {
    throw new Error(`ingestDocument: document ${documentId} not found`);
  }

  const setStatus = async (status: DocStatus, extra: Record<string, unknown> = {}) => {
    await admin.from("documents").update({ status, ...extra }).eq("id", documentId);
  };

  try {
    // Idempotency: clear any chunks from a previous run.
    await admin.from("chunks").delete().eq("document_id", documentId);

    // 1. Parse -----------------------------------------------------------
    await setStatus("parsing");
    const { data: blob, error: dlErr } = await admin.storage
      .from(STORAGE_BUCKET)
      .download(doc.storage_path);
    if (dlErr || !blob) throw new Error(`download failed: ${dlErr?.message}`);
    const bytes = new Uint8Array(await blob.arrayBuffer());

    const parsed = await parseDocument({
      data: bytes,
      filename: doc.filename,
      mimeType: doc.mime_type,
    });

    if (!parsed.ok) {
      await setStatus("failed", { error_detail: `${parsed.reason}: ${parsed.detail}` });
      await writeAudit({
        dealId: doc.deal_id,
        actorType: "system",
        action: "ingest.parse_failed",
        subjectId: documentId,
        payload: { severity: "warn", reason: parsed.reason, detail: parsed.detail },
      });
      return { documentId, status: "failed", error: parsed.reason };
    }

    // 2. Chunk -----------------------------------------------------------
    await setStatus("chunking", { page_count: parsed.pageCount });
    const drafts = chunkDocument(parsed.pages);
    if (drafts.length === 0) {
      await setStatus("failed", { error_detail: "no_chunks_produced" });
      return { documentId, status: "failed", error: "no_chunks_produced" };
    }

    // 3. Embed -----------------------------------------------------------
    await setStatus("embedding");
    const vectors = await embedTexts(drafts.map((d) => d.content));

    const rows = drafts.map((d, i) => ({
      deal_id: doc.deal_id,
      document_id: documentId,
      page_from: d.page_from,
      page_to: d.page_to,
      ordinal: d.ordinal,
      content: d.content,
      token_count: d.token_count,
      embedding: vectors[i] ? toVectorLiteral(vectors[i]!) : null,
    }));
    const { error: insErr } = await admin.from("chunks").insert(rows);
    if (insErr) throw new Error(`chunk insert failed: ${insErr.message}`);

    // 4. Classify → folder ----------------------------------------------
    let category: string | undefined;
    try {
      const result = await classifyDocument({
        filename: doc.filename,
        firstChunks: drafts.slice(0, 2).map((d) => d.content),
      });
      category = result.category;
      const folderId = await ensureFolder(doc.deal_id, result.category);
      // Only set folder if the seller hasn't already placed it (folder stays null on fresh docs).
      await admin.from("documents").update({ folder_id: folderId }).eq("id", documentId);
      await writeAudit({
        dealId: doc.deal_id,
        actorType: "ai",
        action: "ai.classification",
        subjectId: documentId,
        payload: {
          severity: "info",
          model: result.model,
          raw_completion: result.rawCompletion,
          category: result.category,
        },
      });
    } catch (clsErr) {
      // Classification is metadata — never fail the whole ingest over it.
      console.error(`classification failed for ${documentId}:`, clsErr);
    }

    // 5. Ready -----------------------------------------------------------
    await setStatus("ready");
    await writeAudit({
      dealId: doc.deal_id,
      actorType: "system",
      action: "ingest.document_ready",
      subjectId: documentId,
      payload: { severity: "info", chunks: drafts.length, category: category ?? null },
    });

    return { documentId, status: "ready", chunks: drafts.length, category };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "ingest_error";
    await setStatus("failed", { error_detail: msg });
    await writeAudit({
      dealId: doc.deal_id,
      actorType: "system",
      action: "ingest.parse_failed",
      subjectId: documentId,
      payload: { severity: "high", reason: "ingest_error", detail: msg },
    });
    return { documentId, status: "failed", error: msg };
  }
}

/** Find-or-create a top-level folder by name for a deal. */
async function ensureFolder(dealId: string, name: string): Promise<string> {
  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin
    .from("folders")
    .select("id")
    .eq("deal_id", dealId)
    .eq("name", name)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: created, error } = await admin
    .from("folders")
    .insert({ deal_id: dealId, name })
    .select("id")
    .single();
  if (error || !created) throw new Error(`ensureFolder failed: ${error?.message}`);
  return created.id;
}
