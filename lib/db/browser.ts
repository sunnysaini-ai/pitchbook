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

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required environment variable ${name}.`);
  }
  return v;
}

let cached: TypedSupabaseClient | null = null;

/** Singleton per browser tab — @supabase/ssr manages the cookie session. */
export function createSupabaseBrowserClient(): TypedSupabaseClient {
  if (cached) return cached;
  cached = createBrowserClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  );
  return cached;
}
