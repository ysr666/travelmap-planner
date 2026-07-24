-- Avoid ambiguity between the function's shared_trip_id output column and the
-- companion_shared_members primary-key column in the upsert conflict target.

create or replace function public.companion_claim_invite(
  invite_token_hash text,
  companion_display_name text default null
)
returns table(shared_trip_id uuid, trip_id text, permission text)
language plpgsql
security definer
set search_path = public
as $$
declare
  invite_record public.companion_shared_invites%rowtype;
  trip_record public.companion_shared_trips%rowtype;
  user_email text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select *
  into invite_record
  from public.companion_shared_invites
  where token_hash = invite_token_hash
    and status = 'active'
    and revoked_at is null
    and (expires_at is null or expires_at > now())
  limit 1;

  if invite_record.id is null then
    raise exception 'invite_unavailable';
  end if;

  select *
  into trip_record
  from public.companion_shared_trips
  where id = invite_record.shared_trip_id;

  if trip_record.id is null then
    raise exception 'shared_trip_unavailable';
  end if;

  if trip_record.owner_id = auth.uid() then
    return query select trip_record.id, trip_record.trip_id, 'collaborate'::text;
    return;
  end if;

  select email into user_email from auth.users where id = auth.uid();

  insert into public.companion_shared_members (
    shared_trip_id,
    owner_id,
    user_id,
    display_name,
    email,
    permission
  )
  values (
    trip_record.id,
    trip_record.owner_id,
    auth.uid(),
    nullif(trim(companion_display_name), ''),
    user_email,
    invite_record.permission
  )
  on conflict on constraint companion_shared_members_pkey
  do update set
    display_name = coalesce(nullif(trim(excluded.display_name), ''), public.companion_shared_members.display_name),
    email = excluded.email,
    permission = excluded.permission,
    removed_at = null,
    updated_at = now();

  insert into public.companion_shared_activities (
    shared_trip_id,
    user_id,
    display_name,
    activity_type,
    body
  )
  values (
    trip_record.id,
    auth.uid(),
    nullif(trim(companion_display_name), ''),
    'joined',
    '加入了共享旅行'
  );

  return query select trip_record.id, trip_record.trip_id, invite_record.permission;
end;
$$;
