begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_temp;

select plan(120);

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
	      "payload": {"id": "day_1", "tripId": "trip_1", "date": "2026-07-10", "sortOrder": 1}
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
        "createdAt": 1,
        "fileType": "pdf",
        "id": "ticket_1",
        "tripId": "trip_1",
        "title": "Entry ticket",
        "mimeType": "application/pdf",
        "scope": "trip",
        "sharedVisibility": {"mode":"all"},
        "size": 1024,
        "storageMode": "copy",
        "ticketCategory": "admission_ticket",
        "updatedAt": 1
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
select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'tripmap_private.account_ledger_timestamp_is_valid(text)',
    'EXECUTE'
  ),
  'authenticated clients cannot execute the private ledger timestamp validator'
);

select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'tripmap_private.account_ledger_payload_is_valid(text,jsonb)',
    'EXECUTE'
  ),
  'authenticated clients cannot execute the private ledger payload validator'
);

select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'tripmap_private.account_import_workflow_shape_is_valid(text,jsonb)',
    'execute'
  ),
  'the import graph validator is not callable by browser roles'
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
    '10000000-0000-4000-8000-000000000171',
    'trip.import.commit@1',
    'missing_root_trip',
    '[{"stepId":"day","mutationId":"20000000-0000-4000-8000-000000000271","objectType":"day","objectId":"missing_root_day","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"id":"missing_root_day","tripId":"missing_root_trip","sortOrder":0}}]'::jsonb
  ) ->> 'reason',
  'workflow_shape_invalid',
  'a create-only import requires exactly one matching Trip root'
);
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000172',
    'trip.import.commit@1',
    'nonzero_import_trip',
    '[{"stepId":"trip","mutationId":"20000000-0000-4000-8000-000000000272","objectType":"trip","objectId":"nonzero_import_trip","operation":"upsert","expectedRevision":1,"objectSchemaVersion":1,"payload":{"id":"nonzero_import_trip"}}]'::jsonb
  ) ->> 'reason',
  'workflow_shape_invalid',
  'a new-trip import cannot update an existing revision'
);
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000173',
    'trip.import.commit@1',
    'missing_day_trip',
    '[
      {"stepId":"trip","mutationId":"20000000-0000-4000-8000-000000000273","objectType":"trip","objectId":"missing_day_trip","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"id":"missing_day_trip"}},
      {"stepId":"item","mutationId":"20000000-0000-4000-8000-000000000274","objectType":"item","objectId":"missing_day_item","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"id":"missing_day_item","tripId":"missing_day_trip","dayId":"missing_day","sortOrder":0,"ticketIds":[]}}
    ]'::jsonb
  ) ->> 'reason',
  'workflow_shape_invalid',
  'an imported Item must reference a Day in the same batch'
);
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000174',
    'trip.import.commit@1',
    'gapped_import_trip',
    '[
      {"stepId":"trip","mutationId":"20000000-0000-4000-8000-000000000275","objectType":"trip","objectId":"gapped_import_trip","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"id":"gapped_import_trip"}},
      {"stepId":"day","mutationId":"20000000-0000-4000-8000-000000000276","objectType":"day","objectId":"gapped_import_day","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"id":"gapped_import_day","tripId":"gapped_import_trip","sortOrder":0}},
      {"stepId":"item_a","mutationId":"20000000-0000-4000-8000-000000000277","objectType":"item","objectId":"gapped_import_item_a","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"id":"gapped_import_item_a","tripId":"gapped_import_trip","dayId":"gapped_import_day","sortOrder":0,"ticketIds":[]}},
      {"stepId":"item_b","mutationId":"20000000-0000-4000-8000-000000000278","objectType":"item","objectId":"gapped_import_item_b","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"id":"gapped_import_item_b","tripId":"gapped_import_trip","dayId":"gapped_import_day","sortOrder":2,"ticketIds":[]}}
    ]'::jsonb
  ) ->> 'reason',
  'workflow_shape_invalid',
  'imported Item order must be contiguous within each Day'
);
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000175',
    'trip.import.commit@1',
    'asymmetric_ticket_trip',
    '[
      {"stepId":"trip","mutationId":"20000000-0000-4000-8000-000000000279","objectType":"trip","objectId":"asymmetric_ticket_trip","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"id":"asymmetric_ticket_trip"}},
      {"stepId":"day","mutationId":"20000000-0000-4000-8000-000000000280","objectType":"day","objectId":"asymmetric_ticket_day","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"id":"asymmetric_ticket_day","tripId":"asymmetric_ticket_trip","sortOrder":0}},
      {"stepId":"item","mutationId":"20000000-0000-4000-8000-000000000281","objectType":"item","objectId":"asymmetric_ticket_item","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"id":"asymmetric_ticket_item","tripId":"asymmetric_ticket_trip","dayId":"asymmetric_ticket_day","sortOrder":0,"ticketIds":["asymmetric_ticket"]}},
      {"stepId":"ticket","mutationId":"20000000-0000-4000-8000-000000000282","objectType":"ticket_meta","objectId":"asymmetric_ticket","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"createdAt":1,"fileType":"pdf","id":"asymmetric_ticket","tripId":"asymmetric_ticket_trip","mimeType":"application/pdf","scope":"trip","size":10,"storageMode":"reference","updatedAt":1}}
    ]'::jsonb
  ) ->> 'reason',
  'workflow_shape_invalid',
  'Ticket and Item relationships must agree in both directions'
);
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000176',
    'trip.import.commit@1',
    'orphan_ledger_trip',
    '[
      {"stepId":"trip","mutationId":"20000000-0000-4000-8000-000000000283","objectType":"trip","objectId":"orphan_ledger_trip","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"id":"orphan_ledger_trip"}},
      {"stepId":"expense","mutationId":"20000000-0000-4000-8000-000000000284","objectType":"ledger_expense","objectId":"orphan_expense","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"id":"orphan_expense","tripId":"orphan_ledger_trip","title":"Orphan","date":"2026-08-13","category":"other","status":"draft","splitMode":"equal","payerParticipantId":"missing_person","splitShares":[{"participantId":"missing_person","weight":1}],"source":{"kind":"manual"},"createdAt":1,"updatedAt":1}}
    ]'::jsonb
  ) ->> 'reason',
  'workflow_shape_invalid',
  'imported ledger references must resolve inside the same batch'
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
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000177',
    'trip.import.commit@1',
    'trip_1',
    '[{"stepId":"trip","mutationId":"20000000-0000-4000-8000-000000000285","objectType":"trip","objectId":"trip_1","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"id":"trip_1","title":"Overwrite"}}]'::jsonb
  ) ->> 'reason',
  'workflow_shape_invalid',
  'a new import cannot append to or overwrite an existing trip scope'
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
  public.account_apply_object_mutation_v1(
    1,
    'bd7662a5eeb41614e720d477abfcb227',
    '20000000-0000-4000-8000-000000000205',
    'trip_1',
    'ticket_meta',
    'ticket_1',
    'upsert',
    1,
    1,
    'pgtap_device',
    '{"createdAt":1,"fileType":"pdf","id":"ticket_1","tripId":"trip_1","title":"Bypass","mimeType":"application/pdf","scope":"trip","sharedVisibility":{"mode":"all"},"size":1024,"storageMode":"copy","ticketCategory":"admission_ticket","updatedAt":2}'::jsonb
  ) ->> 'reason',
  'workflow_required',
  'single-object mutations cannot bypass the Ticket relationship workflow'
);
select is(
  public.account_apply_object_mutation_v1(
    1,
    'bd7662a5eeb41614e720d477abfcb227',
    '20000000-0000-4000-8000-000000000206',
    'trip_1',
    'item',
    'item_1',
    'upsert',
    1,
    1,
    'pgtap_device',
    '{"id":"item_1","tripId":"trip_1","dayId":"day_1","title":"First","sortOrder":1,"ticketIds":["ticket_1"]}'::jsonb
  ) ->> 'reason',
  'workflow_required',
  'single-object mutations cannot change Item ticket relationships'
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
    'trip_mutation_reuse',
    '[{
      "stepId":"trip",
      "mutationId":"20000000-0000-4000-8000-000000000001",
      "objectType":"trip",
      "objectId":"trip_mutation_reuse",
      "operation":"upsert",
      "expectedRevision":0,
      "objectSchemaVersion":1,
      "payload":{"id":"trip_mutation_reuse","title":"Changed"}
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
    'trip_atomic_fail',
    '[
      {
        "stepId":"trip_new",
        "mutationId":"20000000-0000-4000-8000-000000000031",
        "objectType":"trip",
        "objectId":"trip_atomic_fail",
        "operation":"upsert",
        "expectedRevision":0,
        "objectSchemaVersion":1,
        "payload":{"id":"trip_atomic_fail","title":"Atomic"}
      },
      {
        "stepId":"day_collision",
        "mutationId":"20000000-0000-4000-8000-000000000032",
        "objectType":"day",
        "objectId":"day_1",
        "operation":"upsert",
        "expectedRevision":0,
        "objectSchemaVersion":1,
        "payload":{"id":"day_1","tripId":"trip_atomic_fail","sortOrder":0}
      }
    ]'::jsonb
  ) ->> 'reason',
  'object_trip_mismatch',
  'one colliding object rejects the whole batch before writes'
);

