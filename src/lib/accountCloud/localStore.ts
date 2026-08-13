import type { Table } from 'dexie'
import {
  getActiveTravelDatabase,
  type TravelConsoleDatabase,
} from '../../db/database'
import {
  ACCOUNT_OBJECT_DEFINITIONS,
  parseAccountObjectMutationV1,
  type AccountObjectMutationResultV1,
  type AccountObjectMutationV1,
  type AccountObjectRowV1,
  type ClientMutableAccountObjectType,
} from './contract'
import type {
  AccountMutationJournalEntry,
  AccountMutationJournalStatus,
  AccountMutationLocalErrorCode,
  AccountObjectRevisionRecord,
} from './localTypes'

const DEFAULT_LEASE_MS = 30_000
const MAX_RETRY_DELAY_MS = 5 * 60_000

export class AccountMutationJournalError extends Error {
  readonly code: 'mutation_reused' | 'object_busy' | 'stale_ack' | 'stale_lease' | 'unknown_mutation'

  constructor(code: AccountMutationJournalError['code']) {
    super(code)
    this.name = 'AccountMutationJournalError'
    this.code = code
  }
}

export type AccountMutationReconciliationResult =
  | 'missing'
  | 'not_applicable'
  | 'rolled_back'
  | 'stale_lease'
  | 'stale_local'

export function buildAccountObjectKey(objectType: ClientMutableAccountObjectType, objectId: string) {
  return `${objectType}:${objectId}`
}

export function buildAccountMutationJournalEntry(
  input: AccountObjectMutationV1,
  accountHash: string,
  now = Date.now(),
): AccountMutationJournalEntry {
  if (!/^[a-f0-9]{32}$/.test(accountHash)) {
    throw new AccountMutationJournalError('unknown_mutation')
  }
  const mutation = parseAccountObjectMutationV1(input)
  if (ACCOUNT_OBJECT_DEFINITIONS[mutation.objectType].authority !== 'client_mutable') {
    throw new AccountMutationJournalError('unknown_mutation')
  }
  const objectType = mutation.objectType as ClientMutableAccountObjectType
  return {
    accountHash,
    attempts: 0,
    createdAt: now,
    deviceId: mutation.deviceId,
    expectedRevision: mutation.expectedRevision,
    mutationId: mutation.mutationId,
    objectId: mutation.objectId,
    objectKey: buildAccountObjectKey(objectType, mutation.objectId),
    objectSchemaVersion: mutation.objectSchemaVersion,
    objectType,
    operation: mutation.operation,
    payload: mutation.payload,
    requestFingerprint: fingerprintMutation(mutation),
    status: 'pending',
    tripId: mutation.tripId,
    updatedAt: now,
  }
}

export async function putAccountMutationIntent(
  entry: AccountMutationJournalEntry,
  database: TravelConsoleDatabase = getActiveTravelDatabase(),
) {
  return database.transaction('rw', database.accountMutationJournal, database.accountWorkflowJournal, async () => {
    const existing = await database.accountMutationJournal.get(entry.mutationId)
    if (existing && !hasSameMutationContent(existing, entry)) {
      throw new AccountMutationJournalError('mutation_reused')
    }
    const next = existing
      ? {
          ...existing,
          updatedAt: entry.updatedAt,
        }
      : entry
    if (!existing) {
      const workflowCount = await database.accountWorkflowJournal
        .where('objectKeys')
        .equals(entry.objectKey)
        .count()
      if (workflowCount > 0) throw new AccountMutationJournalError('object_busy')
    }
    await database.accountMutationJournal.put(next)
    return next
  })
}

export async function getAccountMutationJournalEntry(
  mutationId: string,
  database: TravelConsoleDatabase = getActiveTravelDatabase(),
) {
  return database.accountMutationJournal.get(mutationId)
}

export async function getAccountObjectRevision(
  objectKey: string,
  database: TravelConsoleDatabase = getActiveTravelDatabase(),
) {
  return database.accountObjectRevisions.get(objectKey)
}

