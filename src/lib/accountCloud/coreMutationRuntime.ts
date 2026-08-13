import type { Table } from 'dexie'
import {
  getActiveTravelDatabase,
  type TravelConsoleDatabase,
} from '../../db/database'
import type { Day, ItineraryItem, Trip } from '../../types'
import { buildAccountTravelDatabaseName } from '../accountDatabase'
import { getActiveAccountHash } from '../accountStorageScope'
import { getObjectSyncDeviceId } from '../objectSyncLocal'
import { createAccountObjectMutationId } from './client'
import {
  processAccountMutation,
  type AccountMutationProcessResult,
} from './coordinator'
import { isAccountCloudV2AccountEnabled } from './feature'
import {
  buildAccountMutationJournalEntry,
  buildAccountObjectKey,
  getAccountMutationJournalEntry,
  getAccountObjectRevision,
  listAccountMutationsByObject,
  putAccountMutationIntent,
} from './localStore'
import type { AccountMutationJournalEntry } from './localTypes'
import { buildAccountObjectUpsertMutation } from './mutationBuilder'

export type CoreAccountObjectType = 'day' | 'item' | 'trip'

export type CoreAccountObjectByType = {
  day: Day
  item: ItineraryItem
  trip: Trip
}

export type CoreAccountCloudResult<T> =
  | { handled: false }
  | { handled: true; value: T }

export type AccountCloudWriteErrorCode =
  | 'authentication_required'
  | 'conflict'
  | 'contract_unavailable'
  | 'invalid_state'
  | 'rejected'

export class AccountCloudWriteError extends Error {
  readonly code: AccountCloudWriteErrorCode

  constructor(code: AccountCloudWriteErrorCode) {
    super(messageForWriteError(code))
    this.name = 'AccountCloudWriteError'
    this.code = code
  }
}

export type CoreCreateInput<T extends CoreAccountObjectType> = {
  apply: () => Promise<CoreAccountObjectByType[T]>
  objectType: T
  tripId?: string
}

export type CoreUpdateInput<T extends CoreAccountObjectType> = {
  apply: () => Promise<CoreAccountObjectByType[T] | undefined>
  objectId: string
  objectType: T
  tripId: string
}

type OptimisticSnapshot<T extends CoreAccountObjectType> = {
  object: CoreAccountObjectByType[T]
  previous?: CoreAccountObjectByType[T]
}

export async function createCoreAccountObject<T extends CoreAccountObjectType>(
  input: CoreCreateInput<T>,
): Promise<CoreAccountCloudResult<CoreAccountObjectByType[T]>> {
  if (!isAccountCloudRuntimeEnabled()) return { handled: false }

  const { accountHash, database } = requireActiveAccountContext()
  const mutationId = createAccountObjectMutationId()
  let snapshot: OptimisticSnapshot<T> | undefined
  let journalEntry: AccountMutationJournalEntry | undefined

  await database.transaction('rw', coreTransactionTables(database, input.objectType), async () => {
    assertActiveAccountContext(accountHash, database)
    const object = await input.apply()
    assertActiveAccountContext(accountHash, database)
    const tripId = getCoreTripId(input.objectType, object)
    if (input.tripId && input.tripId !== tripId) {
      throw new AccountCloudWriteError('invalid_state')
    }
    const objectKey = buildAccountObjectKey(input.objectType, object.id)
    const [revision, pending] = await Promise.all([
      getAccountObjectRevision(objectKey, database),
      listAccountMutationsByObject(objectKey, database),
    ])
    if (revision || pending.length > 0) {
      throw new AccountCloudWriteError('conflict')
    }
    const mutation = buildCoreUpsertMutation(input.objectType, object, {
      deviceId: getObjectSyncDeviceId(),
      expectedRevision: 0,
      mutationId,
      tripId,
    })
    journalEntry = {
      ...buildAccountMutationJournalEntry(mutation, accountHash, Date.now()),
      optimisticAfter: mutation.payload,
      optimisticBefore: null,
    }
    await putAccountMutationIntent(journalEntry, database)
    snapshot = { object }
  })

  if (!snapshot || !journalEntry) throw new AccountCloudWriteError('invalid_state')
  await settleOptimisticWrite(input.objectType, snapshot, journalEntry, database)
  return { handled: true, value: snapshot.object }
}

