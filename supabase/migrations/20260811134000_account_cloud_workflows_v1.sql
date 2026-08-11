-- Registered atomic workflow boundary for Account Cloud V2.
--
-- The workflow registry is intentionally closed. This RPC accepts no table,
-- function, route, owner, actor, SQL, or dependency expression from callers.
-- All revisions and domain topology are validated before the first write.

create table if not exists tripmap_private.account_workflow_receipts (
  owner_id uuid not null references auth.users(id) on delete cascade,
  batch_mutation_id text not null
    check (batch_mutation_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  workflow_id text not null check (workflow_id in (
    'day.items.reorder@1',
    'item.move@1',
    'trip.import.commit@1',
    'ticket.bind@1',
    'ledger.batch@1',
    'trip.replan.apply@1',
    'trip.repair.apply@1'
  )),
  trip_id text not null,
  device_id text not null,
  step_count smallint not null check (step_count between 1 and 256),
  response jsonb not null check (
    pg_catalog.jsonb_typeof(response) = 'object'
    and pg_catalog.octet_length(response::text) <= 8388608
  ),
  applied_at timestamptz not null default pg_catalog.now(),
  primary key (owner_id, batch_mutation_id)
);

create index if not exists account_workflow_receipts_owner_applied_idx
  on tripmap_private.account_workflow_receipts (owner_id, applied_at desc);

alter table tripmap_private.account_workflow_receipts enable row level security;
alter table tripmap_private.account_workflow_receipts force row level security;
revoke all on table tripmap_private.account_workflow_receipts from public, anon, authenticated;
grant select, insert, update, delete on table tripmap_private.account_workflow_receipts to service_role;

create or replace function tripmap_private.account_payload_shape_is_safe(
  target_payload jsonb
)
returns boolean
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  with recursive payload_nodes(value, depth) as (
    select target_payload, 0
    union all
    select child.value, parent.depth + 1
    from payload_nodes as parent
    cross join lateral (
      select object_entry.value
      from pg_catalog.jsonb_each(
        case
          when pg_catalog.jsonb_typeof(parent.value) = 'object' then parent.value
          else '{}'::jsonb
        end
      ) as object_entry(key, value)
      union all
      select array_entry.value
      from pg_catalog.jsonb_array_elements(
        case
          when pg_catalog.jsonb_typeof(parent.value) = 'array' then parent.value
          else '[]'::jsonb
        end
      ) as array_entry(value)
    ) as child
    where parent.depth < 33
  )
  select
    pg_catalog.count(*) <= 20000
    and coalesce(pg_catalog.max(depth), 0) <= 32
  from payload_nodes;
$$;

create or replace function tripmap_private.account_workflow_payload_is_safe(
  target_payload jsonb
)
returns boolean
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $$
begin
  if not tripmap_private.account_payload_shape_is_safe(target_payload) then
    return false;
  end if;
  return not tripmap_private.account_payload_has_forbidden_key(target_payload);
end;
$$;

revoke all on function tripmap_private.account_payload_shape_is_safe(jsonb)
  from public, anon, authenticated;
revoke all on function tripmap_private.account_workflow_payload_is_safe(jsonb)
  from public, anon, authenticated;

create or replace function tripmap_private.account_apply_workflow_v1(
  target_schema_version integer,
  target_account_hash text,
  target_batch_mutation_id text,
  target_workflow_id text,
  target_trip_id text,
  target_device_id text,
  target_steps jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid;
  prior_receipt tripmap_private.account_workflow_receipts%rowtype;
  current_object public.tripmap_account_objects%rowtype;
  current_step jsonb;
  stored_step jsonb;
  step_payload jsonb;
  step_id text;
  step_mutation_id text;
  step_object_type text;
  step_object_id text;
  step_operation text;
  step_expected_revision bigint;
  step_schema_version integer;
  current_revision bigint;
  next_revision bigint;
  step_count integer;
  request_hash text;
  step_request_hash text;
  lock_key text;
  has_current_object boolean;
  move_detected boolean := false;
  ticket_object_id text;
  ticket_current_item_id text;
  ticket_target_item_id text;
  conflict_results jsonb := '[]'::jsonb;
  applied_steps jsonb := '[]'::jsonb;
  final_response jsonb;
begin
  current_user_id := auth.uid();
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'not_authenticated';
  end if;

  if target_account_hash is null
     or target_account_hash !~ '^[a-f0-9]{32}$'
     or target_account_hash <> pg_catalog.left(
       pg_catalog.encode(
         extensions.digest(
           pg_catalog.convert_to(current_user_id::text, 'UTF8'),
           'sha256'
         ),
         'hex'
       ),
       32
     ) then
    return pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'rejected',
      'batchMutationId', coalesce(target_batch_mutation_id, ''),
      'workflowId', coalesce(target_workflow_id, ''),
      'tripId', coalesce(target_trip_id, ''),
      'reason', 'account_context_mismatch'
    );
  end if;

  if target_schema_version is null or target_schema_version <> 1 then
    return pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'rejected',
      'batchMutationId', coalesce(target_batch_mutation_id, ''),
      'workflowId', coalesce(target_workflow_id, ''),
      'tripId', coalesce(target_trip_id, ''),
      'reason', 'invalid_version_or_revision'
    );
  end if;

  if target_workflow_id is null or target_workflow_id not in (
    'day.items.reorder@1',
    'item.move@1',
    'trip.import.commit@1',
    'ticket.bind@1',
    'ledger.batch@1',
    'trip.replan.apply@1',
    'trip.repair.apply@1'
  ) then
    return pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'rejected',
      'batchMutationId', coalesce(target_batch_mutation_id, ''),
      'workflowId', coalesce(target_workflow_id, ''),
      'tripId', coalesce(target_trip_id, ''),
      'reason', 'unknown_workflow'
    );
  end if;

  if target_batch_mutation_id is null
     or target_batch_mutation_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
     or target_trip_id is null
     or target_trip_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
     or target_device_id is null
     or target_device_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$' then
    return pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'rejected',
      'batchMutationId', coalesce(target_batch_mutation_id, ''),
      'workflowId', target_workflow_id,
      'tripId', coalesce(target_trip_id, ''),
      'reason', 'invalid_identifier'
    );
  end if;

  if target_steps is null
     or pg_catalog.jsonb_typeof(target_steps) <> 'array'
     or pg_catalog.octet_length(target_steps::text) > 4194304 then
    return pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'rejected',
      'batchMutationId', target_batch_mutation_id,
      'workflowId', target_workflow_id,
      'tripId', target_trip_id,
      'reason', 'invalid_envelope'
    );
  end if;

  step_count := pg_catalog.jsonb_array_length(target_steps);
  if step_count < (case target_workflow_id
      when 'day.items.reorder@1' then 2
      when 'ticket.bind@1' then 2
      else 1
    end)
    or step_count > (case target_workflow_id
      when 'day.items.reorder@1' then 128
      when 'item.move@1' then 128
      when 'trip.import.commit@1' then 256
      when 'ticket.bind@1' then 33
      when 'ledger.batch@1' then 128
      when 'trip.replan.apply@1' then 128
      when 'trip.repair.apply@1' then 128
      else 0
    end) then
    return pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'rejected',
      'batchMutationId', target_batch_mutation_id,
      'workflowId', target_workflow_id,
      'tripId', target_trip_id,
      'reason', 'workflow_shape_invalid'
    );
  end if;

  -- Validate every field, payload, and workflow allowlist before any lock or write.
  for current_step in
    select value from pg_catalog.jsonb_array_elements(target_steps)
  loop
    if pg_catalog.jsonb_typeof(current_step) <> 'object'
       or not current_step ?& array[
         'stepId',
         'mutationId',
         'objectType',
         'objectId',
         'operation',
         'expectedRevision',
         'objectSchemaVersion'
       ]
       or exists (
         select 1
         from pg_catalog.jsonb_object_keys(current_step) as workflow_field(field_name)
         where workflow_field.field_name not in (
           'stepId',
           'mutationId',
           'objectType',
           'objectId',
           'operation',
           'expectedRevision',
           'objectSchemaVersion',
           'payload'
         )
       ) then
      return pg_catalog.jsonb_build_object(
        'schemaVersion', 1,
        'status', 'rejected',
        'batchMutationId', target_batch_mutation_id,
        'workflowId', target_workflow_id,
        'tripId', target_trip_id,
        'reason', 'invalid_envelope'
      );
    end if;

    step_id := current_step ->> 'stepId';
    step_mutation_id := current_step ->> 'mutationId';
    step_object_type := current_step ->> 'objectType';
    step_object_id := current_step ->> 'objectId';
    step_operation := current_step ->> 'operation';

    if step_id is null
       or step_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
       or step_mutation_id is null
       or step_mutation_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
       or step_object_id is null
       or step_object_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
       or step_operation is null
       or step_operation not in ('upsert', 'delete') then
      return pg_catalog.jsonb_build_object(
        'schemaVersion', 1,
        'status', 'rejected',
        'batchMutationId', target_batch_mutation_id,
        'workflowId', target_workflow_id,
        'tripId', target_trip_id,
        'reason', 'invalid_identifier'
      );
    end if;

    if pg_catalog.jsonb_typeof(current_step -> 'expectedRevision') <> 'number'
       or (current_step ->> 'expectedRevision') !~ '^[0-9]{1,16}$'
       or pg_catalog.jsonb_typeof(current_step -> 'objectSchemaVersion') <> 'number'
       or (current_step ->> 'objectSchemaVersion') !~ '^[0-9]{1,2}$' then
      return pg_catalog.jsonb_build_object(
        'schemaVersion', 1,
        'status', 'rejected',
        'batchMutationId', target_batch_mutation_id,
        'workflowId', target_workflow_id,
        'tripId', target_trip_id,
        'reason', 'invalid_version_or_revision'
      );
    end if;

    step_expected_revision := (current_step ->> 'expectedRevision')::bigint;
    step_schema_version := (current_step ->> 'objectSchemaVersion')::integer;
    if step_expected_revision > 9007199254740991
       or step_schema_version not between 1 and 32 then
      return pg_catalog.jsonb_build_object(
        'schemaVersion', 1,
        'status', 'rejected',
        'batchMutationId', target_batch_mutation_id,
        'workflowId', target_workflow_id,
        'tripId', target_trip_id,
        'reason', 'invalid_version_or_revision'
      );
    end if;

    if step_object_type in ('media_asset', 'realtime_fact', 'ai_job') then
      return pg_catalog.jsonb_build_object(
        'schemaVersion', 1,
        'status', 'rejected',
        'batchMutationId', target_batch_mutation_id,
        'workflowId', target_workflow_id,
        'tripId', target_trip_id,
        'reason', 'server_managed_object'
      );
    end if;

    if step_object_type is null or step_object_type not in (
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
      'ledger_settings',
      'ledger_participant',
      'ledger_budget',
      'ledger_expense',
      'trip_intelligence_applied_change',
      'trip_intelligence_suggestion_state',
      'shared_task',
      'replan_event',
      'replan_record'
    ) then
      return pg_catalog.jsonb_build_object(
        'schemaVersion', 1,
        'status', 'rejected',
        'batchMutationId', target_batch_mutation_id,
        'workflowId', target_workflow_id,
        'tripId', target_trip_id,
        'reason', 'unknown_object_type'
      );
    end if;

    step_payload := current_step -> 'payload';
    if step_operation = 'delete' then
      if current_step ? 'payload' then
        return pg_catalog.jsonb_build_object(
          'schemaVersion', 1,
          'status', 'rejected',
          'batchMutationId', target_batch_mutation_id,
          'workflowId', target_workflow_id,
          'tripId', target_trip_id,
          'reason', 'invalid_or_sensitive_payload'
        );
      end if;
    elsif step_payload is null
       or pg_catalog.jsonb_typeof(step_payload) <> 'object'
       or pg_catalog.octet_length(step_payload::text) > 524288
       or step_payload ->> 'id' is distinct from step_object_id
       or (
         step_object_type = 'trip'
         and target_trip_id is distinct from step_object_id
       )
       or (
         step_object_type <> 'trip'
         and step_payload ->> 'tripId' is distinct from target_trip_id
       )
       or step_payload ?| array[
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
       or not tripmap_private.account_workflow_payload_is_safe(step_payload) then
      return pg_catalog.jsonb_build_object(
        'schemaVersion', 1,
        'status', 'rejected',
        'batchMutationId', target_batch_mutation_id,
        'workflowId', target_workflow_id,
        'tripId', target_trip_id,
        'reason', 'invalid_or_sensitive_payload'
      );
    end if;

    if step_operation = 'upsert' and step_object_type = 'item' and (
      step_payload ->> 'dayId' is null
      or step_payload ->> 'dayId' !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
      or pg_catalog.jsonb_typeof(step_payload -> 'sortOrder') <> 'number'
      or step_payload ->> 'sortOrder' !~ '^[0-9]{1,16}$'
      or pg_catalog.jsonb_typeof(step_payload -> 'ticketIds') <> 'array'
    ) then
      return pg_catalog.jsonb_build_object(
        'schemaVersion', 1,
        'status', 'rejected',
        'batchMutationId', target_batch_mutation_id,
        'workflowId', target_workflow_id,
        'tripId', target_trip_id,
        'reason', 'workflow_shape_invalid'
      );
    end if;

    if step_operation = 'upsert' and step_object_type = 'item' and (
      (step_payload ->> 'sortOrder')::numeric > 9007199254740991
      or exists (
        select 1
        from pg_catalog.jsonb_array_elements(step_payload -> 'ticketIds') as item_ticket(value)
        where pg_catalog.jsonb_typeof(item_ticket.value) <> 'string'
          or item_ticket.value #>> '{}' !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
      )
      or (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_array_elements(step_payload -> 'ticketIds') as item_ticket(value)
      ) <> (
        select pg_catalog.count(distinct item_ticket.value #>> '{}')
        from pg_catalog.jsonb_array_elements(step_payload -> 'ticketIds') as item_ticket(value)
      )
    ) then
      return pg_catalog.jsonb_build_object(
        'schemaVersion', 1,
        'status', 'rejected',
        'batchMutationId', target_batch_mutation_id,
        'workflowId', target_workflow_id,
        'tripId', target_trip_id,
        'reason', 'workflow_shape_invalid'
      );
    end if;

    if step_operation = 'upsert'
       and step_object_type = 'ticket_meta'
       and exists (
         select 1
         from pg_catalog.jsonb_object_keys(step_payload) as ticket_field(field_name)
         where ticket_field.field_name not in (
           'bookingId',
           'createdAt',
           'fileType',
           'id',
           'itemId',
           'mimeType',
           'scope',
           'sharedVisibility',
           'size',
           'storageMode',
           'ticketCategory',
           'title',
           'tripId',
           'updatedAt'
         )
       ) then
      return pg_catalog.jsonb_build_object(
        'schemaVersion', 1,
        'status', 'rejected',
        'batchMutationId', target_batch_mutation_id,
        'workflowId', target_workflow_id,
        'tripId', target_trip_id,
        'reason', 'invalid_or_sensitive_payload'
      );
    end if;

    if (
      target_workflow_id = 'day.items.reorder@1'
      and (
        step_object_type <> 'item'
        or step_operation <> 'upsert'
        or step_expected_revision < 1
      )
    ) or (
      target_workflow_id = 'item.move@1'
      and (step_object_type <> 'item' or step_operation <> 'upsert' or step_expected_revision < 1)
    ) or (
      target_workflow_id = 'trip.import.commit@1'
      and (
        step_object_type not in (
          'trip', 'day', 'item', 'ticket_meta', 'ledger_settings',
          'ledger_participant', 'ledger_budget', 'ledger_expense'
        )
        or step_operation <> 'upsert'
      )
    ) or (
      target_workflow_id = 'ticket.bind@1'
      and (
        step_object_type not in ('ticket_meta', 'item')
        or step_operation <> 'upsert'
        or step_expected_revision < 1
      )
    ) or (
      target_workflow_id = 'ledger.batch@1'
      and step_object_type not in (
        'ledger_settings', 'ledger_participant', 'ledger_budget', 'ledger_expense'
      )
    ) or (
      target_workflow_id = 'trip.replan.apply@1'
      and (
        step_object_type not in (
          'day', 'item', 'replan_event', 'replan_record',
          'trip_intelligence_applied_change',
          'trip_intelligence_suggestion_state'
        )
        or step_operation <> 'upsert'
      )
    ) or (
      target_workflow_id = 'trip.repair.apply@1'
      and (
        step_object_type not in (
          'item', 'replan_event', 'replan_record',
          'trip_intelligence_applied_change',
          'trip_intelligence_suggestion_state'
        )
        or step_operation <> 'upsert'
      )
    ) then
      return pg_catalog.jsonb_build_object(
        'schemaVersion', 1,
        'status', 'rejected',
        'batchMutationId', target_batch_mutation_id,
        'workflowId', target_workflow_id,
        'tripId', target_trip_id,
        'reason', 'workflow_shape_invalid'
      );
    end if;

    if target_workflow_id = 'day.items.reorder@1' and (
      step_payload ->> 'dayId' is null
      or step_payload ->> 'dayId' !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
      or pg_catalog.jsonb_typeof(step_payload -> 'sortOrder') <> 'number'
      or step_payload ->> 'sortOrder' !~ '^[0-9]{1,16}$'
    ) then
      return pg_catalog.jsonb_build_object(
        'schemaVersion', 1,
        'status', 'rejected',
        'batchMutationId', target_batch_mutation_id,
        'workflowId', target_workflow_id,
        'tripId', target_trip_id,
        'reason', 'workflow_shape_invalid'
      );
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(target_steps) as duplicate_step(value)
    group by duplicate_step.value ->> 'stepId'
    having pg_catalog.count(*) > 1
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(target_steps) as duplicate_mutation(value)
    group by duplicate_mutation.value ->> 'mutationId'
    having pg_catalog.count(*) > 1
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(target_steps) as duplicate_object(value)
    group by duplicate_object.value ->> 'objectType', duplicate_object.value ->> 'objectId'
    having pg_catalog.count(*) > 1
  ) then
    return pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'rejected',
      'batchMutationId', target_batch_mutation_id,
      'workflowId', target_workflow_id,
      'tripId', target_trip_id,
      'reason', 'workflow_shape_invalid'
    );
  end if;

  if target_workflow_id = 'day.items.reorder@1' and (
    (
      select pg_catalog.count(distinct reorder_step.value -> 'payload' ->> 'dayId')
      from pg_catalog.jsonb_array_elements(target_steps) as reorder_step(value)
    ) <> 1
    or (
      select pg_catalog.count(distinct reorder_step.value -> 'payload' ->> 'sortOrder')
      from pg_catalog.jsonb_array_elements(target_steps) as reorder_step(value)
    ) <> step_count
  ) then
    return pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'rejected',
      'batchMutationId', target_batch_mutation_id,
      'workflowId', target_workflow_id,
      'tripId', target_trip_id,
      'reason', 'workflow_shape_invalid'
    );
  end if;

  if target_workflow_id = 'ticket.bind@1' then
    if (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_array_elements(target_steps) as ticket_step(value)
      where ticket_step.value ->> 'objectType' = 'ticket_meta'
    ) <> 1 or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_array_elements(target_steps) as item_step(value)
      where item_step.value ->> 'objectType' = 'item'
    ) <> step_count - 1 then
      return pg_catalog.jsonb_build_object(
        'schemaVersion', 1,
        'status', 'rejected',
        'batchMutationId', target_batch_mutation_id,
        'workflowId', target_workflow_id,
        'tripId', target_trip_id,
        'reason', 'workflow_shape_invalid'
      );
    end if;

    select
      ticket_step.value ->> 'objectId',
      nullif(ticket_step.value -> 'payload' ->> 'itemId', '')
    into ticket_object_id, ticket_target_item_id
    from pg_catalog.jsonb_array_elements(target_steps) as ticket_step(value)
    where ticket_step.value ->> 'objectType' = 'ticket_meta';

    if ticket_target_item_id is not null and ticket_target_item_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$' then
      return pg_catalog.jsonb_build_object(
        'schemaVersion', 1,
        'status', 'rejected',
        'batchMutationId', target_batch_mutation_id,
        'workflowId', target_workflow_id,
        'tripId', target_trip_id,
        'reason', 'workflow_shape_invalid'
      );
    end if;

    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(target_steps) as bound_item(value)
      where bound_item.value ->> 'objectType' = 'item'
        and (
          pg_catalog.jsonb_typeof(bound_item.value -> 'payload' -> 'ticketIds') <> 'array'
          or (
            coalesce(bound_item.value ->> 'objectId' = ticket_target_item_id, false)
            is distinct from
            ((bound_item.value -> 'payload' -> 'ticketIds') ? ticket_object_id)
          )
        )
    ) or (
      ticket_target_item_id is not null
      and not exists (
        select 1
        from pg_catalog.jsonb_array_elements(target_steps) as target_item(value)
        where target_item.value ->> 'objectType' = 'item'
          and target_item.value ->> 'objectId' = ticket_target_item_id
      )
    ) then
      return pg_catalog.jsonb_build_object(
        'schemaVersion', 1,
        'status', 'rejected',
        'batchMutationId', target_batch_mutation_id,
        'workflowId', target_workflow_id,
        'tripId', target_trip_id,
        'reason', 'workflow_shape_invalid'
      );
    end if;
  end if;

  if target_workflow_id = 'ledger.batch@1' and exists (
    select 1
    from pg_catalog.jsonb_array_elements(target_steps) as ledger_step(value)
    where ledger_step.value ->> 'operation' = 'delete'
      and (ledger_step.value ->> 'expectedRevision')::bigint < 1
  ) then
    return pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'rejected',
      'batchMutationId', target_batch_mutation_id,
      'workflowId', target_workflow_id,
      'tripId', target_trip_id,
      'reason', 'workflow_shape_invalid'
    );
  end if;

  request_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'schemaVersion', target_schema_version,
          'accountHash', target_account_hash,
          'batchMutationId', target_batch_mutation_id,
          'workflowId', target_workflow_id,
          'tripId', target_trip_id,
          'deviceId', target_device_id,
          'steps', target_steps
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      current_user_id::text || ':workflow:' || target_batch_mutation_id,
      0
    )
  );

  if target_workflow_id = 'ticket.bind@1' then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        current_user_id::text || ':ticket-binding:' || ticket_object_id,
        0
      )
    );
  end if;

  -- Match the single-object RPC lock order so batch retries cannot race an
  -- independent object mutation or acknowledge a receipt after it advanced.
  for lock_key in
    select distinct
      (requested_step.value ->> 'objectType')
      || ':'
      || (requested_step.value ->> 'objectId')
    from pg_catalog.jsonb_array_elements(target_steps) as requested_step(value)
    order by 1
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(current_user_id::text || ':' || lock_key, 0)
    );
  end loop;

  for lock_key in
    select distinct requested_step.value ->> 'mutationId'
    from pg_catalog.jsonb_array_elements(target_steps) as requested_step(value)
    order by 1
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(current_user_id::text || ':' || lock_key, 0)
    );
  end loop;

  if target_workflow_id = 'ticket.bind@1' then
    select current_ticket.payload ->> 'itemId'
    into ticket_current_item_id
    from public.tripmap_account_objects as current_ticket
    where current_ticket.owner_id = current_user_id
      and current_ticket.object_type = 'ticket_meta'
      and current_ticket.object_id = ticket_object_id
    for update;

    if ticket_current_item_id is not null and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(target_steps) as prior_target(value)
      where prior_target.value ->> 'objectType' = 'item'
        and prior_target.value ->> 'objectId' = ticket_current_item_id
    ) then
      return pg_catalog.jsonb_build_object(
        'schemaVersion', 1,
        'status', 'rejected',
        'batchMutationId', target_batch_mutation_id,
        'workflowId', target_workflow_id,
        'tripId', target_trip_id,
        'reason', 'workflow_shape_invalid'
      );
    end if;

    for lock_key in
      select bound_item.object_id
      from public.tripmap_account_objects as bound_item
      where bound_item.owner_id = current_user_id
        and bound_item.object_type = 'item'
        and not bound_item.tombstone
        and bound_item.payload -> 'ticketIds' ? ticket_object_id
      order by bound_item.object_id
      for update
    loop
      if not exists (
        select 1
        from pg_catalog.jsonb_array_elements(target_steps) as requested_bound_item(value)
        where requested_bound_item.value ->> 'objectType' = 'item'
          and requested_bound_item.value ->> 'objectId' = lock_key
      ) then
        return pg_catalog.jsonb_build_object(
          'schemaVersion', 1,
          'status', 'rejected',
          'batchMutationId', target_batch_mutation_id,
          'workflowId', target_workflow_id,
          'tripId', target_trip_id,
          'reason', 'workflow_shape_invalid'
        );
      end if;
    end loop;
  end if;

  select *
  into prior_receipt
  from tripmap_private.account_workflow_receipts
  where owner_id = current_user_id
    and batch_mutation_id = target_batch_mutation_id;

  if found then
    if prior_receipt.request_hash <> request_hash then
      return pg_catalog.jsonb_build_object(
        'schemaVersion', 1,
        'status', 'rejected',
        'batchMutationId', target_batch_mutation_id,
        'workflowId', target_workflow_id,
        'tripId', target_trip_id,
        'reason', 'batch_mutation_id_reused'
      );
    end if;

    for stored_step in
      select value
      from pg_catalog.jsonb_array_elements(prior_receipt.response -> 'steps')
    loop
      select *
      into current_object
      from public.tripmap_account_objects
      where owner_id = current_user_id
        and object_type = stored_step -> 'object' ->> 'objectType'
        and object_id = stored_step -> 'object' ->> 'objectId'
      for update;
      has_current_object := found;

      if not has_current_object
         or current_object.revision <> (stored_step ->> 'appliedRevision')::bigint
         or current_object.mutation_id <> stored_step ->> 'mutationId' then
        conflict_results := conflict_results || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'stepId', stored_step ->> 'stepId',
            'mutationId', stored_step ->> 'mutationId',
            'objectType', stored_step -> 'object' ->> 'objectType',
            'objectId', stored_step -> 'object' ->> 'objectId',
            'currentRevision', case when has_current_object then current_object.revision else 0 end,
            'currentObject', case
              when has_current_object then tripmap_private.account_object_public_json(current_object)
              else null
            end
          )
        );
      end if;
    end loop;

    if pg_catalog.jsonb_array_length(conflict_results) > 0 then
      return pg_catalog.jsonb_build_object(
        'schemaVersion', 1,
        'status', 'conflict',
        'batchMutationId', target_batch_mutation_id,
        'workflowId', target_workflow_id,
        'tripId', target_trip_id,
        'reason', 'receipt_advanced',
        'conflicts', conflict_results
      );
    end if;

    return pg_catalog.jsonb_set(
      prior_receipt.response,
      '{status}',
      pg_catalog.to_jsonb('idempotent'::text),
      false
    );
  end if;

  if exists (
    select 1
    from tripmap_private.account_mutation_receipts as existing_mutation
    join pg_catalog.jsonb_array_elements(target_steps) as requested_step(value)
      on requested_step.value ->> 'mutationId' = existing_mutation.mutation_id
    where existing_mutation.owner_id = current_user_id
  ) then
    return pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'rejected',
      'batchMutationId', target_batch_mutation_id,
      'workflowId', target_workflow_id,
      'tripId', target_trip_id,
      'reason', 'mutation_id_reused'
    );
  end if;

  -- Preflight every current revision and invariant before the first mutation.
  for current_step in
    select value
    from pg_catalog.jsonb_array_elements(target_steps)
    order by value ->> 'objectType', value ->> 'objectId'
  loop
    step_id := current_step ->> 'stepId';
    step_mutation_id := current_step ->> 'mutationId';
    step_object_type := current_step ->> 'objectType';
    step_object_id := current_step ->> 'objectId';
    step_expected_revision := (current_step ->> 'expectedRevision')::bigint;
    step_payload := current_step -> 'payload';

    select *
    into current_object
    from public.tripmap_account_objects
    where owner_id = current_user_id
      and object_type = step_object_type
      and object_id = step_object_id
    for update;
    has_current_object := found;
    current_revision := case when has_current_object then current_object.revision else 0 end;

    if has_current_object and current_object.trip_id <> target_trip_id then
      return pg_catalog.jsonb_build_object(
        'schemaVersion', 1,
        'status', 'rejected',
        'batchMutationId', target_batch_mutation_id,
        'workflowId', target_workflow_id,
        'tripId', target_trip_id,
        'reason', 'object_trip_mismatch'
      );
    end if;

    if current_revision <> step_expected_revision then
      conflict_results := conflict_results || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'stepId', step_id,
          'mutationId', step_mutation_id,
          'objectType', step_object_type,
          'objectId', step_object_id,
          'currentRevision', current_revision,
          'currentObject', case
            when has_current_object then tripmap_private.account_object_public_json(current_object)
            else null
          end
        )
      );
    end if;

    if target_workflow_id = 'day.items.reorder@1'
       and has_current_object
       and current_object.payload ->> 'dayId' is distinct from step_payload ->> 'dayId' then
      return pg_catalog.jsonb_build_object(
        'schemaVersion', 1,
        'status', 'rejected',
        'batchMutationId', target_batch_mutation_id,
        'workflowId', target_workflow_id,
        'tripId', target_trip_id,
        'reason', 'workflow_shape_invalid'
      );
    end if;

    if target_workflow_id = 'item.move@1'
       and has_current_object
       and current_object.payload ->> 'dayId' is distinct from step_payload ->> 'dayId' then
      move_detected := true;
    end if;
  end loop;

  if pg_catalog.jsonb_array_length(conflict_results) > 0 then
    return pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'conflict',
      'batchMutationId', target_batch_mutation_id,
      'workflowId', target_workflow_id,
      'tripId', target_trip_id,
      'reason', 'revision_mismatch',
      'conflicts', conflict_results
    );
  end if;

  if target_workflow_id = 'item.move@1' and not move_detected then
    return pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'rejected',
      'batchMutationId', target_batch_mutation_id,
      'workflowId', target_workflow_id,
      'tripId', target_trip_id,
      'reason', 'workflow_shape_invalid'
    );
  end if;

  -- No ordinary rejection path exists below this point. PostgreSQL errors roll
  -- back the entire function statement, including all object and receipt rows.
  for current_step in
    select value
    from pg_catalog.jsonb_array_elements(target_steps)
    order by value ->> 'objectType', value ->> 'objectId'
  loop
    step_id := current_step ->> 'stepId';
    step_mutation_id := current_step ->> 'mutationId';
    step_object_type := current_step ->> 'objectType';
    step_object_id := current_step ->> 'objectId';
    step_operation := current_step ->> 'operation';
    step_expected_revision := (current_step ->> 'expectedRevision')::bigint;
    step_schema_version := (current_step ->> 'objectSchemaVersion')::integer;
    step_payload := current_step -> 'payload';
    next_revision := step_expected_revision + 1;

    select *
    into current_object
    from public.tripmap_account_objects
    where owner_id = current_user_id
      and object_type = step_object_type
      and object_id = step_object_id
    for update;
    has_current_object := found;

    if has_current_object then
      update public.tripmap_account_objects
      set
        payload = case when step_operation = 'delete' then null else step_payload end,
        schema_version = step_schema_version,
        revision = next_revision,
        mutation_id = step_mutation_id,
        actor_id = current_user_id,
        device_id = target_device_id,
        tombstone = step_operation = 'delete',
        deleted_at = case when step_operation = 'delete' then pg_catalog.now() else null end,
        updated_at = pg_catalog.now()
      where owner_id = current_user_id
        and object_type = step_object_type
        and object_id = step_object_id
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
      ) values (
        current_user_id,
        target_trip_id,
        step_object_type,
        step_object_id,
        case when step_operation = 'delete' then null else step_payload end,
        step_schema_version,
        next_revision,
        step_mutation_id,
        current_user_id,
        target_device_id,
        step_operation = 'delete',
        case when step_operation = 'delete' then pg_catalog.now() else null end
      )
      returning * into current_object;
    end if;

    step_request_hash := pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          pg_catalog.jsonb_build_object(
            'schemaVersion', target_schema_version,
            'accountHash', target_account_hash,
            'batchMutationId', target_batch_mutation_id,
            'workflowId', target_workflow_id,
            'tripId', target_trip_id,
            'deviceId', target_device_id,
            'step', current_step
          )::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );

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
    ) values (
      current_user_id,
      step_mutation_id,
      step_request_hash,
      target_trip_id,
      step_object_type,
      step_object_id,
      step_operation,
      step_expected_revision,
      next_revision,
      step_schema_version,
      current_user_id,
      target_device_id
    );

    applied_steps := applied_steps || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'stepId', step_id,
        'mutationId', step_mutation_id,
        'appliedRevision', next_revision,
        'currentRevision', next_revision,
        'object', tripmap_private.account_object_public_json(current_object)
      )
    );
  end loop;

  final_response := pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'status', 'applied',
    'batchMutationId', target_batch_mutation_id,
    'workflowId', target_workflow_id,
    'tripId', target_trip_id,
    'steps', applied_steps
  );

  insert into tripmap_private.account_workflow_receipts (
    owner_id,
    batch_mutation_id,
    request_hash,
    workflow_id,
    trip_id,
    device_id,
    step_count,
    response
  ) values (
    current_user_id,
    target_batch_mutation_id,
    request_hash,
    target_workflow_id,
    target_trip_id,
    target_device_id,
    step_count,
    final_response
  );

  return final_response;
end;
$$;

create or replace function public.account_apply_workflow_v1(
  target_schema_version integer,
  target_account_hash text,
  target_batch_mutation_id text,
  target_workflow_id text,
  target_trip_id text,
  target_device_id text,
  target_steps jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select tripmap_private.account_apply_workflow_v1(
    target_schema_version,
    target_account_hash,
    target_batch_mutation_id,
    target_workflow_id,
    target_trip_id,
    target_device_id,
    target_steps
  );
$$;

revoke all on function tripmap_private.account_apply_workflow_v1(
  integer, text, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function tripmap_private.account_apply_workflow_v1(
  integer, text, text, text, text, text, jsonb
) to authenticated, service_role;

revoke all on function public.account_apply_workflow_v1(
  integer, text, text, text, text, text, jsonb
) from public, anon;
grant execute on function public.account_apply_workflow_v1(
  integer, text, text, text, text, text, jsonb
) to authenticated, service_role;

comment on table tripmap_private.account_workflow_receipts is
  'Private immutable idempotency receipts for registered atomic Account Cloud workflows.';
comment on function public.account_apply_workflow_v1(
  integer, text, text, text, text, text, jsonb
) is
  'Authenticated registered atomic workflow boundary; validates every revision and domain shape before writing.';
