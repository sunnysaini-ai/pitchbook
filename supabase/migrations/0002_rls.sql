-- 0002_rls.sql
-- Row Level Security: deny-by-default on EVERY table.
-- Enabling RLS with no policy denies all access for anon/authenticated;
-- each policy below is an explicit, narrow grant. The service-role key
-- bypasses RLS and is used ONLY by writeAudit and the retrieval worker.

-- ---------------------------------------------------------------------------
-- Helper predicates (security definer so they can read across RLS)
-- ---------------------------------------------------------------------------

create or replace function is_deal_admin(d uuid) returns boolean
language sql security definer stable as $$
  select exists (select 1 from deal_admins where deal_id = d and user_id = auth.uid());
$$;

create or replace function current_buyer(d uuid) returns uuid
language sql security definer stable as $$
  select id from buyers where deal_id = d and user_id = auth.uid() and revoked_at is null;
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere (deny-by-default)
-- ---------------------------------------------------------------------------

alter table deals               enable row level security;
alter table deal_admins         enable row level security;
alter table folders             enable row level security;
alter table documents           enable row level security;
alter table chunks              enable row level security;
alter table buyers              enable row level security;
alter table buyer_folder_access enable row level security;
alter table questions           enable row level security;
alter table answers             enable row level security;
alter table citations           enable row level security;
alter table activity_events     enable row level security;
alter table audit_log           enable row level security;

-- ---------------------------------------------------------------------------
-- deals
-- ---------------------------------------------------------------------------

create policy deals_admin_all on deals
  for all
  using (is_deal_admin(id) or owner_id = auth.uid())
  with check (is_deal_admin(id) or owner_id = auth.uid());

-- A buyer may see the deal shell they are invited to (name/mode), nothing else.
create policy deals_buyer_read on deals
  for select
  using (current_buyer(id) is not null);

-- ---------------------------------------------------------------------------
-- deal_admins (admins of a deal can see/manage its admin roster; buyers never)
-- ---------------------------------------------------------------------------

create policy deal_admins_admin_all on deal_admins
  for all
  using (is_deal_admin(deal_id))
  with check (is_deal_admin(deal_id));

create policy deal_admins_self_read on deal_admins
  for select
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- folders
-- ---------------------------------------------------------------------------

create policy folders_admin_all on folders
  for all
  using (is_deal_admin(deal_id))
  with check (is_deal_admin(deal_id));

-- Buyers see only folders they were explicitly granted (INV-2).
create policy folders_buyer_read on folders
  for select
  using (
    current_buyer(deal_id) is not null
    and id in (
      select folder_id from buyer_folder_access
      where buyer_id = current_buyer(deal_id)
    )
  );

-- ---------------------------------------------------------------------------
-- documents
-- ---------------------------------------------------------------------------

create policy doc_admin_all on documents
  for all
  using (is_deal_admin(deal_id))
  with check (is_deal_admin(deal_id));

create policy doc_buyer_read on documents
  for select
  using (
    current_buyer(deal_id) is not null
    and folder_id in (
      select folder_id from buyer_folder_access
      where buyer_id = current_buyer(deal_id)
    )
  );

-- ---------------------------------------------------------------------------
-- chunks — admins only. NO buyer read policy, deliberately (INV-2 / INV-3):
-- buyers never touch raw chunks; retrieval runs through the service-role
-- worker whose SQL applies the permission filter (§5.1) inside the query.
-- ---------------------------------------------------------------------------

create policy chunks_admin_all on chunks
  for all
  using (is_deal_admin(deal_id))
  with check (is_deal_admin(deal_id));

-- ---------------------------------------------------------------------------
-- buyers
-- ---------------------------------------------------------------------------

create policy buyers_admin_all on buyers
  for all
  using (is_deal_admin(deal_id))
  with check (is_deal_admin(deal_id));

-- A buyer sees only their OWN buyer row — never the roster of other bidders.
create policy buyers_self_read on buyers
  for select
  using (user_id = auth.uid() and revoked_at is null);

-- ---------------------------------------------------------------------------
-- buyer_folder_access
-- ---------------------------------------------------------------------------

create policy bfa_admin_all on buyer_folder_access
  for all
  using (exists (
    select 1 from buyers b
    where b.id = buyer_folder_access.buyer_id and is_deal_admin(b.deal_id)
  ))
  with check (exists (
    select 1 from buyers b
    where b.id = buyer_folder_access.buyer_id and is_deal_admin(b.deal_id)
  ));

create policy bfa_self_read on buyer_folder_access
  for select
  using (exists (
    select 1 from buyers b
    where b.id = buyer_folder_access.buyer_id
      and b.user_id = auth.uid()
      and b.revoked_at is null
  ));

-- ---------------------------------------------------------------------------
-- questions — buyers read/insert ONLY their own (INV-2)
-- ---------------------------------------------------------------------------

create policy questions_admin_all on questions
  for all
  using (is_deal_admin(deal_id))
  with check (is_deal_admin(deal_id));

create policy questions_buyer_read on questions
  for select
  using (buyer_id = current_buyer(deal_id));

create policy questions_buyer_insert on questions
  for insert
  with check (buyer_id = current_buyer(deal_id));

-- ---------------------------------------------------------------------------
-- answers — buyer read requires ownership AND, when the deal is strict,
-- an approved/released status (INV-5, enforced HERE, not in the UI).
-- Buyers never insert/update answers; those are written by the service-role
-- worker and moderated by admins.
-- ---------------------------------------------------------------------------

create policy answers_admin_all on answers
  for all
  using (is_deal_admin(deal_id))
  with check (is_deal_admin(deal_id));

