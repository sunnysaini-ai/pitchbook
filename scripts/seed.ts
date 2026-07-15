/**
 * scripts/seed.ts — seed the Meridian Logistics fixture (supabase/seed/manifest.ts)
 * into the live Supabase project. Idempotent: if the deal already exists it
 * prints the existing GOLDEN_DEAL_ID / GOLDEN_BUYER_ID and exits.
 *
 * Run: npx tsx scripts/seed.ts        (env from .env.local must be exported)
 */
import { createClient } from "@supabase/supabase-js";
import {
  MERIDIAN_DEAL,
  SEED_FOLDERS,
  SEED_DOCUMENTS,
  SEED_BUYERS,
} from "../supabase/seed/manifest";
import { chunkDocument } from "../lib/ingest/chunk";
import { embedTexts, toVectorLiteral } from "../lib/ingest/embed";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!url || !serviceKey) throw new Error("Missing Supabase env");
if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");

const db = createClient(url, serviceKey, { auth: { persistSession: false } });

async function ensureAuthUser(email: string): Promise<string> {
  const created = await db.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (created.data.user) return created.data.user.id;
  // Already exists → find by listing (small project, fine)
  const list = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  const hit = list.data.users.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase(),
  );
  if (!hit) throw new Error(`Cannot create or find auth user ${email}: ${created.error?.message}`);
  return hit.id;
}

async function main() {
  // Idempotency check
  const existing = await db
    .from("deals")
    .select("id")
    .eq("name", MERIDIAN_DEAL.name)
    .maybeSingle();
  if (existing.data) {
    const golden = SEED_BUYERS.find((b) => b.goldenBuyer)!;
    const buyer = await db
      .from("buyers")
      .select("id")
      .eq("deal_id", existing.data.id)
      .eq("org_name", golden.orgName)
      .maybeSingle();
    console.log(`ALREADY SEEDED`);
    console.log(`GOLDEN_DEAL_ID=${existing.data.id}`);
    console.log(`GOLDEN_BUYER_ID=${buyer.data?.id ?? "MISSING"}`);
    return;
  }

  // 1. Seller + deal
  const sellerId = await ensureAuthUser("seller@meridianlogistics.example.com");
  const deal = await db
    .from("deals")
    .insert({
      name: MERIDIAN_DEAL.name,
      sector: MERIDIAN_DEAL.sector,
      ev_low: MERIDIAN_DEAL.ev_low,
      ev_high: MERIDIAN_DEAL.ev_high,
      answer_mode: MERIDIAN_DEAL.answer_mode,
      owner_id: sellerId,
    })
    .select("id")
    .single();
  if (deal.error) throw deal.error;
  const dealId = deal.data.id as string;
  const da = await db
    .from("deal_admins")
    .insert({ deal_id: dealId, user_id: sellerId, role: "seller" });
  if (da.error) throw da.error;
  console.log(`deal: ${dealId}`);

  // 2. Folders
  const folderIds = new Map<string, string>();
  for (const f of SEED_FOLDERS) {
    const r = await db
      .from("folders")
      .insert({ deal_id: dealId, name: f.name, sort_order: f.sort_order })
      .select("id")
      .single();
    if (r.error) throw r.error;
    folderIds.set(f.key, r.data.id as string);
  }
  console.log(`folders: ${folderIds.size}`);

  // 3. Documents (+ chunks + embeddings for 'ready' docs with pages)
  let ready = 0,
    failed = 0,
    meta = 0,
    totalChunks = 0;
  for (const doc of SEED_DOCUMENTS) {
    const isReady = doc.expectedStatus === "ready" && doc.pages?.length;
    const row = await db
      .from("documents")
      .insert({
        deal_id: dealId,
        folder_id: folderIds.get(doc.folderKey)!,
        filename: doc.filename,
        storage_path: `deals/${dealId}/${doc.filename}`,
        mime_type: doc.mimeType,
        page_count: doc.pages?.length ?? null,
        status: doc.expectedStatus === "failed" ? "failed" : isReady ? "ready" : "uploaded",
        error_detail: doc.expectedStatus === "failed" ? (doc.errorDetail ?? "likely_scanned") : null,
        ai_accessible: doc.aiAccessible,
      })
      .select("id")
      .single();
    if (row.error) throw row.error;
    const docId = row.data.id as string;

    if (isReady) {
      const drafts = chunkDocument(doc.pages!);
      const vectors = await embedTexts(drafts.map((d) => d.content));
      if (vectors.length !== drafts.length) {
        throw new Error(`embed returned ${vectors.length} vectors for ${drafts.length} chunks`);
      }
      const chunkRows = drafts.map((d, i) => ({
        deal_id: dealId,
        document_id: docId,
        page_from: d.page_from,
        page_to: d.page_to,
        ordinal: d.ordinal,
        content: d.content,
        token_count: d.token_count,
        embedding: toVectorLiteral(vectors[i]!),
      }));
      for (let i = 0; i < chunkRows.length; i += 100) {
        const ins = await db.from("chunks").insert(chunkRows.slice(i, i + 100));
        if (ins.error) throw ins.error;
      }
      totalChunks += chunkRows.length;
      ready++;
    } else if (doc.expectedStatus === "failed") {
      failed++;
    } else {
      meta++;
    }

    const audit = await db.from("audit_log").insert({
      deal_id: dealId,
      actor_type: "system",
      actor_id: null,
      action: doc.expectedStatus === "failed" ? "ingest.parse_failed" : "ingest.document_ready",
      subject_id: docId,
      payload: { seed: true, filename: doc.filename, status: doc.expectedStatus },
    });
    if (audit.error) throw audit.error;
    process.stdout.write(".");
  }
  console.log(`\ndocs: ${ready} ready (${totalChunks} chunks embedded), ${failed} failed, ${meta} metadata-only`);

  // 4. Buyers
  let goldenBuyerId = "";
  for (const b of SEED_BUYERS) {
    const userId = await ensureAuthUser(b.contactEmail);
    const r = await db
      .from("buyers")
      .insert({
        deal_id: dealId,
        org_name: b.orgName,
        contact_email: b.contactEmail,
        user_id: userId,
      })
      .select("id")
      .single();
    if (r.error) throw r.error;
    const buyerId = r.data.id as string;
    if (b.goldenBuyer) goldenBuyerId = buyerId;
    const grants = b.folderKeys.map((k) => ({
      buyer_id: buyerId,
      folder_id: folderIds.get(k)!,
    }));
    const g = await db.from("buyer_folder_access").insert(grants);
    if (g.error) throw g.error;
    console.log(`buyer: ${b.orgName} (${grants.length} folders)`);
  }

  console.log(`\nGOLDEN_DEAL_ID=${dealId}`);
  console.log(`GOLDEN_BUYER_ID=${goldenBuyerId}`);
}

main().catch((e) => {
  console.error("SEED FAILED:", e);
  process.exit(1);
});
