-- Companion member profiles, member-scoped ticket summaries, and ticket file grants.
--
-- Restricted ticket summaries must not live in companion_shared_trips.projection
-- because every active member can read that shared projection. Store each
-- member's assigned summaries on their own member row, where existing RLS only
-- allows the owner or that member to select the row. Real ticket originals are
-- granted through companion_ticket_file_grants instead of being embedded in the
-- shared projection.

alter table public.companion_shared_members
  add column if not exists profile jsonb not null default '{}'::jsonb;

alter table public.companion_shared_members
  add column if not exists assigned_ticket_summaries jsonb not null default '[]'::jsonb;

do $$
begin
  alter table public.companion_shared_members
    add constraint companion_shared_members_profile_object
    check (jsonb_typeof(profile) = 'object');
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  alter table public.companion_shared_members
    add constraint companion_shared_members_assigned_ticket_summaries_array
    check (jsonb_typeof(assigned_ticket_summaries) = 'array');
exception
  when duplicate_object then null;
end;
$$;

comment on column public.companion_shared_members.profile is
  'Owner-managed companion travel profile summary scoped to the owner and that member.';

comment on column public.companion_shared_members.assigned_ticket_summaries is
  'Ticket summaries assigned only to this member. Real ticket files are authorized separately through companion_ticket_file_grants.';

drop policy if exists "select shared members by owner or self" on public.companion_shared_members;
drop policy if exists "select shared members by owner or active self" on public.companion_shared_members;
create policy "select shared members by owner or active self"
on public.companion_shared_members
for select
to authenticated
using (
  (select auth.uid()) = owner_id
  or ((select auth.uid()) = user_id and removed_at is null)
);