reset role;
select is(
  (
    select pg_catalog.count(*)
    from public.tripmap_account_objects
    where owner_id = '11111111-1111-4111-8111-111111111111'
      and object_id = 'trip_atomic_fail'
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
    '10000000-0000-4000-8000-000000000204',
    'ticket.bind@1',
    'trip_1',
    '[
      {
        "stepId":"ticket",
        "mutationId":"20000000-0000-4000-8000-000000000207",
        "objectType":"ticket_meta",
        "objectId":"ticket_1",
        "operation":"upsert",
        "expectedRevision":1,
        "objectSchemaVersion":1,
        "payload":{"createdAt":1,"fileType":"pdf","id":"ticket_1","tripId":"trip_1","title":"Entry ticket","itemId":"item_2","mimeType":"application/pdf","scope":"item","sharedVisibility":{"mode":"all"},"size":1024,"storageMode":"copy","ticketCategory":"admission_ticket","updatedAt":2}
      },
      {
        "stepId":"item_2",
        "mutationId":"20000000-0000-4000-8000-000000000208",
        "objectType":"item",
        "objectId":"item_2",
        "operation":"upsert",
        "expectedRevision":2,
        "objectSchemaVersion":1,
        "payload":{"id":"item_2","tripId":"trip_1","dayId":"day_1","title":"Changed through binding","sortOrder":1,"ticketIds":["ticket_1"],"updatedAt":2}
      }
    ]'::jsonb
  ) ->> 'reason',
  'workflow_shape_invalid',
  'Ticket binding cannot mutate unrelated Item fields'
);
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000205',
    'ticket.bind@1',
    'trip_1',
    '[
      {
        "stepId":"ticket",
        "mutationId":"20000000-0000-4000-8000-000000000209",
        "objectType":"ticket_meta",
        "objectId":"ticket_1",
        "operation":"upsert",
        "expectedRevision":1,
        "objectSchemaVersion":1,
        "payload":{"createdAt":1,"fileType":"pdf","id":"ticket_1","tripId":"trip_1","title":"Entry ticket","itemId":"item_2","mimeType":"application/pdf","scope":"item","sharedVisibility":{"mode":"all"},"size":1024,"storageMode":"copy","ticketCategory":"admission_ticket","updatedAt":2}
      },
      {
        "stepId":"item_2",
        "mutationId":"20000000-0000-4000-8000-000000000210",
        "objectType":"item",
        "objectId":"item_2",
        "operation":"upsert",
        "expectedRevision":2,
        "objectSchemaVersion":1,
        "payload":{"id":"item_2","tripId":"trip_1","dayId":"day_1","title":"Second","sortOrder":1,"ticketIds":["ticket_1","ticket_other"],"updatedAt":2}
      }
    ]'::jsonb
  ) ->> 'reason',
  'workflow_shape_invalid',
  'Ticket binding cannot alter unrelated Ticket memberships'
);

reset role;
select is(
  (
    select pg_catalog.jsonb_build_object(
      'ticketRevision', ticket.revision,
      'itemTitle', item.payload ->> 'title',
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
  '{"ticketRevision": 1, "itemTitle": "Second", "itemTicketIds": []}'::jsonb,
  'rejected Ticket workflow escalation attempts leave both objects unchanged'
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
        "payload":{"createdAt":1,"fileType":"pdf","id":"ticket_1","tripId":"trip_1","title":"Entry ticket","itemId":"item_2","mimeType":"application/pdf","scope":"item","sharedVisibility":{"mode":"all"},"size":1024,"storageMode":"copy","ticketCategory":"admission_ticket","updatedAt":2}
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
        "payload":{"createdAt":1,"fileType":"pdf","id":"ticket_1","tripId":"trip_1","title":"Entry ticket","itemId":"item_1","mimeType":"application/pdf","scope":"item","sharedVisibility":{"mode":"all"},"size":1024,"storageMode":"copy","ticketCategory":"admission_ticket","updatedAt":3}
      },
      {
        "stepId":"item_1",
        "mutationId":"20000000-0000-4000-8000-000000000062",
        "objectType":"item",
        "objectId":"item_1",
        "operation":"upsert",
        "expectedRevision":2,
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
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000201',
    'ticket.bind@1',
    'trip_1',
    '[
      {
        "stepId":"ticket",
        "mutationId":"20000000-0000-4000-8000-000000000201",
        "objectType":"ticket_meta",
        "objectId":"ticket_1",
        "operation":"upsert",
        "expectedRevision":2,
        "objectSchemaVersion":1,
        "payload":{"createdAt":1,"fileType":"pdf","id":"ticket_1","tripId":"trip_1","title":"Entry ticket","mimeType":"application/pdf","scope":"trip","sharedVisibility":{"mode":"all"},"size":1024,"storageMode":"copy","ticketCategory":"admission_ticket","updatedAt":3}
      },
      {
        "stepId":"item_2",
        "mutationId":"20000000-0000-4000-8000-000000000202",
        "objectType":"item",
        "objectId":"item_2",
        "operation":"upsert",
        "expectedRevision":3,
        "objectSchemaVersion":1,
        "payload":{"id":"item_2","tripId":"trip_1","dayId":"day_1","title":"Second","sortOrder":1,"ticketIds":[]}
      }
    ]'::jsonb
  ) ->> 'status',
  'applied',
  'ticket unbind commits metadata and the prior reverse link together'
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
  '{"ticketItemId": null, "itemTicketIds": []}'::jsonb,
  'ticket unbind removes both relationship directions'
);

set local role authenticated;
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000202',
    'ticket.bind@1',
    'trip_1',
    '[
      {
        "stepId":"ticket",
        "mutationId":"20000000-0000-4000-8000-000000000203",
        "objectType":"ticket_meta",
        "objectId":"ticket_1",
        "operation":"upsert",
        "expectedRevision":3,
        "objectSchemaVersion":1,
        "payload":{"createdAt":1,"fileType":"pdf","id":"ticket_1","tripId":"trip_1","title":"Updated entry ticket","mimeType":"application/pdf","scope":"trip","sharedVisibility":{"mode":"all"},"size":1024,"storageMode":"copy","ticketCategory":"admission_ticket","updatedAt":4}
      }
    ]'::jsonb
  ) ->> 'status',
  'applied',
  'an existing unbound Ticket can update metadata with one bounded step'
);

set local role authenticated;
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000203',
    'ticket.bind@1',
    'trip_1',
    '[
      {
        "stepId":"ticket",
        "mutationId":"20000000-0000-4000-8000-000000000204",
        "objectType":"ticket_meta",
        "objectId":"ticket_1",
        "operation":"upsert",
        "expectedRevision":4,
        "objectSchemaVersion":1,
        "payload":{"createdAt":1,"fileType":"pdf","id":"ticket_1","tripId":"trip_1","title":"Invalid update","mimeType":"application/pdf","scope":"trip","sharedVisibility":{"mode":"all","memberIds":[]},"size":1024,"storageMode":"indexeddb","ticketCategory":"attraction","updatedAt":5}
      }
    ]'::jsonb
  ) ->> 'reason',
  'invalid_or_sensitive_payload',
  'Ticket metadata rejects invalid enums and visibility shape'
);

