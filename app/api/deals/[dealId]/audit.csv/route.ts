import { requireUser, requireDealAdmin, fail } from "@/lib/api";

// GET /api/deals/:dealId/audit.csv — full audit export (admin only).
// RLS's audit_admin_read policy already restricts SELECT to deal admins, but
// we call requireDealAdmin first anyway so a non-admin gets a clean 403
// instead of a silent empty CSV.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await params;
    const { supabase } = await requireUser();
    await requireDealAdmin(supabase, dealId);

    const { data, error } = await supabase
      .from("audit_log")
      .select("id, created_at, actor_type, actor_id, action, subject_id, payload")
      .eq("deal_id", dealId)
      .order("id", { ascending: true });
    if (error) throw error;

    const header = ["id", "created_at", "actor_type", "actor_id", "action", "subject_id", "payload"];
    const lines = [header.join(",")];
    for (const row of data ?? []) {
      lines.push(
        [
          String(row.id),
          row.created_at,
          row.actor_type,
          row.actor_id ?? "",
          row.action,
          row.subject_id ?? "",
          JSON.stringify(row.payload),
        ]
          .map(csvField)
          .join(","),
      );
    }
    const csv = lines.join("\n");

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="audit-${dealId}.csv"`,
      },
    });
  } catch (e) {
    return fail(e);
  }
}

// Quote a CSV field if it contains a comma, quote, or newline; embedded
// quotes are doubled per RFC 4180.
function csvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
