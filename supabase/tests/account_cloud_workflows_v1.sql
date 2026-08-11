begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_temp;

select plan(43);

create function pg_temp.run_account_workflow(
  target_account_hash text,
  target_batch_mutation_id text,
  target_workflow_id text,
  target_trip_id text,
  target_steps jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select public.account_apply_workflow_v1(
    1,
    target_account_hash,
    target_batch_mutation_id,
    target_workflow_id,
    target_trip_id,
    'pgtap_device',
    target_steps
  );
$$;

create temporary table workflow_fixtures (
  fixture_name text primary key,
  steps jsonb not null
);
grant select on table workflow_fixtures to authenticated;
grant execute on function pg_temp.run_account_workflow(text, text, text, text, jsonb)
  to authenticated;

insert into workflow_fixtures (fixture_name, steps) values (
  'initial_import',
  '[
    {
      "stepId": "trip",
      "mutationId": "20000000-0000-4000-8000-000000000001",
      "objectType": "trip",
      "objectId": "trip_1",
      "operation": "upsert",
      "expectedRevision": 0,
      "objectSchemaVersion": 1,
      "payload": {"id": "trip_1", "title": "Test trip"}
    },
    {
      "stepId": "day",
      "mutationId": "20000000-0000-4000-8000-000000000002",
      "objectType": "day",
      "objectId": "day_1",
      "operation": "upsert",
      "expectedRevision": 0,
      "objectSchemaVersion": 1,
      "payload": {"id": "day_1", "tripId": "trip_1", "date": "2026-07-10"}
    },
    {
      "stepId": "item_1",
      "mutationId": "20000000-0000-4000-8000-000000000003",
      "objectType": "item",
      "objectId": "item_1",
      "operation": "upsert",
      "expectedRevision": 0,
      "objectSchemaVersion": 1,
      "payload": {
        "id": "item_1",
        "tripId": "trip_1",
        "dayId": "day_1",
        "title": "First",
        "sortOrder": 1,
        "ticketIds": []
      }
    },
    {
      "stepId": "item_2",
      "mutationId": "20000000-0000-4000-8000-000000000004",
      "objectType": "item",
      "objectId": "item_2",
      "operation": "upsert",
      "expectedRevision": 0,
      "objectSchemaVersion": 1,
      "payload": {
        "id": "item_2",
        "tripId": "trip_1",
        "dayId": "day_1",
        "title": "Second",
        "sortOrder": 2,
        "ticketIds": []
      }
    },
    {
      "stepId": "ticket",
      "mutationId": "20000000-0000-4000-8000-000000000005",
      "objectType": "ticket_meta",
      "objectId": "ticket_1",
      "operation": "upsert",
      "expectedRevision": 0,
      "objectSchemaVersion": 1,
      "payload": {
        "id": "ticket_1",
        "tripId": "trip_1",
        "title": "Entry ticket",
        "itemId": null,
        "scope": "trip",
        "sharedVisibility": "owner",
        "ticketCategory": "attraction"
      }
    }
  ]'::jsonb
);

