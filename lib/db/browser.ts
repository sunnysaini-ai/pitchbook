/**
 * lib/db/browser.ts
 *
 * Browser Supabase client (@supabase/ssr). Anon key only — every query is
 * subject to RLS. This is the ONLY client that may exist in client
 * components. It can never see another buyer's rows (INV-2), unapproved
 * strict-mode answers (INV-5), chunks, or the audit log, because those
 * policies live in the database.
 */

import { createBrowserClient } from "@supabase/ssr";
import type { Database, TypedSupabaseClient } from "@/lib/db/server";

// CRITICAL: these MUST be static `process.env.NEXT_PUBLIC_*` member
// expressions. Next.js inlines NEXT_PUBLIC_ vars into the client bundle at
// build time ONLY when they are accessed statically — a dynamic
// `process.env[name]` lookup compiles to a runtime read, and the browser has
// no runtime env, so it is undefined forever regardless of hosting config.
// (This exact bug shipped once; see docs/DECISIONS.md #31.)
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let cached: TypedSupabaseClient | null = null;

/** Singleton per browser tab — @supabase/ssr manages the cookie session. */
export function createSupabaseBrowserClient(): TypedSupabaseClient {
  if (cached) return cached;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "Supabase browser config missing: NEXT_PUBLIC_SUPABASE_URL / " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY were not present at BUILD time. " +
        "Set them in the host's env settings, then rebuild/redeploy.",
    );
  }
  cached = createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
  return cached;
}
