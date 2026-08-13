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

create or replace function tripmap_private.account_import_workflow_shape_is_valid(
  target_trip_id text,
  target_steps jsonb
)
returns boolean
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  with workflow_steps as (
    select
      step.value,
      step.value ->> 'objectType' as object_type,
      step.value ->> 'objectId' as object_id,
      step.value ->> 'operation' as operation,
      (step.value ->> 'expectedRevision')::bigint as expected_revision,
      step.value -> 'payload' as payload
    from pg_catalog.jsonb_array_elements(target_steps) as step(value)
  ),
  day_orders as (
    select
      pg_catalog.count(*) as order_count,
      pg_catalog.count(distinct (day_step.payload ->> 'sortOrder')::bigint) as distinct_count,
      pg_catalog.min((day_step.payload ->> 'sortOrder')::bigint) as minimum_order,
      pg_catalog.max((day_step.payload ->> 'sortOrder')::bigint) as maximum_order
    from workflow_steps as day_step
    where day_step.object_type = 'day'
  ),
  item_orders as (
    select
      item_step.payload ->> 'dayId' as day_id,
      pg_catalog.count(*) as order_count,
      pg_catalog.count(distinct (item_step.payload ->> 'sortOrder')::bigint) as distinct_count,
      pg_catalog.min((item_step.payload ->> 'sortOrder')::bigint) as minimum_order,
      pg_catalog.max((item_step.payload ->> 'sortOrder')::bigint) as maximum_order
    from workflow_steps as item_step
    where item_step.object_type = 'item'
    group by item_step.payload ->> 'dayId'
  )
  select
    (
      select pg_catalog.count(*)
      from workflow_steps as trip_step
      where trip_step.object_type = 'trip'
        and trip_step.object_id = target_trip_id
        and trip_step.payload ->> 'id' = target_trip_id
    ) = 1
    and (
      select pg_catalog.count(*)
      from workflow_steps as trip_step
      where trip_step.object_type = 'trip'
    ) = 1
    and not exists (
      select 1
      from workflow_steps as create_step
      where create_step.operation <> 'upsert'
        or create_step.expected_revision <> 0
    )
    and not exists (
      select 1
      from workflow_steps as day_step
      where day_step.object_type = 'day'
        and (
          pg_catalog.jsonb_typeof(day_step.payload -> 'sortOrder') is distinct from 'number'
          or day_step.payload ->> 'sortOrder' !~ '^[0-9]{1,16}$'
          or (day_step.payload ->> 'sortOrder')::numeric > 9007199254740991
        )
    )
    and not exists (
      select 1
      from day_orders
      where order_count > 0
        and (
          distinct_count <> order_count
          or minimum_order not in (0, 1)
          or maximum_order <> minimum_order + order_count - 1
        )
    )
    and not exists (
      select 1
      from workflow_steps as item_step
      where item_step.object_type = 'item'
        and not exists (
          select 1
          from workflow_steps as day_step
          where day_step.object_type = 'day'
            and day_step.object_id = item_step.payload ->> 'dayId'
        )
    )
    and not exists (
      select 1
      from item_orders
      where distinct_count <> order_count
        or minimum_order not in (0, 1)
        or maximum_order <> minimum_order + order_count - 1
    )
    and not exists (
      select 1
      from workflow_steps as item_step
      cross join lateral pg_catalog.jsonb_array_elements(
        item_step.payload -> 'ticketIds'
      ) as item_ticket(value)
      left join workflow_steps as ticket_step
        on ticket_step.object_type = 'ticket_meta'
        and ticket_step.object_id = item_ticket.value #>> '{}'
      where item_step.object_type = 'item'
        and (
          ticket_step.object_id is null
          or ticket_step.payload ->> 'itemId' is distinct from item_step.object_id
          or ticket_step.payload ->> 'scope' is distinct from 'item'
        )
    )
    and not exists (
      select 1
      from workflow_steps as ticket_step
      where ticket_step.object_type = 'ticket_meta'
        and ticket_step.payload ? 'itemId'
        and not exists (
          select 1
          from workflow_steps as item_step
          where item_step.object_type = 'item'
            and item_step.object_id = ticket_step.payload ->> 'itemId'
            and item_step.payload -> 'ticketIds' ? ticket_step.object_id
        )
    )
    and (
      select pg_catalog.count(*)
      from workflow_steps as settings_step
      where settings_step.object_type = 'ledger_settings'
    ) <= 1
    and not exists (
      select 1
      from workflow_steps as expense_step
      where expense_step.object_type = 'ledger_expense'
        and (
          (
            expense_step.payload ? 'payerParticipantId'
            and (
              pg_catalog.jsonb_typeof(expense_step.payload -> 'payerParticipantId') <> 'string'
              or not exists (
                select 1
                from workflow_steps as participant_step
                where participant_step.object_type = 'ledger_participant'
                  and participant_step.object_id = expense_step.payload ->> 'payerParticipantId'
              )
            )
          )
          or pg_catalog.jsonb_typeof(expense_step.payload -> 'splitShares') is distinct from 'array'
          or exists (
            select 1
            from pg_catalog.jsonb_array_elements(
              case
                when pg_catalog.jsonb_typeof(expense_step.payload -> 'splitShares') = 'array'
                  then expense_step.payload -> 'splitShares'
                else '[]'::jsonb
              end
            ) as split_share(value)
            where pg_catalog.jsonb_typeof(split_share.value) <> 'object'
              or pg_catalog.jsonb_typeof(split_share.value -> 'participantId') <> 'string'
              or not exists (
                select 1
                from workflow_steps as participant_step
                where participant_step.object_type = 'ledger_participant'
                  and participant_step.object_id = split_share.value ->> 'participantId'
              )
          )
          or (
            select pg_catalog.count(*)
            from pg_catalog.jsonb_array_elements(
              case
                when pg_catalog.jsonb_typeof(expense_step.payload -> 'splitShares') = 'array'
                  then expense_step.payload -> 'splitShares'
                else '[]'::jsonb
              end
            ) as split_share(value)
          ) <> (
            select pg_catalog.count(distinct split_share.value ->> 'participantId')
            from pg_catalog.jsonb_array_elements(
              case
                when pg_catalog.jsonb_typeof(expense_step.payload -> 'splitShares') = 'array'
                  then expense_step.payload -> 'splitShares'
                else '[]'::jsonb
              end
            ) as split_share(value)
          )
          or (
            expense_step.payload ? 'itemIds'
            and (
              pg_catalog.jsonb_typeof(expense_step.payload -> 'itemIds') <> 'array'
              or exists (
                select 1
                from pg_catalog.jsonb_array_elements(
                  case
                    when pg_catalog.jsonb_typeof(expense_step.payload -> 'itemIds') = 'array'
                      then expense_step.payload -> 'itemIds'
                    else '[]'::jsonb
                  end
                ) as expense_item(value)
                where pg_catalog.jsonb_typeof(expense_item.value) <> 'string'
                  or not exists (
                    select 1
                    from workflow_steps as item_step
                    where item_step.object_type = 'item'
                      and item_step.object_id = expense_item.value #>> '{}'
                  )
              )
              or (
                select pg_catalog.count(*)
                from pg_catalog.jsonb_array_elements(
                  case
                    when pg_catalog.jsonb_typeof(expense_step.payload -> 'itemIds') = 'array'
                      then expense_step.payload -> 'itemIds'
                    else '[]'::jsonb
                  end
                ) as expense_item(value)
              ) <> (
                select pg_catalog.count(distinct expense_item.value #>> '{}')
                from pg_catalog.jsonb_array_elements(
                  case
                    when pg_catalog.jsonb_typeof(expense_step.payload -> 'itemIds') = 'array'
                      then expense_step.payload -> 'itemIds'
                    else '[]'::jsonb
                  end
                ) as expense_item(value)
              )
            )
          )
          or (
            expense_step.payload ? 'originalExpenseId'
            and (
              pg_catalog.jsonb_typeof(expense_step.payload -> 'originalExpenseId') <> 'string'
              or not exists (
                select 1
                from workflow_steps as original_expense
                where original_expense.object_type = 'ledger_expense'
                  and original_expense.object_id = expense_step.payload ->> 'originalExpenseId'
              )
            )
          )
          or (
            expense_step.payload -> 'source' ->> 'kind' = 'ticket'
            and expense_step.payload -> 'source' ? 'sourceId'
            and (
              pg_catalog.jsonb_typeof(expense_step.payload -> 'source' -> 'sourceId') <> 'string'
              or not exists (
                select 1
                from workflow_steps as source_ticket
                where source_ticket.object_type = 'ticket_meta'
                  and source_ticket.object_id = expense_step.payload -> 'source' ->> 'sourceId'
              )
            )
          )
        )
    );
$$;

revoke all on function tripmap_private.account_import_workflow_shape_is_valid(text, jsonb)
  from public, anon, authenticated;

create or replace function tripmap_private.account_ledger_workflow_graph_is_valid(
  target_owner_id uuid,
  target_trip_id text,
  target_steps jsonb
)
returns boolean
language sql
stable
strict
security invoker
set search_path = ''
as $$
  with requested as (
    select
      step.value ->> 'objectType' as object_type,
      step.value ->> 'objectId' as object_id,
      step.value ->> 'operation' as operation,
      step.value -> 'payload' as payload
    from pg_catalog.jsonb_array_elements(target_steps) as step(value)
    where step.value ->> 'objectType' in (
      'ledger_settings', 'ledger_participant', 'ledger_budget', 'ledger_expense'
    )
  ),
  prospective as (
    select
      current_object.object_type,
      current_object.object_id,
      current_object.payload
    from public.tripmap_account_objects as current_object
    where current_object.owner_id = target_owner_id
      and current_object.trip_id = target_trip_id
      and current_object.object_type in (
        'ledger_settings', 'ledger_participant', 'ledger_budget', 'ledger_expense'
      )
      and not current_object.tombstone
      and not exists (
        select 1
        from requested
        where requested.object_type = current_object.object_type
          and requested.object_id = current_object.object_id
      )
    union all
    select requested.object_type, requested.object_id, requested.payload
    from requested
    where requested.operation = 'upsert'
  ),
  prospective_participants as (
    select object_id, payload
    from prospective
    where object_type = 'ledger_participant'
  ),
  prospective_expenses as (
    select object_id, payload
    from prospective
    where object_type = 'ledger_expense'
  )
  select
    exists (
      select 1
      from public.tripmap_account_objects as trip_object
      where trip_object.owner_id = target_owner_id
        and trip_object.trip_id = target_trip_id
        and trip_object.object_type = 'trip'
        and trip_object.object_id = target_trip_id
        and not trip_object.tombstone
    )
    and not exists (
      select 1
      from prospective
      where not tripmap_private.account_ledger_payload_is_valid(object_type, payload)
    )
    and (select pg_catalog.count(*) from prospective where object_type = 'ledger_settings') <= 1
    and (select pg_catalog.count(*) from prospective_participants where coalesce((payload ->> 'isSelf')::boolean, false)) <= 1
    and not exists (
      select 1
      from prospective_participants
      where payload ? 'sourceId'
      group by payload ->> 'source', payload ->> 'sourceId'
      having pg_catalog.count(*) > 1
    )
    and not exists (
      select 1
      from prospective
      where object_type = 'ledger_budget'
      group by
        payload ->> 'scope',
        case when payload ->> 'scope' = 'category' then payload ->> 'category' end,
        case when payload ->> 'scope' = 'date' then payload ->> 'date' end
      having pg_catalog.count(*) > 1
    )
    and not exists (
      select 1
      from prospective_expenses
      where payload -> 'source' ? 'fingerprint'
      group by payload -> 'source' ->> 'kind', payload -> 'source' ->> 'fingerprint'
      having pg_catalog.count(*) > 1
    )
    and not exists (
      select 1
      from prospective_expenses as expense
      where (
        expense.payload ? 'payerParticipantId'
        and not exists (
          select 1 from prospective_participants as participant
          where participant.object_id = expense.payload ->> 'payerParticipantId'
        )
      ) or exists (
        select 1
        from pg_catalog.jsonb_array_elements(expense.payload -> 'splitShares') as share(value)
        where not exists (
          select 1 from prospective_participants as participant
          where participant.object_id = share.value ->> 'participantId'
        )
      ) or (
        expense.payload ? 'originalExpenseId'
        and not exists (
          select 1 from prospective_expenses as original_expense
          where original_expense.object_id = expense.payload ->> 'originalExpenseId'
        )
      ) or exists (
        select 1
        from pg_catalog.jsonb_array_elements(coalesce(expense.payload -> 'itemIds', '[]'::jsonb)) as item_ref(value)
        where not exists (
          select 1 from public.tripmap_account_objects as item_object
          where item_object.owner_id = target_owner_id
            and item_object.trip_id = target_trip_id
            and item_object.object_type = 'item'
            and item_object.object_id = item_ref.value #>> '{}'
            and not item_object.tombstone
        )
      ) or (
        expense.payload -> 'source' ->> 'kind' = 'ticket'
        and expense.payload -> 'source' ? 'sourceId'
        and not exists (
          select 1
          from pg_catalog.jsonb_array_elements(coalesce(expense.payload -> 'sourceLinks', '[]'::jsonb)) as unavailable_link(value)
          where unavailable_link.value ->> 'kind' = 'ticket'
            and unavailable_link.value ->> 'sourceId' = expense.payload -> 'source' ->> 'sourceId'
            and coalesce((unavailable_link.value ->> 'available')::boolean, true) = false
        )
        and not exists (
          select 1 from public.tripmap_account_objects as ticket_object
          where ticket_object.owner_id = target_owner_id
            and ticket_object.trip_id = target_trip_id
            and ticket_object.object_type = 'ticket_meta'
            and ticket_object.object_id = expense.payload -> 'source' ->> 'sourceId'
            and not ticket_object.tombstone
        )
      ) or exists (
        select 1
        from pg_catalog.jsonb_array_elements(coalesce(expense.payload -> 'sourceLinks', '[]'::jsonb)) as source_link(value)
        where source_link.value ->> 'kind' = 'ticket'
          and source_link.value ? 'sourceId'
          and coalesce((source_link.value ->> 'available')::boolean, true)
          and not exists (
            select 1 from public.tripmap_account_objects as ticket_object
            where ticket_object.owner_id = target_owner_id
              and ticket_object.trip_id = target_trip_id
              and ticket_object.object_type = 'ticket_meta'
              and ticket_object.object_id = source_link.value ->> 'sourceId'
              and not ticket_object.tombstone
          )
      )
    );
$$;

revoke all on function tripmap_private.account_ledger_workflow_graph_is_valid(uuid, text, jsonb)
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
  moved_item_count integer := 0;
  structural_day_id text;
  structural_day_ids text[] := array[]::text[];
  structural_item_count bigint := 0;
  ticket_object_id text;
  ticket_current_item_id text;
  ticket_current_payload jsonb;
  ticket_requested_payload jsonb;
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
      when 'ticket.bind@1' then 1
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
      or pg_catalog.jsonb_typeof(step_payload -> 'sortOrder') is distinct from 'number'
      or step_payload ->> 'sortOrder' !~ '^[0-9]{1,16}$'
      or pg_catalog.jsonb_typeof(step_payload -> 'ticketIds') is distinct from 'array'
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
       and (
         exists (
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
         )
         or not tripmap_private.account_ticket_meta_payload_is_valid(step_payload)
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

    if step_operation = 'upsert'
       and step_object_type in ('ledger_settings', 'ledger_participant', 'ledger_budget', 'ledger_expense')
       and not tripmap_private.account_ledger_payload_is_valid(step_object_type, step_payload) then
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
      and (
        step_object_type not in (
          'ledger_settings', 'ledger_participant', 'ledger_budget', 'ledger_expense'
        )
        or (step_object_type = 'ledger_settings' and step_operation = 'delete')
        or (step_operation = 'delete' and step_expected_revision < 1)
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

  if target_workflow_id = 'trip.import.commit@1'
     and not tripmap_private.account_import_workflow_shape_is_valid(
       target_trip_id,
       target_steps
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
    or (
      select pg_catalog.min((reorder_step.value -> 'payload' ->> 'sortOrder')::bigint)
      from pg_catalog.jsonb_array_elements(target_steps) as reorder_step(value)
    ) <> 1
    or (
      select pg_catalog.max((reorder_step.value -> 'payload' ->> 'sortOrder')::bigint)
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

  if target_workflow_id = 'item.move@1' and exists (
    select 1
    from pg_catalog.jsonb_array_elements(target_steps) as moved_step(value)
    group by moved_step.value -> 'payload' ->> 'dayId'
    having pg_catalog.count(distinct moved_step.value -> 'payload' ->> 'sortOrder')
        <> pg_catalog.count(*)
      or pg_catalog.min((moved_step.value -> 'payload' ->> 'sortOrder')::bigint) <> 1
      or pg_catalog.max((moved_step.value -> 'payload' ->> 'sortOrder')::bigint)
        <> pg_catalog.count(*)
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

  -- New-trip import owns the trip lifecycle while it proves the account has no
  -- prior object in this scope. Other workflows share the lock with ordinary
  -- object mutations and can still run concurrently on independent objects.
  if target_workflow_id = 'trip.import.commit@1' then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        current_user_id::text || ':trip-lifecycle:' || target_trip_id,
        0
      )
    );
  else
    perform pg_catalog.pg_advisory_xact_lock_shared(
      pg_catalog.hashtextextended(
        current_user_id::text || ':trip-lifecycle:' || target_trip_id,
        0
      )
    );
  end if;

  if target_workflow_id = 'ledger.batch@1' then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        current_user_id::text || ':ledger:' || target_trip_id,
        0
      )
    );
  end if;

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

  if target_workflow_id = 'ledger.batch@1' then
    for lock_key in
      with requested_ledger as (
        select
          requested_step.value ->> 'objectType' as object_type,
          requested_step.value ->> 'objectId' as object_id,
          requested_step.value ->> 'operation' as operation,
          requested_step.value -> 'payload' as payload
        from pg_catalog.jsonb_array_elements(target_steps) as requested_step(value)
      ),
      prospective_expenses as (
        select current_expense.payload
        from public.tripmap_account_objects as current_expense
        where current_expense.owner_id = current_user_id
          and current_expense.trip_id = target_trip_id
          and current_expense.object_type = 'ledger_expense'
          and not current_expense.tombstone
          and not exists (
            select 1
            from requested_ledger
            where requested_ledger.object_type = 'ledger_expense'
              and requested_ledger.object_id = current_expense.object_id
          )
        union all
        select requested_ledger.payload
        from requested_ledger
        where requested_ledger.object_type = 'ledger_expense'
          and requested_ledger.operation = 'upsert'
      )
      select distinct dependency.object_type || ':' || dependency.object_id
      from (
        select 'item'::text as object_type, item_ref.value #>> '{}' as object_id
        from prospective_expenses as expense
        cross join lateral pg_catalog.jsonb_array_elements(
          case
            when pg_catalog.jsonb_typeof(expense.payload -> 'itemIds') = 'array'
              then expense.payload -> 'itemIds'
            else '[]'::jsonb
          end
        ) as item_ref(value)
        union all
        select 'ticket_meta', expense.payload -> 'source' ->> 'sourceId'
        from prospective_expenses as expense
        where expense.payload -> 'source' ->> 'kind' = 'ticket'
          and not exists (
            select 1
            from pg_catalog.jsonb_array_elements(
              case
                when pg_catalog.jsonb_typeof(expense.payload -> 'sourceLinks') = 'array'
                  then expense.payload -> 'sourceLinks'
                else '[]'::jsonb
              end
            ) as unavailable_link(value)
            where unavailable_link.value ->> 'kind' = 'ticket'
              and unavailable_link.value ->> 'sourceId' = expense.payload -> 'source' ->> 'sourceId'
              and coalesce((unavailable_link.value ->> 'available')::boolean, true) = false
          )
        union all
        select 'ticket_meta', source_link.value ->> 'sourceId'
        from prospective_expenses as expense
        cross join lateral pg_catalog.jsonb_array_elements(
          case
            when pg_catalog.jsonb_typeof(expense.payload -> 'sourceLinks') = 'array'
              then expense.payload -> 'sourceLinks'
            else '[]'::jsonb
          end
        ) as source_link(value)
        where source_link.value ->> 'kind' = 'ticket'
          and coalesce((source_link.value ->> 'available')::boolean, true)
      ) as dependency
      where dependency.object_id is not null
      order by 1
    loop
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(current_user_id::text || ':' || lock_key, 0)
      );
    end loop;
  end if;

  -- Lock every affected itinerary day after object locks and before mutation locks.
  if target_workflow_id in ('day.items.reorder@1', 'item.move@1') then
    select coalesce(
      pg_catalog.array_agg(structural_day.day_id order by structural_day.day_id),
      array[]::text[]
    )
    into structural_day_ids
    from (
      select requested_step.value -> 'payload' ->> 'dayId' as day_id
      from pg_catalog.jsonb_array_elements(target_steps) as requested_step(value)
      union
      select current_item.payload ->> 'dayId' as day_id
      from public.tripmap_account_objects as current_item
      join pg_catalog.jsonb_array_elements(target_steps) as requested_step(value)
        on requested_step.value ->> 'objectType' = 'item'
        and requested_step.value ->> 'objectId' = current_item.object_id
      where current_item.owner_id = current_user_id
        and current_item.object_type = 'item'
        and current_item.trip_id = target_trip_id
        and not current_item.tombstone
    ) as structural_day
    where structural_day.day_id is not null;

    if exists (
      select 1
      from pg_catalog.unnest(structural_day_ids) as requested_day(day_id)
      where requested_day.day_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'
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

    for structural_day_id in
      select requested_day.day_id
      from pg_catalog.unnest(structural_day_ids) as requested_day(day_id)
      order by requested_day.day_id
    loop
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
          current_user_id::text
            || ':item-day:'
            || target_trip_id
            || ':'
            || structural_day_id,
          0
        )
      );
    end loop;
  end if;

  -- Lock each step mutation identity only after every structural day lock.
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
    select current_ticket.payload, current_ticket.payload ->> 'itemId'
    into ticket_current_payload, ticket_current_item_id
    from public.tripmap_account_objects as current_ticket
    where current_ticket.owner_id = current_user_id
      and current_ticket.object_type = 'ticket_meta'
      and current_ticket.object_id = ticket_object_id
      and current_ticket.trip_id = target_trip_id
      and not current_ticket.tombstone
    for update;

    select ticket_step.value -> 'payload'
    into ticket_requested_payload
    from pg_catalog.jsonb_array_elements(target_steps) as ticket_step(value)
    where ticket_step.value ->> 'objectType' = 'ticket_meta';

    if ticket_current_payload is null
       or (
         ticket_current_payload
           - array['itemId', 'scope', 'sharedVisibility', 'ticketCategory', 'title', 'updatedAt']::text[]
       ) is distinct from (
         ticket_requested_payload
           - array['itemId', 'scope', 'sharedVisibility', 'ticketCategory', 'title', 'updatedAt']::text[]
       )
       or (ticket_requested_payload ->> 'updatedAt')::numeric
          <= (ticket_current_payload ->> 'updatedAt')::numeric then
      return pg_catalog.jsonb_build_object(
        'schemaVersion', 1,
        'status', 'rejected',
        'batchMutationId', target_batch_mutation_id,
        'workflowId', target_workflow_id,
        'tripId', target_trip_id,
        'reason', 'workflow_shape_invalid'
      );
    end if;

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

    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(target_steps) as requested_item(value)
      left join public.tripmap_account_objects as current_item
        on current_item.owner_id = current_user_id
        and current_item.object_type = 'item'
        and current_item.object_id = requested_item.value ->> 'objectId'
        and current_item.trip_id = target_trip_id
        and not current_item.tombstone
      where requested_item.value ->> 'objectType' = 'item'
        and (
          current_item.object_id is null
          or (
            requested_item.value ->> 'objectId' is distinct from ticket_target_item_id
            and not (current_item.payload -> 'ticketIds' ? ticket_object_id)
          )
          or (
            (requested_item.value -> 'payload' -> 'ticketIds') - ticket_object_id
            is distinct from
            (current_item.payload -> 'ticketIds') - ticket_object_id
          )
          or (
            (requested_item.value -> 'payload') - array['ticketIds', 'updatedAt']::text[]
            is distinct from
            current_item.payload - array['ticketIds', 'updatedAt']::text[]
          )
          or (
            requested_item.value -> 'payload' -> 'ticketIds'
              is not distinct from current_item.payload -> 'ticketIds'
            and requested_item.value -> 'payload' is distinct from current_item.payload
          )
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

  if target_workflow_id = 'ledger.batch@1' and not tripmap_private.account_ledger_workflow_graph_is_valid(
    current_user_id,
    target_trip_id,
    target_steps
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

  if target_workflow_id = 'trip.import.commit@1' and exists (
    select 1
    from public.tripmap_account_objects as prior_trip_object
    where prior_trip_object.owner_id = current_user_id
      and prior_trip_object.trip_id = target_trip_id
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

  if target_workflow_id in ('day.items.reorder@1', 'item.move@1') then
    if (
      target_workflow_id = 'day.items.reorder@1'
      and pg_catalog.cardinality(structural_day_ids) <> 1
    ) or (
      target_workflow_id = 'item.move@1'
      and pg_catalog.cardinality(structural_day_ids) <> 2
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

    select pg_catalog.count(*)
    into structural_item_count
    from public.tripmap_account_objects as structural_item
    where structural_item.owner_id = current_user_id
      and structural_item.trip_id = target_trip_id
      and structural_item.object_type = 'item'
      and not structural_item.tombstone
      and structural_item.payload ->> 'dayId' = any(structural_day_ids);

    if structural_item_count <> step_count or exists (
      select 1
      from public.tripmap_account_objects as structural_item
      where structural_item.owner_id = current_user_id
        and structural_item.trip_id = target_trip_id
        and structural_item.object_type = 'item'
        and not structural_item.tombstone
        and structural_item.payload ->> 'dayId' = any(structural_day_ids)
        and not exists (
          select 1
          from pg_catalog.jsonb_array_elements(target_steps) as requested_step(value)
          where requested_step.value ->> 'objectType' = 'item'
            and requested_step.value ->> 'objectId' = structural_item.object_id
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

  if target_workflow_id = 'item.move@1' then
    select pg_catalog.count(*)
    into moved_item_count
    from public.tripmap_account_objects as current_item
    join pg_catalog.jsonb_array_elements(target_steps) as requested_step(value)
      on requested_step.value ->> 'objectType' = 'item'
      and requested_step.value ->> 'objectId' = current_item.object_id
    where current_item.owner_id = current_user_id
      and current_item.trip_id = target_trip_id
      and current_item.object_type = 'item'
      and not current_item.tombstone
      and current_item.payload ->> 'dayId'
        is distinct from requested_step.value -> 'payload' ->> 'dayId';

    if moved_item_count <> 1 then
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

    if target_workflow_id = 'ledger.batch@1'
       and step_operation = 'upsert'
       and has_current_object
       and (
         current_object.tombstone
         or step_payload -> 'createdAt' is distinct from current_object.payload -> 'createdAt'
         or (step_payload ->> 'updatedAt')::numeric
            <= (current_object.payload ->> 'updatedAt')::numeric
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
