import { createSupabaseServerClient } from "@/lib/db/server";
import { DealCreator } from "@/components/DealCreator";
import { money } from "@/lib/utils";

// Seller home: deals this firm administers. RLS returns only the caller's deals.
export default async function Home() {
  const supabase = await createSupabaseServerClient();
  const { data: deals } = await supabase
    .from("deals")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Deals</h1>
          <p className="text-sm text-slate-500">Each deal is one company you're taking to market.</p>
        </div>
        <DealCreator />
      </div>

      {(!deals || deals.length === 0) && (
        <div className="card text-sm text-slate-500">
          No deals yet. Create your first engagement to open a data room.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {deals?.map((d) => (
          <a key={d.id} href={`/deals/${d.id}`} className="card block hover:border-[color:var(--color-accent)]">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{d.name}</h3>
              <span className="badge bg-slate-100 text-slate-600">{d.answer_mode}</span>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {d.sector || "Sector TBD"} · {money(d.ev_low)}–{money(d.ev_high)} EV
            </p>
          </a>
        ))}
      </div>
    </div>
  );
}
