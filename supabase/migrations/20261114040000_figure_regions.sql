-- A third kind of region: a note about a figure, drawn over its caption.
alter table public.regions drop constraint regions_kind_check;
alter table public.regions add constraint regions_kind_check check (kind in ('summary', 'figure', 'detail'));
