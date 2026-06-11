-- End-to-end encrypted travel vault, transport orders, and minimal reminder metadata.
-- Existing trip object sync tables are intentionally unchanged.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema extensions;
create extension if not exists supabase_vault with schema vault;

create table if not exists public.cloud_transport_objects (
  user_id uuid not null references auth.users(id) on delete cascade,
  trip_id text not null,
  object_type text not null check (object_type in ('transport_booking', 'transport_segment')),
  object_id text not null,
  payload jsonb,
  updated_at_ms bigint not null check (updated_at_ms >= 0),
  deleted_at_ms bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, object_type, object_id)
);

create table if not exists public.vault_key_envelopes (
  user_id uuid not null references auth.users(id) on delete cascade,
  vault_id text not null,
  owner_id text not null,
  key_version integer not null check (key_version > 0),
  schema_version integer not null check (schema_version = 1),
  salt text not null,
  wrap_iv text not null,
  wrapped_key text not null,
  pbkdf2_iterations integer not null check (pbkdf2_iterations >= 100000),
  updated_at_ms bigint not null check (updated_at_ms >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, vault_id)
);

create table if not exists public.cloud_vault_objects (
  user_id uuid not null references auth.users(id) on delete cascade,
  vault_id text not null,
  object_type text not null check (object_type in ('traveler', 'document', 'document_trip_link', 'booking_secret', 'booking_traveler_link', 'attachment_metadata')),
  object_id text not null,
  key_version integer not null check (key_version > 0),
  schema_version integer not null check (schema_version = 1),
  aad_version integer not null check (aad_version = 1),
  iv text not null,
  ciphertext text not null,
  created_at_ms bigint not null check (created_at_ms >= 0),
  updated_at_ms bigint not null check (updated_at_ms >= 0),
  deleted_at_ms bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, vault_id, object_id)
);

create table if not exists public.cloud_vault_blobs (
  user_id uuid not null references auth.users(id) on delete cascade,
  vault_id text not null,
  blob_id text not null,
  object_id text not null,
  storage_path text not null,
  key_version integer not null check (key_version > 0),
  schema_version integer not null check (schema_version = 1),
  aad_version integer not null check (aad_version = 1),
  iv text not null,
  encrypted_size bigint not null check (encrypted_size >= 0),
  created_at_ms bigint not null check (created_at_ms >= 0),
  updated_at_ms bigint not null check (updated_at_ms >= 0),
  deleted_at_ms bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, vault_id, blob_id)
);

create table if not exists public.reminder_schedules (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  occurrence_id text not null,
  vault_id text,
  trip_id text,
  object_type text not null check (object_type in ('document', 'transport')),
  object_id text not null,
  reminder_kind text not null check (reminder_kind in ('document_expiry', 'check_in', 'departure', 'transfer')),
  trigger_at timestamptz not null,
  time_zone text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'cancelled')),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  unique (user_id, occurrence_id)
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create table if not exists public.reminder_deliveries (
  user_id uuid not null references auth.users(id) on delete cascade,
  occurrence_id text not null,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  delivered_at timestamptz not null default now(),
  primary key (user_id, occurrence_id, subscription_id)
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'cloud_transport_objects', 'vault_key_envelopes', 'cloud_vault_objects',
    'cloud_vault_blobs', 'reminder_schedules', 'push_subscriptions'
  ] loop
    execute format('drop trigger if exists %I_set_updated_at on public.%I', table_name, table_name);
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name, table_name);
  end loop;
end $$;

alter table public.cloud_transport_objects enable row level security;
alter table public.vault_key_envelopes enable row level security;
alter table public.cloud_vault_objects enable row level security;
alter table public.cloud_vault_blobs enable row level security;
alter table public.reminder_schedules enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.reminder_deliveries enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'cloud_transport_objects', 'vault_key_envelopes', 'cloud_vault_objects',
    'cloud_vault_blobs', 'reminder_schedules', 'push_subscriptions', 'reminder_deliveries'
  ] loop
    execute format('drop policy if exists "select own %1$s" on public.%1$I', table_name);
    execute format('create policy "select own %1$s" on public.%1$I for select to authenticated using ((select auth.uid()) = user_id)', table_name);
    execute format('drop policy if exists "insert own %1$s" on public.%1$I', table_name);
    execute format('create policy "insert own %1$s" on public.%1$I for insert to authenticated with check ((select auth.uid()) = user_id)', table_name);
    execute format('drop policy if exists "update own %1$s" on public.%1$I', table_name);
    execute format('create policy "update own %1$s" on public.%1$I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', table_name);
    execute format('drop policy if exists "delete own %1$s" on public.%1$I', table_name);
    execute format('create policy "delete own %1$s" on public.%1$I for delete to authenticated using ((select auth.uid()) = user_id)', table_name);
  end loop;
end $$;

insert into storage.buckets (id, name, public)
values ('travel-vault', 'travel-vault', false)
on conflict (id) do update set public = false;

drop policy if exists "read own travel vault" on storage.objects;
create policy "read own travel vault" on storage.objects for select to authenticated
using (bucket_id = 'travel-vault' and (storage.foldername(name))[1] = (auth.uid())::text);

drop policy if exists "insert own travel vault" on storage.objects;
create policy "insert own travel vault" on storage.objects for insert to authenticated
with check (bucket_id = 'travel-vault' and (storage.foldername(name))[1] = (auth.uid())::text);

drop policy if exists "update own travel vault" on storage.objects;
create policy "update own travel vault" on storage.objects for update to authenticated
using (bucket_id = 'travel-vault' and (storage.foldername(name))[1] = (auth.uid())::text)
with check (bucket_id = 'travel-vault' and (storage.foldername(name))[1] = (auth.uid())::text);

drop policy if exists "delete own travel vault" on storage.objects;
create policy "delete own travel vault" on storage.objects for delete to authenticated
using (bucket_id = 'travel-vault' and (storage.foldername(name))[1] = (auth.uid())::text);

create or replace function public.invoke_tripmap_due_reminders()
returns void
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  project_url text;
  anon_key text;
  cron_secret text;
begin
  select decrypted_secret into project_url from vault.decrypted_secrets where name = 'tripmap_project_url' limit 1;
  select decrypted_secret into anon_key from vault.decrypted_secrets where name = 'tripmap_anon_key' limit 1;
  select decrypted_secret into cron_secret from vault.decrypted_secrets where name = 'tripmap_reminder_cron_secret' limit 1;
  if project_url is null or anon_key is null or cron_secret is null then return; end if;
  perform net.http_post(
    url := project_url || '/functions/v1/push-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || anon_key, 'x-cron-secret', cron_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
end;
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'tripmap-due-reminders') then
    perform cron.unschedule('tripmap-due-reminders');
  end if;
  perform cron.schedule('tripmap-due-reminders', '* * * * *', 'select public.invoke_tripmap_due_reminders()');
end $$;
