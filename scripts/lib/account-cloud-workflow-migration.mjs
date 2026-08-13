const REQUIRED_FRAGMENTS = [
  'create table if not exists tripmap_private.account_workflow_receipts',
  'alter table tripmap_private.account_workflow_receipts enable row level security',
  'alter table tripmap_private.account_workflow_receipts force row level security',
  'revoke all on table tripmap_private.account_workflow_receipts from public, anon, authenticated',
  'security definer',
  "set search_path = ''",
  'current_user_id := auth.uid()',
  'target_account_hash',
  "'account_context_mismatch'",
  "'batch_mutation_id_reused'",
  "'mutation_id_reused'",
  "'receipt_advanced'",
  "'revision_mismatch'",
  "'workflow_shape_invalid'",
  'pg_catalog.octet_length(target_steps::text) > 4194304',
  'pg_catalog.jsonb_array_length(target_steps)',
  "when 'ticket.bind@1' then 1",
  "when 'trip.import.commit@1' then 256",
  "when 'trip.replan.apply@1' then 128",
  'create or replace function tripmap_private.account_payload_shape_is_safe',
  'create or replace function tripmap_private.account_workflow_payload_is_safe',
  'create or replace function tripmap_private.account_import_workflow_shape_is_valid',
  'create or replace function tripmap_private.account_ledger_workflow_graph_is_valid',
  'create or replace function tripmap_private.account_adaptive_replan_payload_is_valid',
  'create or replace function tripmap_private.account_adaptive_replan_workflow_shape_is_valid',
  'create or replace function tripmap_private.account_adaptive_replan_baseline_matches',
  'not tripmap_private.account_workflow_payload_is_safe(step_payload)',
  'not tripmap_private.account_import_workflow_shape_is_valid',
  'not tripmap_private.account_ticket_meta_payload_is_valid(step_payload)',
  'not tripmap_private.account_ledger_payload_is_valid(step_object_type, step_payload)',
  'tripmap_private.account_adaptive_replan_payload_is_valid',
  'tripmap_private.account_adaptive_replan_workflow_shape_is_valid',
  'tripmap_private.account_adaptive_replan_baseline_matches',
  'is not true',
  "step_payload ->> 'dayId' !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$'",
  "step_payload ->> 'sortOrder' !~ '^[0-9]{1,16}$'",
  "pg_catalog.jsonb_typeof(step_payload -> 'ticketIds') is distinct from 'array'",
  "pg_catalog.count(distinct item_ticket.value #>> '{}')",
  'pg_catalog.count(*) <= 20000',
  'coalesce(pg_catalog.max(depth), 0) <= 32',
  'tripmap_private.account_mutation_receipts',
  'pg_catalog.pg_advisory_xact_lock',
  'pg_catalog.pg_advisory_xact_lock_shared',
  "':trip-lifecycle:'",
  "':ledger:'",
  "':item-day:'",
  'structural_item_count <> step_count',
  'moved_item_count <> 1',
  'pg_catalog.cardinality(structural_day_ids)',
  "current_user_id::text || ':ticket-binding:' || ticket_object_id",
  'ticket_current_item_id is not null and not exists',
  "ticket_current_payload - array['itemId', 'scope', 'sharedVisibility', 'ticketCategory', 'title', 'updatedAt']::text[]",
  "bound_item.payload -> 'ticketIds' ? ticket_object_id",
  "(requested_item.value -> 'payload' -> 'ticketIds') - ticket_object_id",
  "current_item.payload - array['ticketIds', 'updatedAt']::text[]",
  "select distinct requested_step.value ->> 'mutationId'",
  'order by value ->> \'objectType\', value ->> \'objectId\'',
  'insert into tripmap_private.account_workflow_receipts',
  'insert into tripmap_private.account_mutation_receipts',
  'update public.tripmap_account_objects',
  'insert into public.tripmap_account_objects',
  "target_workflow_id = 'trip.repair.apply@1'",
  "or step_operation <> 'upsert'",
  "step_object_type = 'ledger_settings' and step_operation = 'delete'",
  "current_expense.object_type = 'ledger_expense'",
  "step_payload -> 'createdAt' is distinct from current_object.payload -> 'createdAt'",
  "record_step.value -> 'payload' -> 'accountObjectBaseline'",
  "step_payload - 'updatedAt'",
  "'previousTransportDurationMinutes', 'previousTransportMode'",
]

