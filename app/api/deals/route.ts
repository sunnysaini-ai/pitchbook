import { requireUser, ok, fail } from "@/lib/api";
import { z } from "zod";

const createDealSchema = z.object({
  name: z.string().trim().min(1).max(255),
  sector: z.string().trim().max(255).optional(),
  ev_low: z.number().nonnegative().optional(),
  ev_high: z.number().nonnegative().optional(),
  answer_mode: z.enum(["strict", "fast"]).default("strict"),
});

// POST /api/deals — seller creates a deal + becomes its 'seller' admin.
export async function POST(req: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = createDealSchema.parse(await req.json());

    const { data: deal, error } = await supabase
      .from("deals")
      .insert({ ...body, owner_id: user.id })
      .select()
      .single();
    if (error) throw error;

    const { error: adminErr } = await supabase
      .from("deal_admins")
      .insert({ deal_id: deal.id, user_id: user.id, role: "seller" });
    if (adminErr) throw adminErr;

    return ok(deal);
  } catch (e) {
    return fail(e);
  }
}

// GET /api/deals — deals the caller administers (RLS returns only their rows).
export async function GET() {
  try {
    const { supabase } = await requireUser();
    const { data, error } = await supabase
      .from("deals")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}