select ok(
  pg_catalog.to_regprocedure(
    'public.account_apply_workflow_v1(integer,text,text,text,text,text,jsonb)'
  ) is not null,
  'the public workflow RPC has the fixed seven-argument signature'
);
select ok(
  not (
    select procedure.prosecdef
    from pg_catalog.pg_proc as procedure
    where procedure.oid = pg_catalog.to_regprocedure(
      'public.account_apply_workflow_v1(integer,text,text,text,text,text,jsonb)'
    )
  ),
  'the public wrapper is security invoker'
);
select ok(
  (
    select procedure.prosecdef
    from pg_catalog.pg_proc as procedure
    where procedure.oid = pg_catalog.to_regprocedure(
      'tripmap_private.account_apply_workflow_v1(integer,text,text,text,text,text,jsonb)'
    )
  ),
  'the private transaction implementation is security definer'
);
select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.account_apply_workflow_v1(integer,text,text,text,text,text,jsonb)',
    'execute'
  ),
  'authenticated callers can execute the public wrapper'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.account_apply_workflow_v1(integer,text,text,text,text,text,jsonb)',
    'execute'
  ),
  'anonymous callers cannot execute the workflow RPC'
);
select ok(
  not pg_catalog.has_table_privilege(
    'authenticated',
    'public.tripmap_account_objects',
    'insert'
  ),
  'authenticated callers cannot bypass the RPC with direct object inserts'
);
select ok(
  not pg_catalog.has_table_privilege(
    'authenticated',
    'tripmap_private.account_workflow_receipts',
    'select'
  ),
  'workflow receipts are not readable by browser roles'
);
select throws_ok(
  $$
    select pg_temp.run_account_workflow(
      'bd7662a5eeb41614e720d477abfcb227',
      '10000000-0000-4000-8000-000000000099',
      'trip.import.commit@1',
      'trip_1',
      '[]'::jsonb
    )
  $$,
  '28000',
  'not_authenticated',
  'the workflow RPC requires auth.uid()'
);

insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);
set local role authenticated;

select is(
  pg_temp.run_account_workflow(
    '00000000000000000000000000000000',
    '10000000-0000-4000-8000-000000000010',
    'trip.import.commit@1',
    'trip_1',
    (select steps from pg_temp.workflow_fixtures where fixture_name = 'initial_import')
  ) ->> 'reason',
  'account_context_mismatch',
  'a caller-supplied account hash cannot select another account'
);
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000011',
    'arbitrary.function@1',
    'trip_1',
    (select steps from pg_temp.workflow_fixtures where fixture_name = 'initial_import')
  ) ->> 'reason',
  'unknown_workflow',
  'unregistered workflow names are rejected'
);
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000012',
    'trip.import.commit@1',
    'trip_1',
    '[{
      "stepId":"trip",
      "mutationId":"20000000-0000-4000-8000-000000000012",
      "objectType":"trip",
      "objectId":"trip_1",
      "operation":"upsert",
      "expectedRevision":0,
      "objectSchemaVersion":1,
      "payload":{"id":"trip_1"},
      "function":"danger"
    }]'::jsonb
  ) ->> 'reason',
  'invalid_envelope',
  'unknown step fields are rejected'
);
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000013',
    'trip.import.commit@1',
    'trip_1',
    '[{
      "stepId":"trip",
      "mutationId":"20000000-0000-4000-8000-000000000013",
      "objectType":"trip",
      "objectId":"trip_1",
      "operation":"upsert",
      "expectedRevision":0,
      "objectSchemaVersion":1,
      "payload":{"id":"trip_1","nested":{"apiKey":"forbidden"}}
    }]'::jsonb
  ) ->> 'reason',
  'invalid_or_sensitive_payload',
  'nested sensitive fields are rejected'
);

reset role;
select is(
  tripmap_private.account_payload_shape_is_safe(
    (pg_catalog.repeat('{"nested":', 33) || '0' || pg_catalog.repeat('}', 33))::jsonb
  ),
  false,
  'payload depth is bounded before recursive sensitive-field inspection'
);
set local role authenticated;

select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000014',
    'trip.repair.apply@1',
    'trip_1',
    '[{
      "stepId":"job",
      "mutationId":"20000000-0000-4000-8000-000000000014",
      "objectType":"ai_job",
      "objectId":"job_1",
      "operation":"upsert",
      "expectedRevision":0,
      "objectSchemaVersion":1,
      "payload":{"id":"job_1","tripId":"trip_1"}
    }]'::jsonb
  ) ->> 'reason',
  'server_managed_object',
  'server-managed objects cannot be smuggled through a workflow'
);
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000015',
    'trip.repair.apply@1',
    'trip_1',
    '[{
      "stepId":"item",
      "mutationId":"20000000-0000-4000-8000-000000000015",
      "objectType":"item",
      "objectId":"item_1",
      "operation":"delete",
      "expectedRevision":1,
      "objectSchemaVersion":1
    }]'::jsonb
  ) ->> 'reason',
  'workflow_shape_invalid',
  'AI repair cannot delete travel objects'
);

