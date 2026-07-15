import { createSupabaseServerClient } from "@/lib/db/server";
import { ReviewQueue } from "@/components/ReviewQueue";
import { DocumentManager } from "@/components/DocumentManager";
import { notFound } from "next/navigation";

// Seller console: review queue, documents (with AI-access toggle), buyers.
export default async function DealConsole({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: deal } = await supabase.from("deals").select("*").eq("id", dealId).single();
  if (!deal) notFound();

  const [{ data: documents }, { data: buyers }] = await Promise.all([
    supabase.from("documents").select("*").eq("deal_id", dealId).order("created_at"),
    supabase.from("buyers").select("*").eq("deal_id", dealId).order("created_at"),
  ]);

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
          <div className="card space-y-2 text-sm">
            {(buyers ?? []).map((b) => (
              <div key={b.id} className="flex items-center justify-between">
                <span>{b.org_name}</span>
                <span className={`badge ${b.revoked_at ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"}`}>
                  {b.revoked_at ? "revoked" : "active"}
                </span>
              </div>
            ))}
            {(!buyers || buyers.length === 0) && <p className="text-slate-400">No buyers invited yet.</p>}
          </div>
        </div>
      </section>
    </div>
  );
}
