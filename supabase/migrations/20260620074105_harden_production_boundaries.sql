-- Move privileged implementation details out of the exposed API schema while
-- preserving public RPC signatures used by the web client.

create schema if not exists tripmap_private authorization postgres;
revoke all on schema tripmap_private from public, anon, authenticated;
grant usage on schema tripmap_private to authenticated, service_role;

alter function public.set_updated_at() set schema tripmap_private;
alter function public.rls_auto_enable() set schema tripmap_private;
alter function public.invoke_tripmap_due_reminders() set schema tripmap_private;
alter function public.claim_travel_inbox_source(uuid, text, integer) set schema tripmap_private;
alter function public.release_travel_inbox_source_claim(uuid, text) set schema tripmap_private;
alter function public.companion_permission_rank(text) set schema tripmap_private;
alter function public.companion_current_permission(uuid) set schema tripmap_private;
alter function public.companion_claim_invite(text, text) set schema tripmap_private;
alter function public.companion_record_view(uuid) set schema tripmap_private;
alter function public.companion_add_comment(uuid, text, text) set schema tripmap_private;
alter function public.companion_confirm_meeting(uuid, text, text) set schema tripmap_private;
alter function public.companion_submit_mutation(uuid, text, jsonb) set schema tripmap_private;

alter function tripmap_private.set_updated_at() set search_path = '';
alter function tripmap_private.rls_auto_enable() set search_path = 'pg_catalog';
alter function tripmap_private.claim_travel_inbox_source(uuid, text, integer) set search_path = '';
alter function tripmap_private.release_travel_inbox_source_claim(uuid, text) set search_path = '';
alter function tripmap_private.companion_permission_rank(text) set search_path = '';
alter function tripmap_private.companion_current_permission(uuid) set search_path = '';

create or replace function tripmap_private.invoke_tripmap_due_reminders()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_url text;
  anon_key text;
  cron_secret text;
begin
  select decrypted_secret into project_url
  from vault.decrypted_secrets
  where name = 'tripmap_project_url'
  limit 1;

  select decrypted_secret into anon_key
  from vault.decrypted_secrets
  where name = 'tripmap_anon_key'
  limit 1;

  select decrypted_secret into cron_secret
  from vault.decrypted_secrets
  where name = 'tripmap_reminder_cron_secret'
  limit 1;

  if project_url is null or anon_key is null or cron_secret is null then
    return;
  end if;

  perform net.http_post(
    url := project_url || '/functions/v1/push-reminders',
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || anon_key,
      'x-cron-secret', cron_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
end;
$$;

create or replace function tripmap_private.companion_claim_invite(
  invite_token_hash text,
  companion_display_name text default null
)
returns table(shared_trip_id uuid, trip_id text, permission text)
language plpgsql
security definer
set search_path = ''
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
    and (expires_at is null or expires_at > pg_catalog.now())
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
    nullif(pg_catalog.btrim(companion_display_name), ''),
    user_email,
    invite_record.permission
  )
  on conflict on constraint companion_shared_members_pkey
  do update set
    display_name = coalesce(
      nullif(pg_catalog.btrim(excluded.display_name), ''),
      public.companion_shared_members.display_name
    ),
    email = excluded.email,
    permission = excluded.permission,
    removed_at = null,
    updated_at = pg_catalog.now();

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
    nullif(pg_catalog.btrim(companion_display_name), ''),
    'joined',
    '加入了共享旅行'
  );

  return query select trip_record.id, trip_record.trip_id, invite_record.permission;
end;
$$;