select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000209',
    'ticket.bind@1',
    'trip_1',
    '[
      {
        "stepId":"ticket",
        "mutationId":"20000000-0000-4000-8000-000000000219",
        "objectType":"ticket_meta",
        "objectId":"ticket_1",
        "operation":"upsert",
        "expectedRevision":4,
        "objectSchemaVersion":1,
        "payload":{"createdAt":1,"fileType":"pdf","id":"ticket_1","tripId":"trip_1","title":"Invalid visibility","mimeType":"application/pdf","scope":"trip","sharedVisibility":{},"size":1024,"storageMode":"copy","ticketCategory":"admission_ticket","updatedAt":5}
      }
    ]'::jsonb
  ) ->> 'reason',
  'invalid_or_sensitive_payload',
  'Ticket metadata requires a typed visibility mode'
);

reset role;
select is(
  (
    select pg_catalog.jsonb_build_object('revision', revision, 'title', payload ->> 'title')
    from public.tripmap_account_objects
    where owner_id = '11111111-1111-4111-8111-111111111111'
      and object_type = 'ticket_meta'
      and object_id = 'ticket_1'
  ),
  '{"revision": 4, "title": "Updated entry ticket"}'::jsonb,
  'an invalid Ticket metadata request leaves the acknowledged object unchanged'
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
          "stepId":"trip",
          "mutationId":"20000000-0000-4000-8000-000000000089",
          "objectType":"trip",
          "objectId":"rollback_trip",
          "operation":"upsert",
          "expectedRevision":0,
          "objectSchemaVersion":1,
          "payload":{"id":"rollback_trip","title":"Rollback"}
        },
        {
          "stepId":"day",
          "mutationId":"20000000-0000-4000-8000-000000000090",
          "objectType":"day",
          "objectId":"rollback_day",
          "operation":"upsert",
          "expectedRevision":0,
          "objectSchemaVersion":1,
          "payload":{"id":"rollback_day","tripId":"rollback_trip","sortOrder":0}
        },
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

set local role authenticated;
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000110',
    'trip.import.commit@1',
    'move_trip',
    '[
      {"stepId":"trip","mutationId":"20000000-0000-4000-8000-000000000110","objectType":"trip","objectId":"move_trip","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"id":"move_trip","title":"Move trip"}},
      {"stepId":"day_1","mutationId":"20000000-0000-4000-8000-000000000111","objectType":"day","objectId":"move_day_1","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"id":"move_day_1","tripId":"move_trip","date":"2026-08-01","sortOrder":1}},
      {"stepId":"day_2","mutationId":"20000000-0000-4000-8000-000000000112","objectType":"day","objectId":"move_day_2","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"id":"move_day_2","tripId":"move_trip","date":"2026-08-02","sortOrder":2}},
      {"stepId":"item_a","mutationId":"20000000-0000-4000-8000-000000000113","objectType":"item","objectId":"move_item_a","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"id":"move_item_a","tripId":"move_trip","dayId":"move_day_1","title":"A","sortOrder":1,"ticketIds":[]}},
      {"stepId":"item_b","mutationId":"20000000-0000-4000-8000-000000000114","objectType":"item","objectId":"move_item_b","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"id":"move_item_b","tripId":"move_trip","dayId":"move_day_1","title":"B","sortOrder":2,"ticketIds":[]}},
      {"stepId":"item_c","mutationId":"20000000-0000-4000-8000-000000000115","objectType":"item","objectId":"move_item_c","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"id":"move_item_c","tripId":"move_trip","dayId":"move_day_2","title":"C","sortOrder":1,"ticketIds":[]}}
    ]'::jsonb
  ) ->> 'status',
  'applied',
  'the move fixture imports as one atomic workflow'
);

select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000120',
    'item.move@1',
    'move_trip',
    '[
      {"stepId":"item_a","mutationId":"20000000-0000-4000-8000-000000000120","objectType":"item","objectId":"move_item_a","operation":"upsert","expectedRevision":1,"objectSchemaVersion":1,"payload":{"id":"move_item_a","tripId":"move_trip","dayId":"move_day_2","title":"A","sortOrder":2,"ticketIds":[]}},
      {"stepId":"item_c","mutationId":"20000000-0000-4000-8000-000000000121","objectType":"item","objectId":"move_item_c","operation":"upsert","expectedRevision":1,"objectSchemaVersion":1,"payload":{"id":"move_item_c","tripId":"move_trip","dayId":"move_day_2","title":"C","sortOrder":1,"ticketIds":[]}}
    ]'::jsonb
  ) ->> 'reason',
  'workflow_shape_invalid',
  'a move cannot omit a sibling from either affected day'
);

reset role;
select is(
  (
    select pg_catalog.jsonb_object_agg(
      object_id,
      pg_catalog.jsonb_build_object('dayId', payload -> 'dayId', 'sortOrder', payload -> 'sortOrder')
      order by object_id
    )
    from public.tripmap_account_objects
    where owner_id = '11111111-1111-4111-8111-111111111111'
      and object_type = 'item'
      and trip_id = 'move_trip'
  ),
  '{"move_item_a":{"dayId":"move_day_1","sortOrder":1},"move_item_b":{"dayId":"move_day_1","sortOrder":2},"move_item_c":{"dayId":"move_day_2","sortOrder":1}}'::jsonb,
  'an incomplete move leaves the complete item graph unchanged'
);

set local role authenticated;
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000130',
    'item.move@1',
    'move_trip',
    '[
      {"stepId":"item_a","mutationId":"20000000-0000-4000-8000-000000000130","objectType":"item","objectId":"move_item_a","operation":"upsert","expectedRevision":1,"objectSchemaVersion":1,"payload":{"id":"move_item_a","tripId":"move_trip","dayId":"move_day_2","title":"A","sortOrder":2,"ticketIds":[]}},
      {"stepId":"item_b","mutationId":"20000000-0000-4000-8000-000000000131","objectType":"item","objectId":"move_item_b","operation":"upsert","expectedRevision":1,"objectSchemaVersion":1,"payload":{"id":"move_item_b","tripId":"move_trip","dayId":"move_day_1","title":"B","sortOrder":1,"ticketIds":[]}},
      {"stepId":"item_c","mutationId":"20000000-0000-4000-8000-000000000132","objectType":"item","objectId":"move_item_c","operation":"upsert","expectedRevision":1,"objectSchemaVersion":1,"payload":{"id":"move_item_c","tripId":"move_trip","dayId":"move_day_2","title":"C","sortOrder":1,"ticketIds":[]}}
    ]'::jsonb
  ) ->> 'status',
  'applied',
  'a complete cross-day move commits through the registered workflow'
);

reset role;
select is(
  (
    select pg_catalog.jsonb_object_agg(
      object_id,
      pg_catalog.jsonb_build_object('dayId', payload -> 'dayId', 'sortOrder', payload -> 'sortOrder')
      order by object_id
    )
    from public.tripmap_account_objects
    where owner_id = '11111111-1111-4111-8111-111111111111'
      and object_type = 'item'
      and trip_id = 'move_trip'
  ),
  '{"move_item_a":{"dayId":"move_day_2","sortOrder":2},"move_item_b":{"dayId":"move_day_1","sortOrder":1},"move_item_c":{"dayId":"move_day_2","sortOrder":1}}'::jsonb,
  'a successful move leaves contiguous order in both affected days'
);

set local role authenticated;
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000140',
    'item.move@1',
    'move_trip',
    '[
      {"stepId":"item_a","mutationId":"20000000-0000-4000-8000-000000000140","objectType":"item","objectId":"move_item_a","operation":"upsert","expectedRevision":2,"objectSchemaVersion":1,"payload":{"id":"move_item_a","tripId":"move_trip","dayId":"move_day_2","title":"A","sortOrder":1,"ticketIds":[]}},
      {"stepId":"item_b","mutationId":"20000000-0000-4000-8000-000000000141","objectType":"item","objectId":"move_item_b","operation":"upsert","expectedRevision":2,"objectSchemaVersion":1,"payload":{"id":"move_item_b","tripId":"move_trip","dayId":"move_day_2","title":"B","sortOrder":2,"ticketIds":[]}},
      {"stepId":"item_c","mutationId":"20000000-0000-4000-8000-000000000142","objectType":"item","objectId":"move_item_c","operation":"upsert","expectedRevision":2,"objectSchemaVersion":1,"payload":{"id":"move_item_c","tripId":"move_trip","dayId":"move_day_1","title":"C","sortOrder":1,"ticketIds":[]}}
    ]'::jsonb
  ) ->> 'reason',
  'workflow_shape_invalid',
  'one move workflow cannot relocate two different items'
);

