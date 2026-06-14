-- Companion / Shared Trip Mode.
--
-- This schema is separate from one-to-one account sync. It stores an owner
-- published read projection plus companion comments, confirmations, and
-- collaborator mutation requests.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.companion_shared_trips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  trip_id text not null,
  title text not null,
  projection jsonb not null,
  projection_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, trip_id)
);

create table if not exists public.companion_shared_invites (
  id uuid primary key default gen_random_uuid(),
  shared_trip_id uuid not null references public.companion_shared_trips(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  permission text not null check (permission in ('read', 'comment', 'collaborate')),
  status text not null default 'active' check (status in ('active', 'revoked', 'expired')),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists companion_shared_invites_trip_idx
  on public.companion_shared_invites (shared_trip_id, status, created_at desc);

create table if not exists public.companion_shared_members (
  shared_trip_id uuid not null references public.companion_shared_trips(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text,
  email text,
  permission text not null check (permission in ('read', 'comment', 'collaborate')),
  joined_at timestamptz not null default now(),
  removed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (shared_trip_id, user_id)
);

create index if not exists companion_shared_members_user_idx
  on public.companion_shared_members (user_id, removed_at);

create table if not exists public.companion_shared_comments (
  id uuid primary key default gen_random_uuid(),
  shared_trip_id uuid not null references public.companion_shared_trips(id) on delete cascade,
  item_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text,
  body text not null check (char_length(body) between 1 and 500),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists companion_shared_comments_trip_item_idx
  on public.companion_shared_comments (shared_trip_id, item_id, created_at);

create table if not exists public.companion_meeting_confirmations (
  shared_trip_id uuid not null references public.companion_shared_trips(id) on delete cascade,
  item_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text,
  note text check (note is null or char_length(note) <= 300),
  confirmed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (shared_trip_id, item_id, user_id)
);

create index if not exists companion_meeting_confirmations_trip_idx
  on public.companion_meeting_confirmations (shared_trip_id, updated_at desc);

create table if not exists public.companion_shared_activities (
  id uuid primary key default gen_random_uuid(),
  shared_trip_id uuid not null references public.companion_shared_trips(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  display_name text,
  activity_type text not null check (activity_type in (
    'viewed',
    'joined',
    'commented',
    'confirmed_meeting',
    'submitted_change',
    'applied_change',
    'rejected_change',
    'published'
  )),
  item_id text,
  body text check (body is null or char_length(body) <= 500),
  created_at timestamptz not null default now()
);

create index if not exists companion_shared_activities_trip_idx
  on public.companion_shared_activities (shared_trip_id, created_at desc);

create table if not exists public.companion_shared_mutations (
  id uuid primary key default gen_random_uuid(),
  shared_trip_id uuid not null references public.companion_shared_trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text,
  mutation_type text not null check (mutation_type in (
    'update_item',
    'create_item',
    'delete_item',
    'reorder_day_items',
    'update_item_execution_state'
  )),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'applied', 'rejected', 'conflict')),
  applied_at timestamptz,
  rejected_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists companion_shared_mutations_trip_idx
  on public.companion_shared_mutations (shared_trip_id, status, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'companion_shared_trips',
    'companion_shared_invites',
    'companion_shared_members',
    'companion_shared_comments',
    'companion_meeting_confirmations',
    'companion_shared_mutations'
  ]
  loop
    execute format('drop trigger if exists %I_set_updated_at on public.%I', table_name, table_name);
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name, table_name);
  end loop;
end;
$$;

create or replace function public.companion_permission_rank(permission text)
returns integer
language sql
immutable
as $$
  select case permission
    when 'read' then 1
    when 'comment' then 2
    when 'collaborate' then 3
    else 0
  end;
$$;

create or replace function public.companion_current_permission(target_shared_trip_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_match boolean;
  member_permission text;
begin
  select exists (
    select 1
    from public.companion_shared_trips
    where id = target_shared_trip_id
      and owner_id = auth.uid()
  ) into owner_match;

  if owner_match then
    return 'collaborate';
  end if;

  select permission
  into member_permission
  from public.companion_shared_members
  where shared_trip_id = target_shared_trip_id
    and user_id = auth.uid()
    and removed_at is null
  limit 1;

  return member_permission;
end;
$$;

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
  on conflict (shared_trip_id, user_id)
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

create or replace function public.companion_record_view(target_shared_trip_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  activity_id uuid;
begin
  if public.companion_current_permission(target_shared_trip_id) is null then
    raise exception 'permission_denied';
  end if;

  insert into public.companion_shared_activities (
    shared_trip_id,
    user_id,
    display_name,
    activity_type,
    body
  )
  values (
    target_shared_trip_id,
    auth.uid(),
    null,
    'viewed',
    '查看了共享旅行'
  )
  returning id into activity_id;

  return activity_id;
end;
$$;

create or replace function public.companion_add_comment(
  target_shared_trip_id uuid,
  target_item_id text,
  comment_body text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_permission text;
  comment_id uuid;
begin
  current_permission := public.companion_current_permission(target_shared_trip_id);
  if public.companion_permission_rank(current_permission) < 2 then
    raise exception 'permission_denied';
  end if;
  if length(trim(comment_body)) = 0 or length(trim(comment_body)) > 500 then
    raise exception 'invalid_comment';
  end if;

  insert into public.companion_shared_comments (
    shared_trip_id,
    item_id,
    user_id,
    body
  )
  values (
    target_shared_trip_id,
    target_item_id,
    auth.uid(),
    trim(comment_body)
  )
  returning id into comment_id;

  insert into public.companion_shared_activities (
    shared_trip_id,
    user_id,
    activity_type,
    item_id,
    body
  )
  values (
    target_shared_trip_id,
    auth.uid(),
    'commented',
    target_item_id,
    left(trim(comment_body), 160)
  );

  return comment_id;
end;
$$;

create or replace function public.companion_confirm_meeting(
  target_shared_trip_id uuid,
  target_item_id text,
  confirmation_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_permission text;
begin
  current_permission := public.companion_current_permission(target_shared_trip_id);
  if public.companion_permission_rank(current_permission) < 2 then
    raise exception 'permission_denied';
  end if;

  insert into public.companion_meeting_confirmations (
    shared_trip_id,
    item_id,
    user_id,
    note,
    confirmed_at
  )
  values (
    target_shared_trip_id,
    target_item_id,
    auth.uid(),
    nullif(left(trim(coalesce(confirmation_note, '')), 300), ''),
    now()
  )
  on conflict (shared_trip_id, item_id, user_id)
  do update set
    note = excluded.note,
    confirmed_at = now(),
    updated_at = now();

  insert into public.companion_shared_activities (
    shared_trip_id,
    user_id,
    activity_type,
    item_id,
    body
  )
  values (
    target_shared_trip_id,
    auth.uid(),
    'confirmed_meeting',
    target_item_id,
    '确认了集合时间'
  );
end;
$$;

create or replace function public.companion_submit_mutation(
  target_shared_trip_id uuid,
  target_mutation_type text,
  mutation_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  mutation_id uuid;
begin
  if public.companion_permission_rank(public.companion_current_permission(target_shared_trip_id)) < 3 then
    raise exception 'permission_denied';
  end if;

  if target_mutation_type not in (
    'update_item',
    'create_item',
    'delete_item',
    'reorder_day_items',
    'update_item_execution_state'
  ) then
    raise exception 'invalid_mutation_type';
  end if;

  insert into public.companion_shared_mutations (
    shared_trip_id,
    user_id,
    mutation_type,
    payload
  )
  values (
    target_shared_trip_id,
    auth.uid(),
    target_mutation_type,
    mutation_payload
  )
  returning id into mutation_id;

  insert into public.companion_shared_activities (
    shared_trip_id,
    user_id,
    activity_type,
    body
  )
  values (
    target_shared_trip_id,
    auth.uid(),
    'submitted_change',
    '提交了协作修改'
  );

  return mutation_id;
end;
$$;

grant execute on function public.companion_current_permission(uuid) to authenticated;
grant execute on function public.companion_claim_invite(text, text) to authenticated;
grant execute on function public.companion_record_view(uuid) to authenticated;
grant execute on function public.companion_add_comment(uuid, text, text) to authenticated;
grant execute on function public.companion_confirm_meeting(uuid, text, text) to authenticated;
grant execute on function public.companion_submit_mutation(uuid, text, jsonb) to authenticated;

alter table public.companion_shared_trips enable row level security;
alter table public.companion_shared_invites enable row level security;
alter table public.companion_shared_members enable row level security;
alter table public.companion_shared_comments enable row level security;
alter table public.companion_meeting_confirmations enable row level security;
alter table public.companion_shared_activities enable row level security;
alter table public.companion_shared_mutations enable row level security;

drop policy if exists "select shared trips by owner or member" on public.companion_shared_trips;
create policy "select shared trips by owner or member"
on public.companion_shared_trips
for select
to authenticated
using (public.companion_current_permission(id) is not null);

drop policy if exists "insert own shared trips" on public.companion_shared_trips;
create policy "insert own shared trips"
on public.companion_shared_trips
for insert
to authenticated
with check ((select auth.uid()) = owner_id);

drop policy if exists "update own shared trips" on public.companion_shared_trips;
create policy "update own shared trips"
on public.companion_shared_trips
for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists "delete own shared trips" on public.companion_shared_trips;
create policy "delete own shared trips"
on public.companion_shared_trips
for delete
to authenticated
using ((select auth.uid()) = owner_id);

drop policy if exists "owner manages shared invites" on public.companion_shared_invites;
create policy "owner manages shared invites"
on public.companion_shared_invites
for all
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists "select shared members by owner or self" on public.companion_shared_members;
create policy "select shared members by owner or self"
on public.companion_shared_members
for select
to authenticated
using ((select auth.uid()) = owner_id or (select auth.uid()) = user_id);

drop policy if exists "owner updates shared members" on public.companion_shared_members;
create policy "owner updates shared members"
on public.companion_shared_members
for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists "owner deletes shared members" on public.companion_shared_members;
create policy "owner deletes shared members"
on public.companion_shared_members
for delete
to authenticated
using ((select auth.uid()) = owner_id);

drop policy if exists "select shared comments by member" on public.companion_shared_comments;
create policy "select shared comments by member"
on public.companion_shared_comments
for select
to authenticated
using (public.companion_current_permission(shared_trip_id) is not null);

drop policy if exists "insert shared comments by commenter" on public.companion_shared_comments;
create policy "insert shared comments by commenter"
on public.companion_shared_comments
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and public.companion_permission_rank(public.companion_current_permission(shared_trip_id)) >= 2
);

drop policy if exists "select meeting confirmations by member" on public.companion_meeting_confirmations;
create policy "select meeting confirmations by member"
on public.companion_meeting_confirmations
for select
to authenticated
using (public.companion_current_permission(shared_trip_id) is not null);

drop policy if exists "insert meeting confirmations by commenter" on public.companion_meeting_confirmations;
create policy "insert meeting confirmations by commenter"
on public.companion_meeting_confirmations
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and public.companion_permission_rank(public.companion_current_permission(shared_trip_id)) >= 2
);

drop policy if exists "update own meeting confirmations" on public.companion_meeting_confirmations;
create policy "update own meeting confirmations"
on public.companion_meeting_confirmations
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "select shared activities by member" on public.companion_shared_activities;
create policy "select shared activities by member"
on public.companion_shared_activities
for select
to authenticated
using (public.companion_current_permission(shared_trip_id) is not null);

drop policy if exists "insert shared activities by member" on public.companion_shared_activities;
create policy "insert shared activities by member"
on public.companion_shared_activities
for insert
to authenticated
with check (
  ((select auth.uid()) = user_id or user_id is null)
  and public.companion_current_permission(shared_trip_id) is not null
);

drop policy if exists "select shared mutations by member" on public.companion_shared_mutations;
create policy "select shared mutations by member"
on public.companion_shared_mutations
for select
to authenticated
using (public.companion_current_permission(shared_trip_id) is not null);

drop policy if exists "insert shared mutations by collaborator" on public.companion_shared_mutations;
create policy "insert shared mutations by collaborator"
on public.companion_shared_mutations
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and public.companion_permission_rank(public.companion_current_permission(shared_trip_id)) >= 3
);

drop policy if exists "owner updates shared mutations" on public.companion_shared_mutations;
create policy "owner updates shared mutations"
on public.companion_shared_mutations
for update
to authenticated
using (
  exists (
    select 1
    from public.companion_shared_trips trip
    where trip.id = shared_trip_id
      and trip.owner_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.companion_shared_trips trip
    where trip.id = shared_trip_id
      and trip.owner_id = (select auth.uid())
  )
);
