-- Accounts, stored Anthropic keys, and the paper library.

-- ---------------------------------------------------------------------------
-- Per-user settings. The Anthropic key itself lives encrypted in Vault; this
-- row only records that one is set, so the app can show its status.
-- ---------------------------------------------------------------------------
create table public.user_settings (
  user_id uuid primary key references auth.users on delete cascade,
  anthropic_key_hint text,
  anthropic_key_set_at timestamptz
);

alter table public.user_settings enable row level security;

create policy "Users read their own settings"
  on public.user_settings for select to authenticated
  using (user_id = (select auth.uid()));

grant select on public.user_settings to authenticated;
grant all on public.user_settings to service_role;

-- Key functions are callable only with the server-side secret key (from edge
-- functions), never from a browser.
create function public.set_anthropic_key(p_user_id uuid, p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := 'anthropic_key:' || p_user_id;
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = v_name;
  if v_id is null then
    perform vault.create_secret(p_key, v_name);
  else
    perform vault.update_secret(v_id, p_key);
  end if;

  insert into public.user_settings (user_id, anthropic_key_hint, anthropic_key_set_at)
  values (p_user_id, right(p_key, 4), now())
  on conflict (user_id) do update
    set anthropic_key_hint = excluded.anthropic_key_hint,
        anthropic_key_set_at = excluded.anthropic_key_set_at;
end;
$$;

create function public.get_anthropic_key(p_user_id uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'anthropic_key:' || p_user_id;
$$;

create function public.delete_anthropic_key(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where name = 'anthropic_key:' || p_user_id;
  update public.user_settings
    set anthropic_key_hint = null, anthropic_key_set_at = null
    where user_id = p_user_id;
end;
$$;

revoke all on function public.set_anthropic_key(uuid, text) from public, anon, authenticated;
revoke all on function public.get_anthropic_key(uuid) from public, anon, authenticated;
revoke all on function public.delete_anthropic_key(uuid) from public, anon, authenticated;
grant execute on function public.set_anthropic_key(uuid, text) to service_role;
grant execute on function public.get_anthropic_key(uuid) to service_role;
grant execute on function public.delete_anthropic_key(uuid) to service_role;

-- Remove the stored key when the account is deleted.
create function public.purge_anthropic_key()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where name = 'anthropic_key:' || old.user_id;
  return old;
end;
$$;

revoke all on function public.purge_anthropic_key() from public, anon, authenticated;

create trigger purge_anthropic_key
  before delete on public.user_settings
  for each row execute function public.purge_anthropic_key();

-- ---------------------------------------------------------------------------
-- Library: one row per paper a user has saved. The PDF is in Storage.
-- ---------------------------------------------------------------------------
create table public.papers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null,
  file_path text not null,
  created_at timestamptz not null default now()
);

create index papers_user_created on public.papers (user_id, created_at desc);

alter table public.papers enable row level security;

create policy "Users manage their own papers"
  on public.papers for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.papers to authenticated;
grant all on public.papers to service_role;

-- ---------------------------------------------------------------------------
-- PDF files: private bucket, each user confined to a folder named by their id.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('papers', 'papers', false, 52428800, array['application/pdf']);

create policy "Users read their own PDFs"
  on storage.objects for select to authenticated
  using (bucket_id = 'papers' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users upload their own PDFs"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'papers' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users delete their own PDFs"
  on storage.objects for delete to authenticated
  using (bucket_id = 'papers' and (storage.foldername(name))[1] = (select auth.uid())::text);