reset role;
select is(
  (
    select pg_catalog.jsonb_object_agg(
      object_id,
      pg_catalog.jsonb_build_object('dayId', payload -> 'dayId', 'sortOrder', payload -> 'sortOrder')
      order by object_id
    )
    from public.tripmap_account_objects
    where owner_id = '11111111-1111-4111-8111-111111111111'
      and object_type = 'item'
      and trip_id = 'move_trip'
  ),
  '{"move_item_a":{"dayId":"move_day_2","sortOrder":2},"move_item_b":{"dayId":"move_day_1","sortOrder":1},"move_item_c":{"dayId":"move_day_2","sortOrder":1}}'::jsonb,
  'a rejected two-item move leaves the prior graph intact'
);

set local role authenticated;
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000150',
    'day.items.reorder@1',
    'move_trip',
    '[
      {"stepId":"item_a","mutationId":"20000000-0000-4000-8000-000000000150","objectType":"item","objectId":"move_item_a","operation":"upsert","expectedRevision":2,"objectSchemaVersion":1,"payload":{"id":"move_item_a","tripId":"move_trip","dayId":"move_day_2","title":"A","sortOrder":3,"ticketIds":[]}},
      {"stepId":"item_c","mutationId":"20000000-0000-4000-8000-000000000151","objectType":"item","objectId":"move_item_c","operation":"upsert","expectedRevision":2,"objectSchemaVersion":1,"payload":{"id":"move_item_c","tripId":"move_trip","dayId":"move_day_2","title":"C","sortOrder":1,"ticketIds":[]}}
    ]'::jsonb
  ) ->> 'reason',
  'workflow_shape_invalid',
  'a reorder cannot commit a non-contiguous sort order'
);

select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000160',
    'day.items.reorder@1',
    'move_trip',
    '[
      {"stepId":"item_a","mutationId":"20000000-0000-4000-8000-000000000160","objectType":"item","objectId":"move_item_a","operation":"upsert","expectedRevision":2,"objectSchemaVersion":1,"payload":{"id":"move_item_a","tripId":"move_trip","dayId":"move_day_2","title":"A","sortOrder":1,"ticketIds":[]}},
      {"stepId":"item_c","mutationId":"20000000-0000-4000-8000-000000000161","objectType":"item","objectId":"move_item_c","operation":"upsert","expectedRevision":2,"objectSchemaVersion":1,"payload":{"id":"move_item_c","tripId":"move_trip","dayId":"move_day_2","title":"C","sortOrder":2}}
    ]'::jsonb
  ) ->> 'reason',
  'workflow_shape_invalid',
  'a workflow cannot bypass required Item structural fields'
);

reset role;

select ok(
  tripmap_private.account_ledger_payload_is_valid(
    'ledger_expense',
    '{"id":"ledger_draft_currency","tripId":"ledger_trip","title":"Draft","date":"2026-08-11","category":"food","status":"draft","currency":"GBP","splitMode":"equal","splitShares":[],"source":{"kind":"manual"},"createdAt":1,"updatedAt":1}'::jsonb
  ),
  'a draft may retain its recognized currency before the amount is known'
);

select ok(
  not tripmap_private.account_ledger_payload_is_valid(
    'ledger_expense',
    '{"id":"ledger_amount_without_currency","tripId":"ledger_trip","title":"Invalid","date":"2026-08-11","category":"food","status":"draft","amountMinor":100,"splitMode":"equal","splitShares":[],"source":{"kind":"manual"},"createdAt":1,"updatedAt":1}'::jsonb
  ),
  'an amount is never accepted without its currency'
);

select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'tripmap_private.account_ledger_workflow_graph_is_valid(uuid,text,jsonb)',
    'EXECUTE'
  ),
  'authenticated clients cannot execute the private ledger graph validator'
);

set local role authenticated;
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000170',
    'trip.import.commit@1',
    'ledger_trip',
    '[
      {"stepId":"trip","mutationId":"20000000-0000-4000-8000-000000000170","objectType":"trip","objectId":"ledger_trip","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"id":"ledger_trip","title":"Ledger trip"}},
      {"stepId":"day","mutationId":"20000000-0000-4000-8000-000000000171","objectType":"day","objectId":"ledger_day","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"id":"ledger_day","tripId":"ledger_trip","date":"2026-08-11","sortOrder":1}},
      {"stepId":"item","mutationId":"20000000-0000-4000-8000-000000000172","objectType":"item","objectId":"ledger_item","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"id":"ledger_item","tripId":"ledger_trip","dayId":"ledger_day","title":"Dinner","sortOrder":1,"ticketIds":[]}},
      {"stepId":"ticket","mutationId":"20000000-0000-4000-8000-000000000173","objectType":"ticket_meta","objectId":"ledger_ticket","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"createdAt":1,"fileType":"pdf","id":"ledger_ticket","tripId":"ledger_trip","title":"Receipt","mimeType":"application/pdf","scope":"trip","sharedVisibility":{"mode":"all"},"size":1024,"storageMode":"copy","ticketCategory":"other","updatedAt":1}}
    ]'::jsonb
  ) ->> 'status',
  'applied',
  'the ledger fixture imports its parent travel graph atomically'
);

select is(
  public.account_apply_object_mutation_v1(
    1,
    'bd7662a5eeb41614e720d477abfcb227',
    '20000000-0000-4000-8000-000000000174',
    'ledger_trip',
    'ledger_settings',
    'ledger_settings_bypass',
    'upsert',
    0,
    1,
    'pgtap_device',
    '{"id":"ledger_settings_bypass","tripId":"ledger_trip","homeCurrency":"CNY","tripCurrency":"GBP","settlementCurrency":"CNY","createdAt":1,"updatedAt":1}'::jsonb
  ) ->> 'reason',
  'workflow_required',
  'a strict ledger payload still cannot bypass the registered workflow'
);

select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000175',
    'ledger.batch@1',
    'ledger_trip',
    '[
      {"stepId":"settings","mutationId":"20000000-0000-4000-8000-000000000175","objectType":"ledger_settings","objectId":"ledger_settings","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"id":"ledger_settings","tripId":"ledger_trip","homeCurrency":"CNY","tripCurrency":"GBP","settlementCurrency":"CNY","createdAt":1,"updatedAt":1}},
      {"stepId":"participant","mutationId":"20000000-0000-4000-8000-000000000176","objectType":"ledger_participant","objectId":"ledger_person","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"id":"ledger_person","tripId":"ledger_trip","displayName":"Me","isSelf":true,"source":"manual","createdAt":1,"updatedAt":1}},
      {"stepId":"budget","mutationId":"20000000-0000-4000-8000-000000000177","objectType":"ledger_budget","objectId":"ledger_budget","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"id":"ledger_budget","tripId":"ledger_trip","scope":"trip","amountMinor":100000,"currency":"GBP","createdAt":1,"updatedAt":1}}
    ]'::jsonb
  ) ->> 'status',
  'applied',
  'settings, self, and trip budget initialize in one ledger workflow'
);

reset role;
select is(
  (
    select pg_catalog.count(*)
    from public.tripmap_account_objects
    where owner_id = '11111111-1111-4111-8111-111111111111'
      and trip_id = 'ledger_trip'
      and object_type in ('ledger_settings', 'ledger_participant', 'ledger_budget')
      and not tombstone
  ),
  3::bigint,
  'ledger initialization persists the complete three-object baseline'
);

set local role authenticated;
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000178',
    'ledger.batch@1',
    'ledger_trip',
    '[{"stepId":"settings","mutationId":"20000000-0000-4000-8000-000000000178","objectType":"ledger_settings","objectId":"ledger_settings_second","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"id":"ledger_settings_second","tripId":"ledger_trip","homeCurrency":"CNY","tripCurrency":"GBP","settlementCurrency":"CNY","createdAt":1,"updatedAt":1}}]'::jsonb
  ) ->> 'reason',
  'workflow_shape_invalid',
  'a second settings object is rejected against the complete ledger graph'
);

select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000179',
    'ledger.batch@1',
    'ledger_trip',
    '[{"stepId":"settings","mutationId":"20000000-0000-4000-8000-000000000179","objectType":"ledger_settings","objectId":"ledger_settings","operation":"delete","expectedRevision":1,"objectSchemaVersion":1}]'::jsonb
  ) ->> 'reason',
  'workflow_shape_invalid',
  'ledger settings cannot be deleted through a direct batch'
);

