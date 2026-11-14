-- Where a paper was fetched from, and its one-slide summary.
alter table public.papers
  add column source_url text,
  add column slide jsonb;
