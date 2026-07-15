import { requireUser, requireDealAdmin, ok, fail } from "@/lib/api";

// GET /api/deals/:dealId/buyers/access
// Current folder-access grants for every buyer on this deal, as a single
// batched call (avoids N per-buyer fetches from the seller console). RLS-
// bound: buyer_folder_access rows are only readable by admins of the buyer's
// deal (bfa_admin_all), and we further scope to this deal's buyer ids so the
// response never includes grants from a different deal the caller also
// admins.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await params;
    const { supabase } = await requireUser();
    await requireDealAdmin(supabase, dealId);

    const { data: buyers, error: buyersErr } = await supabase
      .from("buyers")
      .select("id")
      .eq("deal_id", dealId);
    if (buyersErr) throw buyersErr;

    const buyerIds = (buyers ?? []).map((b) => b.id);
    const grants: Record<string, string[]> = {};
    for (const id of buyerIds) grants[id] = [];

    if (buyerIds.length > 0) {
      const { data: rows, error: accessErr } = await supabase
        .from("buyer_folder_access")
        .select("buyer_id, folder_id")
        .in("buyer_id", buyerIds);
      if (accessErr) throw accessErr;
      for (const row of rows ?? []) {
        (grants[row.buyer_id] ??= []).push(row.folder_id);
      }
    }

    return ok({ grants });
  } catch (e) {
    return fail(e);
  }
}
