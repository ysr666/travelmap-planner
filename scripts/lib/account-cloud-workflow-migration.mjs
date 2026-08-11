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
  'create or replace function tripmap_private.account_payload_shape_is_safe',
  'create or replace function tripmap_private.account_workflow_payload_is_safe',
  'not tripmap_private.account_workflow_payload_is_safe(step_payload)',
  'pg_catalog.count(*) <= 20000',
  'coalesce(pg_catalog.max(depth), 0) <= 32',
  'tripmap_private.account_mutation_receipts',
  'pg_catalog.pg_advisory_xact_lock',
  "current_user_id::text || ':ticket-binding:' || ticket_object_id",
  'ticket_current_item_id is not null and not exists',
  "bound_item.payload -> 'ticketIds' ? ticket_object_id",
  "select distinct requested_step.value ->> 'mutationId'",
  'order by value ->> \'objectType\', value ->> \'objectId\'',
  'insert into tripmap_private.account_workflow_receipts',
  'insert into tripmap_private.account_mutation_receipts',
  'update public.tripmap_account_objects',
  'insert into public.tripmap_account_objects',
  "target_workflow_id = 'trip.repair.apply@1'",
  "or step_operation <> 'upsert'",
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

  const preflightMarker = privateFunction.toLowerCase().indexOf('-- preflight every current revision')
  const commitMarker = privateFunction.toLowerCase().indexOf('-- no ordinary rejection path exists below this point')
  const lockOrderMarker = privateFunction.toLowerCase().indexOf('-- match the single-object rpc lock order')
  const receiptLookup = privateFunction.toLowerCase().indexOf('into prior_receipt')
  const firstObjectUpdate = privateFunction.toLowerCase().indexOf('update public.tripmap_account_objects')
  const firstObjectInsert = privateFunction.toLowerCase().indexOf('insert into public.tripmap_account_objects')
  if (
    preflightMarker < 0
    || commitMarker <= preflightMarker
    || lockOrderMarker < 0
    || receiptLookup <= lockOrderMarker
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

  const rpcSignature = String.raw`integer\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*jsonb`
  if (!new RegExp(
    String.raw`comment\s+on\s+function\s+public\.account_apply_workflow_v1\s*\(\s*${rpcSignature}\s*\)\s+is`,
    'i',
  ).test(migrationSql)) {
    throw new Error('Workflow RPC comment must reference the exact seven-argument signature.')
  }

  return {
    atomicPreflight: true,
    boundedPayloadTraversal: true,
    deterministicReplayLocks: true,
    privateReceiptLedger: true,
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
