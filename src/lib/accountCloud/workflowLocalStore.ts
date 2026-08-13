import {
  getActiveTravelDatabase,
  type TravelConsoleDatabase,
} from '../../db/database'
import { buildAccountTravelDatabaseName } from '../accountDatabase'
import { getActiveAccountHash } from '../accountStorageScope'
import type { AccountMutationJournalEntry } from './localTypes'
import {
  buildAccountObjectKey,
  buildAccountObjectRevisionRecord,
} from './localStore'
import {
  assertAccountWorkflowResultMatchesRequest,
  parseAccountWorkflowRequestV1,
  parseAccountWorkflowRunResultV1,
  type AccountWorkflowConflictV1,
  type AccountWorkflowRequestV1,
  type AccountWorkflowRunResultV1,
} from './workflowContract'
import {
  encodeAccountWorkflowLocalPayload,
  getAccountWorkflowLocalObjectTables,
  readAccountWorkflowLocalPayload,
  writeAccountWorkflowLocalPayload,
} from './workflowLocalCodec'
import type {
  AccountWorkflowJournalEntry,
  AccountWorkflowJournalStatus,
  AccountWorkflowLocalSnapshotV1,
} from './workflowLocalTypes'
import type { AccountMutationLocalErrorCode, AccountObjectRevisionRecord } from './localTypes'

const DEFAULT_LEASE_MS = 30_000
const MAX_RETRY_DELAY_MS = 5 * 60_000
const ACCOUNT_HASH = /^[a-f0-9]{32}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SNAPSHOT_FIELDS = new Set(['stepId', 'objectKey', 'objectType', 'objectId', 'before'])
const JOURNAL_FIELDS = new Set([
  'accountHash',
  'attempts',
  'batchMutationId',
  'conflicts',
  'createdAt',
  'deviceId',
  'lastErrorCode',
  'leaseExpiresAt',
  'leaseToken',
  'objectKeys',
  'optimisticResolution',
  'request',
  'requestFingerprint',
  'retryAt',
  'serverAcknowledgedAt',
  'snapshots',
  'status',
  'tripId',
  'updatedAt',
  'workflowId',
])
const JOURNAL_STATUSES = new Set<AccountWorkflowJournalStatus>([
  'blocked_auth',
  'blocked_contract',
  'conflict',
  'inflight',
  'pending',
  'retry',
])
const LOCAL_ERROR_CODES = new Set<AccountMutationLocalErrorCode>([
  'authentication_required',
  'contract_unavailable',
  'invalid_response',
  'permission_denied',
  'request_failed',
  'server_rejected',
  'server_conflict',
  'local_state_changed',
])
const OPTIMISTIC_RESOLUTIONS = new Set(['rolled_back', 'stale_local'])

export class AccountWorkflowJournalError extends Error {
  readonly code:
    | 'account_context_mismatch'
    | 'batch_reused'
    | 'invalid_entry'
    | 'invalid_snapshot'
    | 'object_busy'
    | 'stale_ack'
    | 'stale_lease'
    | 'stale_revision'
    | 'unbootstrapped'
    | 'unknown_batch'

  constructor(code: AccountWorkflowJournalError['code']) {
    super(code)
    this.name = 'AccountWorkflowJournalError'
    this.code = code
  }
}

export type AccountWorkflowReconciliationResult =
  | 'missing'
  | 'rolled_back'
  | 'stale_lease'
  | 'stale_local'

export type AccountWorkflowAcknowledgement = {
  status: 'committed' | 'stale_local'
  revisions: AccountObjectRevisionRecord[]
}

export function buildAccountWorkflowJournalEntry(
  input: AccountWorkflowRequestV1,
  accountHash: string,
  snapshots: AccountWorkflowLocalSnapshotV1[],
  now = Date.now(),
): AccountWorkflowJournalEntry {
  if (!ACCOUNT_HASH.test(accountHash) || !Number.isSafeInteger(now) || now < 0) {
    throw new AccountWorkflowJournalError('invalid_entry')
  }
  const request = parseAccountWorkflowRequestV1(input)
  const normalizedSnapshots = normalizeSnapshots(request, snapshots)
  const objectKeys = normalizedSnapshots.map((snapshot) => snapshot.objectKey).sort()
  return {
    accountHash,
    attempts: 0,
    batchMutationId: request.batchMutationId,
    createdAt: now,
    deviceId: request.deviceId,
    objectKeys,
    request,
    requestFingerprint: fingerprintWorkflow(request),
    snapshots: normalizedSnapshots,
    status: 'pending',
    tripId: request.tripId,
    updatedAt: now,
    workflowId: request.workflowId,
  }
}

