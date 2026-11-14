-- Bibliographic details for the reference manager: the paper's DOI, its
-- authors/venue/year, and its reference list.
alter table public.papers
  add column doi text,
  add column meta jsonb,
  add column refs jsonb;
