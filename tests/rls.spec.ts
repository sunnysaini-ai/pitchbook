/**
 * tests/rls.spec.ts — T-04 GATE (INV-2: buyer isolation)
 *
 * One deal, two buyers with DISJOINT folder access. Signed in as Buyer A
 * (a real authenticated client, anon key + password session — exactly what
 * the browser gets), every table scoped to Buyer B must return ZERO rows:
 * documents, chunks, questions, answers, citations, activity_events.
 *
 * This runs against a real Supabase (local `supabase start` or a scratch
 * project) with migrations 0001 + 0002 applied. If the env is missing the
 * suite SKIPS with a loud reason — it never silently passes.
 *
 * Required env:
 *   NEXT_PUBLIC_SUPABASE_URL   (or SUPABASE_URL)
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY)
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const envReady = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE_KEY);
const skipReason =
  "SKIPPED: rls.spec.ts requires NEXT_PUBLIC_SUPABASE_URL, " +
  "NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY pointing at " +
  "a database with migrations 0001+0002 applied (e.g. `supabase start`). " +
  "INV-2 is a release gate — this suite must run green before ship.";

const runId = Math.random().toString(36).slice(2, 10);
const PASSWORD = `test-password-${runId}-A1!`;

interface Fixture {
  admin: SupabaseClient;
  buyerAClient: SupabaseClient;
  dealId: string;
  sellerUserId: string;
  buyerAUserId: string;
  buyerBUserId: string;
  buyerAId: string;
  buyerBId: string;
  folderAId: string;
  folderBId: string;
  docAId: string;
  docBId: string;
  chunkBId: string;
  questionBId: string;
  answerBId: string;
  citationBId: string;
  activityBId: string;
}

let fx: Fixture;

async function createUser(
  admin: SupabaseClient,
  email: string,
): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  return data.user.id;
}

/** Insert helper that throws instead of returning silent nulls. */
async function ins<T extends { id?: string }>(
  admin: SupabaseClient,
  table: string,
  row: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await admin.from(table).insert(row).select("id").single<T>();
  if (error || !data) throw new Error(`insert into ${table} failed: ${error?.message}`);
  return data.id as string;
}

