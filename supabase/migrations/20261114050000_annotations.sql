-- The reader's own marks on a paper: highlights (optionally with a note), and
-- which summaries they have flipped back to the original.

create table public.annotations (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.papers on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  page int not null,
  -- One rectangle per highlighted line, in page units: [{ "x0":, "y0":, "x1":, "y1": }]
  rects jsonb not null,
  quote text not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index annotations_paper on public.annotations (paper_id, page);

alter table public.annotations enable row level security;

create policy "Users manage their own annotations"
  on public.annotations for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.annotations to authenticated;
grant all on public.annotations to service_role;

alter table public.regions
  add column show_original boolean not null default false;

grant update (show_original) on public.regions to authenticated;