create policy answers_buyer_read on answers
  for select
  using (
    buyer_id = current_buyer(deal_id)
    and (
      status in ('approved', 'released')
      or exists (
        select 1 from deals d
        where d.id = answers.deal_id and d.answer_mode = 'fast'
      )
    )
  );

-- ---------------------------------------------------------------------------
-- citations — visible exactly when the parent answer is visible to the buyer
-- ---------------------------------------------------------------------------

create policy citations_admin_all on citations
  for all
  using (exists (
    select 1 from answers a
    where a.id = citations.answer_id and is_deal_admin(a.deal_id)
  ))
  with check (exists (
    select 1 from answers a
    where a.id = citations.answer_id and is_deal_admin(a.deal_id)
  ));

create policy citations_buyer_read on citations
  for select
  using (exists (
    select 1 from answers a
    where a.id = citations.answer_id
      and a.buyer_id = current_buyer(a.deal_id)
      and (
        a.status in ('approved', 'released')
        or exists (
          select 1 from deals d
          where d.id = a.deal_id and d.answer_mode = 'fast'
        )
      )
  ));

-- ---------------------------------------------------------------------------
-- activity_events — admins see all; a buyer sees ONLY their own trail (INV-2)
-- ---------------------------------------------------------------------------

create policy activity_admin_all on activity_events
  for all
  using (is_deal_admin(deal_id))
  with check (is_deal_admin(deal_id));

create policy activity_buyer_read on activity_events
  for select
  using (buyer_id is not null and buyer_id = current_buyer(deal_id));

create policy activity_buyer_insert on activity_events
  for insert
  with check (buyer_id = current_buyer(deal_id) and actor_id = auth.uid());

-- ---------------------------------------------------------------------------
-- audit_log — append-only (INV-4).
--   * SELECT: deal admins only.
--   * NO insert policy for anon/authenticated: all writes go through the
--     service-role writeAudit() path, which bypasses RLS.
--   * NO update/delete policy for ANY role, plus hard revokes and a trigger
--     so even the service role cannot mutate history.
-- ---------------------------------------------------------------------------

create policy audit_admin_read on audit_log
  for select
  using (is_deal_admin(deal_id));

revoke update, delete, truncate on audit_log from anon, authenticated;

create or replace function audit_log_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;

create trigger audit_log_no_mutation
  before update or delete on audit_log
  for each row execute function audit_log_immutable();

-- ---------------------------------------------------------------------------
-- Retrieval RPCs (§5.1) — the permission filter is INSIDE the query.
--
-- These are the only paths that read chunks on behalf of a buyer. The
-- `allowed` CTE excludes:
--   * documents in folders the buyer was not granted (INV-2)
--   * documents with ai_accessible = false (INV-3) — such chunks can never
--     appear in retrieval results, full stop
--   * documents not yet 'ready'
--
-- They are SECURITY DEFINER (they must see chunks despite chunks having no
-- buyer policy) and are therefore EXECUTE-revoked from anon/authenticated:
-- only the service-role retrieval worker may call them. A buyer session
-- calling them over PostgREST gets a permission error.
-- ---------------------------------------------------------------------------

create or replace function search_chunks_vector(
  p_deal_id uuid,
  p_buyer_id uuid,
  p_query_embedding vector(3072),
  p_limit int default 40
) returns table (
  id uuid,
  document_id uuid,
  filename text,
  page_from int,
  page_to int,
  content text,
  distance double precision
)
language sql security definer stable as $$
  with allowed as (
    select c.* from chunks c
    join documents d on d.id = c.document_id
    where c.deal_id = p_deal_id
      and d.ai_accessible = true
      and d.status = 'ready'
      and (
        p_buyer_id::uuid is null
        or d.folder_id in (select folder_id from buyer_folder_access where buyer_id = p_buyer_id)
      )
  )
  select a.id, a.document_id, d.filename, a.page_from, a.page_to, a.content,
         (a.embedding <=> p_query_embedding::halfvec(3072))::double precision as distance
  from allowed a
  join documents d on d.id = a.document_id
  where a.embedding is not null
  order by a.embedding <=> p_query_embedding::halfvec(3072)
  limit p_limit;
$$;

create or replace function search_chunks_fts(
  p_deal_id uuid,
  p_buyer_id uuid,
  p_query text,
  p_limit int default 40
) returns table (
  id uuid,
  document_id uuid,
  filename text,
  page_from int,
  page_to int,
  content text,
  rank double precision
)
language sql security definer stable as $$
  with allowed as (
    select c.* from chunks c
    join documents d on d.id = c.document_id
    where c.deal_id = p_deal_id
      and d.ai_accessible = true
      and d.status = 'ready'
      and (
        p_buyer_id::uuid is null
        or d.folder_id in (select folder_id from buyer_folder_access where buyer_id = p_buyer_id)
      )
  )
  select a.id, a.document_id, d.filename, a.page_from, a.page_to, a.content,
         ts_rank(a.tsv, websearch_to_tsquery('english', p_query))::double precision as rank
  from allowed a
  join documents d on d.id = a.document_id
  where a.tsv @@ websearch_to_tsquery('english', p_query)
  order by rank desc
  limit p_limit;
$$;

revoke execute on function search_chunks_vector(uuid, uuid, vector, int) from public, anon, authenticated;
revoke execute on function search_chunks_fts(uuid, uuid, text, int) from public, anon, authenticated;
grant execute on function search_chunks_vector(uuid, uuid, vector, int) to service_role;
grant execute on function search_chunks_fts(uuid, uuid, text, int) to service_role;
