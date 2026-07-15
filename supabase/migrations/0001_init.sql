create extension if not exists vector;
create extension if not exists pg_trgm;

create type answer_mode  as enum ('strict','fast');
create type answer_status as enum ('draft','approved','rejected','escalated','released');
create type doc_status   as enum ('uploaded','parsing','chunking','embedding','ready','failed');
create type actor_type   as enum ('seller','advisor','buyer','system','ai');

create table deals (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  sector        text,
  ev_low        numeric,
  ev_high       numeric,
  answer_mode   answer_mode not null default 'strict',
  owner_id      uuid not null references auth.users(id),
  created_at    timestamptz not null default now()
);
create table deal_admins (
  deal_id  uuid references deals(id) on delete cascade,
  user_id  uuid references auth.users(id),
  role     text not null check (role in ('seller','advisor')),
  primary key (deal_id, user_id)
);
create table folders (
  id         uuid primary key default gen_random_uuid(),
  deal_id    uuid not null references deals(id) on delete cascade,
  parent_id  uuid references folders(id) on delete cascade,
  name       text not null,
  sort_order int  not null default 0
);
create table documents (
  id             uuid primary key default gen_random_uuid(),
  deal_id        uuid not null references deals(id) on delete cascade,
  folder_id      uuid references folders(id) on delete set null,
  filename       text not null,
  storage_path   text not null,
  mime_type      text not null,
  page_count     int,
  status         doc_status not null default 'uploaded',
  error_detail   text,
  ai_accessible  boolean not null default true,
  created_at     timestamptz not null default now()
);
create table chunks (
  id           uuid primary key default gen_random_uuid(),
  deal_id      uuid not null references deals(id) on delete cascade,
  document_id  uuid not null references documents(id) on delete cascade,
  page_from    int not null,
  page_to      int not null,
  ordinal      int not null,
  content      text not null,
  token_count  int not null,
  -- halfvec(3072): pgvector's hnsw index caps `vector` at 2000 dims, but
  -- supports halfvec up to 4000 dims. text-embedding-3-large is 3072d, so we
  -- store as halfvec (half-precision) to keep an ANN index. See DECISIONS #3.
  embedding    halfvec(3072),
  tsv          tsvector generated always as (to_tsvector('english', content)) stored
);
create index on chunks using hnsw (embedding halfvec_cosine_ops);
create index on chunks using gin (tsv);
create index on chunks (deal_id, document_id);
create table buyers (
  id            uuid primary key default gen_random_uuid(),
  deal_id       uuid not null references deals(id) on delete cascade,
  org_name      text not null,
  contact_email text not null,
  user_id       uuid references auth.users(id),
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  unique (deal_id, contact_email)
);
create table buyer_folder_access (
  buyer_id  uuid references buyers(id) on delete cascade,
  folder_id uuid references folders(id) on delete cascade,
  primary key (buyer_id, folder_id)
);
create table questions (
  id         uuid primary key default gen_random_uuid(),
  deal_id    uuid not null references deals(id) on delete cascade,
  buyer_id   uuid not null references buyers(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now()
);
create table answers (
  id             uuid primary key default gen_random_uuid(),
  question_id    uuid not null references questions(id) on delete cascade,
  deal_id        uuid not null references deals(id) on delete cascade,
  buyer_id       uuid not null references buyers(id) on delete cascade,
  body           text not null,
  status         answer_status not null default 'draft',
  is_grounded    boolean not null,
  model          text not null,
  edited_by      uuid references auth.users(id),
  released_at    timestamptz,
  created_at     timestamptz not null default now()
);
create table citations (
  id          uuid primary key default gen_random_uuid(),
  answer_id   uuid not null references answers(id) on delete cascade,
  chunk_id    uuid not null references chunks(id),
  document_id uuid not null references documents(id),
  page_from   int not null,
  page_to     int not null,
  quote       text not null,
  ordinal     int not null
);
create table activity_events (
  id          uuid primary key default gen_random_uuid(),
  deal_id     uuid not null references deals(id) on delete cascade,
  buyer_id    uuid references buyers(id) on delete cascade,
  actor_id    uuid references auth.users(id),
  kind        text not null,
  document_id uuid references documents(id) on delete set null,
  meta        jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create table audit_log (
  id          bigserial primary key,
  deal_id     uuid not null references deals(id),
  actor_type  actor_type not null,
  actor_id    uuid,
  action      text not null,
  subject_id  uuid,
  payload     jsonb not null,
  created_at  timestamptz not null default now()
);
