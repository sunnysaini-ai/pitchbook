import { createSupabaseServerClient } from "@/lib/db/server";
import { ReviewQueue } from "@/components/ReviewQueue";
import { DocumentManager } from "@/components/DocumentManager";
import { BuyerManager } from "@/components/BuyerManager";
import { notFound } from "next/navigation";

// "doc_view" -> "Doc view"
function formatKind(kind: string): string {
  const spaced = kind.split("_").join(" ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Seller console: review queue, documents (with AI-access toggle), buyers
// (invite/access/revoke), and the activity feed + audit export.
export default async function DealConsole({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: deal } = await supabase.from("deals").select("*").eq("id", dealId).single();
  if (!deal) notFound();

  const [{ data: documents }, { data: buyers }, { data: folders }, { data: activityEvents }] =
    await Promise.all([
      supabase.from("documents").select("*").eq("deal_id", dealId).order("created_at"),
      supabase.from("buyers").select("*").eq("deal_id", dealId).order("created_at"),
      supabase.from("folders").select("id, name, sort_order").eq("deal_id", dealId).order("sort_order"),
      supabase
        .from("activity_events")
        .select("*")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

  const buyerNameById = new Map((buyers ?? []).map((b) => [b.id, b.org_name]));
  const docFilenameById = new Map((documents ?? []).map((d) => [d.id, d.filename]));

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 space-y-8">
      <div>
        <a href="/" className="text-sm text-[color:var(--color-accent)]">← All deals</a>
        <h1 className="text-2xl font-bold">{deal.name}</h1>
        <p className="text-sm text-slate-500">
          {deal.sector || "Sector TBD"} · answer mode: <strong>{deal.answer_mode}</strong>
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Review queue</h2>
        <ReviewQueue dealId={dealId} />
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div>
          <h2 className="mb-3 text-lg font-semibold">Documents</h2>
          <DocumentManager dealId={dealId} initialDocs={documents ?? []} />
        </div>

        <div>
          <h2 className="mb-3 text-lg font-semibold">Buyers</h2>
          <BuyerManager dealId={dealId} initialBuyers={buyers ?? []} folders={folders ?? []} />
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Activity</h2>
          <a href={`/api/deals/${dealId}/audit.csv`} className="text-sm text-[color:var(--color-accent)]">
            Download audit CSV
          </a>
        </div>
        <div className="card space-y-2 text-sm">
          {(!activityEvents || activityEvents.length === 0) && (
            <p className="text-slate-400">No activity yet.</p>
          )}
          {(activityEvents ?? []).map((ev) => (
            <div
              key={ev.id}
              className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2 first:border-t-0 first:pt-0"
            >
              <div className="min-w-0 truncate">
                <span className="font-medium">{formatKind(ev.kind)}</span>
                <span className="text-slate-400"> · {ev.buyer_id ? buyerNameById.get(ev.buyer_id) ?? "buyer" : "seller"}</span>
                {ev.document_id && (
                  <span className="text-slate-400"> · {docFilenameById.get(ev.document_id) ?? "document"}</span>
                )}
              </div>
              <span className="shrink-0 text-xs text-slate-400">{new Date(ev.created_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
