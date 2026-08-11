import type { Table } from 'dexie'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getActiveTravelDatabase,
  type TravelConsoleDatabase,
} from '../../db/database'
import type { SyncObjectType } from '../../types'
import { buildAccountTravelDatabaseName } from '../accountDatabase'
import { getActiveAccountHash } from '../accountStorageScope'
import {
  ACCOUNT_OBJECT_DEFINITIONS,
  parseAccountObjectMutationV1,
  parseAccountObjectRowV1,
  type AccountObjectRowV1,
  type ClientMutableAccountObjectType,
  type JsonObject,
} from './contract'
import {
  buildAccountObjectKey,
  buildAccountObjectRevisionRecord,
} from './localStore'
import type { AccountObjectRevisionRecord } from './localTypes'
import { redactTicketMetaForAccountCloud } from './mutationBuilder'
import { readStableAccountTripObjectsV1 } from './reader'

export const LEGACY_ACCOUNT_OBJECT_TYPES = [
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
  'trip_intelligence_suggestion_state',
] as const satisfies readonly SyncObjectType[]

type LegacyAccountObjectType = typeof LEGACY_ACCOUNT_OBJECT_TYPES[number]

export type LocalAccountObjectV1 = {
  objectId: string
  objectType: LegacyAccountObjectType
  payload: JsonObject
  tripId: string
}

export type AccountCloudBootstrapStatus =
  | 'exact_match'
  | 'local_only'
  | 'payload_drift'
  | 'pending_mutation'
  | 'remote_only'
  | 'schema_unsupported'
  | 'tombstone_drift'
  | 'tombstone_match'
  | 'unsupported_remote'

export type AccountCloudBootstrapEntryV1 = {
  objectId: string
  objectKey: string
  objectType: string
  remoteRevision?: number
  status: AccountCloudBootstrapStatus
}

export type AccountCloudBootstrapPlanV1 = {
  schemaVersion: 1
  tripId: string
  remoteSnapshotFingerprint: string
  remoteRows: AccountObjectRowV1[]
  entries: AccountCloudBootstrapEntryV1[]
  summary: Record<AccountCloudBootstrapStatus, number>
}

export type AccountCloudBootstrapSkipReason =
  | 'existing_revision_conflict'
  | 'local_state_changed'
  | 'pending_mutation'
  | 'schema_unsupported'
  | 'unsupported_type'

export type AccountCloudBootstrapPersistResult = {
  idempotentObjectKeys: string[]
  seededObjectKeys: string[]
  skipped: Array<{ objectKey: string; reason: AccountCloudBootstrapSkipReason }>
}

export class AccountCloudBootstrapError extends Error {
  readonly code:
    | 'account_context_mismatch'
    | 'duplicate_object'
    | 'invalid_plan'
    | 'invalid_trip'

  constructor(code: AccountCloudBootstrapError['code']) {
    super(code)
    this.name = 'AccountCloudBootstrapError'
    this.code = code
  }
}

const LEGACY_TYPE_SET = new Set<string>(LEGACY_ACCOUNT_OBJECT_TYPES)
const MAX_BOOTSTRAP_OBJECTS = 20_000

