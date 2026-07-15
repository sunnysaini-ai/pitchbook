import { requireUser, ok, fail } from "@/lib/api";
import { createSupabaseAdminClient } from "@/lib/db/admin";

// GET /api/deals/:dealId/documents/:docId/view
// Returns a short-lived signed URL for the source file, and logs a doc_view
// activity event. Authorization is by RLS: the SELECT below only succeeds if
// the caller is a deal admin OR a buyer with access to the document's folder
// (doc_buyer_read). If it returns nothing, the caller isn't permitted.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ dealId: string; docId: string }> }
) {
  try {
    const { dealId, docId } = await params;
    const { supabase, user } = await requireUser();

    const { data: doc, error } = await supabase
      .from("documents")
      .select("id, filename, storage_path, mime_type")
      .eq("id", docId)
      .maybeSingle();
    if (error) throw error;
    if (!doc) throw Object.assign(new Error("Not permitted."), { status: 403 });

    const admin = createSupabaseAdminClient();
    const { data: signed, error: signErr } = await admin.storage
      .from("deal-docs")
      .createSignedUrl(doc.storage_path, 300);
    if (signErr || !signed) throw new Error(`sign failed: ${signErr?.message}`);

    // Activity: who viewed what. buyer_id resolved best-effort (null for admins).
    const { data: buyer } = await supabase
      .from("buyers")
      .select("id")
      .eq("deal_id", dealId)
      .is("revoked_at", null)
      .maybeSingle();

    await admin.from("activity_events").insert({
      deal_id: dealId,
      buyer_id: buyer?.id ?? null,
      actor_id: user.id,
      kind: "doc_view",
      document_id: docId,
    });

    return ok({ url: signed.signedUrl, filename: doc.filename, mime_type: doc.mime_type });
  } catch (e) {
    return fail(e);
  }
}
