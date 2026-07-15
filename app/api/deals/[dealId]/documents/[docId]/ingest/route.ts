import { requireUser, requireDealAdmin, ok, fail } from "@/lib/api";
import { ingestDocument } from "@/lib/ingest/run";

// POST /api/deals/:dealId/documents/:docId/ingest
// Runs parse → chunk → embed → classify for one document. Synchronous in the
// scaffold (the body is the future queue worker; see lib/ingest/run.ts).
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ dealId: string; docId: string }> }
) {
  try {
    const { dealId, docId } = await params;
    const { supabase } = await requireUser();
    await requireDealAdmin(supabase, dealId);
    const result = await ingestDocument(docId);
    return ok(result);
  } catch (e) {
    return fail(e);
  }
}
