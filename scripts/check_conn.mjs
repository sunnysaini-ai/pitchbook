// Connectivity smoke test — verifies the keys + new Supabase key format work
// with the pinned SDK, before we rely on them for migrations/gates.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// tiny .env.local loader
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log("URL:", url);

// 1) Service-role client: list storage buckets (works pre-migrations)
const admin = createClient(url, secret, { auth: { persistSession: false } });
const buckets = await admin.storage.listBuckets();
console.log("[service key] storage.listBuckets:", buckets.error ? `ERROR ${buckets.error.message}` : JSON.stringify(buckets.data?.map(b => `${b.name}${b.public ? " (PUBLIC!)" : " (private)"}`)));

// 2) Anon/publishable client: hit auth health (no session needed)
const pub = createClient(url, anon, { auth: { persistSession: false } });
const sess = await pub.auth.getSession();
console.log("[publishable key] auth.getSession reachable:", sess.error ? `ERROR ${sess.error.message}` : "ok");

// 3) Model/parse key presence only — never print key material.
console.log("ANTHROPIC key present:", Boolean(process.env.ANTHROPIC_API_KEY));
console.log("OPENAI key present:", Boolean(process.env.OPENAI_API_KEY));
console.log("LLAMA key present:", Boolean(process.env.LLAMA_CLOUD_API_KEY));