export async function listAccountObjectRevisionsByTrip(
  tripId: string,
  database: TravelConsoleDatabase = getActiveTravelDatabase(),
) {
  return database.accountObjectRevisions.where('tripId').equals(tripId).toArray()
}

export async function listAccountMutationsByObject(
  objectKey: string,
  database: TravelConsoleDatabase = getActiveTravelDatabase(),
) {
  return (await database.accountMutationJournal.where('objectKey').equals(objectKey).toArray())
    .sort(compareJournalOrder)
}

export async function listRunnableAccountMutations({
  database = getActiveTravelDatabase(),
  limit = 50,
  now = Date.now(),
  tripId,
}: {
  database?: TravelConsoleDatabase
  limit?: number
  now?: number
  tripId?: string
} = {}) {
  const entries = tripId
    ? await database.accountMutationJournal.where('tripId').equals(tripId).toArray()
    : await database.accountMutationJournal.toArray()
  return entries
    .filter((entry) => isRunnable(entry, now))
    .sort((left, right) => left.createdAt - right.createdAt || left.mutationId.localeCompare(right.mutationId))
    .slice(0, Math.max(0, Math.min(limit, 200)))
}

export async function leaseAccountMutation(
  mutationId: string,
  {
    leaseMs = DEFAULT_LEASE_MS,
    leaseToken = crypto.randomUUID(),
    now = Date.now(),
    database = getActiveTravelDatabase(),
  }: {
    database?: TravelConsoleDatabase
    leaseMs?: number
    leaseToken?: string
    now?: number
  } = {},
) {
  return database.transaction('rw', database.accountMutationJournal, database.accountWorkflowJournal, async () => {
    const entry = await database.accountMutationJournal.get(mutationId)
    if (!entry || !isRunnable(entry, now)) return null
    const objectEntries = await database.accountMutationJournal.where('objectKey').equals(entry.objectKey).toArray()
    if (objectEntries.some((candidate) => (
      candidate.mutationId !== mutationId
      && compareJournalOrder(candidate, entry) < 0
    ))) {
      return null
    }
    const workflows = await database.accountWorkflowJournal
      .where('objectKeys')
      .equals(entry.objectKey)
      .toArray()
    if (workflows.some((workflow) => (
      workflow.createdAt < entry.createdAt
      || (
        workflow.createdAt === entry.createdAt
        && `workflow:${workflow.batchMutationId}`.localeCompare(`mutation:${entry.mutationId}`) < 0
      )
    ))) {
      return null
    }
    const leased: AccountMutationJournalEntry = {
      ...entry,
      attempts: entry.attempts + 1,
      lastErrorCode: undefined,
      leaseExpiresAt: now + Math.max(1_000, Math.min(leaseMs, 5 * 60_000)),
      leaseToken,
      retryAt: undefined,
      status: 'inflight',
      updatedAt: now,
    }
    await database.accountMutationJournal.put(leased)
    return leased
  })
}

export async function markAccountMutationPending(
  mutationId: string,
  now = Date.now(),
  leaseToken?: string,
  database: TravelConsoleDatabase = getActiveTravelDatabase(),
) {
  return updateJournalEntry(mutationId, (entry) => ({
    ...entry,
    lastErrorCode: undefined,
    leaseExpiresAt: undefined,
    leaseToken: undefined,
    retryAt: undefined,
    status: 'pending',
    updatedAt: now,
  }), leaseToken, database)
}

export async function markAccountMutationForRetry(
  mutationId: string,
  errorCode: AccountMutationLocalErrorCode,
  now = Date.now(),
  leaseToken?: string,
  database: TravelConsoleDatabase = getActiveTravelDatabase(),
) {
  return updateJournalEntry(mutationId, (entry) => ({
    ...entry,
    lastErrorCode: errorCode,
    leaseExpiresAt: undefined,
    leaseToken: undefined,
    retryAt: computeAccountMutationRetryAt(entry.attempts, now),
    status: 'retry',
    updatedAt: now,
  }), leaseToken, database)
}