describe.skipIf(!envReady)("INV-2 buyer isolation (T-04 gate)", () => {
  beforeAll(async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const sellerUserId = await createUser(admin, `seller-${runId}@test.dealdesk.local`);
    const buyerAUserId = await createUser(admin, `buyer-a-${runId}@test.dealdesk.local`);
    const buyerBUserId = await createUser(admin, `buyer-b-${runId}@test.dealdesk.local`);

    const dealId = await ins(admin, "deals", {
      name: `RLS Gate Deal ${runId}`,
      answer_mode: "strict",
      owner_id: sellerUserId,
    });
    await admin.from("deal_admins").insert({ deal_id: dealId, user_id: sellerUserId, role: "seller" });

    // Disjoint folders
    const folderAId = await ins(admin, "folders", { deal_id: dealId, name: "Folder A (buyer A only)" });
    const folderBId = await ins(admin, "folders", { deal_id: dealId, name: "Folder B (buyer B only)" });

    const docAId = await ins(admin, "documents", {
      deal_id: dealId, folder_id: folderAId, filename: "a.pdf",
      storage_path: `deals/${dealId}/a.pdf`, mime_type: "application/pdf", status: "ready",
    });
    const docBId = await ins(admin, "documents", {
      deal_id: dealId, folder_id: folderBId, filename: "b.pdf",
      storage_path: `deals/${dealId}/b.pdf`, mime_type: "application/pdf", status: "ready",
    });

    const chunkBId = await ins(admin, "chunks", {
      deal_id: dealId, document_id: docBId, page_from: 1, page_to: 1,
      ordinal: 0, content: "Buyer B secret: churn spiked in Q3.", token_count: 10,
    });
    // A chunk in buyer A's own folder — buyers must not read chunks EITHER.
    await ins(admin, "chunks", {
      deal_id: dealId, document_id: docAId, page_from: 1, page_to: 1,
      ordinal: 0, content: "Chunk in buyer A's folder.", token_count: 6,
    });

    const buyerAId = await ins(admin, "buyers", {
      deal_id: dealId, org_name: "Alpha Capital",
      contact_email: `buyer-a-${runId}@test.dealdesk.local`, user_id: buyerAUserId,
    });
    const buyerBId = await ins(admin, "buyers", {
      deal_id: dealId, org_name: "Beta Partners",
      contact_email: `buyer-b-${runId}@test.dealdesk.local`, user_id: buyerBUserId,
    });
    await admin.from("buyer_folder_access").insert([
      { buyer_id: buyerAId, folder_id: folderAId },
      { buyer_id: buyerBId, folder_id: folderBId },
    ]);

    // Buyer B's Q&A trail — the thing buyer A must NEVER see.
    const questionBId = await ins(admin, "questions", {
      deal_id: dealId, buyer_id: buyerBId, body: "What is customer concentration?",
    });
    // Status 'approved' on purpose: visibility must be blocked by OWNERSHIP,
    // not merely by the strict-mode status clause.
    const answerBId = await ins(admin, "answers", {
      question_id: questionBId, deal_id: dealId, buyer_id: buyerBId,
      body: "Top customer is 45% of revenue.", status: "approved",
      is_grounded: true, model: "claude-sonnet-4-6",
    });
    const citationBId = await ins(admin, "citations", {
      answer_id: answerBId, chunk_id: chunkBId, document_id: docBId,
      page_from: 1, page_to: 1, quote: "churn spiked in Q3", ordinal: 0,
    });
    const activityBId = await ins(admin, "activity_events", {
      deal_id: dealId, buyer_id: buyerBId, actor_id: buyerBUserId,
      kind: "document.viewed", document_id: docBId,
    });
    // And an audit row, which no buyer may ever read.
    await admin.from("audit_log").insert({
      deal_id: dealId, actor_type: "ai", action: "ai.answer_generated",
      payload: { test: true },
    });

    // Sign in as Buyer A with the ANON key — the exact client a browser gets.
    const buyerAClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signInError } = await buyerAClient.auth.signInWithPassword({
      email: `buyer-a-${runId}@test.dealdesk.local`,
      password: PASSWORD,
    });
    if (signInError) throw new Error(`buyer A sign-in failed: ${signInError.message}`);

    fx = {
      admin, buyerAClient, dealId, sellerUserId, buyerAUserId, buyerBUserId,
      buyerAId, buyerBId, folderAId, folderBId, docAId, docBId, chunkBId,
      questionBId, answerBId, citationBId, activityBId,
    };
  }, 60_000);

  afterAll(async () => {
    if (!fx) return;
    await fx.buyerAClient.auth.signOut();
    // audit_log rows are append-only by design and cannot be deleted; the
    // deal row is left in place for the same reason (audit_log FK). All
    // other fixture rows cascade if you drop the deal from a superuser
    // session; test databases are throwaway.
    for (const uid of [fx.buyerAUserId, fx.buyerBUserId]) {
      await fx.admin.auth.admin.deleteUser(uid).catch(() => undefined);
    }
  });

  // -------------------------------------------------------------------------
  // Sanity: buyer A's grants actually work (RLS isn't just failing everything)
  // -------------------------------------------------------------------------
  it("buyer A CAN read their own folder's document", async () => {
    const { data, error } = await fx.buyerAClient
      .from("documents").select("id").eq("id", fx.docAId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("buyer A CAN read their own buyer row and no other", async () => {
    const { data, error } = await fx.buyerAClient.from("buyers").select("id, org_name");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.id).toBe(fx.buyerAId);
  });

  // -------------------------------------------------------------------------
  // THE GATE: zero rows of Buyer B's, on every scoped table
  // -------------------------------------------------------------------------
  it("documents: 0 rows from buyer B's folder", async () => {
    const direct = await fx.buyerAClient.from("documents").select("id").eq("id", fx.docBId);
    expect(direct.error).toBeNull();
    expect(direct.data).toHaveLength(0);

    const broad = await fx.buyerAClient.from("documents").select("id, folder_id").eq("deal_id", fx.dealId);
    expect(broad.error).toBeNull();
    expect((broad.data ?? []).filter((d) => d.folder_id === fx.folderBId)).toHaveLength(0);
  });

  it("chunks: 0 rows — buyers have NO chunk read path at all", async () => {
    const any = await fx.buyerAClient.from("chunks").select("id");
    expect(any.error).toBeNull();
    expect(any.data).toHaveLength(0); // not even chunks in buyer A's own folder

    const direct = await fx.buyerAClient.from("chunks").select("id").eq("id", fx.chunkBId);
    expect(direct.error).toBeNull();
    expect(direct.data).toHaveLength(0);
  });

  it("questions: 0 rows of buyer B's", async () => {
    const direct = await fx.buyerAClient.from("questions").select("id").eq("id", fx.questionBId);
    expect(direct.error).toBeNull();
    expect(direct.data).toHaveLength(0);

    const broad = await fx.buyerAClient.from("questions").select("id").eq("deal_id", fx.dealId);
    expect(broad.error).toBeNull();
    expect(broad.data).toHaveLength(0); // buyer A asked nothing; sees nothing
  });

  it("answers: 0 rows of buyer B's, even though B's answer is 'approved'", async () => {
    const direct = await fx.buyerAClient.from("answers").select("id").eq("id", fx.answerBId);
    expect(direct.error).toBeNull();
    expect(direct.data).toHaveLength(0);

    const broad = await fx.buyerAClient.from("answers").select("id").eq("deal_id", fx.dealId);
    expect(broad.error).toBeNull();
    expect(broad.data).toHaveLength(0);
  });

  it("citations: 0 rows attached to buyer B's answer", async () => {
    const direct = await fx.buyerAClient.from("citations").select("id").eq("id", fx.citationBId);
    expect(direct.error).toBeNull();
    expect(direct.data).toHaveLength(0);

    const viaAnswer = await fx.buyerAClient.from("citations").select("id").eq("answer_id", fx.answerBId);
    expect(viaAnswer.error).toBeNull();
    expect(viaAnswer.data).toHaveLength(0);
  });

  it("activity_events: 0 rows of buyer B's trail", async () => {
    const direct = await fx.buyerAClient.from("activity_events").select("id").eq("id", fx.activityBId);
    expect(direct.error).toBeNull();
    expect(direct.data).toHaveLength(0);

    const broad = await fx.buyerAClient.from("activity_events").select("id, buyer_id").eq("deal_id", fx.dealId);
    expect(broad.error).toBeNull();
    expect((broad.data ?? []).filter((e) => e.buyer_id === fx.buyerBId)).toHaveLength(0);
  });

  it("buyers: buyer A cannot enumerate the bidder roster", async () => {
    const direct = await fx.buyerAClient.from("buyers").select("id").eq("id", fx.buyerBId);
    expect(direct.error).toBeNull();
    expect(direct.data).toHaveLength(0);
  });

  it("audit_log: buyers read 0 rows, and cannot insert", async () => {
    const read = await fx.buyerAClient.from("audit_log").select("id").eq("deal_id", fx.dealId);
    expect(read.error).toBeNull();
    expect(read.data).toHaveLength(0);

    const write = await fx.buyerAClient.from("audit_log").insert({
      deal_id: fx.dealId, actor_type: "buyer", action: "forged", payload: {},
    });
    expect(write.error).not.toBeNull(); // no insert policy for authenticated
  });
});

// Always-on guard: if env is missing, surface the skip loudly in output.
describe.skipIf(envReady)("rls.spec.ts environment", () => {
  it("is not configured — INV-2 gate DID NOT RUN", () => {
    console.warn(skipReason);
    expect(envReady).toBe(false);
  });
});