export function validateAccountWorkflowJournalEntry(
  input: AccountWorkflowJournalEntry,
): AccountWorkflowJournalEntry {
  if (
    !input
    || typeof input !== 'object'
    || Object.keys(input).some((key) => !JOURNAL_FIELDS.has(key))
    || !ACCOUNT_HASH.test(input.accountHash)
  ) {
    throw new AccountWorkflowJournalError('invalid_entry')
  }
  const canonical = buildAccountWorkflowJournalEntry(
    input.request,
    input.accountHash,
    input.snapshots,
    input.createdAt,
  )
  const conflicts = normalizeConflicts(input.conflicts, canonical.request)
  const hasAnyLease = input.leaseToken !== undefined || input.leaseExpiresAt !== undefined
  const hasCompleteLease = input.leaseToken !== undefined && input.leaseExpiresAt !== undefined
  const hasRetry = input.retryAt !== undefined
  if (
    input.batchMutationId !== canonical.batchMutationId
    || input.deviceId !== canonical.deviceId
    || input.tripId !== canonical.tripId
    || input.workflowId !== canonical.workflowId
    || input.requestFingerprint !== canonical.requestFingerprint
    || !sameJson(input.objectKeys, canonical.objectKeys)
    || !Number.isSafeInteger(input.attempts)
    || input.attempts < 0
    || !Number.isFinite(input.createdAt)
    || !Number.isFinite(input.updatedAt)
    || !JOURNAL_STATUSES.has(input.status)
    || (input.lastErrorCode !== undefined && !LOCAL_ERROR_CODES.has(input.lastErrorCode))
    || (input.optimisticResolution !== undefined && !OPTIMISTIC_RESOLUTIONS.has(input.optimisticResolution))
    || (input.serverAcknowledgedAt !== undefined && !Number.isFinite(input.serverAcknowledgedAt))
    || (input.leaseToken !== undefined && !UUID.test(input.leaseToken))
    || (input.leaseExpiresAt !== undefined && !Number.isFinite(input.leaseExpiresAt))
    || (input.retryAt !== undefined && !Number.isFinite(input.retryAt))
    || (input.status === 'inflight' ? !hasCompleteLease : hasAnyLease)
    || (input.status === 'retry' ? !hasRetry : hasRetry)
    || (input.status !== 'conflict' && (
      conflicts !== undefined
      || input.optimisticResolution !== undefined
      || input.serverAcknowledgedAt !== undefined
    ))
  ) {
    throw new AccountWorkflowJournalError('invalid_entry')
  }
  return {
    ...input,
    conflicts,
    objectKeys: canonical.objectKeys,
    request: canonical.request,
    snapshots: canonical.snapshots,
  }
}

export async function createOptimisticAccountWorkflowIntent<T>({
  accountHash,
  apply,
  database = getActiveTravelDatabase(),
  input,
  now = Date.now(),
}: {
  accountHash: string
  apply: () => Promise<T>
  database?: TravelConsoleDatabase
  input: AccountWorkflowRequestV1
  now?: number
}) {
  if (!ACCOUNT_HASH.test(accountHash)) throw new AccountWorkflowJournalError('invalid_entry')
  assertActiveWorkflowAccountContext(accountHash, database)
  const request = parseAccountWorkflowRequestV1(input)
  const objectTables = getAccountWorkflowLocalObjectTables(
    request.steps.map((step) => step.objectType),
    database,
  )
  const structuralTables = request.workflowId === 'day.items.reorder@1'
    || request.workflowId === 'item.move@1'
    ? [database.days]
    : request.workflowId === 'ticket.bind@1'
      ? [database.itineraryItems]
    : []
  const tables = [
    database.accountMutationJournal,
    database.accountObjectRevisions,
    database.accountWorkflowJournal,
    ...structuralTables,
    ...objectTables,
  ]

  return database.transaction('rw', tables, async () => {
    assertActiveWorkflowAccountContext(accountHash, database)
    if (await database.accountWorkflowJournal.get(request.batchMutationId)) {
      throw new AccountWorkflowJournalError('batch_reused')
    }
    const objectKeys = request.steps.map((step) => buildAccountObjectKey(step.objectType, step.objectId))
    await assertObjectsAreIdle(objectKeys, database)
    const snapshots = await captureWorkflowSnapshots(request, database)
    await assertWorkflowBaselines(request, snapshots, database)

    const value = await apply()
    assertActiveWorkflowAccountContext(accountHash, database)
    await assertOptimisticStateMatchesRequest(request, database)
    const entry = buildAccountWorkflowJournalEntry(request, accountHash, snapshots, now)
    await database.accountWorkflowJournal.put(entry)
    assertActiveWorkflowAccountContext(accountHash, database)
    return { entry, value }
  })
}

