import { requireUser, ok, fail } from "@/lib/api";
import { answerQuestion } from "@/lib/analyst/answer";
import { z } from "zod";

const askSchema = z.object({ body: z.string().trim().min(3).max(4000) });

// POST /api/deals/:dealId/questions
// Buyer asks the analyst. We (1) resolve the caller's buyer row under RLS,
// (2) insert the question under RLS, then (3) run the analyst worker (service
// role) which enforces the groundedness gate + guardrails and writes audit.
//
// Scaffold note: this awaits the answer synchronously. AGENT_SPEC §7 specifies
// an async job returning {questionId} immediately + SSE streaming; that's a
// follow-up (see docs/DECISIONS + RUNBOOK). The trust-critical path is here.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await params;
    const { supabase } = await requireUser();
    const { body } = askSchema.parse(await req.json());

    // Resolve the caller's own buyer row for this deal (RLS scopes to self).
    const { data: buyer, error: buyerErr } = await supabase
      .from("buyers")
      .select("id")
      .eq("deal_id", dealId)
      .is("revoked_at", null)
      .maybeSingle();
    if (buyerErr) throw buyerErr;
    if (!buyer) {
      const e = new Error("Not a buyer on this deal, or access revoked.");
      (e as any).status = 403;
      throw e;
    }

    const { data: question, error: qErr } = await supabase
      .from("questions")
      .insert({ deal_id: dealId, buyer_id: buyer.id, body })
      .select("id")
      .single();
    if (qErr) throw qErr;

    const result = await answerQuestion({
      questionId: question.id,
      dealId,
      buyerId: buyer.id,
      questionBody: body,
    });

    // In strict mode the buyer sees only that it's queued (RLS hides drafts).
    return ok({
      questionId: question.id,
      status: result.status,
      grounded: result.isGrounded,
    });
  } catch (e) {
    return fail(e);
  }
}
