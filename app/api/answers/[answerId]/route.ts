import { requireUser, ok, fail } from "@/lib/api";
import { writeAudit } from "@/lib/audit/writeAudit";
import { moderateAnswerRequestSchema } from "@/lib/schema";

// PATCH /api/answers/:answerId — seller moderation of a draft/escalated answer.
// approve → status 'approved' (RLS then lets the buyer see it, INV-5).
// reject  → status 'rejected'. edit → replace body (audited with diff), approve.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ answerId: string }> }
) {
  try {
    const { answerId } = await params;
    const { supabase, user } = await requireUser();
    const input = moderateAnswerRequestSchema.parse({
      ...(await req.json()),
      answer_id: answerId,
    });

    // Load current answer (RLS: admin-only) for deal_id + before-image.
    const { data: current, error: readErr } = await supabase
      .from("answers")
      .select("id, deal_id, body")
      .eq("id", answerId)
      .single();
    if (readErr) throw readErr;

    if (input.action === "approve") {
      const { error } = await supabase
        .from("answers")
        .update({ status: "approved" })
        .eq("id", answerId);
      if (error) throw error;
      await writeAudit({
        dealId: current.deal_id,
        actorType: "seller",
        actorId: user.id,
        action: "human.answer_approved",
        subjectId: answerId,
        payload: { severity: "info" },
      });
    } else if (input.action === "reject") {
      const { error } = await supabase
        .from("answers")
        .update({ status: "rejected" })
        .eq("id", answerId);
      if (error) throw error;
      await writeAudit({
        dealId: current.deal_id,
        actorType: "seller",
        actorId: user.id,
        action: "human.answer_rejected",
        subjectId: answerId,
        payload: { severity: "info", reason: input.reason },
      });
    } else {
      // edit → replace body, mark edited_by, approve, audit the diff.
      const { error } = await supabase
        .from("answers")
        .update({ body: input.body, edited_by: user.id, status: "approved" })
        .eq("id", answerId);
      if (error) throw error;
      await writeAudit({
        dealId: current.deal_id,
        actorType: "seller",
        actorId: user.id,
        action: "human.answer_edited",
        subjectId: answerId,
        payload: {
          severity: "info",
          diff: { before: current.body, after: input.body },
        },
      });
    }

    return ok({ answerId, action: input.action });
  } catch (e) {
    return fail(e);
  }
}
