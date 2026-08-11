const REQUIRED_FRAGMENTS = [
  'create table if not exists public.tripmap_account_objects',
  'create table if not exists tripmap_private.account_mutation_receipts',
  'revision bigint not null',
  'mutation_id text not null',
  'actor_id uuid not null',
  'schema_version smallint not null',
  'tombstone boolean not null',
  'alter table public.tripmap_account_objects replica identity full',
  'alter table public.tripmap_account_objects enable row level security',
  'alter table public.tripmap_account_objects force row level security',
  'alter table tripmap_private.account_mutation_receipts enable row level security',
  'alter table tripmap_private.account_mutation_receipts force row level security',
  'using ((select auth.uid()) = owner_id)',
  'grant select on table public.tripmap_account_objects to authenticated',
  'security definer',
  "set search_path = ''",
  'current_user_id := auth.uid()',
  'target_account_hash',
  "'account_context_mismatch'",
  'target_expected_revision',
  "'mutation_id_reused'",
  "'revision_mismatch'",
  "'server_managed_object'",
  'account_payload_has_forbidden_key',
  'pg_advisory_xact_lock',
  'account_mutation_receipts',
  'alter publication supabase_realtime add table public.tripmap_account_objects',
  'from public.cloud_sync_objects as legacy',
  "when legacy.object_type = 'ticket_meta' then pg_catalog.jsonb_strip_nulls",
  'on conflict (owner_id, object_type, object_id) do nothing',
]

