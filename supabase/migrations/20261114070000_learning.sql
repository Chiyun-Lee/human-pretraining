-- Questions asked about a highlight, edits to summary notes, and the review
-- cards with their schedule.

-- The conversation about a highlight: [{ "role": "user" | "claude", "text": }]
alter table public.annotations
  add column thread jsonb not null default '[]';

-- Summary notes can be rewritten by the reader.
alter table public.regions
  add column edited boolean not null default false;

grant update (bullets, caveat, edited) on public.regions to authenticated;

-- One question about a paper, with where it is in the review schedule.
create table public.cards (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.papers on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  -- 'predict' is asked before reading; the others afterwards.
  kind text not null check (kind in ('predict', 'recall', 'explain', 'apply', 'critique')),
  prompt text not null,
  -- Multiple choice when options are given (`correct` is the index of the right one);
  -- otherwise the reader writes an answer, judged against `points`.
  options jsonb not null default '[]',
  correct int not null default 0,
  -- The answer in a sentence or two, shown as feedback.
  answer text not null,
  points jsonb not null default '[]',
  page int,
  -- Schedule (see src/learning/schedule.ts). A card that was never answered has no last_review.
  due timestamptz not null default now(),
  stability real not null default 0,
  difficulty real not null default 0,
  reps int not null default 0,
  lapses int not null default 0,
  last_review timestamptz,
  -- What the reader last wrote, shown again at the next review.
  last_response text,
  created_at timestamptz not null default now()
);

create index cards_due on public.cards (user_id, due);
create index cards_paper on public.cards (paper_id);

alter table public.cards enable row level security;

create policy "Users manage their own cards"
  on public.cards for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.cards to authenticated;
grant all on public.cards to service_role;

-- One row per day the reader studied, in their own calendar; streaks are counted from these.
create table public.study_days (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day date not null,
  reviews int not null default 0,
  primary key (user_id, day)
);

alter table public.study_days enable row level security;

create policy "Users read their own study days"
  on public.study_days for select to authenticated
  using (user_id = (select auth.uid()));

grant select on public.study_days to authenticated;
grant all on public.study_days to service_role;

-- Counts answered questions towards a day. `p_day` is the reader's local date.
create function public.record_study(p_day date, p_reviews int)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.study_days (user_id, day, reviews)
  values ((select auth.uid()), p_day, greatest(p_reviews, 0))
  on conflict (user_id, day) do update set reviews = public.study_days.reviews + excluded.reviews;
$$;

revoke all on function public.record_study(date, int) from public, anon;
grant execute on function public.record_study(date, int) to authenticated;
