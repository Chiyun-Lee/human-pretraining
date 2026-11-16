-- Questions are no longer asked before reading.
delete from public.cards where kind = 'predict';
alter table public.cards drop constraint cards_kind_check;
alter table public.cards add constraint cards_kind_check check (kind in ('recall', 'explain', 'apply', 'critique'));

-- Saving a batch of pages now returns what is stored for them (with ids), so
-- the app does not have to ask again. If another device saved these pages
-- first, nothing is written and its regions are returned.
drop function public.save_page_summaries(uuid, int[], jsonb);

create function public.save_page_summaries(p_paper_id uuid, p_pages int[], p_regions jsonb)
returns setof public.regions
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

  if not (v_done && p_pages) then
    insert into public.regions (paper_id, page, x0, y0, x1, y1, bullets, kind, caveat, sources)
    select p_paper_id, r.page, r.x0, r.y0, r.x1, r.y1, r.bullets, coalesce(r.kind, 'summary'), r.caveat, r.sources
    from jsonb_to_recordset(p_regions)
      as r(page int, x0 real, y0 real, x1 real, y1 real, bullets jsonb, kind text, caveat text, sources jsonb);

    update public.papers set summarised_pages = v_done || p_pages where id = p_paper_id;
  end if;

  return query select * from public.regions where paper_id = p_paper_id and page = any(p_pages);
end;
$$;

revoke all on function public.save_page_summaries(uuid, int[], jsonb) from public, anon;
grant execute on function public.save_page_summaries(uuid, int[], jsonb) to authenticated, service_role;
