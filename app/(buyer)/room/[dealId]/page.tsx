import { createSupabaseServerClient } from "@/lib/db/server";
import { BuyerRoomClient } from "@/components/BuyerRoomClient";
import { notFound } from "next/navigation";

// Buyer room: two-pane document viewer + analyst chat with resolvable citation
// chips (T-12). The folder index + documents are permission-filtered by RLS —
// a buyer sees only granted folders/documents.
export default async function BuyerRoom({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: deal } = await supabase
    .from("deals")
    .select("id, name, sector")
    .eq("id", dealId)
    .single();
  if (!deal) notFound();

  const { data: documents } = await supabase
    .from("documents")
    .select("id, filename")
    .eq("deal_id", dealId)
    .order("filename");

  return (
    <BuyerRoomClient
      dealId={dealId}
      deal={{ name: deal.name, sector: deal.sector }}
      documents={documents ?? []}
    />
  );
}