select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000001',
    'trip.import.commit@1',
    'trip_1',
    (select steps from pg_temp.workflow_fixtures where fixture_name = 'initial_import')
  ) ->> 'status',
  'applied',
  'a registered import commits one atomic batch'
);

reset role;
select is(
  (
    select pg_catalog.count(*)
    from public.tripmap_account_objects
    where owner_id = '11111111-1111-4111-8111-111111111111'
  ),
  5::bigint,
  'all import objects are committed'
);
select is(
  (
    select pg_catalog.count(*)
    from tripmap_private.account_mutation_receipts
    where owner_id = '11111111-1111-4111-8111-111111111111'
  ),
  5::bigint,
  'each committed step has one private mutation receipt'
);
select is(
  (
    select pg_catalog.count(*)
    from tripmap_private.account_workflow_receipts
    where owner_id = '11111111-1111-4111-8111-111111111111'
  ),
  1::bigint,
  'the committed batch has one private workflow receipt'
);

set local role authenticated;
select is(
  (
    select pg_catalog.count(*)
    from pg_catalog.generate_series(1, 100)
    where pg_temp.run_account_workflow(
      'bd7662a5eeb41614e720d477abfcb227',
      '10000000-0000-4000-8000-000000000001',
      'trip.import.commit@1',
      'trip_1',
      (select steps from pg_temp.workflow_fixtures where fixture_name = 'initial_import')
    ) ->> 'status' = 'idempotent'
  ),
  100::bigint,
  '100 identical retries are idempotent'
);

reset role;
select is(
  (
    select pg_catalog.count(*)
    from public.tripmap_account_objects
    where owner_id = '11111111-1111-4111-8111-111111111111'
  ),
  5::bigint,
  'retries do not duplicate account objects'
);
select is(
  (
    select pg_catalog.count(*)
    from tripmap_private.account_mutation_receipts
    where owner_id = '11111111-1111-4111-8111-111111111111'
  ),
  5::bigint,
  'retries do not duplicate step receipts'
);

set local role authenticated;
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000001',
    'trip.import.commit@1',
    'trip_1',
    pg_catalog.jsonb_set(
      (select steps from pg_temp.workflow_fixtures where fixture_name = 'initial_import'),
      '{0,payload,title}',
      '"Changed"'::jsonb
    )
  ) ->> 'reason',
  'batch_mutation_id_reused',
  'a batch mutation ID cannot be reused for changed content'
);
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000002',
    'trip.import.commit@1',
    'trip_1',
    '[{
      "stepId":"trip",
      "mutationId":"20000000-0000-4000-8000-000000000001",
      "objectType":"trip",
      "objectId":"trip_1",
      "operation":"upsert",
      "expectedRevision":1,
      "objectSchemaVersion":1,
      "payload":{"id":"trip_1","title":"Changed"}
    }]'::jsonb
  ) ->> 'reason',
  'mutation_id_reused',
  'a step mutation ID cannot be reused in another batch'
);
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000003',
    'trip.import.commit@1',
    'trip_1',
    '[
      {
        "stepId":"day_new",
        "mutationId":"20000000-0000-4000-8000-000000000031",
        "objectType":"day",
        "objectId":"day_atomic_fail",
        "operation":"upsert",
        "expectedRevision":0,
        "objectSchemaVersion":1,
        "payload":{"id":"day_atomic_fail","tripId":"trip_1"}
      },
      {
        "stepId":"trip_stale",
        "mutationId":"20000000-0000-4000-8000-000000000032",
        "objectType":"trip",
        "objectId":"trip_1",
        "operation":"upsert",
        "expectedRevision":0,
        "objectSchemaVersion":1,
        "payload":{"id":"trip_1","title":"Stale"}
      }
    ]'::jsonb
  ) ->> 'status',
  'conflict',
  'one stale step rejects the whole batch before writes'
);