export function validateAccountCloudWorkflowMigration({ contractSource, migrationSql }) {
  const normalizedSql = normalize(migrationSql)
  for (const fragment of REQUIRED_FRAGMENTS) {
    if (!normalizedSql.includes(normalize(fragment))) {
      throw new Error(`Account workflow migration is missing required contract fragment: ${fragment}`)
    }
  }

  const contractWorkflowIds = extractQuotedList(
    contractSource,
    /account_workflow_ids\s*=\s*\[([\s\S]*?)\]\s*as\s+const/i,
    'TypeScript workflow registry',
  )
  const tableWorkflowIds = extractQuotedList(
    migrationSql,
    /workflow_id\s+text\s+not\s+null\s+check\s*\(workflow_id\s+in\s*\(([\s\S]*?)\)\s*\),\s*trip_id/i,
    'workflow receipt constraint',
  )
  const rpcWorkflowIds = extractQuotedList(
    migrationSql,
    /if\s+target_workflow_id\s+is\s+null\s+or\s+target_workflow_id\s+not\s+in\s*\(([\s\S]*?)\)\s+then/i,
    'workflow RPC registry',
  )
  assertSameSet(contractWorkflowIds, tableWorkflowIds, 'workflow receipt IDs')
  assertSameSet(contractWorkflowIds, rpcWorkflowIds, 'workflow RPC IDs')

  const ticketFields = extractQuotedList(
    contractSource,
    /ticket_meta_payload_fields\s*=\s*new\s+set\s*\(\s*\[([\s\S]*?)\]\s*\)/i,
    'TypeScript Ticket metadata fields',
  )
  const sqlTicketFields = extractQuotedList(
    migrationSql,
    /step_object_type\s*=\s*'ticket_meta'[\s\S]*?ticket_field\.field_name\s+not\s+in\s*\(([\s\S]*?)\)\s*\)\s*then/i,
    'workflow SQL Ticket metadata fields',
  )
  assertSameSet(ticketFields, sqlTicketFields, 'workflow Ticket metadata fields')

  const publicFunction = extractFunctionBody(migrationSql, 'public.account_apply_workflow_v1')
  if (!/security\s+invoker/i.test(publicFunction) || /security\s+definer/i.test(publicFunction)) {
    throw new Error('The exposed account workflow RPC must be a security-invoker wrapper.')
  }
  const privateFunction = extractFunctionBody(migrationSql, 'tripmap_private.account_apply_workflow_v1')
  if (!/security\s+definer/i.test(privateFunction) || !/current_user_id\s*:=\s*auth\.uid\(\)/i.test(privateFunction)) {
    throw new Error('The private workflow RPC must authenticate inside its security-definer body.')
  }
  const signature = privateFunction.slice(0, privateFunction.indexOf('returns jsonb')).toLowerCase()
  if (/owner_id|actor_id|function_name|table_name|route|sql/.test(signature)) {
    throw new Error('The workflow RPC must not accept identity or executable targets from the client.')
  }
  if (/\bexecute\b/i.test(privateFunction)) {
    throw new Error('The workflow RPC must not use dynamic SQL execution.')
  }
  if (!/target_account_hash\s*<>\s*pg_catalog\.left\s*\([\s\S]{0,260}current_user_id::text/i.test(privateFunction)) {
    throw new Error('The workflow RPC is missing the authenticated account-context guard.')
  }
  const importShapeFunction = extractFunctionBody(
    migrationSql,
    'tripmap_private.account_import_workflow_shape_is_valid',
  )
  if (
    !/security\s+invoker/i.test(importShapeFunction)
    || /security\s+definer/i.test(importShapeFunction)
    || !/expected_revision\s*<>\s*0/i.test(importShapeFunction)
    || !/object_type\s*=\s*'trip'/i.test(importShapeFunction)
    || !/object_type\s*=\s*'day'/i.test(importShapeFunction)
    || !/object_type\s*=\s*'ticket_meta'/i.test(importShapeFunction)
    || !/object_type\s*=\s*'ledger_expense'/i.test(importShapeFunction)
  ) {
    throw new Error('The import workflow must validate one closed create-only graph.')
  }
  if (!/target_workflow_id\s+in\s*\(\s*'trip\.import\.commit@1'\s*,\s*'trip\.replan\.apply@1'\s*\)\s+then[\s\S]{0,260}pg_advisory_xact_lock\s*\([\s\S]{0,180}:trip-lifecycle:[\s\S]{0,220}else[\s\S]{0,180}pg_advisory_xact_lock_shared/i.test(privateFunction)) {
    throw new Error('Import and adaptive replan must exclusively lock the trip lifecycle before ordinary workflow locks.')
  }
  const ledgerGraphFunction = extractFunctionBody(
    migrationSql,
    'tripmap_private.account_ledger_workflow_graph_is_valid',
  )
  if (
    !/security\s+invoker/i.test(ledgerGraphFunction)
    || /security\s+definer/i.test(ledgerGraphFunction)
    || !/prospective_expenses/i.test(ledgerGraphFunction)
    || !/account_ledger_payload_is_valid/i.test(ledgerGraphFunction)
    || !/object_type\s*=\s*'trip'/i.test(ledgerGraphFunction)
    || !/object_type\s*=\s*'ticket_meta'/i.test(ledgerGraphFunction)
    || !/revoke\s+all\s+on\s+function\s+tripmap_private\.account_ledger_workflow_graph_is_valid\s*\(\s*uuid\s*,\s*text\s*,\s*jsonb\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i.test(migrationSql)
  ) {
    throw new Error('The ledger workflow graph validator must remain complete and private.')
  }
  const adaptivePayloadFunction = extractFunctionBody(
    migrationSql,
    'tripmap_private.account_adaptive_replan_payload_is_valid',
  )
  const adaptiveShapeFunction = extractFunctionBody(
    migrationSql,
    'tripmap_private.account_adaptive_replan_workflow_shape_is_valid',
  )
  const adaptiveBaselineFunction = extractFunctionBody(
    migrationSql,
    'tripmap_private.account_adaptive_replan_baseline_matches',
  )
  if (
    !/security\s+invoker/i.test(adaptivePayloadFunction)
    || /security\s+definer/i.test(adaptivePayloadFunction)
    || !/accountobjectbaseline/i.test(adaptivePayloadFunction)
    || !/account_adaptive_replan_option_is_valid/i.test(adaptivePayloadFunction)
    || !/expectedrevision/i.test(adaptivePayloadFunction)
    || !/revoke\s+all\s+on\s+function\s+tripmap_private\.account_adaptive_replan_payload_is_valid\s*\(\s*text\s*,\s*jsonb\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i.test(migrationSql)
  ) {
    throw new Error('The adaptive replan payload validator must remain strict and private.')
  }
  if (
    !/security\s+invoker/i.test(adaptiveShapeFunction)
    || /security\s+definer/i.test(adaptiveShapeFunction)
    || !/item_count\s*\+\s*4/i.test(adaptiveShapeFunction)
    || !/account_adaptive_replan_payload_is_valid/i.test(adaptiveShapeFunction)
    || !/scopeitemids/i.test(adaptiveShapeFunction)
    || !/aftersnapshot/i.test(adaptiveShapeFunction)
    || !/itempatches/i.test(adaptiveShapeFunction)
    || !/beforesnapshot/i.test(adaptiveShapeFunction)
    || !/selected_option\s*->\s*'itemPatches'[\s\S]{0,120}item_count/i.test(adaptiveShapeFunction)
    || !/snapshot_item\.value\s*\|\|\s*\(patch\.value\s*->\s*'patch'\)[\s\S]{0,700}item_step\.value\s*->\s*'payload'/i.test(adaptiveShapeFunction)
    || !/revoke\s+all\s+on\s+function\s+tripmap_private\.account_adaptive_replan_workflow_shape_is_valid\s*\(\s*text\s*,\s*jsonb\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i.test(migrationSql)
  ) {
    throw new Error('The adaptive replan workflow shape validator must remain complete and private.')
  }
  if (
    !/security\s+invoker/i.test(adaptiveBaselineFunction)
    || /security\s+definer/i.test(adaptiveBaselineFunction)
    || !/object_type\s+in\s*\(\s*'trip'\s*,\s*'day'\s*,\s*'item'\s*,\s*'ticket_meta'\s*,\s*'ledger_expense'\s*\)/i.test(adaptiveBaselineFunction)
    || (
      adaptiveBaselineFunction.match(/current_object\.object_type\s+in\s*\(\s*'trip'\s*,\s*'day'\s*,\s*'item'\s*,\s*'ticket_meta'\s*,\s*'ledger_expense'\s*\)/gi)
        ?? []
    ).length < 2
    || !/current_object\.revision\s*<>\s*\(expected\.value\s*->>\s*'expectedRevision'\)::bigint/i.test(adaptiveBaselineFunction)
    || !/not\s+current_object\.tombstone/i.test(adaptiveBaselineFunction)
    || !/current_object\.payload\s+is\s+distinct\s+from\s+snapshot\.value/i.test(adaptiveBaselineFunction)
    || !/revoke\s+all\s+on\s+function\s+tripmap_private\.account_adaptive_replan_baseline_matches\s*\(\s*uuid\s*,\s*text\s*,\s*jsonb\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i.test(migrationSql)
  ) {
    throw new Error('The adaptive replan baseline validator must cover the complete active dependency graph and remain private.')
  }
  const normalizedPrivateFunction = privateFunction.toLowerCase()
  const tripLifecycleLockMarker = normalizedPrivateFunction.indexOf(':trip-lifecycle:')
  const ledgerLockMarker = normalizedPrivateFunction.indexOf(':ledger:')
  const objectLockMarker = normalizedPrivateFunction.indexOf('-- match the single-object rpc lock order')
  const structuralDayLockMarker = normalizedPrivateFunction.indexOf(
    '-- lock every affected itinerary day after object locks and before mutation locks',
  )
  const mutationLockMarker = normalizedPrivateFunction.indexOf(
    '-- lock each step mutation identity only after every structural day lock',
  )
  if (
    !/step_operation\s*=\s*'upsert'\s+and\s+step_object_type\s*=\s*'item'[\s\S]{0,260}jsonb_typeof\s*\(step_payload\s*->\s*'sortOrder'\)\s+is\s+distinct\s+from\s+'number'[\s\S]{0,180}step_payload\s*->>\s*'sortOrder'\s*!~\s*'\^\[0-9\]\{1,16\}\$'[\s\S]{0,180}jsonb_typeof\s*\(step_payload\s*->\s*'ticketIds'\)\s+is\s+distinct\s+from\s+'array'/i
      .test(privateFunction)
    ||
    tripLifecycleLockMarker < 0
    || ledgerLockMarker <= tripLifecycleLockMarker
    || objectLockMarker <= ledgerLockMarker
    || objectLockMarker <= tripLifecycleLockMarker
    || structuralDayLockMarker <= objectLockMarker
    || mutationLockMarker <= structuralDayLockMarker
    || !/structural_item_count\s*<>\s*step_count/i.test(privateFunction)
    || !/moved_item_count\s*<>\s*1/i.test(privateFunction)
  ) {
    throw new Error('Structural workflows must lock affected days and validate the complete item graph before writes.')
  }

  const preflightMarker = normalizedPrivateFunction.indexOf('-- preflight every current revision')
  const commitMarker = normalizedPrivateFunction.indexOf('-- no ordinary rejection path exists below this point')
  const lockOrderMarker = objectLockMarker
  const receiptLookup = normalizedPrivateFunction.indexOf('into prior_receipt')
  const adaptiveBaselineCheck = normalizedPrivateFunction.indexOf(
    'tripmap_private.account_adaptive_replan_baseline_matches',
  )
  const firstObjectUpdate = normalizedPrivateFunction.indexOf('update public.tripmap_account_objects')
  const firstObjectInsert = normalizedPrivateFunction.indexOf('insert into public.tripmap_account_objects')
  if (
    preflightMarker < 0
    || commitMarker <= preflightMarker
    || lockOrderMarker < 0
    || receiptLookup <= lockOrderMarker
    || adaptiveBaselineCheck <= receiptLookup
    || preflightMarker <= adaptiveBaselineCheck
    || preflightMarker <= receiptLookup
    || firstObjectUpdate <= commitMarker
    || firstObjectInsert <= commitMarker
  ) {
    throw new Error('The workflow RPC must complete preflight before the first object write.')
  }
  const beforeCommit = privateFunction.slice(0, commitMarker)
  if (/\b(?:update|insert\s+into|delete\s+from)\s+(?:public\.tripmap_account_objects|tripmap_private\.account_mutation_receipts)/i.test(beforeCommit)) {
    throw new Error('The workflow RPC writes objects or mutation receipts before preflight completes.')
  }

  if (/grant\s+(?:[^;]*\b(?:insert|update|delete|all)\b[^;]*)\s+on\s+table\s+public\.tripmap_account_objects\s+to\s+authenticated/i.test(migrationSql)) {
    throw new Error('Authenticated clients must not receive direct account-object write grants.')
  }
  if (/grant\s+[^;]+on\s+table\s+tripmap_private\.account_workflow_receipts\s+to\s+(?:authenticated|anon)/i.test(migrationSql)) {
    throw new Error('Workflow receipts must remain inaccessible to browser roles.')
  }
  if (!/revoke\s+all\s+on\s+function\s+tripmap_private\.account_payload_shape_is_safe\s*\(\s*jsonb\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i.test(migrationSql)) {
    throw new Error('The workflow payload-shape helper must remain inaccessible to browser roles.')
  }
  if (!/revoke\s+all\s+on\s+function\s+tripmap_private\.account_workflow_payload_is_safe\s*\(\s*jsonb\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i.test(migrationSql)) {
    throw new Error('The workflow payload-boundary helper must remain inaccessible to browser roles.')
  }
  if (!/revoke\s+all\s+on\s+function\s+tripmap_private\.account_import_workflow_shape_is_valid\s*\(\s*text\s*,\s*jsonb\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i.test(migrationSql)) {
    throw new Error('The import graph validator must remain inaccessible to browser roles.')
  }
  if (!/target_workflow_id\s*=\s*'trip\.import\.commit@1'\s+and\s+exists\s*\([\s\S]{0,260}prior_trip_object\.trip_id\s*=\s*target_trip_id/i.test(privateFunction)) {
    throw new Error('The import workflow must reject a non-empty trip scope under its lifecycle lock.')
  }
  if (
    !/target_workflow_id\s*=\s*'trip\.replan\.apply@1'\s+and\s+step_operation\s*=\s*'upsert'\s+and\s+tripmap_private\.account_adaptive_replan_payload_is_valid[\s\S]{0,140}is\s+not\s+true/i.test(privateFunction)
    || !/tripmap_private\.account_adaptive_replan_workflow_shape_is_valid[\s\S]{0,140}is\s+not\s+true/i.test(privateFunction)
    || !/tripmap_private\.account_adaptive_replan_baseline_matches[\s\S]{0,180}is\s+not\s+true/i.test(privateFunction)
    || !/record_step\.value\s*->\s*'payload'\s*->\s*'accountObjectBaseline'/i.test(privateFunction)
    || !/target_workflow_id\s*=\s*'trip\.replan\.apply@1'[\s\S]{0,260}step_payload\s*-\s*'updatedAt'[\s\S]{0,400}current_object\.payload\s*-\s*'updatedAt'/i.test(privateFunction)
    || !/target_workflow_id\s*=\s*'trip\.replan\.apply@1'[\s\S]{0,900}previousTransportDurationMinutes[\s\S]{0,900}current_object\.payload/i.test(privateFunction)
  ) {
    throw new Error('Adaptive replan must lock its dependency baseline and restrict Trip/Item mutations.')
  }

  const rpcSignature = String.raw`integer\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*jsonb`
  if (!new RegExp(
    String.raw`comment\s+on\s+function\s+public\.account_apply_workflow_v1\s*\(\s*${rpcSignature}\s*\)\s+is`,
    'i',
  ).test(migrationSql)) {
    throw new Error('Workflow RPC comment must reference the exact seven-argument signature.')
  }

  return {
    atomicPreflight: true,
    adaptiveReplanGraphAtomicity: true,
    boundedPayloadTraversal: true,
    deterministicReplayLocks: true,
    importGraphAtomicity: true,
    ledgerGraphAtomicity: true,
    privateReceiptLedger: true,
    structuralGraphLocking: true,
    ticketBindingCompleteness: true,
    workflowCount: contractWorkflowIds.length,
  }
}

function extractFunctionBody(sql, qualifiedName) {
  const escaped = qualifiedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = sql.match(new RegExp(`create\\s+or\\s+replace\\s+function\\s+${escaped}\\s*\\(([\\s\\S]*?)\\$\\$\\s*;`, 'i'))
  if (!match) throw new Error(`Missing function ${qualifiedName}.`)
  return match[0]
}

function extractQuotedList(source, pattern, label) {
  const match = source.match(pattern)
  if (!match) throw new Error(`Could not read ${label}.`)
  const values = [...match[1].matchAll(/['"]([a-z0-9_.@-]+)['"]/gi)].map((entry) => entry[1])
  if (values.length === 0 || new Set(values).size !== values.length) {
    throw new Error(`${label} is empty or contains duplicates.`)
  }
  return values
}

function assertSameSet(expected, actual, label) {
  const expectedSorted = [...expected].sort()
  const actualSorted = [...actual].sort()
  if (JSON.stringify(expectedSorted) !== JSON.stringify(actualSorted)) {
    throw new Error(`${label} do not match the TypeScript registry.`)
  }
}

function normalize(value) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}
