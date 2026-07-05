-- Break RLS recursion between companion ticket grants and cloud ticket blobs.
--
-- Grant insert/update policies need to prove that the owner's ticket blob still
-- exists. Doing that with a direct cloud_ticket_blobs subquery triggers that
-- table's companion SELECT policy, which also references grants. Use a private
-- SECURITY DEFINER helper for the existence check instead.

create or replace function tripmap_private.companion_ticket_blob_exists(
  target_owner_id uuid,
  target_shared_trip_id uuid,
  target_ticket_id text,
  target_storage_path text
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.companion_shared_trips trip
    join public.cloud_ticket_blobs blob
      on blob.user_id = trip.owner_id
     and blob.trip_id = trip.trip_id
     and blob.ticket_id = target_ticket_id
     and blob.storage_path = target_storage_path
     and blob.deleted_at is null
    where trip.id = target_shared_trip_id
      and trip.owner_id = target_owner_id
  );
$$;

revoke all on function tripmap_private.companion_ticket_blob_exists(uuid, uuid, text, text)
  from public, anon;
grant execute on function tripmap_private.companion_ticket_blob_exists(uuid, uuid, text, text)
  to authenticated, service_role;

drop policy if exists "owner inserts companion ticket file grants"
  on public.companion_ticket_file_grants;
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
  and tripmap_private.companion_ticket_blob_exists(
    owner_id,
    shared_trip_id,
    ticket_id,
    storage_path
  )
);

drop policy if exists "owner updates companion ticket file grants"
  on public.companion_ticket_file_grants;
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
      and tripmap_private.companion_ticket_blob_exists(
        owner_id,
        shared_trip_id,
        ticket_id,
        storage_path
      )
    )
  )
);