export async function markAccountMutationBlocked(
  mutationId: string,
  status: Extract<AccountMutationJournalStatus, 'blocked_auth' | 'blocked_contract'>,
  errorCode: AccountMutationLocalErrorCode,
  now = Date.now(),
  leaseToken?: string,
  database: TravelConsoleDatabase = getActiveTravelDatabase(),
) {
  return updateJournalEntry(mutationId, (entry) => ({
    ...entry,
    lastErrorCode: errorCode,
    leaseExpiresAt: undefined,
    leaseToken: undefined,
    retryAt: undefined,
    status,
    updatedAt: now,
  }), leaseToken, database)
}

export async function markAccountMutationConflict(
  mutationId: string,
  conflictObject: AccountObjectRowV1 | null,
  now = Date.now(),
  leaseToken?: string,
  database: TravelConsoleDatabase = getActiveTravelDatabase(),
) {
  return updateJournalEntry(mutationId, (entry) => ({
    ...entry,
    conflictObject,
    lastErrorCode: 'server_conflict',
    leaseExpiresAt: undefined,
    leaseToken: undefined,
    retryAt: undefined,
    status: 'conflict',
    updatedAt: now,
  }), leaseToken, database)
}

export async function reconcileOptimisticAccountMutationFailure(
  mutationId: string,
  {
    conflictObject = null,
    errorCode,
    now = Date.now(),
    retainJournal,
    leaseToken,
    database = getActiveTravelDatabase(),
  }: {
    conflictObject?: AccountObjectRowV1 | null
    errorCode: AccountMutationLocalErrorCode
    now?: number
    retainJournal: boolean
    leaseToken?: string
    database?: TravelConsoleDatabase
  },
): Promise<AccountMutationReconciliationResult> {
  const initial = await database.accountMutationJournal.get(mutationId)
  if (!initial) return 'missing'
  if (hasLeaseMismatch(initial, leaseToken)) return 'stale_lease'
  if (initial.optimisticAfter === undefined || initial.optimisticBefore === undefined) {
    return 'not_applicable'
  }
  const objectTable = getOptimisticObjectTable(initial.objectType, database)
  if (!objectTable) return 'not_applicable'

  return database.transaction('rw', database.accountMutationJournal, objectTable, async () => {
    const entries = (await database.accountMutationJournal.where('objectKey').equals(initial.objectKey).toArray())
      .sort(compareJournalOrder)
    const targetIndex = entries.findIndex((entry) => entry.mutationId === mutationId)
    if (targetIndex < 0) return 'missing'

    const impacted = entries.slice(targetIndex)
    const target = impacted[0]
    const latest = impacted.at(-1)
    if (
      !target
      || !latest
      || target.optimisticBefore === undefined
      || impacted.some((entry) => entry.optimisticAfter === undefined)
    ) {
      return 'not_applicable'
    }
    if (hasLeaseMismatch(target, leaseToken)) return 'stale_lease'

    const current = await objectTable.get(initial.objectId)
    if (!sameJson(current, latest.optimisticAfter)) {
      await database.accountMutationJournal.bulkPut(impacted.map((entry) => ({
        ...entry,
        conflictObject,
        lastErrorCode: 'local_state_changed' as const,
        leaseExpiresAt: undefined,
        leaseToken: undefined,
        retryAt: undefined,
        optimisticResolution: 'stale_local' as const,
        status: 'conflict' as const,
        updatedAt: now,
      })))
      return 'stale_local'
    }

    if (target.optimisticBefore === null) {
      await objectTable.delete(initial.objectId)
    } else {
      await objectTable.put(target.optimisticBefore, initial.objectId)
    }

    if (retainJournal) {
      await database.accountMutationJournal.bulkPut(impacted.map((entry) => ({
        ...entry,
        conflictObject,
        lastErrorCode: errorCode,
        leaseExpiresAt: undefined,
        leaseToken: undefined,
        retryAt: undefined,
        optimisticResolution: 'rolled_back' as const,
        status: 'conflict' as const,
        updatedAt: now,
      })))
    } else {
      await database.accountMutationJournal.bulkDelete(impacted.map((entry) => entry.mutationId))
    }
    return 'rolled_back'
  })
}

