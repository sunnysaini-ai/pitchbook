import { requireUser, requireDealAdmin, ok, fail } from "@/lib/api";
import { writeAudit } from "@/lib/audit/writeAudit";

// POST /api/deals/:dealId/buyers/:buyerId/revoke — kill switch (RLS-bound
// update; only deal admins can update buyers). Idempotent: revoking an
// already-revoked buyer keeps the original revoked_at rather than bumping it,
// so the audit trail's timestamp always reflects when access actually ended.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ dealId: string; buyerId: string }> }
) {
  try {
    const { dealId, buyerId } = await params;
    const { supabase, user } = await requireUser();
    await requireDealAdmin(supabase, dealId);

    const { data: buyer, error: buyerErr } = await supabase
      .from("buyers")
      .select("id, org_name, contact_email, revoked_at")
      .eq("id", buyerId)
      .eq("deal_id", dealId)
      .maybeSingle();
    if (buyerErr) throw buyerErr;
    if (!buyer) throw Object.assign(new Error("Buyer not found."), { status: 404 });

    let revokedAt = buyer.revoked_at;
    if (!revokedAt) {
      const { data: updated, error: updateErr } = await supabase
        .from("buyers")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", buyerId)
        .select("revoked_at")
        .single();
      if (updateErr) throw updateErr;
      revokedAt = updated.revoked_at;
    }

    await writeAudit({
      dealId,
      actorType: "seller",
      actorId: user.id,
      action: "human.buyer_revoked",
      subjectId: buyerId,
      payload: { org_name: buyer.org_name, contact_email: buyer.contact_email },
    });

    return ok({ revokedAt });
  } catch (e) {
    return fail(e);
  }
}