export function validateAccountCloudMigration({ migrationSql, contractSource }) {
  const normalizedSql = normalize(migrationSql)
  for (const fragment of REQUIRED_FRAGMENTS) {
    if (!normalizedSql.includes(normalize(fragment))) {
      throw new Error(`Account-cloud migration is missing required contract fragment: ${fragment}`)
    }
  }

  const contractTypes = extractQuotedList(
    contractSource,
    /account_object_types\s*=\s*\[([\s\S]*?)\]\s*as\s+const/i,
    'TypeScript account object registry',
  )
  const tableTypes = extractQuotedList(
    migrationSql,
    /object_type\s+text\s+not\s+null[\s\S]*?check\s*\(object_type\s+in\s*\(([\s\S]*?)\)\s*\),\s*object_id/i,
    'account-object table constraint',
  )
  const rpcTypes = extractQuotedList(
    migrationSql,
    /if\s+target_object_type\s+is\s+null\s+or\s+target_object_type\s+not\s+in\s*\(([\s\S]*?)\)\s+then/i,
    'mutation RPC registry',
  )
  assertSameSet(contractTypes, tableTypes, 'table object types')
  assertSameSet(contractTypes, rpcTypes, 'RPC object types')
  const ticketFields = extractQuotedList(
    contractSource,
    /ticket_meta_payload_fields\s*=\s*new\s+set\s*\(\s*\[([\s\S]*?)\]\s*\)/i,
    'TypeScript Ticket metadata fields',
  )
  const sqlTicketFields = extractQuotedList(
    migrationSql,
    /target_object_type\s*=\s*'ticket_meta'[\s\S]*?ticket_field\.field_name\s+not\s+in\s*\(([\s\S]*?)\)\s*\)\s*then/i,
    'SQL Ticket metadata fields',
  )
  assertSameSet(ticketFields, sqlTicketFields, 'Ticket metadata fields')

  if (countMatches(normalizedSql, /pg_catalog\.pg_advisory_xact_lock/g) < 2) {
    throw new Error('Account-cloud RPC must serialize both object identity and mutation identity.')
  }
  if (!/current_revision\s*<>\s*target_expected_revision/i.test(migrationSql)) {
    throw new Error('Account-cloud RPC is missing the expected-revision guard.')
  }
  if (!/prior_receipt\.request_hash\s*<>\s*request_hash/i.test(migrationSql)) {
    throw new Error('Account-cloud RPC is missing mutation-content replay validation.')
  }
  if (!/target_account_hash\s*<>\s*pg_catalog\.left\s*\([\s\S]{0,260}current_user_id::text/i.test(migrationSql)) {
    throw new Error('Account-cloud RPC is missing the authenticated account-context guard.')
  }
  const currentRpcSignature = String.raw`integer\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*bigint\s*,\s*integer\s*,\s*text\s*,\s*jsonb`
  const supersededRpcSignature = String.raw`integer\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*bigint\s*,\s*integer\s*,\s*text\s*,\s*jsonb`
  if (!new RegExp(
    String.raw`comment\s+on\s+function\s+public\.account_apply_object_mutation_v1\s*\(\s*${currentRpcSignature}\s*\)\s+is`,
    'i',
  ).test(migrationSql)) {
    throw new Error('Account-cloud RPC comment must reference the current 11-argument signature.')
  }
  if (!new RegExp(
    String.raw`drop\s+function\s+if\s+exists\s+public\.account_apply_object_mutation_v1\s*\(\s*${supersededRpcSignature}\s*\)`,
    'i',
  ).test(migrationSql)) {
    throw new Error('Account-cloud migration must remove the superseded public RPC overload.')
  }
  if (!new RegExp(
    String.raw`drop\s+function\s+if\s+exists\s+tripmap_private\.account_apply_object_mutation_v1\s*\(\s*${supersededRpcSignature}\s*\)`,
    'i',
  ).test(migrationSql)) {
    throw new Error('Account-cloud migration must remove the superseded private RPC overload.')
  }

  const publicFunction = extractFunctionBody(
    migrationSql,
    'public.account_apply_object_mutation_v1',
  )
  if (!/security\s+invoker/i.test(publicFunction) || /security\s+definer/i.test(publicFunction)) {
    throw new Error('The exposed account-cloud RPC must be a security-invoker wrapper.')
  }
  const privateFunction = extractFunctionBody(
    migrationSql,
    'tripmap_private.account_apply_object_mutation_v1',
  )
  if (!/security\s+definer/i.test(privateFunction) || !/current_user_id\s*:=\s*auth\.uid\(\)/i.test(privateFunction)) {
    throw new Error('The private account-cloud RPC must authenticate inside its security-definer body.')
  }
  const signature = privateFunction.slice(0, privateFunction.indexOf('returns jsonb')).toLowerCase()
  if (/owner_id|actor_id/.test(signature)) {
    throw new Error('The account-cloud RPC must not accept owner or actor IDs from the client.')
  }

  if (/grant\s+(?:[^;]*\b(?:insert|update|delete|all)\b[^;]*)\s+on\s+table\s+public\.tripmap_account_objects\s+to\s+authenticated/i.test(migrationSql)) {
    throw new Error('Authenticated clients must not receive direct account-object write grants.')
  }
  if (/create\s+policy[\s\S]{0,180}on\s+public\.tripmap_account_objects[\s\S]{0,100}for\s+(?:insert|update|delete)/i.test(migrationSql)) {
    throw new Error('Authenticated clients must not receive direct account-object write policies.')
  }
  if (/grant\s+[^;]+on\s+table\s+tripmap_private\.account_mutation_receipts\s+to\s+(?:authenticated|anon)/i.test(migrationSql)) {
    throw new Error('Mutation receipts must remain inaccessible to browser roles.')
  }

  const legacyWrite = /(?:update\s+public\.cloud_sync_objects|delete\s+from\s+public\.cloud_sync_objects|truncate\s+(?:table\s+)?public\.cloud_sync_objects)/i
  if (legacyWrite.test(migrationSql)) {
    throw new Error('The additive backfill must not modify legacy cloud-sync rows.')
  }

  return {
    objectTypeCount: contractTypes.length,
    receiptLedger: true,
    realtimePublished: true,
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
  const values = [...match[1].matchAll(/['"]([a-z0-9_]+)['"]/gi)].map((entry) => entry[1])
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

function countMatches(value, pattern) {
  return [...value.matchAll(pattern)].length
}
