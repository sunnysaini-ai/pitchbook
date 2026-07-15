/**
 * lib/db/server.ts
 *
 * Server-side Supabase client (Next.js 15 App Router, @supabase/ssr).
 * This client carries the CALLER's auth cookie, so every query it runs is
 * subject to RLS (INV-2, INV-5). It must be used for all request-scoped
 * reads/writes. It can NEVER bypass row security.
 *
 * This module also owns the hand-written `Database` type shared by the
 * admin and browser clients (imported with `import type`, so importing it
 * from a non-Next context is erased at compile time).
 */

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Database types (mirror supabase/migrations/0001_init.sql exactly)
// ---------------------------------------------------------------------------

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type AnswerMode = "strict" | "fast";
export type AnswerStatus =
  | "draft"
  | "approved"
  | "rejected"
  | "escalated"
  | "released";
export type DocStatus =
  | "uploaded"
  | "parsing"
  | "chunking"
  | "embedding"
  | "ready"
  | "failed";
export type ActorType = "seller" | "advisor" | "buyer" | "system" | "ai";

export interface DealRow {
  id: string;
  name: string;
  sector: string | null;
  ev_low: number | null;
  ev_high: number | null;
  answer_mode: AnswerMode;
  owner_id: string;
  created_at: string;
}
export interface DealInsert {
  id?: string;
  name: string;
  sector?: string | null;
  ev_low?: number | null;
  ev_high?: number | null;
  answer_mode?: AnswerMode;
  owner_id: string;
  created_at?: string;
}

export interface DealAdminRow {
  deal_id: string;
  user_id: string;
  role: "seller" | "advisor";
}
export type DealAdminInsert = DealAdminRow;

export interface FolderRow {
  id: string;
  deal_id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
}
export interface FolderInsert {
  id?: string;
  deal_id: string;
  parent_id?: string | null;
  name: string;
  sort_order?: number;
}

export interface DocumentRow {
  id: string;
  deal_id: string;
  folder_id: string | null;
  filename: string;
  storage_path: string;
  mime_type: string;
  page_count: number | null;
  status: DocStatus;
  error_detail: string | null;
  ai_accessible: boolean;
  created_at: string;
}
export interface DocumentInsert {
  id?: string;
  deal_id: string;
  folder_id?: string | null;
  filename: string;
  storage_path: string;
  mime_type: string;
  page_count?: number | null;
  status?: DocStatus;
  error_detail?: string | null;
  ai_accessible?: boolean;
  created_at?: string;
}

export interface ChunkRow {
  id: string;
  deal_id: string;
  document_id: string;
  page_from: number;
  page_to: number;
  ordinal: number;
  content: string;
  token_count: number;
  embedding: string | null; // pgvector serializes as a string over PostgREST
  tsv: unknown;
}
export interface ChunkInsert {
  id?: string;
  deal_id: string;
  document_id: string;
  page_from: number;
  page_to: number;
  ordinal: number;
  content: string;
  token_count: number;
  embedding?: string | null;
  // tsv is a generated column — never inserted
}

export interface BuyerRow {
  id: string;
  deal_id: string;
  org_name: string;
  contact_email: string;
  user_id: string | null;
  revoked_at: string | null;
  created_at: string;
}
export interface BuyerInsert {
  id?: string;
  deal_id: string;
  org_name: string;
  contact_email: string;
  user_id?: string | null;
  revoked_at?: string | null;
  created_at?: string;
}

export interface BuyerFolderAccessRow {
  buyer_id: string;
  folder_id: string;
}
export type BuyerFolderAccessInsert = BuyerFolderAccessRow;

export interface QuestionRow {
  id: string;
  deal_id: string;
  buyer_id: string;
  body: string;
  created_at: string;
}
export interface QuestionInsert {
  id?: string;
  deal_id: string;
  buyer_id: string;
  body: string;
  created_at?: string;
}

export interface AnswerRow {
  id: string;
  question_id: string;
  deal_id: string;
  buyer_id: string;
  body: string;
  status: AnswerStatus;
  is_grounded: boolean;
  model: string;
  edited_by: string | null;
  released_at: string | null;
  created_at: string;
}
export interface AnswerInsert {
  id?: string;
  question_id: string;
  deal_id: string;
  buyer_id: string;
  body: string;
  status?: AnswerStatus;
  is_grounded: boolean;
  model: string;
  edited_by?: string | null;
  released_at?: string | null;
  created_at?: string;
}