export async function updateCoreAccountObject<T extends CoreAccountObjectType>(
  input: CoreUpdateInput<T>,
): Promise<CoreAccountCloudResult<CoreAccountObjectByType[T] | undefined>> {
  if (!isAccountCloudRuntimeEnabled()) return { handled: false }

  const { accountHash, database } = requireActiveAccountContext()
  const mutationId = createAccountObjectMutationId()
  const table = getCoreTable(database, input.objectType)
  let fallback = false
  let snapshot: OptimisticSnapshot<T> | undefined
  let journalEntry: AccountMutationJournalEntry | undefined

  await database.transaction('rw', coreTransactionTables(database, input.objectType), async () => {
    assertActiveAccountContext(accountHash, database)
    const previous = await table.get(input.objectId)
    if (!previous) return
    if (getCoreTripId(input.objectType, previous) !== input.tripId) {
      throw new AccountCloudWriteError('invalid_state')
    }

    const objectKey = buildAccountObjectKey(input.objectType, input.objectId)
    const [revision, pending] = await Promise.all([
      getAccountObjectRevision(objectKey, database),
      listAccountMutationsByObject(objectKey, database),
    ])
    const nextRevision = resolveNextExpectedRevision({
      objectId: input.objectId,
      objectType: input.objectType,
      pending,
      revision,
      tripId: input.tripId,
    })
    if (nextRevision === null) {
      fallback = true
      return
    }
    assertCoreOptimisticBaseline(previous, pending, revision)

    assertActiveAccountContext(accountHash, database)
    const object = await input.apply()
    assertActiveAccountContext(accountHash, database)
    if (!object) return
    if (object.id !== input.objectId || getCoreTripId(input.objectType, object) !== input.tripId) {
      throw new AccountCloudWriteError('invalid_state')
    }
    const mutation = buildCoreUpsertMutation(input.objectType, object, {
      deviceId: getObjectSyncDeviceId(),
      expectedRevision: nextRevision,
      mutationId,
      tripId: input.tripId,
    })
    const createdAt = Math.max(
      Date.now(),
      ...pending.map((entry) => entry.createdAt + 1),
    )
    const previousMutation = buildCoreUpsertMutation(input.objectType, previous, {
      deviceId: mutation.deviceId,
      expectedRevision: mutation.expectedRevision,
      mutationId: mutation.mutationId,
      tripId: mutation.tripId,
    })
    journalEntry = {
      ...buildAccountMutationJournalEntry(mutation, accountHash, createdAt),
      optimisticAfter: mutation.payload,
      optimisticBefore: previousMutation.payload,
    }
    await putAccountMutationIntent(journalEntry, database)
    snapshot = {
      object,
      previous,
    }
  })

  if (fallback) return { handled: false }
  if (!snapshot || !journalEntry) return { handled: true, value: undefined }
  await settleOptimisticWrite(input.objectType, snapshot, journalEntry, database)
  return { handled: true, value: snapshot.object }
}

async function settleOptimisticWrite<T extends CoreAccountObjectType>(
  objectType: T,
  snapshot: OptimisticSnapshot<T>,
  journalEntry: AccountMutationJournalEntry,
  database: TravelConsoleDatabase,
) {
  let result: AccountMutationProcessResult
  try {
    result = await processAccountMutation(journalEntry.mutationId, {
      database,
      reconcileOptimistic: true,
    })
  } catch {
    throw new AccountCloudWriteError('invalid_state')
  }

  if (!hasActiveAccountContext(journalEntry.accountHash, database)) return

  if (
    result.status === 'committed'
    || result.status === 'queued_offline'
    || result.status === 'retry_scheduled'
  ) {
    return
  }

  if (result.status === 'blocked_auth') {
    throw new AccountCloudWriteError('authentication_required')
  }
  if (result.status === 'conflict') {
    throw new AccountCloudWriteError('conflict')
  }
  if (result.status === 'rejected') {
    throw new AccountCloudWriteError('rejected')
  }
  if (result.status === 'blocked_contract') {
    throw new AccountCloudWriteError('contract_unavailable')
  }

  if (result.status === 'missing' || result.status === 'not_runnable') {
    const pending = await getAccountMutationJournalEntry(journalEntry.mutationId, database)
    if (!hasActiveAccountContext(journalEntry.accountHash, database)) return
    if (pending?.status === 'pending' || pending?.status === 'retry' || pending?.status === 'inflight') {
      return
    }
    const revision = await getAccountObjectRevision(journalEntry.objectKey, database)
    if (revision?.mutationId === journalEntry.mutationId) return
    if (pending?.status === 'blocked_auth') {
      throw new AccountCloudWriteError('authentication_required')
    }
    if (pending?.status === 'conflict') {
      throw new AccountCloudWriteError('conflict')
    }
    if (pending?.status === 'blocked_contract') {
      throw new AccountCloudWriteError('contract_unavailable')
    }

    const rolledBack = await rollbackOrphanedOptimisticWrite(
      objectType,
      snapshot,
      journalEntry.accountHash,
      database,
    )
    if (!rolledBack) throw new AccountCloudWriteError('conflict')
  }
  throw new AccountCloudWriteError('invalid_state')
}

async function rollbackOrphanedOptimisticWrite<T extends CoreAccountObjectType>(
  objectType: T,
  snapshot: OptimisticSnapshot<T>,
  accountHash: string,
  database: TravelConsoleDatabase,
) {
  const table = getCoreTable(database, objectType)
  return database.transaction('rw', table, async () => {
    if (!hasActiveAccountContext(accountHash, database)) return false
    const current = await table.get(snapshot.object.id)
    if (!sameRecord(current, snapshot.object)) return false

    if (snapshot.previous) {
      await table.put(snapshot.previous)
    } else {
      await table.delete(snapshot.object.id)
    }
    return true
  })
}