select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000180',
    'ledger.batch@1',
    'ledger_trip',
    '[{"stepId":"budget","mutationId":"20000000-0000-4000-8000-000000000180","objectType":"ledger_budget","objectId":"ledger_budget_unknown","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"id":"ledger_budget_unknown","tripId":"ledger_trip","scope":"category","category":"food","amountMinor":1000,"currency":"GBP","createdAt":1,"updatedAt":1,"apiKey":"forbidden"}}]'::jsonb
  ) ->> 'reason',
  'invalid_or_sensitive_payload',
  'unknown or sensitive ledger fields are rejected before locks and writes'
);

select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000181',
    'ledger.batch@1',
    'ledger_trip',
    '[{"stepId":"expense","mutationId":"20000000-0000-4000-8000-000000000181","objectType":"ledger_expense","objectId":"ledger_expense_numeric_source","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"id":"ledger_expense_numeric_source","tripId":"ledger_trip","title":"Invalid","date":"2026-08-11","category":"food","status":"confirmed","amountMinor":100,"currency":"GBP","splitMode":"equal","splitShares":[],"source":{"kind":"manual","sourceId":1},"createdAt":1,"updatedAt":1}}]'::jsonb
  ) ->> 'reason',
  'invalid_or_sensitive_payload',
  'numeric values cannot impersonate string ledger identifiers'
);

reset role;
select is(
  tripmap_private.account_ledger_payload_is_valid(
    'ledger_settings',
    '{"id":"invalid_settings","tripId":"ledger_trip","tripCurrency":"GBP","settlementCurrency":"CNY","createdAt":1,"updatedAt":1}'::jsonb
  ),
  false,
  'ledger settings require every currency as a JSON string'
);

select is(
  tripmap_private.account_ledger_payload_is_valid(
    'ledger_expense',
    '{"id":"invalid_expense_category","tripId":"ledger_trip","title":"Invalid","date":"2026-08-11","status":"draft","splitMode":"equal","splitShares":[],"source":{"kind":"manual"},"createdAt":1,"updatedAt":1}'::jsonb
  ),
  false,
  'ledger expenses require a typed category instead of accepting SQL null semantics'
);

select is(
  tripmap_private.account_ledger_payload_is_valid(
    'ledger_expense',
    '{"id":"invalid_source_link","tripId":"ledger_trip","title":"Invalid","date":"2026-08-11","category":"other","status":"draft","splitMode":"equal","splitShares":[],"source":{"kind":"manual"},"sourceLinks":[{"id":"link_1","kind":"ticket","sourceId":"ledger_ticket"}],"createdAt":1,"updatedAt":1}'::jsonb
  ),
  false,
  'ledger source links require every nested enum field'
);

select is(
  tripmap_private.account_ledger_payload_is_valid(
    'ledger_expense',
    '{"id":"invalid_line_item","tripId":"ledger_trip","title":"Invalid","date":"2026-08-11","category":"other","status":"draft","splitMode":"equal","splitShares":[],"source":{"kind":"manual"},"lineItems":[{"id":"line_1","title":123,"kind":"base","category":"other","amountMinor":100,"currency":"GBP"}],"createdAt":1,"updatedAt":1}'::jsonb
  ),
  false,
  'ledger line items reject scalar coercion for required strings'
);

select is(
  tripmap_private.account_ledger_payload_is_valid(
    'ledger_expense',
    '{"id":"invalid_exchange_rate","tripId":"ledger_trip","title":"Invalid","date":"2026-08-11","category":"other","status":"draft","splitMode":"equal","splitShares":[],"source":{"kind":"manual"},"exchangeRate":{"requestedDate":"2026-08-11","effectiveDate":"2026-08-11","baseCurrency":"GBP","tripCurrency":"GBP","homeCurrency":"CNY","rateToTrip":"1","rateToHome":"9","provider":"manual"},"createdAt":1,"updatedAt":1}'::jsonb
  ),
  false,
  'ledger exchange rates require a typed observation timestamp'
);

select is(
  tripmap_private.account_ledger_payload_is_valid(
    'ledger_expense',
    '{"id":"invalid_split_weight","tripId":"ledger_trip","title":"Invalid","date":"2026-08-11","category":"other","status":"draft","splitMode":"weights","splitShares":[{"participantId":"ledger_person","weight":9007199254740992}],"source":{"kind":"manual"},"createdAt":1,"updatedAt":1}'::jsonb
  ),
  false,
  'ledger split weights remain inside the JavaScript safe-integer boundary'
);

set local role authenticated;

select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000182',
    'ledger.batch@1',
    'ledger_trip',
    '[{"stepId":"expense","mutationId":"20000000-0000-4000-8000-000000000182","objectType":"ledger_expense","objectId":"ledger_expense_missing_person","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"id":"ledger_expense_missing_person","tripId":"ledger_trip","title":"Missing person","date":"2026-08-11","category":"food","status":"confirmed","amountMinor":100,"currency":"GBP","payerParticipantId":"missing_person","splitMode":"equal","splitShares":[{"participantId":"missing_person","weight":1}],"source":{"kind":"manual"},"createdAt":1,"updatedAt":1}}]'::jsonb
  ) ->> 'reason',
  'workflow_shape_invalid',
  'an expense cannot reference a missing participant'
);

select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000183',
    'ledger.batch@1',
    'ledger_trip',
    '[{"stepId":"expense","mutationId":"20000000-0000-4000-8000-000000000183","objectType":"ledger_expense","objectId":"ledger_expense_missing_item","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"id":"ledger_expense_missing_item","tripId":"ledger_trip","title":"Missing item","date":"2026-08-11","category":"food","status":"confirmed","amountMinor":100,"currency":"GBP","payerParticipantId":"ledger_person","splitMode":"equal","splitShares":[{"participantId":"ledger_person","weight":1}],"source":{"kind":"manual"},"itemIds":["missing_item"],"createdAt":1,"updatedAt":1}}]'::jsonb
  ) ->> 'reason',
  'workflow_shape_invalid',
  'an expense cannot reference a missing itinerary item'
);

select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000184',
    'ledger.batch@1',
    'ledger_trip',
    '[{"stepId":"expense","mutationId":"20000000-0000-4000-8000-000000000184","objectType":"ledger_expense","objectId":"ledger_expense_missing_ticket","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"id":"ledger_expense_missing_ticket","tripId":"ledger_trip","title":"Missing ticket","date":"2026-08-11","category":"food","status":"confirmed","amountMinor":100,"currency":"GBP","payerParticipantId":"ledger_person","splitMode":"equal","splitShares":[{"participantId":"ledger_person","weight":1}],"source":{"kind":"ticket","sourceId":"missing_ticket"},"createdAt":1,"updatedAt":1}}]'::jsonb
  ) ->> 'reason',
  'workflow_shape_invalid',
  'an expense cannot reference a missing Ticket object'
);

select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000185',
    'ledger.batch@1',
    'ledger_trip',
    '[{"stepId":"expense","mutationId":"20000000-0000-4000-8000-000000000185","objectType":"ledger_expense","objectId":"ledger_expense_missing_original","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"id":"ledger_expense_missing_original","tripId":"ledger_trip","title":"Missing original","date":"2026-08-11","category":"food","status":"confirmed","amountMinor":-100,"currency":"GBP","payerParticipantId":"ledger_person","splitMode":"equal","splitShares":[{"participantId":"ledger_person","weight":1}],"source":{"kind":"manual"},"originalExpenseId":"missing_original","createdAt":1,"updatedAt":1}}]'::jsonb
  ) ->> 'reason',
  'workflow_shape_invalid',
  'a refund cannot reference a missing original expense'
);

