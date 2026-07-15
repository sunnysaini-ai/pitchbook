import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/db/server";
import type { EmailOtpType } from "@supabase/supabase-js";

// Exchanges the magic-link credentials for a session, then routes the user
// home. Handles both flows:
//   - PKCE (?code=...): requires the code_verifier cookie set by the SAME
//     browser profile that requested the link. Cross-browser clicks fail —
//     we surface that instead of silently looping back to /login.
//   - token_hash (?token_hash=...&type=...): direct OTP verification.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/";

  const supabase = await createSupabaseServerClient();

  const toLoginWithError = (message: string) =>
    NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(message)}`
    );

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    return toLoginWithError(
      `Sign-in failed: ${error.message}. Request a new link and open it in the same browser window you requested it from.`
    );
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    return toLoginWithError(
      `Sign-in failed: ${error.message}. The link may have expired or already been used — request a new one.`
    );
  }

  return toLoginWithError(
    "That link didn't contain a sign-in code. Request a new magic link."
  );
}