export async function readLocalAccountObjectsForTripV1(
  tripId: string,
  database: TravelConsoleDatabase = getActiveTravelDatabase(),
): Promise<LocalAccountObjectV1[]> {
  const [
    trip,
    days,
    items,
    tickets,
    ledgerSettings,
    ledgerParticipants,
    ledgerBudgets,
    ledgerExpenses,
    replanEvents,
    replanRecords,
    intelligenceChanges,
    suggestionStates,
  ] = await Promise.all([
    database.trips.get(tripId),
    database.days.where('tripId').equals(tripId).toArray(),
    database.itineraryItems.where('tripId').equals(tripId).toArray(),
    database.ticketMetas.where('tripId').equals(tripId).toArray(),
    database.ledgerSettings.where('tripId').equals(tripId).toArray(),
    database.ledgerParticipants.where('tripId').equals(tripId).toArray(),
    database.ledgerBudgets.where('tripId').equals(tripId).toArray(),
    database.ledgerExpenses.where('tripId').equals(tripId).toArray(),
    database.tripReplanEvents.where('tripId').equals(tripId).toArray(),
    database.tripReplanRecords.where('tripId').equals(tripId).toArray(),
    database.tripIntelligenceAppliedChanges.where('tripId').equals(tripId).toArray(),
    database.tripIntelligenceSuggestionStates.where('tripId').equals(tripId).toArray(),
  ])

  return [
    ...(trip ? [toLocalObject('trip', tripId, trip)] : []),
    ...days.map((value) => toLocalObject('day', tripId, value)),
    ...items.map((value) => toLocalObject('item', tripId, value)),
    ...tickets.map((value) => toLocalObject('ticket_meta', tripId, redactTicketMetaForAccountCloud(value))),
    ...ledgerSettings.map((value) => toLocalObject('ledger_settings', tripId, value)),
    ...ledgerParticipants.map((value) => toLocalObject('ledger_participant', tripId, value)),
    ...ledgerBudgets.map((value) => toLocalObject('ledger_budget', tripId, value)),
    ...ledgerExpenses.map((value) => toLocalObject('ledger_expense', tripId, value)),
    ...replanEvents.map((value) => toLocalObject('replan_event', tripId, value)),
    ...replanRecords.map((value) => toLocalObject('replan_record', tripId, value)),
    ...intelligenceChanges.map((value) => toLocalObject('trip_intelligence_applied_change', tripId, value)),
    ...suggestionStates.map((value) => toLocalObject('trip_intelligence_suggestion_state', tripId, value)),
  ].sort((left, right) => buildLocalObjectKey(left).localeCompare(buildLocalObjectKey(right)))
}

export async function readPendingAccountObjectKeysForTripV1(
  tripId: string,
  database: TravelConsoleDatabase = getActiveTravelDatabase(),
) {
  const [legacyEntries, v2Entries] = await Promise.all([
    database.syncOutbox.where('tripId').equals(tripId).toArray(),
    database.accountMutationJournal.where('tripId').equals(tripId).toArray(),
  ])
  return new Set([
    ...legacyEntries.map((entry) => entry.objectKey),
    ...v2Entries.map((entry) => entry.objectKey),
  ])
}

export async function prepareAccountCloudBootstrapPlanV1({
  accountHash,
  database = getActiveTravelDatabase(),
  remoteRows,
  tripId,
}: {
  accountHash: string
  database?: TravelConsoleDatabase
  remoteRows: AccountObjectRowV1[]
  tripId: string
}) {
  assertBootstrapAccountContext(accountHash, database)
  const [localObjects, pendingObjectKeys] = await Promise.all([
    readLocalAccountObjectsForTripV1(tripId, database),
    readPendingAccountObjectKeysForTripV1(tripId, database),
  ])
  assertBootstrapAccountContext(accountHash, database)
  return buildAccountCloudBootstrapPlanV1({
    localObjects,
    pendingObjectKeys,
    remoteRows,
    tripId,
  })
}

export async function readAndPrepareAccountCloudBootstrapPlanV1({
  accountHash,
  client,
  database = getActiveTravelDatabase(),
  tripId,
}: {
  accountHash: string
  client?: SupabaseClient
  database?: TravelConsoleDatabase
  tripId: string
}) {
  assertBootstrapAccountContext(accountHash, database)
  const remoteRows = await readStableAccountTripObjectsV1(tripId, {
    client,
    expectedAccountHash: accountHash,
  })
  assertBootstrapAccountContext(accountHash, database)
  return prepareAccountCloudBootstrapPlanV1({
    accountHash,
    database,
    remoteRows,
    tripId,
  })
}

