import { requireUser, requireDealAdmin, ok, fail } from "@/lib/api";
import { createSupabaseAdminClient } from "@/lib/db/admin";

const BUCKET = "deal-docs";

// POST /api/deals/:dealId/documents  (multipart: file)
// Seller uploads a source document. Stored in the private 'deal-docs' bucket
// under <dealId>/<ts>-<name>; a documents row is created as 'uploaded'.
// Authorization is app-layer (deal admin) + storage stays server-side via the
// service role (object-level storage RLS is a recommended hardening follow-up).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await params;
    const { supabase } = await requireUser();
    await requireDealAdmin(supabase, dealId);

    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return fail(Object.assign(new Error("file required"), { status: 400 }));

    const safeName = file.name.replace(/[^\w.\- ]+/g, "_");
    const storagePath = `${dealId}/${Date.now()}-${safeName}`;
    const bytes = Buffer.from(await file.arrayBuffer());

    const admin = createSupabaseAdminClient();
    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(storagePath, bytes, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
    if (upErr) throw upErr;

    const { data: doc, error } = await admin
      .from("documents")
      .insert({
        deal_id: dealId,
        filename: file.name,
        storage_path: storagePath,
        mime_type: file.type || "application/octet-stream",
        status: "uploaded",
      })
      .select("id, filename, status")
      .single();
    if (error) throw error;

    return ok(doc);
  } catch (e) {
    return fail(e);
  }
}

// GET /api/deals/:dealId/documents — admin list (RLS-scoped).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await params;
    const { supabase } = await requireUser();
    const { data, error } = await supabase
      .from("documents")
      .select("id, filename, status, ai_accessible, error_detail, folder_id, page_count")
      .eq("deal_id", dealId)
      .order("created_at");
    if (error) throw error;
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}
