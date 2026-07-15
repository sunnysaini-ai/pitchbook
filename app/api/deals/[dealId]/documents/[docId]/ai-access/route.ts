import { requireUser, requireDealAdmin, ok, fail } from "@/lib/api";
import { writeAudit } from "@/lib/audit/writeAudit";
import { z } from "zod";

const schema = z.object({ ai_accessible: z.boolean() });

// POST /api/deals/:dealId/documents/:docId/ai-access  { ai_accessible }
// Toggles whether the analyst may retrieve/cite this document (INV-3).
// Audited — this is a security-relevant control.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ dealId: string; docId: string }> }
) {
  try {
    const { dealId, docId } = await params;
    const { supabase, user } = await requireUser();
    await requireDealAdmin(supabase, dealId);
    const { ai_accessible } = schema.parse(await req.json());

    const { error } = await supabase
      .from("documents")
      .update({ ai_accessible })
      .eq("id", docId);
    if (error) throw error;

    await writeAudit({
      dealId,
      actorType: "seller",
      actorId: user.id,
      action: "human.doc_ai_access_changed",
      subjectId: docId,
      payload: { severity: "info", ai_accessible },
    });

    return ok({ docId, ai_accessible });
  } catch (e) {
    return fail(e);
  }
}