reset role;
select is(
  (
    select pg_catalog.count(*)
    from public.tripmap_account_objects
    where owner_id = '11111111-1111-4111-8111-111111111111'
      and object_id = 'day_atomic_fail'
  ),
  0::bigint,
  'a failed batch leaves no earlier-step object behind'
);
select is(
  (
    select pg_catalog.count(*)
    from tripmap_private.account_workflow_receipts
    where owner_id = '11111111-1111-4111-8111-111111111111'
      and batch_mutation_id = '10000000-0000-4000-8000-000000000003'
  ),
  0::bigint,
  'a failed batch leaves no success receipt'
);

set local role authenticated;
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000004',
    'day.items.reorder@1',
    'trip_1',
    '[
      {
        "stepId":"item_1",
        "mutationId":"20000000-0000-4000-8000-000000000041",
        "objectType":"item",
        "objectId":"item_1",
        "operation":"upsert",
        "expectedRevision":1,
        "objectSchemaVersion":1,
        "payload":{"id":"item_1","tripId":"trip_1","dayId":"day_1","title":"First","sortOrder":2,"ticketIds":[]}
      },
      {
        "stepId":"item_2",
        "mutationId":"20000000-0000-4000-8000-000000000042",
        "objectType":"item",
        "objectId":"item_2",
        "operation":"upsert",
        "expectedRevision":1,
        "objectSchemaVersion":1,
        "payload":{"id":"item_2","tripId":"trip_1","dayId":"day_1","title":"Second","sortOrder":1,"ticketIds":[]}
      }
    ]'::jsonb
  ) ->> 'status',
  'applied',
  'day reorder commits through its registered workflow'
);

reset role;
select is(
  (
    select pg_catalog.jsonb_object_agg(object_id, payload -> 'sortOrder')
    from public.tripmap_account_objects
    where owner_id = '11111111-1111-4111-8111-111111111111'
      and object_type = 'item'
  ),
  '{"item_1": 2, "item_2": 1}'::jsonb,
  'day reorder writes the complete requested order'
);

set local role authenticated;
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000005',
    'ticket.bind@1',
    'trip_1',
    '[
      {
        "stepId":"ticket",
        "mutationId":"20000000-0000-4000-8000-000000000051",
        "objectType":"ticket_meta",
        "objectId":"ticket_1",
        "operation":"upsert",
        "expectedRevision":1,
        "objectSchemaVersion":1,
        "payload":{"id":"ticket_1","tripId":"trip_1","title":"Entry ticket","itemId":"item_2","scope":"item","sharedVisibility":"owner","ticketCategory":"attraction"}
      },
      {
        "stepId":"item_1",
        "mutationId":"20000000-0000-4000-8000-000000000052",
        "objectType":"item",
        "objectId":"item_1",
        "operation":"upsert",
        "expectedRevision":2,
        "objectSchemaVersion":1,
        "payload":{"id":"item_1","tripId":"trip_1","dayId":"day_1","title":"First","sortOrder":2,"ticketIds":[]}
      },
      {
        "stepId":"item_2",
        "mutationId":"20000000-0000-4000-8000-000000000053",
        "objectType":"item",
        "objectId":"item_2",
        "operation":"upsert",
        "expectedRevision":2,
        "objectSchemaVersion":1,
        "payload":{"id":"item_2","tripId":"trip_1","dayId":"day_1","title":"Second","sortOrder":1,"ticketIds":["ticket_1"]}
      }
    ]'::jsonb
  ) ->> 'status',
  'applied',
  'ticket binding commits metadata and item links together'
);

reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'ticketItemId', ticket.payload -> 'itemId',
      'itemTicketIds', item.payload -> 'ticketIds'
    )
    from public.tripmap_account_objects as ticket
    join public.tripmap_account_objects as item
      on item.owner_id = ticket.owner_id
      and item.object_type = 'item'
      and item.object_id = 'item_2'
    where ticket.owner_id = '11111111-1111-4111-8111-111111111111'
      and ticket.object_type = 'ticket_meta'
      and ticket.object_id = 'ticket_1'
  ),
  '{"ticketItemId": "item_2", "itemTicketIds": ["ticket_1"]}'::jsonb,
  'ticket metadata and reverse item link agree'
);

set local role authenticated;
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000006',
    'ticket.bind@1',
    'trip_1',
    '[
      {
        "stepId":"ticket",
        "mutationId":"20000000-0000-4000-8000-000000000061",
        "objectType":"ticket_meta",
        "objectId":"ticket_1",
        "operation":"upsert",
        "expectedRevision":2,
        "objectSchemaVersion":1,
        "payload":{"id":"ticket_1","tripId":"trip_1","title":"Entry ticket","itemId":"item_1","scope":"item","sharedVisibility":"owner","ticketCategory":"attraction"}
      },
      {
        "stepId":"item_1",
        "mutationId":"20000000-0000-4000-8000-000000000062",
        "objectType":"item",
        "objectId":"item_1",
        "operation":"upsert",
        "expectedRevision":3,
        "objectSchemaVersion":1,
        "payload":{"id":"item_1","tripId":"trip_1","dayId":"day_1","title":"First","sortOrder":2,"ticketIds":["ticket_1"]}
      }
    ]'::jsonb
  ) ->> 'reason',
  'workflow_shape_invalid',
  'ticket rebind rejects an omitted currently bound item'
);

reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'ticketItemId', ticket.payload -> 'itemId',
      'oldItemTicketIds', item.payload -> 'ticketIds'
    )
    from public.tripmap_account_objects as ticket
    join public.tripmap_account_objects as item
      on item.owner_id = ticket.owner_id
      and item.object_type = 'item'
      and item.object_id = 'item_2'
    where ticket.owner_id = '11111111-1111-4111-8111-111111111111'
      and ticket.object_type = 'ticket_meta'
      and ticket.object_id = 'ticket_1'
  ),
  '{"ticketItemId": "item_2", "oldItemTicketIds": ["ticket_1"]}'::jsonb,
  'a rejected partial rebind leaves the prior relationship intact'
);

set local role authenticated;
select is(
  public.account_apply_object_mutation_v1(
    1,
    'bd7662a5eeb41614e720d477abfcb227',
    '20000000-0000-4000-8000-000000000071',
    'trip_1',
    'trip',
    'trip_1',
    'upsert',
    1,
    1,
    'pgtap_device',
    '{"id":"trip_1","title":"Advanced"}'::jsonb
  ) ->> 'status',
  'applied',
  'an independent later mutation advances one object revision'
);
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000001',
    'trip.import.commit@1',
    'trip_1',
    (select steps from pg_temp.workflow_fixtures where fixture_name = 'initial_import')
  ) ->> 'reason',
  'receipt_advanced',
  'a stale workflow receipt never acknowledges advanced server state'
);

reset role;
create function pg_temp.force_second_step_failure()
returns trigger
language plpgsql
as $$
begin
  if new.object_id = 'rollback_item_2' then
    raise exception using errcode = 'P0001', message = 'forced_workflow_failure';
  end if;
  return new;
end;
$$;
create trigger account_workflow_force_second_step_failure
before insert on public.tripmap_account_objects
for each row execute function pg_temp.force_second_step_failure();