select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000186',
    'ledger.batch@1',
    'ledger_trip',
    '[
      {"stepId":"expense_one","mutationId":"20000000-0000-4000-8000-000000000186","objectType":"ledger_expense","objectId":"ledger_expense_one","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"id":"ledger_expense_one","tripId":"ledger_trip","title":"Ticket dinner","date":"2026-08-11","category":"food","status":"confirmed","amountMinor":2500,"currency":"GBP","payerParticipantId":"ledger_person","splitMode":"equal","splitShares":[{"participantId":"ledger_person","weight":1}],"source":{"kind":"ticket","sourceId":"ledger_ticket","fingerprint":"ticket_fingerprint_1"},"itemIds":["ledger_item"],"createdAt":1,"updatedAt":1}},
      {"stepId":"expense_two","mutationId":"20000000-0000-4000-8000-000000000187","objectType":"ledger_expense","objectId":"ledger_expense_two","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"id":"ledger_expense_two","tripId":"ledger_trip","title":"Manual dinner","date":"2026-08-12","category":"food","status":"confirmed","amountMinor":1800,"currency":"GBP","payerParticipantId":"ledger_person","splitMode":"equal","splitShares":[{"participantId":"ledger_person","weight":1}],"source":{"kind":"manual","fingerprint":"manual_fingerprint_1"},"createdAt":1,"updatedAt":1}}
    ]'::jsonb
  ) ->> 'status',
  'applied',
  'valid linked expenses commit atomically in one ledger workflow'
);

reset role;
select is(
  (
    select pg_catalog.count(*)
    from public.tripmap_account_objects
    where owner_id = '11111111-1111-4111-8111-111111111111'
      and trip_id = 'ledger_trip'
      and object_type = 'ledger_expense'
      and not tombstone
  ),
  2::bigint,
  'the successful ledger batch persists both expenses'
);

set local role authenticated;
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000188',
    'ledger.batch@1',
    'ledger_trip',
    '[
      {"stepId":"expense_one","mutationId":"20000000-0000-4000-8000-000000000188","objectType":"ledger_expense","objectId":"ledger_expense_one","operation":"upsert","expectedRevision":1,"objectSchemaVersion":1,"payload":{"id":"ledger_expense_one","tripId":"ledger_trip","title":"Changed one","date":"2026-08-11","category":"food","status":"confirmed","amountMinor":2500,"currency":"GBP","payerParticipantId":"ledger_person","splitMode":"equal","splitShares":[{"participantId":"ledger_person","weight":1}],"source":{"kind":"ticket","sourceId":"ledger_ticket","fingerprint":"ticket_fingerprint_1"},"itemIds":["ledger_item"],"createdAt":1,"updatedAt":2}},
      {"stepId":"expense_two","mutationId":"20000000-0000-4000-8000-000000000189","objectType":"ledger_expense","objectId":"ledger_expense_two","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"id":"ledger_expense_two","tripId":"ledger_trip","title":"Changed two","date":"2026-08-12","category":"food","status":"confirmed","amountMinor":1800,"currency":"GBP","payerParticipantId":"ledger_person","splitMode":"equal","splitShares":[{"participantId":"ledger_person","weight":1}],"source":{"kind":"manual","fingerprint":"manual_fingerprint_1"},"createdAt":1,"updatedAt":2}}
    ]'::jsonb
  ) ->> 'status',
  'conflict',
  'one stale revision conflicts the complete ledger batch'
);

reset role;
select is(
  (
    select pg_catalog.jsonb_object_agg(object_id, payload -> 'title' order by object_id)
    from public.tripmap_account_objects
    where owner_id = '11111111-1111-4111-8111-111111111111'
      and object_id in ('ledger_expense_one', 'ledger_expense_two')
  ),
  '{"ledger_expense_one":"Ticket dinner","ledger_expense_two":"Manual dinner"}'::jsonb,
  'a ledger conflict writes none of the otherwise valid steps'
);

set local role authenticated;
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000190',
    'ledger.batch@1',
    'ledger_trip',
    '[{"stepId":"expense_one","mutationId":"20000000-0000-4000-8000-000000000190","objectType":"ledger_expense","objectId":"ledger_expense_one","operation":"upsert","expectedRevision":1,"objectSchemaVersion":1,"payload":{"id":"ledger_expense_one","tripId":"ledger_trip","title":"Stale timestamp","date":"2026-08-11","category":"food","status":"confirmed","amountMinor":2500,"currency":"GBP","payerParticipantId":"ledger_person","splitMode":"equal","splitShares":[{"participantId":"ledger_person","weight":1}],"source":{"kind":"ticket","sourceId":"ledger_ticket","fingerprint":"ticket_fingerprint_1"},"itemIds":["ledger_item"],"createdAt":1,"updatedAt":1}}]'::jsonb
  ) ->> 'reason',
  'workflow_shape_invalid',
  'ledger updates require a strictly later domain timestamp'
);

select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000195',
    'ledger.batch@1',
    'ledger_trip',
    '[{"stepId":"expense_one","mutationId":"20000000-0000-4000-8000-000000000195","objectType":"ledger_expense","objectId":"ledger_expense_one","operation":"upsert","expectedRevision":1,"objectSchemaVersion":1,"payload":{"id":"ledger_expense_one","tripId":"ledger_trip","title":"Rewritten creation","date":"2026-08-11","category":"food","status":"confirmed","amountMinor":2500,"currency":"GBP","payerParticipantId":"ledger_person","splitMode":"equal","splitShares":[{"participantId":"ledger_person","weight":1}],"source":{"kind":"ticket","sourceId":"ledger_ticket","fingerprint":"ticket_fingerprint_1"},"itemIds":["ledger_item"],"createdAt":2,"updatedAt":2}}]'::jsonb
  ) ->> 'reason',
  'workflow_shape_invalid',
  'ledger updates cannot rewrite the original domain creation timestamp'
);

select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000191',
    'ledger.batch@1',
    'ledger_trip',
    '[{"stepId":"participant","mutationId":"20000000-0000-4000-8000-000000000191","objectType":"ledger_participant","objectId":"ledger_person","operation":"delete","expectedRevision":1,"objectSchemaVersion":1}]'::jsonb
  ) ->> 'reason',
  'workflow_shape_invalid',
  'a participant referenced by expenses cannot be deleted'
);

select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000192',
    'ledger.batch@1',
    'ledger_trip',
    '[{"stepId":"expense","mutationId":"20000000-0000-4000-8000-000000000192","objectType":"ledger_expense","objectId":"ledger_expense_duplicate","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"id":"ledger_expense_duplicate","tripId":"ledger_trip","title":"Duplicate","date":"2026-08-12","category":"food","status":"confirmed","amountMinor":1800,"currency":"GBP","payerParticipantId":"ledger_person","splitMode":"equal","splitShares":[{"participantId":"ledger_person","weight":1}],"source":{"kind":"manual","fingerprint":"manual_fingerprint_1"},"createdAt":1,"updatedAt":1}}]'::jsonb
  ) ->> 'reason',
  'workflow_shape_invalid',
  'the complete graph rejects a duplicate source fingerprint'
);

select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000193',
    'ledger.batch@1',
    'ledger_trip',
    '[{"stepId":"expense","mutationId":"20000000-0000-4000-8000-000000000193","objectType":"ledger_expense","objectId":"ledger_expense_unavailable_ticket","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"id":"ledger_expense_unavailable_ticket","tripId":"ledger_trip","title":"Historical source","date":"2026-08-12","category":"food","status":"confirmed","amountMinor":500,"currency":"GBP","payerParticipantId":"ledger_person","splitMode":"equal","splitShares":[{"participantId":"ledger_person","weight":1}],"source":{"kind":"ticket","sourceId":"deleted_ticket"},"sourceLinks":[{"id":"deleted_ticket_link","kind":"ticket","sourceId":"deleted_ticket","role":"payment_receipt","available":false}],"createdAt":1,"updatedAt":1}}]'::jsonb
  ) ->> 'status',
  'applied',
  'an explicitly unavailable Ticket source remains as audit metadata without a live dependency'
);

select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '10000000-0000-4000-8000-000000000194',
    'ledger.batch@1',
    'ledger_trip',
    '[{"stepId":"expense","mutationId":"20000000-0000-4000-8000-000000000194","objectType":"ledger_expense","objectId":"ledger_expense_mixed_ticket","operation":"upsert","expectedRevision":0,"objectSchemaVersion":1,"payload":{"id":"ledger_expense_mixed_ticket","tripId":"ledger_trip","title":"Mixed source","date":"2026-08-12","category":"food","status":"confirmed","amountMinor":500,"currency":"GBP","payerParticipantId":"ledger_person","splitMode":"equal","splitShares":[{"participantId":"ledger_person","weight":1}],"source":{"kind":"ticket","sourceId":"deleted_ticket"},"sourceLinks":[{"id":"deleted_ticket_false","kind":"ticket","sourceId":"deleted_ticket","role":"other","available":false},{"id":"deleted_ticket_true","kind":"ticket","sourceId":"deleted_ticket","role":"payment_receipt","available":true}],"createdAt":1,"updatedAt":1}}]'::jsonb
  ) ->> 'reason',
  'workflow_shape_invalid',
  'an available Ticket link cannot be hidden by a second unavailable marker'
);

