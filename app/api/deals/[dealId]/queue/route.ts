import { requireUser, ok, fail } from "@/lib/api";

// GET /api/deals/:dealId/queue — admin review queue: drafts + escalations
// awaiting a human. RLS ensures only deal admins can read these.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await params;
    const { supabase } = await requireUser();
    const { data, error } = await supabase
      .from("answers")
      .select("id, body, status, is_grounded, model, created_at, buyer_id, question_id, questions(body)")
      .eq("deal_id", dealId)
      .in("status", ["draft", "escalated"])
      .order("created_at", { ascending: true });
    if (error) throw error;
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}