function resolveNextExpectedRevision({
  objectId,
  objectType,
  pending,
  revision,
  tripId,
}: {
  objectId: string
  objectType: CoreAccountObjectType
  pending: AccountMutationJournalEntry[]
  revision: Awaited<ReturnType<typeof getAccountObjectRevision>>
  tripId: string
}) {
  if (
    revision
    && (
      revision.objectId !== objectId
      || revision.objectType !== objectType
      || revision.tripId !== tripId
      || revision.tombstone
    )
  ) {
    throw new AccountCloudWriteError('invalid_state')
  }
  if (pending.some((entry) => entry.status === 'blocked_auth'
    || entry.status === 'blocked_contract'
    || entry.status === 'conflict'
    || entry.operation !== 'upsert')) {
    throw new AccountCloudWriteError('conflict')
  }
  if (pending.length === 0) return revision?.revision ?? null

  let expected = revision?.revision ?? 0
  for (const entry of pending) {
    if (
      entry.expectedRevision !== expected
      || entry.objectId !== objectId
      || entry.objectType !== objectType
      || entry.tripId !== tripId
    ) {
      throw new AccountCloudWriteError('invalid_state')
    }
    expected += 1
  }
  return expected
}

function assertCoreOptimisticBaseline<T extends CoreAccountObjectType>(
  current: CoreAccountObjectByType[T],
  pending: AccountMutationJournalEntry[],
  revision: Awaited<ReturnType<typeof getAccountObjectRevision>>,
) {
  let expected: unknown = revision?.payload ?? null
  for (const entry of pending) {
    if (
      entry.optimisticBefore === undefined
      || entry.optimisticAfter === undefined
      || !sameRecord(entry.optimisticBefore, expected)
    ) {
      throw new AccountCloudWriteError('invalid_state')
    }
    expected = entry.optimisticAfter
  }
  if (!sameRecord(current, expected)) {
    throw new AccountCloudWriteError('invalid_state')
  }
}

function getCoreTable<T extends CoreAccountObjectType>(
  database: TravelConsoleDatabase,
  objectType: T,
): Table<CoreAccountObjectByType[T], string> {
  switch (objectType) {
    case 'day':
      return database.days as unknown as Table<CoreAccountObjectByType[T], string>
    case 'item':
      return database.itineraryItems as unknown as Table<CoreAccountObjectByType[T], string>
    case 'trip':
      return database.trips as unknown as Table<CoreAccountObjectByType[T], string>
  }
}

function buildCoreUpsertMutation<T extends CoreAccountObjectType>(
  objectType: T,
  object: CoreAccountObjectByType[T],
  options: {
    deviceId: string
    expectedRevision: number
    mutationId: string
    tripId: string
  },
) {
  switch (objectType) {
    case 'day':
      return buildAccountObjectUpsertMutation('day', object as Day, options)
    case 'item':
      return buildAccountObjectUpsertMutation('item', object as ItineraryItem, options)
    case 'trip':
      return buildAccountObjectUpsertMutation('trip', object as Trip, options)
  }
}

function coreTransactionTables(
  database: TravelConsoleDatabase,
  objectType: CoreAccountObjectType,
) {
  const common = [
    database.accountMutationJournal,
    database.accountObjectRevisions,
    database.accountWorkflowJournal,
    database.trips,
  ]
  switch (objectType) {
    case 'day':
      return [...common, database.days]
    case 'item':
      return [...common, database.itineraryItems]
    case 'trip':
      return common
  }
}

function getCoreTripId<T extends CoreAccountObjectType>(
  objectType: T,
  object: CoreAccountObjectByType[T],
) {
  return objectType === 'trip' ? object.id : (object as Day | ItineraryItem).tripId
}

function sameRecord(left: unknown, right: unknown) {
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

function messageForWriteError(code: AccountCloudWriteErrorCode) {
  switch (code) {
    case 'authentication_required':
      return '登录已过期，请重新登录后重试。'
    case 'conflict':
      return '账号中的内容已变化，请刷新后重试。'
    case 'contract_unavailable':
      return '账号保存暂时不可用，请稍后重试。'
    case 'invalid_state':
      return '本次修改未能安全保存，请刷新后重试。'
    case 'rejected':
      return '本次修改不符合账号保存规则。'
  }
}

function isAccountCloudRuntimeEnabled() {
  return isAccountCloudV2AccountEnabled(getActiveAccountHash())
}

function requireActiveAccountContext() {
  const accountHash = getActiveAccountHash()
  if (!accountHash) throw new AccountCloudWriteError('authentication_required')
  const database = getActiveTravelDatabase()
  if (database.name !== buildAccountTravelDatabaseName(accountHash)) {
    throw new AccountCloudWriteError('authentication_required')
  }
  return { accountHash, database }
}

function assertActiveAccountContext(
  accountHash: string,
  database: TravelConsoleDatabase,
) {
  if (!hasActiveAccountContext(accountHash, database)) {
    throw new AccountCloudWriteError('authentication_required')
  }
}

function hasActiveAccountContext(
  accountHash: string,
  database: TravelConsoleDatabase,
) {
  return getActiveAccountHash() === accountHash
    && getActiveTravelDatabase() === database
    && database.name === buildAccountTravelDatabaseName(accountHash)
}