reset role;

insert into public.tripmap_account_objects (
  owner_id, trip_id, object_type, object_id, payload, schema_version, revision,
  mutation_id, actor_id, device_id, tombstone
) values
  (
    '11111111-1111-4111-8111-111111111111', 'replan_trip', 'trip', 'replan_trip',
    '{"createdAt":1,"destination":"United Kingdom","endDate":"2026-07-10","id":"replan_trip","startDate":"2026-07-10","title":"United Kingdom","updatedAt":1}'::jsonb,
    1, 1, '30000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111', 'pgtap_device', false
  ),
  (
    '11111111-1111-4111-8111-111111111111', 'replan_trip', 'day', 'replan_day',
    '{"date":"2026-07-10","id":"replan_day","sortOrder":1,"title":"London","tripId":"replan_trip"}'::jsonb,
    1, 1, '30000000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111', 'pgtap_device', false
  ),
  (
    '11111111-1111-4111-8111-111111111111', 'replan_trip', 'item', 'replan_item',
    '{"createdAt":1,"dayId":"replan_day","endTime":"11:00","id":"replan_item","sortOrder":1,"startTime":"10:00","ticketIds":[],"title":"Museum","tripId":"replan_trip","updatedAt":1}'::jsonb,
    1, 1, '30000000-0000-4000-8000-000000000003',
    '11111111-1111-4111-8111-111111111111', 'pgtap_device', false
  );

insert into workflow_fixtures (fixture_name, steps) values (
  'adaptive_replan',
  '[
    {
      "stepId":"trip","mutationId":"30000000-0000-4000-8000-000000000011",
      "objectType":"trip","objectId":"replan_trip","operation":"upsert",
      "expectedRevision":1,"objectSchemaVersion":1,
      "payload":{"createdAt":1,"destination":"United Kingdom","endDate":"2026-07-10","id":"replan_trip","startDate":"2026-07-10","title":"United Kingdom","updatedAt":2}
    },
    {
      "stepId":"item","mutationId":"30000000-0000-4000-8000-000000000012",
      "objectType":"item","objectId":"replan_item","operation":"upsert",
      "expectedRevision":1,"objectSchemaVersion":1,
      "payload":{"createdAt":1,"dayId":"replan_day","endTime":"11:30","id":"replan_item","sortOrder":1,"startTime":"10:30","ticketIds":[],"title":"Museum","tripId":"replan_trip","updatedAt":2}
    },
    {
      "stepId":"event","mutationId":"30000000-0000-4000-8000-000000000013",
      "objectType":"replan_event","objectId":"replan_event","operation":"upsert",
      "expectedRevision":0,"objectSchemaVersion":1,
      "payload":{"createdAt":2,"dayId":"replan_day","delayMinutes":30,"evidence":[],"id":"replan_event","itemId":"replan_item","kind":"late","notes":"Arrival delay","occurredAt":"2026-08-11T12:00:00.000Z","reportedByRole":"owner","status":"applied","tripId":"replan_trip","updatedAt":2}
    },
    {
      "stepId":"record","mutationId":"30000000-0000-4000-8000-000000000014",
      "objectType":"replan_record","objectId":"replan_record","operation":"upsert",
      "expectedRevision":0,"objectSchemaVersion":1,
      "payload":{
        "accountObjectBaseline":[
          {"expectedRevision":1,"objectId":"replan_trip","objectType":"trip"},
          {"expectedRevision":1,"objectId":"replan_day","objectType":"day"},
          {"expectedRevision":1,"objectId":"replan_item","objectType":"item"}
        ],
        "afterSnapshot":{"days":[{"date":"2026-07-10","id":"replan_day","sortOrder":1,"title":"London","tripId":"replan_trip"}],"items":[{"createdAt":1,"dayId":"replan_day","endTime":"11:30","id":"replan_item","sortOrder":1,"startTime":"10:30","ticketIds":[],"title":"Museum","tripId":"replan_trip","updatedAt":2}]},
        "appliedFingerprint":"applied-fingerprint",
        "baselineFingerprint":"baseline-fingerprint",
        "beforeSnapshot":{"days":[{"date":"2026-07-10","id":"replan_day","sortOrder":1,"title":"London","tripId":"replan_trip"}],"items":[{"createdAt":1,"dayId":"replan_day","endTime":"11:00","id":"replan_item","sortOrder":1,"startTime":"10:00","ticketIds":[],"title":"Museum","tripId":"replan_trip","updatedAt":1}]},
        "createdAt":2,
        "eventId":"replan_event",
        "evidence":[{"id":"user-report:replan_event","kind":"user_report","label":"用户报告","retrievedAt":"2026-08-11T12:00:00.000Z","snippet":"Arrival delay","sourceType":"unknown"}],
        "id":"replan_record",
        "operationFingerprint":"ai-action-replan",
        "operationKind":"adaptive_replan",
        "options":[
          {"diff":{"companionImpacts":[],"itemChanges":[{"after":{"dayId":"replan_day","endTime":"11:30","sortOrder":1,"startTime":"10:30"},"before":{"dayId":"replan_day","endTime":"11:00","sortOrder":1,"startTime":"10:00"},"changeType":"time_changed","itemId":"replan_item","reason":"Arrival delay","title":"Museum"}],"ledgerImpacts":[],"routeImpacts":[],"ticketImpacts":[],"warnings":[]},"id":"replan_least","itemPatches":[{"itemId":"replan_item","patch":{"endTime":"11:30","startTime":"10:30"}}],"score":100,"strategy":"least_change","summary":"Shifted one stop","title":"Least change"},
          {"diff":{"companionImpacts":[],"itemChanges":[{"after":{"dayId":"replan_day","endTime":"11:30","sortOrder":1,"startTime":"10:30"},"before":{"dayId":"replan_day","endTime":"11:00","sortOrder":1,"startTime":"10:00"},"changeType":"time_changed","itemId":"replan_item","reason":"Arrival delay","title":"Museum"}],"ledgerImpacts":[],"routeImpacts":[],"ticketImpacts":[],"warnings":[]},"id":"replan_preserve","itemPatches":[{"itemId":"replan_item","patch":{"endTime":"11:30","startTime":"10:30"}}],"score":90,"strategy":"preserve_most","summary":"Preserved bookings","title":"Preserve most"},
          {"diff":{"companionImpacts":[],"itemChanges":[{"after":{"dayId":"replan_day","endTime":"11:30","sortOrder":1,"startTime":"10:30"},"before":{"dayId":"replan_day","endTime":"11:00","sortOrder":1,"startTime":"10:00"},"changeType":"time_changed","itemId":"replan_item","reason":"Arrival delay","title":"Museum"}],"ledgerImpacts":[],"routeImpacts":[],"ticketImpacts":[],"warnings":[]},"id":"replan_shortest","itemPatches":[{"itemId":"replan_item","patch":{"endTime":"11:30","startTime":"10:30"}}],"score":80,"strategy":"shortest_route","summary":"Reduced travel","title":"Shortest route"}
        ],
        "scopeItemIds":["replan_item"],
        "selectedDiff":{"companionImpacts":[],"itemChanges":[{"after":{"dayId":"replan_day","endTime":"11:30","sortOrder":1,"startTime":"10:30"},"before":{"dayId":"replan_day","endTime":"11:00","sortOrder":1,"startTime":"10:00"},"changeType":"time_changed","itemId":"replan_item","reason":"Arrival delay","title":"Museum"}],"ledgerImpacts":[],"routeImpacts":[],"ticketImpacts":[],"warnings":[]},
        "selectedOptionId":"replan_least","status":"applied","tripId":"replan_trip","updatedAt":2
      }
    },
    {
      "stepId":"history","mutationId":"30000000-0000-4000-8000-000000000015",
      "objectType":"trip_intelligence_applied_change","objectId":"replan_history","operation":"upsert",
      "expectedRevision":0,"objectSchemaVersion":1,
      "payload":{"actionType":"global_ai_adaptive_replan_applied","dedupeKey":"replan_trip:change","detail":"Shifted one stop","executionId":"trip-operations-2-","executionSource":"live","executionStatus":"success","executionTitle":"Adaptive replan","id":"replan_history","occurredAt":2,"privacyLevel":"private","recommendationFingerprints":[],"sourceId":"replan_record","sourceKind":"live","sourceLabel":"Adaptive replan","targetId":"replan_item","targetType":"live","title":"Replan applied","tripId":"replan_trip","updatedAt":2}
    }
  ]'::jsonb
);