create table if not exists public.companion_ticket_file_grants (
  shared_trip_id uuid not null references public.companion_shared_trips(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  ticket_id text not null,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size bigint not null check (size >= 0),
  sha256 text,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (shared_trip_id, user_id, ticket_id)
);

create index if not exists companion_ticket_file_grants_user_idx
  on public.companion_ticket_file_grants (user_id, shared_trip_id, revoked_at);

create index if not exists companion_ticket_file_grants_storage_path_idx
  on public.companion_ticket_file_grants (storage_path)
  where revoked_at is null;

alter table public.companion_ticket_file_grants enable row level security;

drop policy if exists "select companion ticket file grants by owner or self" on public.companion_ticket_file_grants;
create policy "select companion ticket file grants by owner or self"
on public.companion_ticket_file_grants
for select
to authenticated
using (
  (select auth.uid()) = owner_id
  or (
    (select auth.uid()) = user_id
    and revoked_at is null
    and exists (
      select 1
      from public.companion_shared_members member
      where member.shared_trip_id = public.companion_ticket_file_grants.shared_trip_id
        and member.user_id = public.companion_ticket_file_grants.user_id
        and member.removed_at is null
    )
  )
);

drop policy if exists "owner inserts companion ticket file grants" on public.companion_ticket_file_grants;
create policy "owner inserts companion ticket file grants"
on public.companion_ticket_file_grants
for insert
to authenticated
with check (
  (select auth.uid()) = owner_id
  and exists (
    select 1
    from public.companion_shared_trips trip
    where trip.id = public.companion_ticket_file_grants.shared_trip_id
      and trip.owner_id = (select auth.uid())
  )
  and exists (
    select 1
    from public.companion_shared_members member
    where member.shared_trip_id = public.companion_ticket_file_grants.shared_trip_id
      and member.user_id = public.companion_ticket_file_grants.user_id
      and member.removed_at is null
  )
  and (storage.foldername(storage_path))[1] = owner_id::text
  and exists (
    select 1
    from public.companion_shared_trips trip
    join public.cloud_ticket_blobs blob
      on blob.user_id = trip.owner_id
     and blob.trip_id = trip.trip_id
     and blob.ticket_id = public.companion_ticket_file_grants.ticket_id
     and blob.storage_path = public.companion_ticket_file_grants.storage_path
     and blob.deleted_at is null
    where trip.id = public.companion_ticket_file_grants.shared_trip_id
      and trip.owner_id = public.companion_ticket_file_grants.owner_id
  )
);

drop policy if exists "owner updates companion ticket file grants" on public.companion_ticket_file_grants;
create policy "owner updates companion ticket file grants"
on public.companion_ticket_file_grants
for update
to authenticated
using ((select auth.uid()) = owner_id)
with check (
  (select auth.uid()) = owner_id
  and exists (
    select 1
    from public.companion_shared_trips trip
    where trip.id = public.companion_ticket_file_grants.shared_trip_id
      and trip.owner_id = (select auth.uid())
  )
  and (storage.foldername(storage_path))[1] = owner_id::text
  and (
    revoked_at is not null
    or (
      exists (
        select 1
        from public.companion_shared_members member
        where member.shared_trip_id = public.companion_ticket_file_grants.shared_trip_id
          and member.user_id = public.companion_ticket_file_grants.user_id
          and member.removed_at is null
      )
      and exists (
        select 1
        from public.companion_shared_trips trip
        join public.cloud_ticket_blobs blob
          on blob.user_id = trip.owner_id
         and blob.trip_id = trip.trip_id
         and blob.ticket_id = public.companion_ticket_file_grants.ticket_id
         and blob.storage_path = public.companion_ticket_file_grants.storage_path
         and blob.deleted_at is null
        where trip.id = public.companion_ticket_file_grants.shared_trip_id
          and trip.owner_id = public.companion_ticket_file_grants.owner_id
      )
    )
  )
);

drop policy if exists "owner deletes companion ticket file grants" on public.companion_ticket_file_grants;
create policy "owner deletes companion ticket file grants"
on public.companion_ticket_file_grants
for delete
to authenticated
using ((select auth.uid()) = owner_id);

drop policy if exists "select companion granted ticket blobs" on public.cloud_ticket_blobs;
create policy "select companion granted ticket blobs"
on public.cloud_ticket_blobs
for select
to authenticated
using (
  (select auth.uid()) = user_id
  or (public.cloud_ticket_blobs.deleted_at is null and exists (
    select 1
    from public.companion_ticket_file_grants grant_row
    where grant_row.owner_id = public.cloud_ticket_blobs.user_id
      and grant_row.ticket_id = public.cloud_ticket_blobs.ticket_id
      and grant_row.storage_path = public.cloud_ticket_blobs.storage_path
      and grant_row.user_id = (select auth.uid())
      and grant_row.revoked_at is null
      and exists (
        select 1
        from public.companion_shared_trips trip
        where trip.id = grant_row.shared_trip_id
          and trip.trip_id = public.cloud_ticket_blobs.trip_id
          and trip.owner_id = grant_row.owner_id
      )
      and exists (
        select 1
        from public.companion_shared_members member
        where member.shared_trip_id = grant_row.shared_trip_id
          and member.user_id = grant_row.user_id
          and member.removed_at is null
      )
  ))
);

drop policy if exists "read companion granted ticket objects" on storage.objects;
create policy "read companion granted ticket objects"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'trip-backups'
  and exists (
    select 1
    from public.companion_ticket_file_grants grant_row
    where grant_row.storage_path = storage.objects.name
      and (storage.foldername(storage.objects.name))[1] = grant_row.owner_id::text
      and grant_row.user_id = (select auth.uid())
      and grant_row.revoked_at is null
      and exists (
        select 1
        from public.companion_shared_trips trip
        join public.cloud_ticket_blobs blob
          on blob.user_id = trip.owner_id
         and blob.trip_id = trip.trip_id
         and blob.ticket_id = grant_row.ticket_id
         and blob.storage_path = grant_row.storage_path
         and blob.deleted_at is null
        where trip.id = grant_row.shared_trip_id
          and trip.owner_id = grant_row.owner_id
      )
      and exists (
        select 1
        from public.companion_shared_members member
        where member.shared_trip_id = grant_row.shared_trip_id
          and member.user_id = grant_row.user_id
          and member.removed_at is null
      )
  )
);

comment on table public.companion_ticket_file_grants is
  'Member-scoped grants for opening real ticket originals from the private trip-backups bucket.';

create table if not exists public.companion_ticket_file_events (
  id uuid primary key default gen_random_uuid(),
  shared_trip_id uuid not null references public.companion_shared_trips(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  ticket_id text not null,
  event_type text not null check (event_type in ('grant_synced', 'grant_revoked', 'file_opened')),
  file_name text,
  mime_type text,
  created_at timestamptz not null default now()
);

create index if not exists companion_ticket_file_events_trip_idx
  on public.companion_ticket_file_events (shared_trip_id, created_at desc);

create index if not exists companion_ticket_file_events_user_idx
  on public.companion_ticket_file_events (user_id, shared_trip_id, created_at desc);

alter table public.companion_ticket_file_events enable row level security;

drop policy if exists "select companion ticket file events by owner or self" on public.companion_ticket_file_events;
create policy "select companion ticket file events by owner or self"
on public.companion_ticket_file_events
for select
to authenticated
using (
  (select auth.uid()) = owner_id
  or (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.companion_shared_members member
      where member.shared_trip_id = public.companion_ticket_file_events.shared_trip_id
        and member.user_id = public.companion_ticket_file_events.user_id
        and member.removed_at is null
    )
  )
);