create or replace function tripmap_private.companion_record_view(target_shared_trip_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  activity_id uuid;
begin
  if tripmap_private.companion_current_permission(target_shared_trip_id) is null then
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

create or replace function tripmap_private.companion_add_comment(
  target_shared_trip_id uuid,
  target_item_id text,
  comment_body text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_permission text;
  comment_id uuid;
begin
  current_permission := tripmap_private.companion_current_permission(target_shared_trip_id);
  if tripmap_private.companion_permission_rank(current_permission) < 2 then
    raise exception 'permission_denied';
  end if;
  if pg_catalog.length(pg_catalog.btrim(comment_body)) = 0
     or pg_catalog.length(pg_catalog.btrim(comment_body)) > 500 then
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
    pg_catalog.btrim(comment_body)
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
    pg_catalog.left(pg_catalog.btrim(comment_body), 160)
  );

  return comment_id;
end;
$$;

create or replace function tripmap_private.companion_confirm_meeting(
  target_shared_trip_id uuid,
  target_item_id text,
  confirmation_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_permission text;
begin
  current_permission := tripmap_private.companion_current_permission(target_shared_trip_id);
  if tripmap_private.companion_permission_rank(current_permission) < 2 then
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
    nullif(pg_catalog.left(pg_catalog.btrim(coalesce(confirmation_note, '')), 300), ''),
    pg_catalog.now()
  )
  on conflict (shared_trip_id, item_id, user_id)
  do update set
    note = excluded.note,
    confirmed_at = pg_catalog.now(),
    updated_at = pg_catalog.now();

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

create or replace function tripmap_private.companion_submit_mutation(
  target_shared_trip_id uuid,
  target_mutation_type text,
  mutation_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_permission text;
  mutation_id uuid;
  required_rank integer;
begin
  if target_mutation_type not in (
    'update_item',
    'create_item',
    'delete_item',
    'reorder_day_items',
    'update_item_execution_state',
    'report_disruption',
    'request_replan_undo'
  ) then
    raise exception 'invalid_mutation_type';
  end if;

  current_permission := tripmap_private.companion_current_permission(target_shared_trip_id);
  required_rank := case
    when target_mutation_type = 'report_disruption' then 2
    else 3
  end;

  if tripmap_private.companion_permission_rank(current_permission) < required_rank then
    raise exception 'permission_denied';
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
    case
      when target_mutation_type = 'report_disruption' then '报告了突发情况'
      when target_mutation_type = 'request_replan_undo' then '请求撤销一次重排'
      else '提交了协作修改'
    end
  );

  return mutation_id;
end;
$$;

-- Public RPCs are deliberately thin invoker wrappers. PostgREST exposes these
-- signatures, while their privileged implementations remain outside public.
create or replace function public.claim_travel_inbox_source(
  source_id uuid,
  claimant text,
  lease_seconds integer default 300
)
returns public.travel_inbox_sources
language sql
security invoker
set search_path = ''
as $$
  select * from tripmap_private.claim_travel_inbox_source(source_id, claimant, lease_seconds);
$$;

create or replace function public.release_travel_inbox_source_claim(source_id uuid, claimant text)
returns void
language sql
security invoker
set search_path = ''
as $$
  select tripmap_private.release_travel_inbox_source_claim(source_id, claimant);
$$;

create or replace function public.companion_claim_invite(
  invite_token_hash text,
  companion_display_name text default null
)
returns table(shared_trip_id uuid, trip_id text, permission text)
language sql
security invoker
set search_path = ''
as $$
  select *
  from tripmap_private.companion_claim_invite(invite_token_hash, companion_display_name);
$$;

create or replace function public.companion_record_view(target_shared_trip_id uuid)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select tripmap_private.companion_record_view(target_shared_trip_id);
$$;

create or replace function public.companion_add_comment(
  target_shared_trip_id uuid,
  target_item_id text,
  comment_body text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select tripmap_private.companion_add_comment(target_shared_trip_id, target_item_id, comment_body);
$$;

create or replace function public.companion_confirm_meeting(
  target_shared_trip_id uuid,
  target_item_id text,
  confirmation_note text default null
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select tripmap_private.companion_confirm_meeting(target_shared_trip_id, target_item_id, confirmation_note);
$$;

create or replace function public.companion_submit_mutation(
  target_shared_trip_id uuid,
  target_mutation_type text,
  mutation_payload jsonb
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select tripmap_private.companion_submit_mutation(target_shared_trip_id, target_mutation_type, mutation_payload);
$$;

revoke all on all functions in schema tripmap_private from public, anon, authenticated;
grant execute on function tripmap_private.claim_travel_inbox_source(uuid, text, integer) to authenticated, service_role;
grant execute on function tripmap_private.release_travel_inbox_source_claim(uuid, text) to authenticated, service_role;
grant execute on function tripmap_private.companion_permission_rank(text) to authenticated, service_role;
grant execute on function tripmap_private.companion_current_permission(uuid) to authenticated, service_role;
grant execute on function tripmap_private.companion_claim_invite(text, text) to authenticated, service_role;
grant execute on function tripmap_private.companion_record_view(uuid) to authenticated, service_role;
grant execute on function tripmap_private.companion_add_comment(uuid, text, text) to authenticated, service_role;
grant execute on function tripmap_private.companion_confirm_meeting(uuid, text, text) to authenticated, service_role;
grant execute on function tripmap_private.companion_submit_mutation(uuid, text, jsonb) to authenticated, service_role;

revoke all on function public.claim_travel_inbox_source(uuid, text, integer) from public, anon;
revoke all on function public.release_travel_inbox_source_claim(uuid, text) from public, anon;
revoke all on function public.companion_claim_invite(text, text) from public, anon;
revoke all on function public.companion_record_view(uuid) from public, anon;
revoke all on function public.companion_add_comment(uuid, text, text) from public, anon;
revoke all on function public.companion_confirm_meeting(uuid, text, text) from public, anon;
revoke all on function public.companion_submit_mutation(uuid, text, jsonb) from public, anon;

grant execute on function public.claim_travel_inbox_source(uuid, text, integer) to authenticated, service_role;
grant execute on function public.release_travel_inbox_source_claim(uuid, text) to authenticated, service_role;
grant execute on function public.companion_claim_invite(text, text) to authenticated, service_role;
grant execute on function public.companion_record_view(uuid) to authenticated, service_role;
grant execute on function public.companion_add_comment(uuid, text, text) to authenticated, service_role;
grant execute on function public.companion_confirm_meeting(uuid, text, text) to authenticated, service_role;
grant execute on function public.companion_submit_mutation(uuid, text, jsonb) to authenticated, service_role;

-- The cron command stores a function name as text, so update it after moving
-- the implementation out of public.
do $$
declare
  reminder_job record;
begin
  for reminder_job in
    select jobid from cron.job where jobname = 'tripmap-due-reminders'
  loop
    perform cron.unschedule(reminder_job.jobid);
  end loop;
  perform cron.schedule(
    'tripmap-due-reminders',
    '* * * * *',
    'select tripmap_private.invoke_tripmap_due_reminders()'
  );
end;
$$;

-- Cover every foreign key reported by the production performance advisor.
create index if not exists companion_meeting_confirmations_user_id_idx
  on public.companion_meeting_confirmations (user_id);
create index if not exists companion_shared_activities_user_id_idx
  on public.companion_shared_activities (user_id);
create index if not exists companion_shared_comments_user_id_idx
  on public.companion_shared_comments (user_id);
create index if not exists companion_shared_invites_owner_id_idx
  on public.companion_shared_invites (owner_id);
create index if not exists companion_shared_members_owner_id_idx
  on public.companion_shared_members (owner_id);
create index if not exists companion_shared_mutations_user_id_idx
  on public.companion_shared_mutations (user_id);
create index if not exists reminder_deliveries_subscription_id_idx
  on public.reminder_deliveries (subscription_id);
create index if not exists travel_inbox_sources_connector_id_idx
  on public.travel_inbox_sources (connector_id);

comment on schema tripmap_private is
  'Non-exposed implementations for TripMap RPC, RLS, trigger, and cron boundaries.';
