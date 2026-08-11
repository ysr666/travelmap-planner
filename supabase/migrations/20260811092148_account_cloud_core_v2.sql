-- Additive account-cloud V2 contract.
--
-- This migration deliberately leaves cloud_sync_objects untouched. Compatible
-- legacy rows are copied into the new revisioned envelope, while the web client
-- keeps using the legacy path until the cloud-first cutover is separately
-- deployed and verified.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists tripmap_private authorization postgres;
revoke all on schema tripmap_private from public, anon, authenticated;
grant usage on schema tripmap_private to authenticated, service_role;

create table if not exists public.tripmap_account_objects (
  owner_id uuid not null references auth.users(id) on delete cascade,
  trip_id text not null
    check (
      pg_catalog.length(trip_id) between 1 and 160
      and trip_id !~ '[[:cntrl:]]'
    ),
  object_type text not null
    check (object_type in (
      'trip',
      'day',
      'item',
      'ticket_meta',
      'document_index',
      'document_trip_link',
      'transport_booking',
      'transport_segment',
      'lodging',
      'insurance',
      'media_asset',
      'realtime_fact',
      'ledger_settings',
      'ledger_participant',
      'ledger_budget',
      'ledger_expense',
      'trip_intelligence_applied_change',
      'trip_intelligence_suggestion_state',
      'shared_task',
      'ai_job',
      'replan_event',
      'replan_record'
    )),
  object_id text not null
    check (
      pg_catalog.length(object_id) between 1 and 160
      and object_id !~ '[[:cntrl:]]'
    ),
  payload jsonb,
  schema_version smallint not null
    check (schema_version between 1 and 32),
  revision bigint not null
    check (revision >= 1),
  mutation_id text not null
    check (
      pg_catalog.length(mutation_id) between 1 and 160
      and mutation_id !~ '[[:cntrl:]]'
    ),
  actor_id uuid not null,
  device_id text not null
    check (
      pg_catalog.length(device_id) between 1 and 128
      and device_id !~ '[[:cntrl:]]'
    ),
  tombstone boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (owner_id, object_type, object_id),
  check (
    (tombstone and payload is null and deleted_at is not null)
    or (
      not tombstone
      and payload is not null
      and pg_catalog.jsonb_typeof(payload) = 'object'
      and deleted_at is null
      and pg_catalog.octet_length(payload::text) <= 2097152
    )
  )
);

create index if not exists tripmap_account_objects_owner_trip_revision_idx
  on public.tripmap_account_objects (owner_id, trip_id, revision desc);

create index if not exists tripmap_account_objects_owner_trip_updated_idx
  on public.tripmap_account_objects (owner_id, trip_id, updated_at desc);

create index if not exists tripmap_account_objects_tombstone_retention_idx
  on public.tripmap_account_objects (deleted_at)
  where tombstone;

alter table public.tripmap_account_objects replica identity full;
alter table public.tripmap_account_objects enable row level security;
alter table public.tripmap_account_objects force row level security;

drop policy if exists "select own account objects" on public.tripmap_account_objects;
create policy "select own account objects"
on public.tripmap_account_objects
for select
to authenticated
using ((select auth.uid()) = owner_id);

revoke all on table public.tripmap_account_objects from public, anon, authenticated;
grant select on table public.tripmap_account_objects to authenticated;
grant select, insert, update, delete on table public.tripmap_account_objects to service_role;

create table if not exists tripmap_private.account_mutation_receipts (
  owner_id uuid not null references auth.users(id) on delete cascade,
  mutation_id text not null
    check (
      pg_catalog.length(mutation_id) between 1 and 160
      and mutation_id !~ '[[:cntrl:]]'
    ),
  request_hash text not null
    check (request_hash ~ '^[0-9a-f]{64}$'),
  trip_id text not null,
  object_type text not null,
  object_id text not null,
  operation text not null check (operation in ('upsert', 'delete')),
  expected_revision bigint not null check (expected_revision >= 0),
  applied_revision bigint not null check (applied_revision >= 1),
  schema_version smallint not null check (schema_version between 1 and 32),
  actor_id uuid not null,
  device_id text not null,
  applied_at timestamptz not null default pg_catalog.now(),
  primary key (owner_id, mutation_id)
);

create index if not exists account_mutation_receipts_owner_applied_idx
  on tripmap_private.account_mutation_receipts (owner_id, applied_at desc);

create index if not exists account_mutation_receipts_object_idx
  on tripmap_private.account_mutation_receipts (
    owner_id,
    object_type,
    object_id,
    applied_revision desc
  );

alter table tripmap_private.account_mutation_receipts enable row level security;
alter table tripmap_private.account_mutation_receipts force row level security;
revoke all on table tripmap_private.account_mutation_receipts from public, anon, authenticated;
grant select, insert, update, delete on table tripmap_private.account_mutation_receipts to service_role;