export async function acknowledgeAccountMutation(
  mutationId: string,
  result: Extract<AccountObjectMutationResultV1, { status: 'applied' | 'idempotent' }>,
  now = Date.now(),
  leaseToken?: string,
  database: TravelConsoleDatabase = getActiveTravelDatabase(),
) {
  return database.transaction('rw', database.accountMutationJournal, database.accountObjectRevisions, async () => {
    const entry = await database.accountMutationJournal.get(mutationId)
    if (!entry) throw new AccountMutationJournalError('unknown_mutation')
    if (hasLeaseMismatch(entry, leaseToken)) {
      throw new AccountMutationJournalError('stale_lease')
    }
    if (result.mutationId !== mutationId) throw new AccountMutationJournalError('stale_ack')
    const revision = buildAccountObjectRevisionRecord(result.object, now)
    if (
      revision.objectKey !== entry.objectKey
      || revision.tripId !== entry.tripId
      || revision.objectType !== entry.objectType
    ) {
      throw new AccountMutationJournalError('stale_ack')
    }

    const current = await database.accountObjectRevisions.get(entry.objectKey)
    if (current && current.revision > revision.revision) {
      throw new AccountMutationJournalError('stale_ack')
    }
    if (
      current
      && current.revision === revision.revision
      && current.mutationId !== revision.mutationId
    ) {
      throw new AccountMutationJournalError('stale_ack')
    }

    await database.accountObjectRevisions.put(revision)
    await database.accountMutationJournal.delete(mutationId)
    return revision
  })
}

export async function discardAccountMutation(
  mutationId: string,
  database: TravelConsoleDatabase = getActiveTravelDatabase(),
) {
  await database.accountMutationJournal.delete(mutationId)
}

export async function resumeBlockedAuthAccountMutations(
  now = Date.now(),
  database: TravelConsoleDatabase = getActiveTravelDatabase(),
  accountHash?: string,
) {
  return database.transaction('rw', database.accountMutationJournal, async () => {
    const entries = (await database.accountMutationJournal.where('status').equals('blocked_auth').toArray())
      .filter((entry) => accountHash === undefined || entry.accountHash === accountHash)
    if (entries.length === 0) return 0
    await database.accountMutationJournal.bulkPut(entries.map((entry) => ({
      ...entry,
      lastErrorCode: undefined,
      leaseExpiresAt: undefined,
      leaseToken: undefined,
      retryAt: undefined,
      status: 'pending' as const,
      updatedAt: now,
    })))
    return entries.length
  })
}

export async function recoverTerminalOptimisticAccountMutations({
  accountHash,
  database = getActiveTravelDatabase(),
  limit = 50,
  now = Date.now(),
}: {
  accountHash: string
  database?: TravelConsoleDatabase
  limit?: number
  now?: number
}) {
  const candidates = (await database.accountMutationJournal
    .where('status')
    .anyOf('blocked_contract', 'conflict')
    .toArray())
    .filter((entry) => (
      entry.accountHash === accountHash
      && entry.optimisticAfter !== undefined
      && entry.optimisticBefore !== undefined
      && entry.optimisticResolution === undefined
    ))
    .sort(compareJournalOrder)
    .slice(0, Math.max(0, Math.min(limit, 200)))

  let recovered = 0
  let staleLocal = 0
  for (const entry of candidates) {
    const result = await reconcileOptimisticAccountMutationFailure(entry.mutationId, {
      conflictObject: entry.conflictObject,
      database,
      errorCode: entry.lastErrorCode
        ?? (entry.status === 'conflict' ? 'server_conflict' : 'server_rejected'),
      now,
      retainJournal: entry.status === 'conflict',
    })
    if (result === 'rolled_back') recovered += 1
    if (result === 'stale_local') staleLocal += 1
  }
  return { recovered, scanned: candidates.length, staleLocal }
}

export function computeAccountMutationRetryAt(attempts: number, now = Date.now()) {
  const exponent = Math.max(0, Math.min(attempts - 1, 8))
  return now + Math.min(1_000 * (2 ** exponent), MAX_RETRY_DELAY_MS)
}