set local role authenticated;
select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'tripmap_private.account_adaptive_replan_payload_is_valid(text,jsonb)',
    'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'tripmap_private.account_adaptive_replan_workflow_shape_is_valid(text,jsonb)',
    'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'tripmap_private.account_adaptive_replan_baseline_matches(uuid,text,jsonb)',
    'execute'
  ),
  'adaptive replan validators are not callable by browser roles'
);
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '40000000-0000-4000-8000-000000000001',
    'trip.replan.apply@1',
    'replan_trip',
    pg_catalog.jsonb_set(
      (select steps from pg_temp.workflow_fixtures where fixture_name = 'adaptive_replan'),
      '{3,payload,options,0,functionName}',
      '"database.run"'::jsonb
    )
  ) ->> 'reason',
  'invalid_or_sensitive_payload',
  'adaptive replan rejects an arbitrary nested function selector'
);
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '40000000-0000-4000-8000-000000000002',
    'trip.replan.apply@1',
    'replan_trip',
    pg_catalog.jsonb_set(
      (select steps from pg_temp.workflow_fixtures where fixture_name = 'adaptive_replan'),
      '{3,payload,options,0,providerKey}',
      '"secret-value"'::jsonb
    )
  ) ->> 'reason',
  'invalid_or_sensitive_payload',
  'adaptive replan rejects nested Provider secrets'
);
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '40000000-0000-4000-8000-000000000008',
    'trip.replan.apply@1',
    'replan_trip',
    pg_catalog.jsonb_set(
      (select steps from pg_temp.workflow_fixtures where fixture_name = 'adaptive_replan'),
      '{3,payload,options}',
      '{}'::jsonb
    )
  ) ->> 'reason',
  'invalid_or_sensitive_payload',
  'malformed adaptive JSON returns a bounded rejection instead of a database error'
);
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '40000000-0000-4000-8000-000000000009',
    'trip.replan.apply@1',
    'replan_trip',
    pg_catalog.jsonb_set(
      (select steps from pg_temp.workflow_fixtures where fixture_name = 'adaptive_replan'),
      '{3,payload,beforeSnapshot,days,0,title}',
      '7'::jsonb
    )
  ) ->> 'reason',
  'invalid_or_sensitive_payload',
  'adaptive replan rejects JSON scalar coercion in its stored snapshot'
);
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '40000000-0000-4000-8000-000000000010',
    'trip.replan.apply@1',
    'replan_trip',
    pg_catalog.jsonb_set(
      (select steps from pg_temp.workflow_fixtures where fixture_name = 'adaptive_replan'),
      '{3,payload,evidence,0,snippet}',
      'null'::jsonb
    )
  ) ->> 'reason',
  'invalid_or_sensitive_payload',
  'adaptive replan treats an explicit JSON null as invalid instead of unknown'
);
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '40000000-0000-4000-8000-000000000011',
    'trip.replan.apply@1',
    'replan_trip',
    pg_catalog.jsonb_set(
      (select steps from pg_temp.workflow_fixtures where fixture_name = 'adaptive_replan'),
      '{3,payload,options,0,itemPatches,0,patch,startTime}',
      '"09:00"'::jsonb
    )
  ) ->> 'reason',
  'workflow_shape_invalid',
  'adaptive replan binds the selected patch to the submitted Item payload'
);
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '40000000-0000-4000-8000-000000000012',
    'trip.replan.apply@1',
    'replan_trip',
    pg_catalog.jsonb_set(
      (select steps from pg_temp.workflow_fixtures where fixture_name = 'adaptive_replan'),
      '{3,payload,beforeSnapshot,days,0,title}',
      '"Forged London"'::jsonb
    )
  ) ->> 'reason',
  'revision_mismatch',
  'adaptive replan proves its before snapshot against current server objects'
);
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '40000000-0000-4000-8000-000000000003',
    'trip.replan.apply@1',
    'replan_trip',
    (select steps - 4 from pg_temp.workflow_fixtures where fixture_name = 'adaptive_replan')
  ) ->> 'reason',
  'workflow_shape_invalid',
  'adaptive replan rejects a workflow missing its redacted history step'
);
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '40000000-0000-4000-8000-000000000004',
    'trip.replan.apply@1',
    'replan_trip',
    pg_catalog.jsonb_set(
      (select steps from pg_temp.workflow_fixtures where fixture_name = 'adaptive_replan'),
      '{3,payload,accountObjectBaseline,1,expectedRevision}',
      '99'::jsonb
    )
  ) ->> 'reason',
  'revision_mismatch',
  'adaptive replan rejects a stale unsubmitted Day revision'
);
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '40000000-0000-4000-8000-000000000005',
    'trip.replan.apply@1',
    'replan_trip',
    pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(
        (select steps from pg_temp.workflow_fixtures where fixture_name = 'adaptive_replan'),
        '{1,payload,title}',
        '"Changed title"'::jsonb
      ),
      '{3,payload,afterSnapshot,items,0,title}',
      '"Changed title"'::jsonb
    )
  ) ->> 'reason',
  'workflow_shape_invalid',
  'adaptive replan cannot alter immutable Item content'
);

reset role;
insert into public.tripmap_account_objects (
  owner_id, trip_id, object_type, object_id, payload, schema_version, revision,
  mutation_id, actor_id, device_id, tombstone
) values (
  '11111111-1111-4111-8111-111111111111', 'replan_trip', 'ticket_meta', 'replan_ticket',
  '{"createdAt":1,"fileType":"pdf","id":"replan_ticket","mimeType":"application/pdf","scope":"trip","sharedVisibility":{"mode":"all"},"size":100,"storageMode":"copy","ticketCategory":"admission_ticket","title":"Ticket","tripId":"replan_trip","updatedAt":1}'::jsonb,
  1, 1, '30000000-0000-4000-8000-000000000004',
  '11111111-1111-4111-8111-111111111111', 'pgtap_device', false
);
set local role authenticated;
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '40000000-0000-4000-8000-000000000006',
    'trip.replan.apply@1',
    'replan_trip',
    (select steps from pg_temp.workflow_fixtures where fixture_name = 'adaptive_replan')
  ) ->> 'reason',
  'revision_mismatch',
  'adaptive replan rejects an active dependency omitted from the baseline'
);
reset role;
delete from public.tripmap_account_objects
where owner_id = '11111111-1111-4111-8111-111111111111'
  and object_type = 'ticket_meta'
  and object_id = 'replan_ticket';
set local role authenticated;

select is(
  (
    select pg_catalog.count(*)
    from public.tripmap_account_objects
    where trip_id = 'replan_trip'
      and object_type in (
        'replan_event', 'replan_record', 'trip_intelligence_applied_change'
      )
  ),
  0::bigint,
  'rejected adaptive replans leave no partial audit objects'
);
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '40000000-0000-4000-8000-000000000007',
    'trip.replan.apply@1',
    'replan_trip',
    (select steps from pg_temp.workflow_fixtures where fixture_name = 'adaptive_replan')
  ) ->> 'status',
  'applied',
  'a complete adaptive replan commits through one registered workflow'
);
select is(
  (
    select pg_catalog.count(*)
    from public.tripmap_account_objects
    where owner_id = '11111111-1111-4111-8111-111111111111'
      and trip_id = 'replan_trip'
      and object_id in (
        'replan_trip', 'replan_item', 'replan_event', 'replan_record', 'replan_history'
      )
  ),
  5::bigint,
  'adaptive replan persists the Trip, Item, event, record, and redacted history together'
);
select is(
  pg_temp.run_account_workflow(
    'bd7662a5eeb41614e720d477abfcb227',
    '40000000-0000-4000-8000-000000000007',
    'trip.replan.apply@1',
    'replan_trip',
    (select steps from pg_temp.workflow_fixtures where fixture_name = 'adaptive_replan')
  ) ->> 'status',
  'idempotent',
  'adaptive replan replay returns its receipt without reapplying successful steps'
);

reset role;

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