create or replace function tripmap_private.account_payload_has_forbidden_key(
  target_payload jsonb
)
returns boolean
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $$
declare
  payload_entry record;
  normalized_key text;
begin
  if pg_catalog.jsonb_typeof(target_payload) = 'object' then
    for payload_entry in
      select key, value from pg_catalog.jsonb_each(target_payload)
    loop
      normalized_key := pg_catalog.lower(
        pg_catalog.regexp_replace(payload_entry.key, '[^a-zA-Z0-9]', '', 'g')
      );
      if normalized_key in (
        'password',
        'passcode',
        'accesstoken',
        'refreshtoken',
        'authorization',
        'bearer',
        'secret',
        'providerkey',
        'apikey',
        'blob',
        'fileblob',
        'rawproviderpayload',
        'providerpayload',
        'ocrtext',
        'documentbody',
        'passportnumber',
        'visanumber'
      ) then
        return true;
      end if;
      if pg_catalog.jsonb_typeof(payload_entry.value) in ('object', 'array')
         and tripmap_private.account_payload_has_forbidden_key(payload_entry.value) then
        return true;
      end if;
    end loop;
  elsif pg_catalog.jsonb_typeof(target_payload) = 'array' then
    for payload_entry in
      select value from pg_catalog.jsonb_array_elements(target_payload)
    loop
      if pg_catalog.jsonb_typeof(payload_entry.value) in ('object', 'array')
         and tripmap_private.account_payload_has_forbidden_key(payload_entry.value) then
        return true;
      end if;
    end loop;
  end if;

  return false;
end;
$$;

create or replace function tripmap_private.account_object_public_json(
  target_object public.tripmap_account_objects
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'tripId', target_object.trip_id,
    'objectType', target_object.object_type,
    'objectId', target_object.object_id,
    'payload', target_object.payload,
    'objectSchemaVersion', target_object.schema_version,
    'revision', target_object.revision,
    'mutationId', target_object.mutation_id,
    'actorId', target_object.actor_id,
    'deviceId', target_object.device_id,
    'tombstone', target_object.tombstone,
    'deletedAt', target_object.deleted_at,
    'createdAt', target_object.created_at,
    'updatedAt', target_object.updated_at
  );
$$;

