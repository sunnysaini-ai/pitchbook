import { requireUser, ok, fail } from "@/lib/api";

// GET /api/deals/:dealId/answers — the caller-buyer's Q&A history.
// RLS returns only this buyer's answers, and only those approved/released in
// strict mode (INV-5) — the trust boundary is the database, not this handler.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await params;
    const { supabase } = await requireUser();
    const { data, error } = await supabase
      .from("answers")
      .select(
        "id, body, status, is_grounded, created_at, question_id, questions(body), citations(id, ordinal, quote, document_id, page_from, page_to)"
      )
      .eq("deal_id", dealId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}