export async function putAccountWorkflowIntent(
  input: AccountWorkflowJournalEntry,
  database: TravelConsoleDatabase = getActiveTravelDatabase(),
) {
  const entry = validateAccountWorkflowJournalEntry(input)
  assertActiveWorkflowAccountContext(entry.accountHash, database)
  return database.transaction(
    'rw',
    database.accountMutationJournal,
    database.accountWorkflowJournal,
    async () => {
      assertActiveWorkflowAccountContext(entry.accountHash, database)
      const existing = await database.accountWorkflowJournal.get(entry.batchMutationId)
      if (existing) {
        const canonicalExisting = validateAccountWorkflowJournalEntry(existing)
        if (!hasSameWorkflowContent(canonicalExisting, entry)) {
          throw new AccountWorkflowJournalError('batch_reused')
        }
        const next = { ...canonicalExisting, updatedAt: entry.updatedAt }
        await database.accountWorkflowJournal.put(next)
        assertActiveWorkflowAccountContext(entry.accountHash, database)
        return next
      }
      await assertObjectsAreIdle(entry.objectKeys, database)
      await database.accountWorkflowJournal.put(entry)
      assertActiveWorkflowAccountContext(entry.accountHash, database)
      return entry
    },
  )
}

export async function getAccountWorkflowJournalEntry(
  batchMutationId: string,
  database: TravelConsoleDatabase = getActiveTravelDatabase(),
) {
  const entry = await database.accountWorkflowJournal.get(batchMutationId)
  if (!entry) return undefined
  const canonical = validateAccountWorkflowJournalEntry(entry)
  assertActiveWorkflowAccountContext(canonical.accountHash, database)
  return canonical
}