create or replace function tripmap_private.account_apply_object_mutation_v1(
  target_schema_version integer,
  target_mutation_id text,
  target_trip_id text,
  target_object_type text,
  target_object_id text,
  target_operation text,
  target_expected_revision bigint,
  target_object_schema_version integer,
  target_device_id text,
  target_payload jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid;
  current_object public.tripmap_account_objects%rowtype;
  prior_receipt tripmap_private.account_mutation_receipts%rowtype;
  current_revision bigint;
  next_revision bigint;
  request_hash text;
  has_current_object boolean;
begin
  current_user_id := auth.uid();
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'not_authenticated';
  end if;

  if target_schema_version is null
     or target_schema_version <> 1
     or target_object_schema_version is null
     or target_object_schema_version not between 1 and 32
     or target_expected_revision is null
     or target_expected_revision < 0 then
    return pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'rejected',
      'mutationId', coalesce(target_mutation_id, ''),
      'reason', 'invalid_version_or_revision'
    );
  end if;

  if target_object_type is null or target_object_type not in (
    'trip',
    'day',
    'item',
    'ticket_meta',
    'document_index',
    'document_trip_link',
    'transport_booking',
    'transport_segment',
    'lodging',
    'insurance',
    'media_asset',
    'realtime_fact',
    'ledger_settings',
    'ledger_participant',
    'ledger_budget',
    'ledger_expense',
    'trip_intelligence_applied_change',
    'trip_intelligence_suggestion_state',
    'shared_task',
    'ai_job',
    'replan_event',
    'replan_record'
  ) then
    return pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'rejected',
      'mutationId', coalesce(target_mutation_id, ''),
      'reason', 'unknown_object_type'
    );
  end if;

  if target_object_type in ('media_asset', 'realtime_fact', 'ai_job') then
    return pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'rejected',
      'mutationId', coalesce(target_mutation_id, ''),
      'reason', 'server_managed_object'
    );
  end if;

  if target_operation is null
     or target_operation not in ('upsert', 'delete')
     or target_mutation_id is null
     or target_mutation_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
     or target_trip_id is null
     or target_trip_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
     or target_object_id is null
     or target_object_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
     or target_device_id is null
     or target_device_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$' then
    return pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'rejected',
      'mutationId', coalesce(target_mutation_id, ''),
      'reason', 'invalid_identifier_or_operation'
    );
  end if;

  if target_operation = 'upsert' and (
    target_payload is null
    or pg_catalog.jsonb_typeof(target_payload) <> 'object'
    or pg_catalog.octet_length(target_payload::text) > 524288
    or target_payload ->> 'id' is distinct from target_object_id
    or (
      target_object_type = 'trip'
      and target_trip_id is distinct from target_object_id
    )
    or (
      target_object_type <> 'trip'
      and target_payload ->> 'tripId' is distinct from target_trip_id
    )
    or target_payload ?| array[
      'owner_id',
      'ownerId',
      'actor_id',
      'actorId',
      'mutation_id',
      'mutationId',
      'revision',
      'tombstone',
      'deleted_at',
      'deletedAt'
    ]
    or tripmap_private.account_payload_has_forbidden_key(target_payload)
  ) then
    return pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'rejected',
      'mutationId', target_mutation_id,
      'reason', 'invalid_or_sensitive_payload'
    );
  end if;

  if target_operation = 'delete' and target_payload is not null then
    return pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'rejected',
      'mutationId', target_mutation_id,
      'reason', 'delete_payload_not_allowed'
    );
  end if;

  request_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'schemaVersion', target_schema_version,
          'mutationId', target_mutation_id,
          'tripId', target_trip_id,
          'objectType', target_object_type,
          'objectId', target_object_id,
          'operation', target_operation,
          'expectedRevision', target_expected_revision,
          'objectSchemaVersion', target_object_schema_version,
          'deviceId', target_device_id,
          'payload', target_payload
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  -- Serialize absent-row creates by object identity and serialize retries by
  -- mutation identity before consulting the receipt ledger.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      current_user_id::text || ':' || target_object_type || ':' || target_object_id,
      0
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      current_user_id::text || ':' || target_mutation_id,
      0
    )
  );

  select *
  into prior_receipt
  from tripmap_private.account_mutation_receipts
  where owner_id = current_user_id
    and mutation_id = target_mutation_id;

  if found then
    if prior_receipt.request_hash <> request_hash then
      return pg_catalog.jsonb_build_object(
        'schemaVersion', 1,
        'status', 'rejected',
        'mutationId', target_mutation_id,
        'reason', 'mutation_id_reused'
      );
    end if;

    select *
    into current_object
    from public.tripmap_account_objects
    where owner_id = current_user_id
      and object_type = prior_receipt.object_type
      and object_id = prior_receipt.object_id;

    if not found then
      return pg_catalog.jsonb_build_object(
        'schemaVersion', 1,
        'status', 'rejected',
        'mutationId', target_mutation_id,
        'reason', 'receipt_object_missing'
      );
    end if;

    return pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'idempotent',
      'mutationId', target_mutation_id,
      'appliedRevision', prior_receipt.applied_revision,
      'currentRevision', current_object.revision,
      'object', tripmap_private.account_object_public_json(current_object)
    );
  end if;

  select *
  into current_object
  from public.tripmap_account_objects
  where owner_id = current_user_id
    and object_type = target_object_type
    and object_id = target_object_id
  for update;
  has_current_object := found;
  current_revision := case when has_current_object then current_object.revision else 0 end;

  if has_current_object and current_object.trip_id <> target_trip_id then
    return pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'rejected',
      'mutationId', target_mutation_id,
      'reason', 'object_trip_mismatch'
    );
  end if;

  if current_revision <> target_expected_revision then
    return pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'conflict',
      'mutationId', target_mutation_id,
      'reason', 'revision_mismatch',
      'currentRevision', current_revision,
      'currentObject', case
        when has_current_object
          then tripmap_private.account_object_public_json(current_object)
        else null
      end
    );
  end if;

  next_revision := current_revision + 1;
  if has_current_object then
    update public.tripmap_account_objects
    set
      payload = case when target_operation = 'delete' then null else target_payload end,
      schema_version = target_object_schema_version,
      revision = next_revision,
      mutation_id = target_mutation_id,
      actor_id = current_user_id,
      device_id = target_device_id,
      tombstone = target_operation = 'delete',
      deleted_at = case when target_operation = 'delete' then pg_catalog.now() else null end,
      updated_at = pg_catalog.now()
    where owner_id = current_user_id
      and object_type = target_object_type
      and object_id = target_object_id
    returning * into current_object;
  else
    insert into public.tripmap_account_objects (
      owner_id,
      trip_id,
      object_type,
      object_id,
      payload,
      schema_version,
      revision,
      mutation_id,
      actor_id,
      device_id,
      tombstone,
      deleted_at
    )
    values (
      current_user_id,
      target_trip_id,
      target_object_type,
      target_object_id,
      case when target_operation = 'delete' then null else target_payload end,
      target_object_schema_version,
      next_revision,
      target_mutation_id,
      current_user_id,
      target_device_id,
      target_operation = 'delete',
      case when target_operation = 'delete' then pg_catalog.now() else null end
    )
    returning * into current_object;
  end if;

  insert into tripmap_private.account_mutation_receipts (
    owner_id,
    mutation_id,
    request_hash,
    trip_id,
    object_type,
    object_id,
    operation,
    expected_revision,
    applied_revision,
    schema_version,
    actor_id,
    device_id
  )
  values (
    current_user_id,
    target_mutation_id,
    request_hash,
    target_trip_id,
    target_object_type,
    target_object_id,
    target_operation,
    target_expected_revision,
    next_revision,
    target_object_schema_version,
    current_user_id,
    target_device_id
  );

  return pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'status', 'applied',
    'mutationId', target_mutation_id,
    'appliedRevision', next_revision,
    'currentRevision', next_revision,
    'object', tripmap_private.account_object_public_json(current_object)
  );