export function buildAccountCloudBootstrapPlanV1({
  localObjects,
  pendingObjectKeys = new Set<string>(),
  remoteRows,
  tripId,
}: {
  localObjects: LocalAccountObjectV1[]
  pendingObjectKeys?: ReadonlySet<string>
  remoteRows: AccountObjectRowV1[]
  tripId: string
}): AccountCloudBootstrapPlanV1 {
  const localByKey = validateLocalObjects(localObjects, tripId)
  const normalizedRemoteRows = validateRemoteRows(remoteRows, tripId)
  const remoteByKey = new Map(normalizedRemoteRows.map((row) => [buildRemoteObjectKey(row), row]))
  const entries: AccountCloudBootstrapEntryV1[] = []

  for (const row of normalizedRemoteRows) {
    const objectKey = buildRemoteObjectKey(row)
    const local = localByKey.get(objectKey)
    let status: AccountCloudBootstrapStatus
    if (!isLegacyAccountObjectType(row.objectType)) {
      status = 'unsupported_remote'
    } else if (row.objectSchemaVersion !== 1) {
      status = 'schema_unsupported'
    } else if (pendingObjectKeys.has(objectKey)) {
      status = 'pending_mutation'
    } else if (row.tombstone) {
      status = local ? 'tombstone_drift' : 'tombstone_match'
    } else if (!local) {
      status = 'remote_only'
    } else {
      status = sameJson(local.payload, row.payload) ? 'exact_match' : 'payload_drift'
    }
    entries.push({
      objectId: row.objectId,
      objectKey,
      objectType: row.objectType,
      remoteRevision: row.revision,
      status,
    })
  }

  for (const [objectKey, local] of localByKey) {
    if (remoteByKey.has(objectKey)) continue
    entries.push({
      objectId: local.objectId,
      objectKey,
      objectType: local.objectType,
      status: pendingObjectKeys.has(objectKey) ? 'pending_mutation' : 'local_only',
    })
  }

  entries.sort((left, right) => left.objectKey.localeCompare(right.objectKey))
  return {
    entries,
    remoteRows: normalizedRemoteRows,
    remoteSnapshotFingerprint: fingerprintRemoteRows(normalizedRemoteRows),
    schemaVersion: 1,
    summary: summarizeEntries(entries),
    tripId,
  }
}

export async function persistAccountCloudBootstrapPlanV1(
  plan: AccountCloudBootstrapPlanV1,
  {
    accountHash,
    database = getActiveTravelDatabase(),
    now = Date.now(),
  }: {
    accountHash: string
    database?: TravelConsoleDatabase
    now?: number
  },
): Promise<AccountCloudBootstrapPersistResult> {
  assertBootstrapAccountContext(accountHash, database)
  if (
    plan.schemaVersion !== 1
    || plan.remoteSnapshotFingerprint !== fingerprintRemoteRows(validateRemoteRows(plan.remoteRows, plan.tripId))
  ) {
    throw new AccountCloudBootstrapError('invalid_plan')
  }

  const result: AccountCloudBootstrapPersistResult = {
    idempotentObjectKeys: [],
    seededObjectKeys: [],
    skipped: [],
  }
  const tables = accountBootstrapTransactionTables(database)

  await database.transaction('rw', tables, async () => {
    assertBootstrapAccountContext(accountHash, database)
    for (const row of plan.remoteRows) {
      const objectKey = buildRemoteObjectKey(row)
      if (!isLegacyAccountObjectType(row.objectType)) {
        result.skipped.push({ objectKey, reason: 'unsupported_type' })
        continue
      }
      if (row.objectSchemaVersion !== 1) {
        result.skipped.push({ objectKey, reason: 'schema_unsupported' })
        continue
      }
      const [legacyPending, v2Pending] = await Promise.all([
        database.syncOutbox.where('objectKey').equals(objectKey).count(),
        database.accountMutationJournal.where('objectKey').equals(objectKey).count(),
      ])
      if (legacyPending > 0 || v2Pending > 0) {
        result.skipped.push({ objectKey, reason: 'pending_mutation' })
        continue
      }

      const local = await readLocalAccountObject(row.objectType, row.objectId, row.tripId, database)
      const localMatches = row.tombstone ? local === undefined : Boolean(local && sameJson(local.payload, row.payload))
      if (!localMatches) {
        result.skipped.push({ objectKey, reason: 'local_state_changed' })
        continue
      }

      const existing = await database.accountObjectRevisions.get(objectKey)
      if (existing) {
        if (revisionRecordMatchesRow(existing, row)) {
          result.idempotentObjectKeys.push(objectKey)
          continue
        }
        if (
          existing.tripId !== row.tripId
          || existing.objectId !== row.objectId
          || existing.objectType !== row.objectType
          || existing.revision >= row.revision
        ) {
          result.skipped.push({ objectKey, reason: 'existing_revision_conflict' })
          continue
        }
      }

      assertBootstrapAccountContext(accountHash, database)
      await database.accountObjectRevisions.put(buildAccountObjectRevisionRecord(row, now))
      result.seededObjectKeys.push(objectKey)
    }
    assertBootstrapAccountContext(accountHash, database)
  })

  return result
}