export interface CitationRow {
  id: string;
  answer_id: string;
  chunk_id: string;
  document_id: string;
  page_from: number;
  page_to: number;
  quote: string;
  ordinal: number;
}
export interface CitationInsert {
  id?: string;
  answer_id: string;
  chunk_id: string;
  document_id: string;
  page_from: number;
  page_to: number;
  quote: string;
  ordinal: number;
}

export interface ActivityEventRow {
  id: string;
  deal_id: string;
  buyer_id: string | null;
  actor_id: string | null;
  kind: string;
  document_id: string | null;
  meta: Json;
  created_at: string;
}
export interface ActivityEventInsert {
  id?: string;
  deal_id: string;
  buyer_id?: string | null;
  actor_id?: string | null;
  kind: string;
  document_id?: string | null;
  meta?: Json;
  created_at?: string;
}

export interface AuditLogRow {
  id: number;
  deal_id: string;
  actor_type: ActorType;
  actor_id: string | null;
  action: string;
  subject_id: string | null;
  payload: Json;
  created_at: string;
}
export interface AuditLogInsert {
  id?: number;
  deal_id: string;
  actor_type: ActorType;
  actor_id?: string | null;
  action: string;
  subject_id?: string | null;
  payload: Json;
  created_at?: string;
}

export interface Database {
  public: {
    Tables: {
      deals: { Row: DealRow; Insert: DealInsert; Update: Partial<DealInsert>; Relationships: [] };
      deal_admins: { Row: DealAdminRow; Insert: DealAdminInsert; Update: Partial<DealAdminInsert>; Relationships: [] };
      folders: { Row: FolderRow; Insert: FolderInsert; Update: Partial<FolderInsert>; Relationships: [] };
      documents: { Row: DocumentRow; Insert: DocumentInsert; Update: Partial<DocumentInsert>; Relationships: [] };
      chunks: { Row: ChunkRow; Insert: ChunkInsert; Update: Partial<ChunkInsert>; Relationships: [] };
      buyers: { Row: BuyerRow; Insert: BuyerInsert; Update: Partial<BuyerInsert>; Relationships: [] };
      buyer_folder_access: { Row: BuyerFolderAccessRow; Insert: BuyerFolderAccessInsert; Update: Partial<BuyerFolderAccessInsert>; Relationships: [] };
      questions: { Row: QuestionRow; Insert: QuestionInsert; Update: Partial<QuestionInsert>; Relationships: [] };
      answers: { Row: AnswerRow; Insert: AnswerInsert; Update: Partial<AnswerInsert>; Relationships: [] };
      citations: { Row: CitationRow; Insert: CitationInsert; Update: Partial<CitationInsert>; Relationships: [] };
      activity_events: { Row: ActivityEventRow; Insert: ActivityEventInsert; Update: Partial<ActivityEventInsert>; Relationships: [] };
      audit_log: { Row: AuditLogRow; Insert: AuditLogInsert; Update: never; Relationships: [] };
    };
    Views: Record<string, never>;
    Functions: {
      is_deal_admin: { Args: { d: string }; Returns: boolean };
      current_buyer: { Args: { d: string }; Returns: string | null };
      search_chunks_vector: {
        Args: {
          p_deal_id: string;
          p_buyer_id: string | null;
          p_query_embedding: string;
          p_limit?: number;
        };
        Returns: Array<{
          id: string;
          document_id: string;
          filename: string;
          page_from: number;
          page_to: number;
          content: string;
          distance: number;
        }>;
      };
      search_chunks_fts: {
        Args: {
          p_deal_id: string;
          p_buyer_id: string | null;
          p_query: string;
          p_limit?: number;
        };
        Returns: Array<{
          id: string;
          document_id: string;
          filename: string;
          page_from: number;
          page_to: number;
          content: string;
          rank: number;
        }>;
      };
    };
    Enums: {
      answer_mode: AnswerMode;
      answer_status: AnswerStatus;
      doc_status: DocStatus;
      actor_type: ActorType;
    };
    CompositeTypes: Record<string, never>;
  };
}

export type TypedSupabaseClient = SupabaseClient<Database>;

// ---------------------------------------------------------------------------
// Server client factory
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Set it in .env.local (see supabase project settings).`,
    );
  }
  return v;
}

/**
 * Request-scoped, RLS-enforced client. Call per request (Next 15: cookies()
 * is async). Never cache across requests.
 */
export async function createSupabaseServerClient(): Promise<TypedSupabaseClient> {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component where cookies are read-only;
            // middleware refreshes the session, so this is safe to ignore.
          }
        },
      },
    },
  );
}