drop policy if exists "owner inserts companion ticket file events" on public.companion_ticket_file_events;
create policy "owner inserts companion ticket file events"
on public.companion_ticket_file_events
for insert
to authenticated
with check (
  (select auth.uid()) = owner_id
  and actor_user_id = (select auth.uid())
  and exists (
    select 1
    from public.companion_shared_trips trip
    where trip.id = public.companion_ticket_file_events.shared_trip_id
      and trip.owner_id = (select auth.uid())
  )
  and (
    event_type = 'grant_revoked'
    or exists (
      select 1
      from public.companion_shared_members member
      where member.shared_trip_id = public.companion_ticket_file_events.shared_trip_id
        and member.user_id = public.companion_ticket_file_events.user_id
        and member.removed_at is null
    )
  )
);

comment on table public.companion_ticket_file_events is
  'Audit trail for companion ticket original grants, revocations, and file open requests.';

create schema if not exists tripmap_private;

create or replace function tripmap_private.companion_get_ticket_file_grant(
  target_shared_trip_id uuid,
  target_ticket_id text
)
returns table (
  storage_path text,
  file_name text,
  mime_type text,
  size bigint,
  sha256 text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  grant_record public.companion_ticket_file_grants%rowtype;
begin
  select *
  into grant_record
  from public.companion_ticket_file_grants grant_row
  where grant_row.shared_trip_id = target_shared_trip_id
    and grant_row.ticket_id = target_ticket_id
    and grant_row.user_id = (select auth.uid())
    and grant_row.revoked_at is null
    and exists (
      select 1
      from public.companion_shared_trips trip
      join public.cloud_ticket_blobs blob
        on blob.user_id = trip.owner_id
       and blob.trip_id = trip.trip_id
       and blob.ticket_id = grant_row.ticket_id
       and blob.storage_path = grant_row.storage_path
       and blob.deleted_at is null
      where trip.id = grant_row.shared_trip_id
        and trip.owner_id = grant_row.owner_id
    )
    and exists (
      select 1
      from public.companion_shared_members member
      where member.shared_trip_id = grant_row.shared_trip_id
        and member.user_id = grant_row.user_id
        and member.removed_at is null
    )
  limit 1;

  if not found then
    return;
  end if;

  insert into public.companion_ticket_file_events (
    actor_user_id,
    event_type,
    file_name,
    mime_type,
    owner_id,
    shared_trip_id,
    ticket_id,
    user_id
  )
  values (
    (select auth.uid()),
    'file_opened',
    grant_record.file_name,
    grant_record.mime_type,
    grant_record.owner_id,
    grant_record.shared_trip_id,
    grant_record.ticket_id,
    grant_record.user_id
  );

  return query
  select
    grant_record.storage_path,
    grant_record.file_name,
    grant_record.mime_type,
    grant_record.size,
    grant_record.sha256;
end;
$$;

create or replace function public.companion_get_ticket_file_grant(
  target_shared_trip_id uuid,
  target_ticket_id text
)
returns table (
  storage_path text,
  file_name text,
  mime_type text,
  size bigint,
  sha256 text
)
language sql
security invoker
set search_path = ''
as $$
  select *
  from tripmap_private.companion_get_ticket_file_grant(target_shared_trip_id, target_ticket_id);
$$;

revoke all on function tripmap_private.companion_get_ticket_file_grant(uuid, text) from public, anon;
grant execute on function tripmap_private.companion_get_ticket_file_grant(uuid, text) to authenticated, service_role;
revoke all on function public.companion_get_ticket_file_grant(uuid, text) from public, anon;
grant execute on function public.companion_get_ticket_file_grant(uuid, text) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.companion_shared_trips;
exception
  when duplicate_object or undefined_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.companion_shared_members;
exception
  when duplicate_object or undefined_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.companion_shared_comments;
exception
  when duplicate_object or undefined_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.companion_meeting_confirmations;
exception
  when duplicate_object or undefined_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.companion_shared_mutations;
exception
  when duplicate_object or undefined_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.companion_shared_activities;
exception
  when duplicate_object or undefined_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.companion_ticket_file_grants;
exception
  when duplicate_object or undefined_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.companion_ticket_file_events;
exception
  when duplicate_object or undefined_object then null;
end;
$$;
