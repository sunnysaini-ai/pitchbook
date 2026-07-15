import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/db/server";

// Shared helpers for route handlers. Every handler resolves the caller from
// the RLS-bound server client — never the service role — except where a
// worker explicitly needs to bypass RLS (analyst/ingest).

export async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const err = new Error("UNAUTHENTICATED");
    (err as any).status = 401;
    throw err;
  }
  return { supabase, user };
}

// Authorize the caller as an admin of this deal. Uses the RLS-bound client:
// deals is readable only by its admins (is_deal_admin), so a returned row IS
// the authorization. Throws 403 otherwise.
export async function requireDealAdmin(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  dealId: string
) {
  const { data, error } = await supabase.from("deals").select("id").eq("id", dealId).maybeSingle();
  if (error) throw error;
  if (!data) {
    const e = new Error("Not an admin of this deal.");
    (e as any).status = 403;
    throw e;
  }
}

export function ok(data: unknown) {
  return NextResponse.json({ data });
}

export function fail(e: unknown) {
  const message = e instanceof Error ? e.message : "Unknown error";
  const status = (e as any)?.status ?? (message === "UNAUTHENTICATED" ? 401 : 500);
  return NextResponse.json({ error: { code: status, message } }, { status });
}
