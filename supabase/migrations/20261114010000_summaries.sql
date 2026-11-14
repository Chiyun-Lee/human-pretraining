-- AI summaries: each region is a rectangle on a page that covers one or more
-- paragraphs, with the bullets shown in their place.

alter table public.papers
  add column summarised_pages int[] not null default '{}';

create table public.regions (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.papers on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  page int not null,
  x0 real not null,
  y0 real not null,
  x1 real not null,
  y1 real not null,
  bullets jsonb not null
);

create index regions_paper_page on public.regions (paper_id, page);

alter table public.regions enable row level security;

create policy "Users manage their own regions"
  on public.regions for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, delete on public.regions to authenticated;
grant all on public.regions to service_role;

-- Stores the summaries for a set of pages and marks those pages done, in one
-- step. Returns false without writing when another device got there first.
create function public.save_page_summaries(p_paper_id uuid, p_pages int[], p_regions jsonb)
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

  insert into public.regions (paper_id, page, x0, y0, x1, y1, bullets)
  select p_paper_id, r.page, r.x0, r.y0, r.x1, r.y1, r.bullets
  from jsonb_to_recordset(p_regions) as r(page int, x0 real, y0 real, x1 real, y1 real, bullets jsonb);

  update public.papers set summarised_pages = v_done || p_pages where id = p_paper_id;
  return true;
end;
$$;

revoke all on function public.save_page_summaries(uuid, int[], jsonb) from public, anon;
grant execute on function public.save_page_summaries(uuid, int[], jsonb) to authenticated, service_role;
