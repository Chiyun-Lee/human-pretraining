-- Who a paper's notes are written for. Null until the paper has been read;
-- papers read before levels existed were written for a technical reader.
alter table public.papers
  add column level text check (level in ('lay', 'technical', 'expert'));

update public.papers set level = 'technical' where brief is not null;