export function buildAccountObjectRevisionRecord(
  row: AccountObjectRowV1,
  now = Date.now(),
): AccountObjectRevisionRecord {
  if (ACCOUNT_OBJECT_DEFINITIONS[row.objectType].authority !== 'client_mutable') {
    throw new AccountMutationJournalError('stale_ack')
  }
  const objectType = row.objectType as ClientMutableAccountObjectType
  return {
    acknowledgedAt: now,
    actorId: row.actorId,
    deletedAt: row.deletedAt,
    deviceId: row.deviceId,
    mutationId: row.mutationId,
    objectId: row.objectId,
    objectKey: buildAccountObjectKey(objectType, row.objectId),
    objectSchemaVersion: row.objectSchemaVersion,
    objectType,
    payload: row.payload,
    revision: row.revision,
    serverCreatedAt: row.createdAt,
    serverUpdatedAt: row.updatedAt,
    tombstone: row.tombstone,
    tripId: row.tripId,
    updatedAt: now,
  }
}

function isRunnable(entry: AccountMutationJournalEntry, now: number) {
  if (entry.status === 'pending') return true
  if (entry.status === 'retry') return (entry.retryAt ?? 0) <= now
  return entry.status === 'inflight' && (entry.leaseExpiresAt ?? 0) <= now
}

function compareJournalOrder(left: AccountMutationJournalEntry, right: AccountMutationJournalEntry) {
  return left.createdAt - right.createdAt || left.mutationId.localeCompare(right.mutationId)
}

async function updateJournalEntry(
  mutationId: string,
  update: (entry: AccountMutationJournalEntry) => AccountMutationJournalEntry,
  leaseToken?: string,
  database: TravelConsoleDatabase = getActiveTravelDatabase(),
) {
  return database.transaction('rw', database.accountMutationJournal, async () => {
    const entry = await database.accountMutationJournal.get(mutationId)
    if (!entry) throw new AccountMutationJournalError('unknown_mutation')
    if (hasLeaseMismatch(entry, leaseToken)) {
      throw new AccountMutationJournalError('stale_lease')
    }
    const next = update(entry)
    await database.accountMutationJournal.put(next)
    return next
  })
}

function hasLeaseMismatch(entry: AccountMutationJournalEntry, leaseToken?: string) {
  if (leaseToken !== undefined) return entry.leaseToken !== leaseToken
  return entry.status === 'inflight'
}

function fingerprintMutation(mutation: AccountObjectMutationV1) {
  const canonical = stableStringify(mutation)
  let hash = 2166136261
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}:${canonical.length}`
}

function hasSameMutationContent(
  left: AccountMutationJournalEntry,
  right: AccountMutationJournalEntry,
) {
  return left.deviceId === right.deviceId
    && left.accountHash === right.accountHash
    && left.expectedRevision === right.expectedRevision
    && left.mutationId === right.mutationId
    && left.objectId === right.objectId
    && left.objectSchemaVersion === right.objectSchemaVersion
    && left.objectType === right.objectType
    && left.operation === right.operation
    && left.tripId === right.tripId
    && stableStringify(left.optimisticAfter) === stableStringify(right.optimisticAfter)
    && stableStringify(left.optimisticBefore) === stableStringify(right.optimisticBefore)
    && stableStringify(left.payload) === stableStringify(right.payload)
}

function getOptimisticObjectTable(
  objectType: ClientMutableAccountObjectType,
  database: TravelConsoleDatabase,
): Table<unknown, string> | null {
  switch (objectType) {
    case 'day':
      return database.days as Table<unknown, string>
    case 'item':
      return database.itineraryItems as Table<unknown, string>
    case 'ticket_meta':
      return database.ticketMetas as Table<unknown, string>
    case 'trip':
      return database.trips as Table<unknown, string>
    default:
      return null
  }
}

function sameJson(left: unknown, right: unknown) {
  return stableStringify(left) === stableStringify(right)
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
