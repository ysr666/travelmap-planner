-- TripMap account sync schema.
--
-- This migration is intentionally idempotent because older environments may
-- have parts of the legacy snapshot sync schema already applied through the
-- Supabase SQL editor.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.cloud_trip_backups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  original_trip_id text,
  title text not null,
  destination text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  exported_at timestamptz not null,
  app_version text,
  schema_version integer not null default 1 check (schema_version = 1),
  snapshot_path text not null,
  files_count integer not null default 0 check (files_count >= 0),
  total_size_bytes bigint not null default 0 check (total_size_bytes >= 0),
  warnings jsonb,
  notes text
);

create unique index if not exists cloud_trip_backups_user_snapshot_unique
  on public.cloud_trip_backups (user_id, snapshot_path);

create index if not exists cloud_trip_backups_user_updated_idx
  on public.cloud_trip_backups (user_id, updated_at desc);

create table if not exists public.cloud_sync_objects (
  user_id uuid not null references auth.users(id) on delete cascade,
  trip_id text not null,
  object_type text not null check (object_type in ('trip', 'day', 'item', 'ticket_meta')),
  object_id text not null,
  payload jsonb,
  updated_at_ms bigint not null check (updated_at_ms >= 0),
  deleted_at_ms bigint,
  device_id text not null,
  op_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, object_type, object_id)
);

create index if not exists cloud_sync_objects_user_trip_idx
  on public.cloud_sync_objects (user_id, trip_id, updated_at_ms desc);

create table if not exists public.cloud_ticket_blobs (
  user_id uuid not null references auth.users(id) on delete cascade,
  trip_id text not null,
  ticket_id text not null,
  storage_path text not null,
  sha256 text not null,
  mime_type text not null,
  size bigint not null check (size >= 0),
  file_name text not null,
  uploaded_at timestamptz not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, ticket_id)
);

create index if not exists cloud_ticket_blobs_user_trip_idx
  on public.cloud_ticket_blobs (user_id, trip_id, uploaded_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists cloud_trip_backups_set_updated_at on public.cloud_trip_backups;
create trigger cloud_trip_backups_set_updated_at
before update on public.cloud_trip_backups
for each row execute function public.set_updated_at();

drop trigger if exists cloud_sync_objects_set_updated_at on public.cloud_sync_objects;
create trigger cloud_sync_objects_set_updated_at
before update on public.cloud_sync_objects
for each row execute function public.set_updated_at();

drop trigger if exists cloud_ticket_blobs_set_updated_at on public.cloud_ticket_blobs;
create trigger cloud_ticket_blobs_set_updated_at
before update on public.cloud_ticket_blobs
for each row execute function public.set_updated_at();

alter table public.cloud_trip_backups enable row level security;
alter table public.cloud_sync_objects enable row level security;
alter table public.cloud_ticket_blobs enable row level security;

drop policy if exists "select own cloud backups" on public.cloud_trip_backups;
create policy "select own cloud backups"
on public.cloud_trip_backups
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "insert own cloud backups" on public.cloud_trip_backups;
create policy "insert own cloud backups"
on public.cloud_trip_backups
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "update own cloud backups" on public.cloud_trip_backups;
create policy "update own cloud backups"
on public.cloud_trip_backups
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "delete own cloud backups" on public.cloud_trip_backups;
create policy "delete own cloud backups"
on public.cloud_trip_backups
for delete
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "select own sync objects" on public.cloud_sync_objects;
create policy "select own sync objects"
on public.cloud_sync_objects
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "insert own sync objects" on public.cloud_sync_objects;
create policy "insert own sync objects"
on public.cloud_sync_objects
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "update own sync objects" on public.cloud_sync_objects;
create policy "update own sync objects"
on public.cloud_sync_objects
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "delete own sync objects" on public.cloud_sync_objects;
create policy "delete own sync objects"
on public.cloud_sync_objects
for delete
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "select own ticket blobs" on public.cloud_ticket_blobs;
create policy "select own ticket blobs"
on public.cloud_ticket_blobs
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "insert own ticket blobs" on public.cloud_ticket_blobs;
create policy "insert own ticket blobs"
on public.cloud_ticket_blobs
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "update own ticket blobs" on public.cloud_ticket_blobs;
create policy "update own ticket blobs"
on public.cloud_ticket_blobs
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "delete own ticket blobs" on public.cloud_ticket_blobs;
create policy "delete own ticket blobs"
on public.cloud_ticket_blobs
for delete
to authenticated
using ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public)
values ('trip-backups', 'trip-backups', false)
on conflict (id) do update set public = false;

drop policy if exists "read own trip backup objects" on storage.objects;
create policy "read own trip backup objects"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'trip-backups'
  and (storage.foldername(name))[1] = (auth.uid())::text
);

drop policy if exists "insert own trip backup objects" on storage.objects;
create policy "insert own trip backup objects"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'trip-backups'
  and (storage.foldername(name))[1] = (auth.uid())::text
);

drop policy if exists "update own trip backup objects" on storage.objects;
create policy "update own trip backup objects"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'trip-backups'
  and (storage.foldername(name))[1] = (auth.uid())::text
)
with check (
  bucket_id = 'trip-backups'
  and (storage.foldername(name))[1] = (auth.uid())::text
);

drop policy if exists "delete own trip backup objects" on storage.objects;
create policy "delete own trip backup objects"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'trip-backups'
  and (storage.foldername(name))[1] = (auth.uid())::text
);
