import { requireUser, ok, fail } from "@/lib/api";
import { z } from "zod";

const inviteSchema = z.object({
  org_name: z.string().trim().min(1).max(255),
  contact_email: z.string().email(),
  folder_ids: z.array(z.string().uuid()).max(500).default([]),
});

// POST /api/deals/:dealId/buyers — invite a buyer + grant folder access.
// Buyer isolation is enforced by RLS; access is deny-by-default, so a buyer
// with an empty folder grant sees nothing until folders are granted here.
//
// Scaffold note: the magic-link email send is a service-role step
// (supabase.auth.admin.inviteUserByEmail) wired in the RUNBOOK — the buyer
// row + grants (the security-relevant state) are created here under RLS.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await params;
    const { supabase } = await requireUser();
    const input = inviteSchema.parse(await req.json());

    const { data: buyer, error } = await supabase
      .from("buyers")
      .insert({
        deal_id: dealId,
        org_name: input.org_name,
        contact_email: input.contact_email,
      })
      .select("id")
      .single();
    if (error) throw error;

    if (input.folder_ids.length > 0) {
      const rows = input.folder_ids.map((folder_id) => ({
        buyer_id: buyer.id,
        folder_id,
      }));
      const { error: grantErr } = await supabase
        .from("buyer_folder_access")
        .insert(rows);
      if (grantErr) throw grantErr;
    }

    return ok({ buyerId: buyer.id });
  } catch (e) {
    return fail(e);
  }
}
