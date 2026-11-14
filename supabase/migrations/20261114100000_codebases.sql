-- Codebases: a public GitHub repository at one commit, with Claude's map of it
-- and, per file opened, the notes over its sections. The code itself is not
-- stored; it is read from GitHub at the pinned commit.

create table public.codebases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  owner text not null,
  repo text not null,
  -- The commit everything below describes.
  ref text not null,
  -- Every file worth listing: [{ "path":, "size": }]
  files jsonb not null,
  -- The overview written by Claude (see supabase/functions/codemap); null until written.
  map jsonb,
  created_at timestamptz not null default now()
);

create index codebases_user_created on public.codebases (user_id, created_at desc);

alter table public.codebases enable row level security;

create policy "Users manage their own codebases"
  on public.codebases for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.codebases to authenticated;
grant all on public.codebases to service_role;

-- The notes over one file: [{ "start":, "end":, "kind":, "title":, "bullets": [] }], lines counted from 1.
create table public.code_notes (
  codebase_id uuid not null references public.codebases on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  path text not null,
  sections jsonb not null,
  primary key (codebase_id, path)
);

alter table public.code_notes enable row level security;

create policy "Users manage their own code notes"
  on public.code_notes for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.code_notes to authenticated;
grant all on public.code_notes to service_role;