end;
$$;

create or replace function public.account_apply_object_mutation_v1(
  target_schema_version integer,
  target_mutation_id text,
  target_trip_id text,
  target_object_type text,
  target_object_id text,
  target_operation text,
  target_expected_revision bigint,
  target_object_schema_version integer,
  target_device_id text,
  target_payload jsonb default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select tripmap_private.account_apply_object_mutation_v1(
    target_schema_version,
    target_mutation_id,
    target_trip_id,
    target_object_type,
    target_object_id,
    target_operation,
    target_expected_revision,
    target_object_schema_version,
    target_device_id,
    target_payload
  );
$$;

revoke all on function tripmap_private.account_payload_has_forbidden_key(jsonb)
  from public, anon, authenticated;
revoke all on function tripmap_private.account_object_public_json(public.tripmap_account_objects)
  from public, anon, authenticated;
revoke all on function tripmap_private.account_apply_object_mutation_v1(
  integer, text, text, text, text, text, bigint, integer, text, jsonb
) from public, anon, authenticated;
grant execute on function tripmap_private.account_apply_object_mutation_v1(
  integer, text, text, text, text, text, bigint, integer, text, jsonb
) to authenticated, service_role;

revoke all on function public.account_apply_object_mutation_v1(
  integer, text, text, text, text, text, bigint, integer, text, jsonb
) from public, anon;
grant execute on function public.account_apply_object_mutation_v1(
  integer, text, text, text, text, text, bigint, integer, text, jsonb
) to authenticated, service_role;

-- Copy compatible legacy records without updating or deleting any legacy row.
insert into public.tripmap_account_objects (
  owner_id,
  trip_id,
  object_type,
  object_id,
  payload,
  schema_version,
  revision,
  mutation_id,
  actor_id,
  device_id,
  tombstone,
  deleted_at,
  created_at,
  updated_at
)
select
  legacy.user_id,
  legacy.trip_id,
  legacy.object_type,
  legacy.object_id,
  case when legacy.deleted_at_ms is null then legacy.payload else null end,
  1,
  1,
  'legacy_' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        legacy.user_id::text || ':' || legacy.object_type || ':' || legacy.object_id || ':' || legacy.op_id,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ),
  legacy.user_id,
  coalesce(
    nullif(
      pg_catalog.left(
        pg_catalog.regexp_replace(legacy.device_id, '[^A-Za-z0-9:_-]', '', 'g'),
        128
      ),
      ''
    ),
    'legacy'
  ),
  legacy.deleted_at_ms is not null,
  case
    when legacy.deleted_at_ms is null then null
    else pg_catalog.to_timestamp(legacy.deleted_at_ms::double precision / 1000.0)
  end,
  legacy.created_at,
  legacy.updated_at
from public.cloud_sync_objects as legacy
where legacy.object_type in (
  'trip',
  'day',
  'item',
  'ticket_meta',
  'ledger_settings',
  'ledger_participant',
  'ledger_budget',
  'ledger_expense',
  'replan_event',
  'replan_record',
  'trip_intelligence_applied_change',
  'trip_intelligence_suggestion_state'
)
on conflict (owner_id, object_type, object_id) do nothing;

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tripmap_account_objects'
  ) then
    alter publication supabase_realtime add table public.tripmap_account_objects;
  end if;
end;
$$;

comment on table public.tripmap_account_objects is
  'Revisioned TripMap account objects. Sensitive document bodies and file blobs remain in their dedicated encrypted or Storage domains.';
comment on table tripmap_private.account_mutation_receipts is
  'Private idempotency receipts retained independently from the latest object revision.';
comment on function public.account_apply_object_mutation_v1(
  integer, text, text, text, text, text, bigint, integer, text, jsonb
) is
  'Authenticated cloud-first object mutation boundary with optimistic revision checks and mutation replay deduplication.';
