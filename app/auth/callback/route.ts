import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/db/server";

// Exchanges the magic-link code for a session, then routes the user home.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  if (code) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(`${origin}/`);
}
