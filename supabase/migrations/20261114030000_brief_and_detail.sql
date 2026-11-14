-- A whole-paper brief that every page's summaries are written against, and
-- two kinds of region: a summary of something that matters, or a label over
-- detail the reader can skip.

alter table public.papers
  add column brief jsonb;

alter table public.regions
  add column kind text not null default 'summary' check (kind in ('summary', 'detail')),
  add column caveat text;

create or replace function public.save_page_summaries(p_paper_id uuid, p_pages int[], p_regions jsonb)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_done int[];
begin
  select summarised_pages into v_done from public.papers where id = p_paper_id for update;
  if not found then
    raise exception 'paper not found';
  end if;
  if v_done && p_pages then
    return false;
  end if;

  insert into public.regions (paper_id, page, x0, y0, x1, y1, bullets, kind, caveat)
  select p_paper_id, r.page, r.x0, r.y0, r.x1, r.y1, r.bullets, coalesce(r.kind, 'summary'), r.caveat
  from jsonb_to_recordset(p_regions)
    as r(page int, x0 real, y0 real, x1 real, y1 real, bullets jsonb, kind text, caveat text);

  update public.papers set summarised_pages = v_done || p_pages where id = p_paper_id;
  return true;
end;
$$;