function validateLocalObjects(localObjects: LocalAccountObjectV1[], tripId: string) {
  if (localObjects.length > MAX_BOOTSTRAP_OBJECTS) {
    throw new AccountCloudBootstrapError('invalid_plan')
  }
  const byKey = new Map<string, LocalAccountObjectV1>()
  for (const [index, local] of localObjects.entries()) {
    if (local.tripId !== tripId || !isLegacyAccountObjectType(local.objectType)) {
      throw new AccountCloudBootstrapError('invalid_trip')
    }
    const mutation = parseAccountObjectMutationV1({
      deviceId: 'bootstrap_validator',
      expectedRevision: 0,
      mutationId: `bootstrap_validation_${index}`,
      objectId: local.objectId,
      objectSchemaVersion: 1,
      objectType: local.objectType,
      operation: 'upsert',
      payload: local.payload,
      schemaVersion: 1,
      tripId,
    })
    const normalized: LocalAccountObjectV1 = {
      objectId: mutation.objectId,
      objectType: local.objectType,
      payload: mutation.payload as JsonObject,
      tripId,
    }
    const key = buildLocalObjectKey(normalized)
    if (byKey.has(key)) throw new AccountCloudBootstrapError('duplicate_object')
    byKey.set(key, normalized)
  }
  return byKey
}

function validateRemoteRows(remoteRows: AccountObjectRowV1[], tripId: string) {
  if (remoteRows.length > MAX_BOOTSTRAP_OBJECTS) {
    throw new AccountCloudBootstrapError('invalid_plan')
  }
  const normalized = remoteRows.map((row) => parseAccountObjectRowV1(row))
  const seen = new Set<string>()
  for (const row of normalized) {
    if (row.tripId !== tripId) throw new AccountCloudBootstrapError('invalid_trip')
    const key = buildRemoteObjectKey(row)
    if (seen.has(key)) throw new AccountCloudBootstrapError('duplicate_object')
    seen.add(key)
  }
  return normalized.sort((left, right) => buildRemoteObjectKey(left).localeCompare(buildRemoteObjectKey(right)))
}

async function readLocalAccountObject(
  objectType: LegacyAccountObjectType,
  objectId: string,
  tripId: string,
  database: TravelConsoleDatabase,
) {
  const value = await getLegacyObjectTable(objectType, database).get(objectId)
  if (!value) return undefined
  return toLocalObject(
    objectType,
    tripId,
    objectType === 'ticket_meta'
      ? redactTicketMetaForAccountCloud(value as Parameters<typeof redactTicketMetaForAccountCloud>[0])
      : value,
  )
}

function getLegacyObjectTable(
  objectType: LegacyAccountObjectType,
  database: TravelConsoleDatabase,
): Table<unknown, string> {
  switch (objectType) {
    case 'trip': return database.trips as Table<unknown, string>
    case 'day': return database.days as Table<unknown, string>
    case 'item': return database.itineraryItems as Table<unknown, string>
    case 'ticket_meta': return database.ticketMetas as Table<unknown, string>
    case 'ledger_settings': return database.ledgerSettings as Table<unknown, string>
    case 'ledger_participant': return database.ledgerParticipants as Table<unknown, string>
    case 'ledger_budget': return database.ledgerBudgets as Table<unknown, string>
    case 'ledger_expense': return database.ledgerExpenses as Table<unknown, string>
    case 'replan_event': return database.tripReplanEvents as Table<unknown, string>
    case 'replan_record': return database.tripReplanRecords as Table<unknown, string>
    case 'trip_intelligence_applied_change': return database.tripIntelligenceAppliedChanges as Table<unknown, string>
    case 'trip_intelligence_suggestion_state': return database.tripIntelligenceSuggestionStates as Table<unknown, string>
  }
}

