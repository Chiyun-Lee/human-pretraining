-- Where each note comes from, and questions about an area of a page.

-- One entry per bullet, in order: { "quote": the sentence it was drawn from,
-- "facet": "goal" | "method" | "result" | "other" }.
alter table public.regions
  add column sources jsonb;

-- A highlight that is a rectangle on the page (a figure, an equation) rather than selected text.
alter table public.annotations
  add column area boolean not null default false;

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

  insert into public.regions (paper_id, page, x0, y0, x1, y1, bullets, kind, caveat, sources)
  select p_paper_id, r.page, r.x0, r.y0, r.x1, r.y1, r.bullets, coalesce(r.kind, 'summary'), r.caveat, r.sources
  from jsonb_to_recordset(p_regions)
    as r(page int, x0 real, y0 real, x1 real, y1 real, bullets jsonb, kind text, caveat text, sources jsonb);

  update public.papers set summarised_pages = v_done || p_pages where id = p_paper_id;
  return true;
end;
$$;
