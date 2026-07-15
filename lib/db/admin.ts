/**
 * lib/db/admin.ts
 *
 * Service-role Supabase client. BYPASSES RLS.
 *
 * Allowed call sites — exactly two, by contract:
 *   1. lib/audit/writeAudit.ts   (audit_log has no insert policy for
 *      authenticated; all audit writes flow through the service role)
 *   2. lib/retrieval/search.ts and the ingest worker (chunks have NO buyer
 *      read policy; retrieval applies the §5.1 permission filter INSIDE the
 *      SQL it runs, never as a post-filter)
 *
 * Never import this from a route handler that serves buyer traffic directly,
 * and never leak SUPABASE_SERVICE_ROLE_KEY to the client bundle (no
 * NEXT_PUBLIC_ prefix, server-only module).
 */

import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database, TypedSupabaseClient } from "@/lib/db/server";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required environment variable ${name}. The admin client ` +
        `cannot start without it — refusing to fall back to the anon key.`,
    );
  }
  return v;
}

let cached: TypedSupabaseClient | null = null;

/**
 * Lazily constructed singleton. Lazy so that merely importing a module that
 * type-references the admin client does not demand the key at build time.
 */
export function createSupabaseAdminClient(): TypedSupabaseClient {
  if (cached) return cached;
  cached = createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        // The service role is a machine identity: no session persistence,
        // no token auto-refresh, nothing touching browser storage.
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
  return cached;
}