set local role authenticated;
select throws_ok(
  $$
    select pg_temp.run_account_workflow(
      'bd7662a5eeb41614e720d477abfcb227',
      '10000000-0000-4000-8000-000000000007',
      'trip.import.commit@1',
      'rollback_trip',
      '[
        {
          "stepId":"first",
          "mutationId":"20000000-0000-4000-8000-000000000091",
          "objectType":"item",
          "objectId":"rollback_item_1",
          "operation":"upsert",
          "expectedRevision":0,
          "objectSchemaVersion":1,
          "payload":{"id":"rollback_item_1","tripId":"rollback_trip","dayId":"rollback_day","title":"First","sortOrder":1,"ticketIds":[]}
        },
        {
          "stepId":"second",
          "mutationId":"20000000-0000-4000-8000-000000000092",
          "objectType":"item",
          "objectId":"rollback_item_2",
          "operation":"upsert",
          "expectedRevision":0,
          "objectSchemaVersion":1,
          "payload":{"id":"rollback_item_2","tripId":"rollback_trip","dayId":"rollback_day","title":"Second","sortOrder":2,"ticketIds":[]}
        }
      ]'::jsonb
    )
  $$,
  'P0001',
  'forced_workflow_failure',
  'a database error aborts the complete workflow statement'
);

reset role;
select is(
  (
    select pg_catalog.count(*)
    from public.tripmap_account_objects
    where owner_id = '11111111-1111-4111-8111-111111111111'
      and object_id in ('rollback_item_1', 'rollback_item_2')
  ),
  0::bigint,
  'a later-step database error rolls back an earlier object write'
);
select is(
  (
    select
      (
        select pg_catalog.count(*)
        from tripmap_private.account_mutation_receipts
        where owner_id = '11111111-1111-4111-8111-111111111111'
          and mutation_id in (
            '20000000-0000-4000-8000-000000000091',
            '20000000-0000-4000-8000-000000000092'
          )
      ) + (
        select pg_catalog.count(*)
        from tripmap_private.account_workflow_receipts
        where owner_id = '11111111-1111-4111-8111-111111111111'
          and batch_mutation_id = '10000000-0000-4000-8000-000000000007'
      )
  ),
  0::bigint,
  'a rolled-back workflow leaves neither step nor batch receipts'
);

drop trigger account_workflow_force_second_step_failure
  on public.tripmap_account_objects;

select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '22222222-2222-4222-8222-222222222222',
  true
);
set local role authenticated;
select is(
  pg_temp.run_account_workflow(
    'b454f82c5857ebabf342b7258e5cf7de',
    '10000000-0000-4000-8000-000000000008',
    'trip.import.commit@1',
    'trip_1',
    '[{
      "stepId":"trip",
      "mutationId":"20000000-0000-4000-8000-000000000081",
      "objectType":"trip",
      "objectId":"trip_1",
      "operation":"upsert",
      "expectedRevision":0,
      "objectSchemaVersion":1,
      "payload":{"id":"trip_1","title":"Second account"}
    }]'::jsonb
  ) ->> 'status',
  'applied',
  'the same object ID remains isolated by account owner'
);

reset role;
select is(
  (
    select pg_catalog.count(*)
    from public.tripmap_account_objects
    where object_type = 'trip' and object_id = 'trip_1'
  ),
  2::bigint,
  'two account-owned rows exist for the same semantic object ID'
);

set local role authenticated;
select is(
  (
    select pg_catalog.count(*)
    from public.tripmap_account_objects
    where object_type = 'trip' and object_id = 'trip_1'
  ),
  1::bigint,
  'RLS exposes only the active account row'
);
select is(
  (
    select payload ->> 'title'
    from public.tripmap_account_objects
    where object_type = 'trip' and object_id = 'trip_1'
  ),
  'Second account',
  'RLS cannot substitute the other account payload'
);

reset role;
select is(
  (
    select pg_catalog.count(*)
    from tripmap_private.account_workflow_receipts
    where owner_id = '22222222-2222-4222-8222-222222222222'
  ),
  1::bigint,
  'workflow receipts are isolated by account owner'
);

select * from finish();
rollback;