export async function listRunnableAccountWorkflows({
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
  const accountHash = getActiveAccountHash()
  if (!accountHash) throw new AccountWorkflowJournalError('account_context_mismatch')
  assertActiveWorkflowAccountContext(accountHash, database)
  const entries = tripId
    ? await database.accountWorkflowJournal.where('tripId').equals(tripId).toArray()
    : await database.accountWorkflowJournal.toArray()
  const canonical = entries.map(validateAccountWorkflowJournalEntry)
  if (canonical.some((entry) => entry.accountHash !== accountHash)) {
    throw new AccountWorkflowJournalError('account_context_mismatch')
  }
  assertActiveWorkflowAccountContext(accountHash, database)
  return canonical
    .filter((entry) => isRunnable(entry, now))
    .sort(compareWorkflowOrder)
    .slice(0, Math.max(0, Math.min(limit, 100)))
}

export async function leaseAccountWorkflow(
  batchMutationId: string,
  {
    database = getActiveTravelDatabase(),
    leaseMs = DEFAULT_LEASE_MS,
    leaseToken = crypto.randomUUID(),
    now = Date.now(),
  }: {
    database?: TravelConsoleDatabase
    leaseMs?: number
    leaseToken?: string
    now?: number
  } = {},
) {
  return database.transaction(
    'rw',
    database.accountMutationJournal,
    database.accountWorkflowJournal,
    async () => {
      const raw = await database.accountWorkflowJournal.get(batchMutationId)
      if (!raw) return null
      const entry = validateAccountWorkflowJournalEntry(raw)
      if (!isRunnable(entry, now)) return null
      assertActiveWorkflowAccountContext(entry.accountHash, database)
      if (await hasEarlierObjectWork(entry, database)) return null
      const leased = validateAccountWorkflowJournalEntry({
        ...entry,
        attempts: entry.attempts + 1,
        lastErrorCode: undefined,
        leaseExpiresAt: now + Math.max(1_000, Math.min(leaseMs, 5 * 60_000)),
        leaseToken,
        retryAt: undefined,
        status: 'inflight',
        updatedAt: now,
      })
      await database.accountWorkflowJournal.put(leased)
      assertActiveWorkflowAccountContext(entry.accountHash, database)
      return leased
    },
  )
}

export async function markAccountWorkflowPending(
  batchMutationId: string,
  now = Date.now(),
  leaseToken?: string,
  database: TravelConsoleDatabase = getActiveTravelDatabase(),
) {
  return updateWorkflowEntry(batchMutationId, (entry) => ({
    ...entry,
    lastErrorCode: undefined,
    leaseExpiresAt: undefined,
    leaseToken: undefined,
    retryAt: undefined,
    status: 'pending',
    updatedAt: now,
  }), leaseToken, database)
}

export async function markAccountWorkflowForRetry(
  batchMutationId: string,
  errorCode: AccountMutationLocalErrorCode,
  now = Date.now(),
  leaseToken?: string,
  database: TravelConsoleDatabase = getActiveTravelDatabase(),
) {
  return updateWorkflowEntry(batchMutationId, (entry) => ({
    ...entry,
    lastErrorCode: errorCode,
    leaseExpiresAt: undefined,
    leaseToken: undefined,
    retryAt: computeAccountWorkflowRetryAt(entry.attempts, now),
    status: 'retry',
    updatedAt: now,
  }), leaseToken, database)
}

export async function markAccountWorkflowBlocked(
  batchMutationId: string,
  status: Extract<AccountWorkflowJournalStatus, 'blocked_auth' | 'blocked_contract'>,
  errorCode: AccountMutationLocalErrorCode,
  now = Date.now(),
  leaseToken?: string,
  database: TravelConsoleDatabase = getActiveTravelDatabase(),
) {
  return updateWorkflowEntry(batchMutationId, (entry) => ({
    ...entry,
    lastErrorCode: errorCode,
    leaseExpiresAt: undefined,
    leaseToken: undefined,
    retryAt: undefined,
    status,
    updatedAt: now,
  }), leaseToken, database)
}

export async function markAccountWorkflowConflictWithoutRollback(
  batchMutationId: string,
  {
    conflicts,
    errorCode = 'server_conflict',
    leaseToken,
    now = Date.now(),
    serverAcknowledged = false,
    database = getActiveTravelDatabase(),
  }: {
    conflicts?: AccountWorkflowConflictV1[]
    database?: TravelConsoleDatabase
    errorCode?: AccountMutationLocalErrorCode
    leaseToken?: string
    now?: number
    serverAcknowledged?: boolean
  } = {},
) {
  return updateWorkflowEntry(batchMutationId, (entry) => ({
    ...entry,
    conflicts,
    lastErrorCode: errorCode,
    leaseExpiresAt: undefined,
    leaseToken: undefined,
    optimisticResolution: errorCode === 'local_state_changed' ? 'stale_local' : entry.optimisticResolution,
    retryAt: undefined,
    serverAcknowledgedAt: serverAcknowledged ? now : entry.serverAcknowledgedAt,
    status: 'conflict',
    updatedAt: now,
  }), leaseToken, database)
}

export async function acknowledgeAccountWorkflow(
  batchMutationId: string,
  input: Extract<AccountWorkflowRunResultV1, { status: 'applied' | 'idempotent' }>,
  now = Date.now(),
  leaseToken?: string,
  database: TravelConsoleDatabase = getActiveTravelDatabase(),
): Promise<AccountWorkflowAcknowledgement> {
  const parsed = parseAccountWorkflowRunResultV1(input)
  if (parsed.status !== 'applied' && parsed.status !== 'idempotent') {
    throw new AccountWorkflowJournalError('stale_ack')
  }
  const initial = await database.accountWorkflowJournal.get(batchMutationId)
  if (!initial) throw new AccountWorkflowJournalError('unknown_batch')
  const entry = validateAccountWorkflowJournalEntry(initial)
  assertActiveWorkflowAccountContext(entry.accountHash, database)
  let result: typeof parsed
  try {
    result = assertAccountWorkflowResultMatchesRequest(parsed, entry.request) as typeof parsed
  } catch {
    throw new AccountWorkflowJournalError('stale_ack')
  }
  const objectTables = getAccountWorkflowLocalObjectTables(
    entry.request.steps.map((step) => step.objectType),
    database,
  )

  return database.transaction(
    'rw',
    [database.accountObjectRevisions, database.accountWorkflowJournal, ...objectTables],
    async () => {
      const currentRaw = await database.accountWorkflowJournal.get(batchMutationId)
      if (!currentRaw) throw new AccountWorkflowJournalError('unknown_batch')
      const currentEntry = validateAccountWorkflowJournalEntry(currentRaw)
      assertActiveWorkflowAccountContext(currentEntry.accountHash, database)
      if (hasLeaseMismatch(currentEntry, leaseToken)) {
        throw new AccountWorkflowJournalError('stale_lease')
      }
      if (!hasSameWorkflowContent(currentEntry, entry)) {
        throw new AccountWorkflowJournalError('stale_ack')
      }

      const revisions = result.steps.map((step) => buildAccountObjectRevisionRecord(step.object, now))
      for (const revision of revisions) {
        const current = await database.accountObjectRevisions.get(revision.objectKey)
        if (
          current
          && (
            current.revision > revision.revision
            || (current.revision === revision.revision && current.mutationId !== revision.mutationId)
          )
        ) {
          throw new AccountWorkflowJournalError('stale_ack')
        }
      }

      const localMatches = await workflowLocalStateMatchesAfter(currentEntry, database)
      assertActiveWorkflowAccountContext(currentEntry.accountHash, database)
      await database.accountObjectRevisions.bulkPut(revisions)
      assertActiveWorkflowAccountContext(currentEntry.accountHash, database)
      if (localMatches) {
        await database.accountWorkflowJournal.delete(batchMutationId)
        assertActiveWorkflowAccountContext(currentEntry.accountHash, database)
        return { revisions, status: 'committed' }
      }

      const next = validateAccountWorkflowJournalEntry({
        ...currentEntry,
        lastErrorCode: 'local_state_changed',
        leaseExpiresAt: undefined,
        leaseToken: undefined,
        optimisticResolution: 'stale_local',
        retryAt: undefined,
        serverAcknowledgedAt: now,
        status: 'conflict',
        updatedAt: now,
      })
      await database.accountWorkflowJournal.put(next)
      assertActiveWorkflowAccountContext(currentEntry.accountHash, database)
      return { revisions, status: 'stale_local' }
    },
  )
}

export async function reconcileOptimisticAccountWorkflowFailure(
  batchMutationId: string,
  {
    conflicts,
    database = getActiveTravelDatabase(),
    errorCode,
    leaseToken,
    now = Date.now(),
    retainJournal,
  }: {
    conflicts?: AccountWorkflowConflictV1[]
    database?: TravelConsoleDatabase
    errorCode: AccountMutationLocalErrorCode
    leaseToken?: string
    now?: number
    retainJournal: boolean
  },
): Promise<AccountWorkflowReconciliationResult> {
  const initial = await database.accountWorkflowJournal.get(batchMutationId)
  if (!initial) return 'missing'
  const entry = validateAccountWorkflowJournalEntry(initial)
  assertActiveWorkflowAccountContext(entry.accountHash, database)
  if (hasLeaseMismatch(entry, leaseToken)) return 'stale_lease'
  const objectTables = getAccountWorkflowLocalObjectTables(
    entry.request.steps.map((step) => step.objectType),
    database,
  )

  return database.transaction('rw', [database.accountWorkflowJournal, ...objectTables], async () => {
    const currentRaw = await database.accountWorkflowJournal.get(batchMutationId)
    if (!currentRaw) return 'missing'
    const currentEntry = validateAccountWorkflowJournalEntry(currentRaw)
    assertActiveWorkflowAccountContext(currentEntry.accountHash, database)
    if (hasLeaseMismatch(currentEntry, leaseToken)) return 'stale_lease'

    if (currentEntry.serverAcknowledgedAt || !await workflowLocalStateMatchesAfter(currentEntry, database)) {
      const next = validateAccountWorkflowJournalEntry({
        ...currentEntry,
        conflicts,
        lastErrorCode: 'local_state_changed',
        leaseExpiresAt: undefined,
        leaseToken: undefined,
        optimisticResolution: 'stale_local',
        retryAt: undefined,
        status: 'conflict',
        updatedAt: now,
      })
      await database.accountWorkflowJournal.put(next)
      assertActiveWorkflowAccountContext(currentEntry.accountHash, database)
      return 'stale_local'
    }

    for (const snapshot of [...currentEntry.snapshots].reverse()) {
      await writeAccountWorkflowLocalPayload(
        snapshot.objectType,
        snapshot.objectId,
        currentEntry.tripId,
        snapshot.before,
        database,
      )
    }

    if (retainJournal) {
      const next = validateAccountWorkflowJournalEntry({
        ...currentEntry,
        conflicts,
        lastErrorCode: errorCode,
        leaseExpiresAt: undefined,
        leaseToken: undefined,
        optimisticResolution: 'rolled_back',
        retryAt: undefined,
        status: 'conflict',
        updatedAt: now,
      })
      await database.accountWorkflowJournal.put(next)
    } else {
      await database.accountWorkflowJournal.delete(batchMutationId)
    }
    assertActiveWorkflowAccountContext(currentEntry.accountHash, database)
    return 'rolled_back'
  })
}

export async function resumeBlockedAuthAccountWorkflows(
  now = Date.now(),
  database: TravelConsoleDatabase = getActiveTravelDatabase(),
  accountHash?: string,
) {
  const activeAccountHash = getActiveAccountHash()
  if (!activeAccountHash) throw new AccountWorkflowJournalError('account_context_mismatch')
  assertActiveWorkflowAccountContext(activeAccountHash, database)
  if (accountHash !== undefined && accountHash !== activeAccountHash) return 0
  return database.transaction('rw', database.accountWorkflowJournal, async () => {
    const entries = (await database.accountWorkflowJournal.where('status').equals('blocked_auth').toArray())
      .map(validateAccountWorkflowJournalEntry)
      .filter((entry) => entry.accountHash === activeAccountHash)
    if (entries.length === 0) return 0
    await database.accountWorkflowJournal.bulkPut(entries.map((entry) => ({
      ...entry,
      lastErrorCode: undefined,
      leaseExpiresAt: undefined,
      leaseToken: undefined,
      retryAt: undefined,
      status: 'pending' as const,
      updatedAt: now,
    })))
    assertActiveWorkflowAccountContext(activeAccountHash, database)
    return entries.length
  })
}

export async function recoverTerminalOptimisticAccountWorkflows({
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
  assertActiveWorkflowAccountContext(accountHash, database)
  const candidates = (await database.accountWorkflowJournal
    .where('status')
    .anyOf('blocked_contract', 'conflict')
    .toArray())
    .map(validateAccountWorkflowJournalEntry)
    .filter((entry) => (
      entry.accountHash === accountHash
      && entry.optimisticResolution === undefined
      && entry.serverAcknowledgedAt === undefined
    ))
    .sort(compareWorkflowOrder)
    .slice(0, Math.max(0, Math.min(limit, 100)))
  let recovered = 0
  let staleLocal = 0
  for (const entry of candidates) {
    const result = await reconcileOptimisticAccountWorkflowFailure(entry.batchMutationId, {
      conflicts: entry.conflicts,
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

export function computeAccountWorkflowRetryAt(attempts: number, now = Date.now()) {
  const exponent = Math.max(0, Math.min(attempts - 1, 8))
  return now + Math.min(1_000 * (2 ** exponent), MAX_RETRY_DELAY_MS)
}

async function captureWorkflowSnapshots(
  request: AccountWorkflowRequestV1,
  database: TravelConsoleDatabase,
) {
  return Promise.all(request.steps.map(async (step): Promise<AccountWorkflowLocalSnapshotV1> => ({
    before: await readAccountWorkflowLocalPayload(
      step.objectType,
      step.objectId,
      request.tripId,
      database,
    ),
    objectId: step.objectId,
    objectKey: buildAccountObjectKey(step.objectType, step.objectId),
    objectType: step.objectType,
    stepId: step.stepId,
  })))
}

async function assertWorkflowBaselines(
  request: AccountWorkflowRequestV1,
  snapshots: AccountWorkflowLocalSnapshotV1[],
  database: TravelConsoleDatabase,
) {
  const snapshotByStep = new Map(snapshots.map((snapshot) => [snapshot.stepId, snapshot]))
  for (const step of request.steps) {
    const snapshot = snapshotByStep.get(step.stepId)
    if (!snapshot) throw new AccountWorkflowJournalError('invalid_snapshot')
    const revision = await database.accountObjectRevisions.get(snapshot.objectKey)
    const currentRevision = revision?.revision ?? 0
    if (step.expectedRevision !== currentRevision) {
      throw new AccountWorkflowJournalError('stale_revision')
    }
    if (snapshot.before !== null && !revision) {
      throw new AccountWorkflowJournalError('unbootstrapped')
    }
    if (
      revision
      && (
        revision.objectId !== step.objectId
        || revision.objectType !== step.objectType
        || revision.tripId !== request.tripId
        || revision.objectSchemaVersion !== step.objectSchemaVersion
        || revision.tombstone !== (snapshot.before === null)
        || !sameJson(revision.payload, snapshot.before)
      )
    ) {
      throw new AccountWorkflowJournalError('stale_revision')
    }
    if (step.operation === 'delete' && snapshot.before === null) {
      throw new AccountWorkflowJournalError('invalid_snapshot')
    }
  }
}

async function assertOptimisticStateMatchesRequest(
  request: AccountWorkflowRequestV1,
  database: TravelConsoleDatabase,
) {
  for (const step of request.steps) {
    const current = await readAccountWorkflowLocalPayload(
      step.objectType,
      step.objectId,
      request.tripId,
      database,
    )
    const expected = step.operation === 'delete' ? null : step.payload ?? null
    if (!sameJson(current, expected)) {
      throw new AccountWorkflowJournalError('invalid_snapshot')
    }
  }
}

async function workflowLocalStateMatchesAfter(
  entry: AccountWorkflowJournalEntry,
  database: TravelConsoleDatabase,
) {
  for (const step of entry.request.steps) {
    const current = await readAccountWorkflowLocalPayload(
      step.objectType,
      step.objectId,
      entry.tripId,
      database,
    )
    const expected = step.operation === 'delete' ? null : step.payload ?? null
    if (!sameJson(current, expected)) return false
  }
  return true
}

function normalizeSnapshots(
  request: AccountWorkflowRequestV1,
  snapshots: AccountWorkflowLocalSnapshotV1[],
) {
  if (!Array.isArray(snapshots) || snapshots.length !== request.steps.length) {
    throw new AccountWorkflowJournalError('invalid_snapshot')
  }
  const byStep = new Map<string, AccountWorkflowLocalSnapshotV1>()
  for (const snapshot of snapshots) {
    if (
      !snapshot
      || typeof snapshot !== 'object'
      || Object.keys(snapshot).some((key) => !SNAPSHOT_FIELDS.has(key))
      || byStep.has(snapshot.stepId)
    ) {
      throw new AccountWorkflowJournalError('invalid_snapshot')
    }
    byStep.set(snapshot.stepId, snapshot)
  }
  return request.steps.map((step): AccountWorkflowLocalSnapshotV1 => {
    const snapshot = byStep.get(step.stepId)
    const objectKey = buildAccountObjectKey(step.objectType, step.objectId)
    if (
      !snapshot
      || snapshot.objectId !== step.objectId
      || snapshot.objectType !== step.objectType
      || snapshot.objectKey !== objectKey
      || (snapshot.before !== null && (!snapshot.before || typeof snapshot.before !== 'object'))
    ) {
      throw new AccountWorkflowJournalError('invalid_snapshot')
    }
    return {
      before: snapshot.before === null
        ? null
        : encodeAccountWorkflowLocalPayload(
            step.objectType,
            step.objectId,
            request.tripId,
            snapshot.before,
          ),
      objectId: step.objectId,
      objectKey,
      objectType: step.objectType,
      stepId: step.stepId,
    }
  })
}

async function assertObjectsAreIdle(
  objectKeys: string[],
  database: TravelConsoleDatabase,
) {
  const [singleCount, workflowCount] = await Promise.all([
    database.accountMutationJournal.where('objectKey').anyOf(objectKeys).count(),
    database.accountWorkflowJournal.where('objectKeys').anyOf(objectKeys).count(),
  ])
  if (singleCount > 0 || workflowCount > 0) {
    throw new AccountWorkflowJournalError('object_busy')
  }
}

async function hasEarlierObjectWork(
  entry: AccountWorkflowJournalEntry,
  database: TravelConsoleDatabase,
) {
  const [singleEntries, workflowEntries] = await Promise.all([
    database.accountMutationJournal.where('objectKey').anyOf(entry.objectKeys).toArray(),
    database.accountWorkflowJournal.where('objectKeys').anyOf(entry.objectKeys).toArray(),
  ])
  if (singleEntries.some((candidate) => compareSingleToWorkflow(candidate, entry) < 0)) return true
  return workflowEntries.some((candidate) => (
    candidate.batchMutationId !== entry.batchMutationId
    && compareWorkflowOrder(validateAccountWorkflowJournalEntry(candidate), entry) < 0
  ))
}

async function updateWorkflowEntry(
  batchMutationId: string,
  update: (entry: AccountWorkflowJournalEntry) => AccountWorkflowJournalEntry,
  leaseToken?: string,
  database: TravelConsoleDatabase = getActiveTravelDatabase(),
) {
  return database.transaction('rw', database.accountWorkflowJournal, async () => {
    const raw = await database.accountWorkflowJournal.get(batchMutationId)
    if (!raw) throw new AccountWorkflowJournalError('unknown_batch')
    const entry = validateAccountWorkflowJournalEntry(raw)
    assertActiveWorkflowAccountContext(entry.accountHash, database)
    if (hasLeaseMismatch(entry, leaseToken)) {
      throw new AccountWorkflowJournalError('stale_lease')
    }
    const next = validateAccountWorkflowJournalEntry(update(entry))
    await database.accountWorkflowJournal.put(next)
    assertActiveWorkflowAccountContext(entry.accountHash, database)
    return next
  })
}

function hasLeaseMismatch(entry: AccountWorkflowJournalEntry, leaseToken?: string) {
  if (leaseToken !== undefined) return entry.leaseToken !== leaseToken
  return entry.status === 'inflight'
}

function assertActiveWorkflowAccountContext(
  accountHash: string,
  database: TravelConsoleDatabase,
) {
  if (
    getActiveAccountHash() !== accountHash
    || getActiveTravelDatabase() !== database
    || database.name !== buildAccountTravelDatabaseName(accountHash)
  ) {
    throw new AccountWorkflowJournalError('account_context_mismatch')
  }
}

function normalizeConflicts(
  conflicts: AccountWorkflowConflictV1[] | undefined,
  request: AccountWorkflowRequestV1,
) {
  if (conflicts === undefined) return undefined
  try {
    const result = assertAccountWorkflowResultMatchesRequest(
      parseAccountWorkflowRunResultV1({
        batchMutationId: request.batchMutationId,
        conflicts,
        reason: 'revision_mismatch',
        schemaVersion: 1,
        status: 'conflict',
        tripId: request.tripId,
        workflowId: request.workflowId,
      }),
      request,
    )
    if (result.status !== 'conflict') throw new Error('invalid conflict')
    return result.conflicts
  } catch {
    throw new AccountWorkflowJournalError('invalid_entry')
  }
}

function isRunnable(entry: AccountWorkflowJournalEntry, now: number) {
  if (entry.status === 'pending') return true
  if (entry.status === 'retry') return (entry.retryAt ?? 0) <= now
  return entry.status === 'inflight' && (entry.leaseExpiresAt ?? 0) <= now
}

function compareWorkflowOrder(left: AccountWorkflowJournalEntry, right: AccountWorkflowJournalEntry) {
  return left.createdAt - right.createdAt
    || left.batchMutationId.localeCompare(right.batchMutationId)
}

function compareSingleToWorkflow(
  left: AccountMutationJournalEntry,
  right: AccountWorkflowJournalEntry,
) {
  return left.createdAt - right.createdAt
    || `mutation:${left.mutationId}`.localeCompare(`workflow:${right.batchMutationId}`)
}

function hasSameWorkflowContent(
  left: AccountWorkflowJournalEntry,
  right: AccountWorkflowJournalEntry,
) {
  return left.accountHash === right.accountHash
    && left.batchMutationId === right.batchMutationId
    && left.requestFingerprint === right.requestFingerprint
    && sameJson(left.request, right.request)
    && sameJson(left.snapshots, right.snapshots)
}

function fingerprintWorkflow(request: AccountWorkflowRequestV1) {
  const canonical = stableStringify(request)
  let hash = 2166136261
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}:${canonical.length}`
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