function accountBootstrapTransactionTables(database: TravelConsoleDatabase) {
  return [
    database.accountMutationJournal,
    database.accountObjectRevisions,
    database.syncOutbox,
    database.trips,
    database.days,
    database.itineraryItems,
    database.ticketMetas,
    database.ledgerSettings,
    database.ledgerParticipants,
    database.ledgerBudgets,
    database.ledgerExpenses,
    database.tripReplanEvents,
    database.tripReplanRecords,
    database.tripIntelligenceAppliedChanges,
    database.tripIntelligenceSuggestionStates,
  ]
}

function toLocalObject(
  objectType: LegacyAccountObjectType,
  tripId: string,
  value: object,
): LocalAccountObjectV1 {
  const payload = toPlainJsonObject(value)
  if (typeof payload.id !== 'string') throw new AccountCloudBootstrapError('invalid_plan')
  return { objectId: payload.id, objectType, payload, tripId }
}

function toPlainJsonObject(value: object): JsonObject {
  const serialized = JSON.stringify(value)
  if (!serialized) throw new AccountCloudBootstrapError('invalid_plan')
  const parsed = JSON.parse(serialized) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AccountCloudBootstrapError('invalid_plan')
  }
  return parsed as JsonObject
}

function isLegacyAccountObjectType(objectType: string): objectType is LegacyAccountObjectType {
  return LEGACY_TYPE_SET.has(objectType)
}

function buildLocalObjectKey(object: Pick<LocalAccountObjectV1, 'objectId' | 'objectType'>) {
  return buildAccountObjectKey(object.objectType, object.objectId)
}

function buildRemoteObjectKey(row: AccountObjectRowV1) {
  if (ACCOUNT_OBJECT_DEFINITIONS[row.objectType].authority !== 'client_mutable') {
    return `${row.objectType}:${row.objectId}`
  }
  return buildAccountObjectKey(row.objectType as ClientMutableAccountObjectType, row.objectId)
}

function summarizeEntries(entries: AccountCloudBootstrapEntryV1[]) {
  const summary: Record<AccountCloudBootstrapStatus, number> = {
    exact_match: 0,
    local_only: 0,
    payload_drift: 0,
    pending_mutation: 0,
    remote_only: 0,
    schema_unsupported: 0,
    tombstone_drift: 0,
    tombstone_match: 0,
    unsupported_remote: 0,
  }
  for (const entry of entries) summary[entry.status] += 1
  return summary
}

function fingerprintRemoteRows(rows: AccountObjectRowV1[]) {
  const canonical = stableStringify(rows)
  let first = 2166136261
  let second = 0x9e3779b9
  for (let index = 0; index < canonical.length; index += 1) {
    const code = canonical.charCodeAt(index)
    first = Math.imul(first ^ code, 16777619)
    second = Math.imul(second ^ code, 2246822519)
  }
  return `account-v2:${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}:${rows.length}`
}

function sameJson(left: unknown, right: unknown) {
  return stableStringify(left) === stableStringify(right)
}

function revisionRecordMatchesRow(
  revision: AccountObjectRevisionRecord,
  row: AccountObjectRowV1,
) {
  return revision.actorId === row.actorId
    && revision.deletedAt === row.deletedAt
    && revision.deviceId === row.deviceId
    && revision.mutationId === row.mutationId
    && revision.objectId === row.objectId
    && revision.objectSchemaVersion === row.objectSchemaVersion
    && revision.objectType === row.objectType
    && revision.revision === row.revision
    && revision.serverCreatedAt === row.createdAt
    && revision.serverUpdatedAt === row.updatedAt
    && revision.tombstone === row.tombstone
    && revision.tripId === row.tripId
    && sameJson(revision.payload, row.payload)
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}

function assertBootstrapAccountContext(
  accountHash: string,
  database: TravelConsoleDatabase,
) {
  if (
    !/^[a-f0-9]{32}$/.test(accountHash)
    || getActiveAccountHash() !== accountHash
    || getActiveTravelDatabase() !== database
    || database.name !== buildAccountTravelDatabaseName(accountHash)
  ) {
    throw new AccountCloudBootstrapError('account_context_mismatch')
  }
}
