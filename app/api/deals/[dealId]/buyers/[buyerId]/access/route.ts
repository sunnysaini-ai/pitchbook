import { requireUser, requireDealAdmin, ok, fail } from "@/lib/api";
import { writeAudit } from "@/lib/audit/writeAudit";
import { z } from "zod";

const accessSchema = z.object({
  folder_ids: z.array(z.string().uuid()).max(500),
});

// PUT /api/deals/:dealId/buyers/:buyerId/access  { folder_ids }
// Replaces the buyer's folder-access grant set wholesale (delete + insert,
// both RLS-bound so only a deal admin can do this). Deny-by-default means an
// empty folder_ids array is a valid "revoke all folder access" request.
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ dealId: string; buyerId: string }> }
) {
  try {
    const { dealId, buyerId } = await params;
    const { supabase, user } = await requireUser();
    await requireDealAdmin(supabase, dealId);
    const { folder_ids } = accessSchema.parse(await req.json());

    const { data: buyer, error: buyerErr } = await supabase
      .from("buyers")
      .select("id")
      .eq("id", buyerId)
      .eq("deal_id", dealId)
      .maybeSingle();
    if (buyerErr) throw buyerErr;
    if (!buyer) throw Object.assign(new Error("Buyer not found."), { status: 404 });

    const { error: delErr } = await supabase
      .from("buyer_folder_access")
      .delete()
      .eq("buyer_id", buyerId);
    if (delErr) throw delErr;

    if (folder_ids.length > 0) {
      const rows = folder_ids.map((folder_id) => ({ buyer_id: buyerId, folder_id }));
      const { error: insErr } = await supabase.from("buyer_folder_access").insert(rows);
      if (insErr) throw insErr;
    }

    await writeAudit({
      dealId,
      actorType: "seller",
      actorId: user.id,
      action: "human.buyer_access_changed",
      subjectId: buyerId,
      payload: { folder_count: folder_ids.length, folder_ids },
    });

    return ok({ folderIds: folder_ids });
  } catch (e) {
    return fail(e);
  }
}
