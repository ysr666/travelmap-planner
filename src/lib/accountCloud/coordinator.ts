import {
  AccountCloudTransportError,
  commitAccountObjectMutationV1,
} from './client'
import {
  ACCOUNT_CLOUD_SCHEMA_VERSION,
  type AccountObjectMutationResultV1,
  type AccountObjectMutationV1,
} from './contract'
import {
  acknowledgeAccountMutation,
  AccountMutationJournalError,
  getAccountMutationJournalEntry,
  getAccountObjectRevision,
  leaseAccountMutation,
  listRunnableAccountMutations,
  markAccountMutationBlocked,
  markAccountMutationConflict,
  markAccountMutationForRetry,
  markAccountMutationPending,
  reconcileOptimisticAccountMutationFailure,
} from './localStore'
import type { AccountMutationJournalEntry } from './localTypes'
import { getActiveAccountHash } from '../accountStorageScope'
import {
  getActiveTravelDatabase,
  type TravelConsoleDatabase,
} from '../../db/database'

export type AccountMutationCommit = (
  mutation: AccountObjectMutationV1,
) => Promise<AccountObjectMutationResultV1>

export type AccountMutationProcessResult =
  | { status: 'blocked_auth'; mutationId: string }
  | { status: 'blocked_contract'; mutationId: string }
  | { status: 'committed'; mutationId: string; revision: number; replayed: boolean }
  | { status: 'conflict'; mutationId: string; currentRevision: number | null }
  | { status: 'missing'; mutationId: string }
  | { status: 'not_runnable'; mutationId: string }
  | { status: 'queued_offline'; mutationId: string }
  | { status: 'rejected'; mutationId: string }
  | { status: 'retry_scheduled'; mutationId: string; retryAt: number }

export type AccountMutationCoordinatorOptions = {
  commit?: AccountMutationCommit
  database?: TravelConsoleDatabase
  isOnline?: () => boolean
  leaseMs?: number
  now?: () => number
  reconcileOptimistic?: boolean
}

export type AccountMutationDrainResult = {
  processed: AccountMutationProcessResult[]
  skippedMutationIds: string[]
}

export async function processAccountMutation(
  mutationId: string,
  options: AccountMutationCoordinatorOptions = {},
): Promise<AccountMutationProcessResult> {
  const now = options.now?.() ?? Date.now()
  const database = options.database ?? getActiveTravelDatabase()
  const existing = await getAccountMutationJournalEntry(mutationId, database)
  if (!existing) return { mutationId, status: 'missing' }
  if (!hasMatchingActiveAccount(existing)) return { mutationId, status: 'not_runnable' }

  if (!(options.isOnline ?? defaultIsOnline)()) {
    const canQueue = existing.status === 'pending'
      || (existing.status === 'retry' && (existing.retryAt ?? 0) <= now)
      || (existing.status === 'inflight' && (existing.leaseExpiresAt ?? 0) <= now)
    if (!canQueue) return { mutationId, status: 'not_runnable' }
    await markAccountMutationPending(mutationId, now, existing.leaseToken, database)
    return { mutationId, status: 'queued_offline' }
  }

  const entry = await leaseAccountMutation(mutationId, {
    database,
    ...(options.leaseMs === undefined ? {} : { leaseMs: options.leaseMs }),
    now,
  })
  if (!entry) return { mutationId, status: 'not_runnable' }
  if (!hasMatchingActiveAccount(entry)) return { mutationId, status: 'not_runnable' }

  let result: AccountObjectMutationResultV1
  try {
    result = options.commit
      ? await options.commit(mutationFromEntry(entry))
      : await commitAccountObjectMutationV1(mutationFromEntry(entry), undefined, entry.accountHash)
  } catch (error) {
    if (!hasMatchingActiveAccount(entry)) return { mutationId, status: 'not_runnable' }
    return persistTransportFailure(
      entry,
      error,
      options.now?.() ?? Date.now(),
      shouldReconcileOptimistic(entry, options),
      database,
    )
  }
  if (!hasMatchingActiveAccount(entry)) return { mutationId, status: 'not_runnable' }
  return persistMutationResult(entry, result, options, now, database)
}

async function persistMutationResult(
  entry: AccountMutationJournalEntry,
  result: AccountObjectMutationResultV1,
  options: AccountMutationCoordinatorOptions,
  now: number,
  database: TravelConsoleDatabase,
): Promise<AccountMutationProcessResult> {
  const mutationId = entry.mutationId
  const reconcileOptimistic = shouldReconcileOptimistic(entry, options)
  try {
    if (result.status === 'applied' || result.status === 'idempotent') {
      if (result.status === 'idempotent' && result.currentRevision > result.appliedRevision) {
        const reconciled = await persistAccountMutationConflict(
          entry,
          result.object,
          now,
          reconcileOptimistic,
          database,
        )
        if (reconciled === 'stale_lease' || reconciled === 'missing') {
          return { mutationId, status: 'not_runnable' }
        }
        return { currentRevision: result.currentRevision, mutationId, status: 'conflict' }
      }

      try {
        const revision = await acknowledgeAccountMutation(
          mutationId,
          result,
          now,
          entry.leaseToken,
          database,
        )
        return {
          mutationId,
          replayed: result.status === 'idempotent',
          revision: revision.revision,
          status: 'committed',
        }
      } catch (error) {
        if (!(error instanceof AccountMutationJournalError)) throw error
        if (error.code === 'stale_lease') return { mutationId, status: 'not_runnable' }
        if (error.code === 'unknown_mutation') {
          const revision = await getAccountObjectRevision(entry.objectKey, database)
          if (revision?.mutationId === mutationId) {
            return {
              mutationId,
              replayed: true,
              revision: revision.revision,
              status: 'committed',
            }
          }
          return { mutationId, status: revision ? 'not_runnable' : 'missing' }
        }
        if (error.code !== 'stale_ack') throw error
        const reconciled = await persistAccountMutationConflict(
          entry,
          result.object,
          now,
          reconcileOptimistic,
          database,
        )
        if (reconciled === 'stale_lease' || reconciled === 'missing') {
          return { mutationId, status: 'not_runnable' }
        }
        return { currentRevision: result.currentRevision, mutationId, status: 'conflict' }
      }
    }

    if (result.status === 'conflict') {
      const reconciled = await persistAccountMutationConflict(
        entry,
        result.currentObject,
        now,
        reconcileOptimistic,
        database,
      )
      if (reconciled === 'stale_lease' || reconciled === 'missing') {
        return { mutationId, status: 'not_runnable' }
      }
      return { currentRevision: result.currentRevision, mutationId, status: 'conflict' }
    }

    if (result.status !== 'rejected') {
      throw new Error(`Unsupported account mutation result: ${result.status}`)
    }

    if (result.reason === 'account_context_mismatch') {
      await markAccountMutationBlocked(
        mutationId,
        'blocked_auth',
        'authentication_required',
        now,
        entry.leaseToken,
        database,
      )
      return { mutationId, status: 'blocked_auth' }
    }

    if (isConflictRejection(result.reason)) {
      const reconciled = reconcileOptimistic
        ? await reconcileOptimisticAccountMutationFailure(mutationId, {
            database,
            errorCode: 'server_rejected',
            leaseToken: entry.leaseToken,
            now,
            retainJournal: true,
          })
        : 'not_applicable'
      if (reconciled === 'stale_lease' || reconciled === 'missing') {
        return { mutationId, status: 'not_runnable' }
      }
      if (reconciled === 'not_applicable') {
        await markAccountMutationConflict(mutationId, null, now, entry.leaseToken, database)
      }
      return { currentRevision: null, mutationId, status: 'conflict' }
    }

    if (reconcileOptimistic) {
      const reconciled = await reconcileOptimisticAccountMutationFailure(mutationId, {
        errorCode: 'server_rejected',
        leaseToken: entry.leaseToken,
        now,
        retainJournal: false,
        database,
      })
      if (reconciled === 'stale_lease') return { mutationId, status: 'not_runnable' }
      if (reconciled === 'missing') return { mutationId, status: 'not_runnable' }
      if (reconciled !== 'not_applicable') return { mutationId, status: 'rejected' }
    }
    await markAccountMutationBlocked(
      mutationId,
      'blocked_contract',
      'server_rejected',
      now,
      entry.leaseToken,
      database,
    )
    return { mutationId, status: 'rejected' }
  } catch (error) {
    if (isObsoleteLeaseError(error)) return { mutationId, status: 'not_runnable' }
    throw error
  }
}

export async function drainAccountMutationJournal(
  options: AccountMutationCoordinatorOptions & { limit?: number; tripId?: string } = {},
): Promise<AccountMutationDrainResult> {
  const database = options.database ?? getActiveTravelDatabase()
  const entries = await listRunnableAccountMutations({
    database,
    limit: options.limit,
    now: options.now?.() ?? Date.now(),
    tripId: options.tripId,
  })
  const blockedObjects = new Set<string>()
  const processed: AccountMutationProcessResult[] = []
  const skippedMutationIds: string[] = []

  for (const [index, entry] of entries.entries()) {
    if (blockedObjects.has(entry.objectKey)) {
      skippedMutationIds.push(entry.mutationId)
      continue
    }
    const result = await processAccountMutation(entry.mutationId, { ...options, database })
    processed.push(result)
    if (result.status !== 'committed' && result.status !== 'missing') {
      blockedObjects.add(entry.objectKey)
    }
    if (result.status === 'queued_offline') {
      for (const remaining of entries.slice(index + 1)) {
        if (!skippedMutationIds.includes(remaining.mutationId)) {
          skippedMutationIds.push(remaining.mutationId)
        }
      }
      break
    }
  }

  return { processed, skippedMutationIds }
}

function mutationFromEntry(entry: AccountMutationJournalEntry): AccountObjectMutationV1 {
  return {
    deviceId: entry.deviceId,
    expectedRevision: entry.expectedRevision,
    mutationId: entry.mutationId,
    objectId: entry.objectId,
    objectSchemaVersion: entry.objectSchemaVersion,
    objectType: entry.objectType,
    operation: entry.operation,
    ...(entry.payload ? { payload: entry.payload } : {}),
    schemaVersion: ACCOUNT_CLOUD_SCHEMA_VERSION,
    tripId: entry.tripId,
  }
}

async function persistTransportFailure(
  entry: AccountMutationJournalEntry,
  error: unknown,
  now: number,
  reconcileOptimistic: boolean,
  database: TravelConsoleDatabase,
): Promise<AccountMutationProcessResult> {
  try {
    if (!(error instanceof AccountCloudTransportError)) {
      if (entry.optimisticAfter && reconcileOptimistic) {
        const reconciled = await reconcileOptimisticAccountMutationFailure(entry.mutationId, {
          errorCode: 'request_failed',
          database,
          leaseToken: entry.leaseToken,
          now,
          retainJournal: false,
        })
        if (reconciled === 'stale_lease' || reconciled === 'missing') {
          return { mutationId: entry.mutationId, status: 'not_runnable' }
        }
        if (reconciled !== 'not_applicable') {
          return { mutationId: entry.mutationId, status: 'blocked_contract' }
        }
      }
      await markAccountMutationBlocked(
        entry.mutationId,
        'blocked_contract',
        'request_failed',
        now,
        entry.leaseToken,
        database,
      )
      return { mutationId: entry.mutationId, status: 'blocked_contract' }
    }
    if (error.code === 'authentication_required') {
      await markAccountMutationBlocked(
        entry.mutationId,
        'blocked_auth',
        error.code,
        now,
        entry.leaseToken,
        database,
      )
      return { mutationId: entry.mutationId, status: 'blocked_auth' }
    }
    if (error.retryable) {
      const updated = await markAccountMutationForRetry(
        entry.mutationId,
        error.code,
        now,
        entry.leaseToken,
        database,
      )
      return {
        mutationId: entry.mutationId,
        retryAt: updated.retryAt ?? now,
        status: 'retry_scheduled',
      }
    }
    if (reconcileOptimistic) {
      const reconciled = await reconcileOptimisticAccountMutationFailure(entry.mutationId, {
        errorCode: error.code,
        database,
        leaseToken: entry.leaseToken,
        now,
        retainJournal: false,
      })
      if (reconciled === 'stale_lease' || reconciled === 'missing') {
        return { mutationId: entry.mutationId, status: 'not_runnable' }
      }
      if (reconciled !== 'not_applicable') {
        return { mutationId: entry.mutationId, status: 'blocked_contract' }
      }
    }
    await markAccountMutationBlocked(
      entry.mutationId,
      'blocked_contract',
      error.code,
      now,
      entry.leaseToken,
      database,
    )
    return { mutationId: entry.mutationId, status: 'blocked_contract' }
  } catch (transitionError) {
    if (isObsoleteLeaseError(transitionError)) {
      return { mutationId: entry.mutationId, status: 'not_runnable' }
    }
    throw transitionError
  }
}

async function persistAccountMutationConflict(
  entry: AccountMutationJournalEntry,
  conflictObject: Parameters<typeof markAccountMutationConflict>[1],
  now: number,
  reconcileOptimistic: boolean,
  database: TravelConsoleDatabase,
) {
  const reconciled = reconcileOptimistic
    ? await reconcileOptimisticAccountMutationFailure(entry.mutationId, {
        conflictObject,
        database,
        errorCode: 'server_conflict',
        leaseToken: entry.leaseToken,
        now,
        retainJournal: true,
      })
    : 'not_applicable' as const
  if (reconciled === 'not_applicable') {
    await markAccountMutationConflict(
      entry.mutationId,
      conflictObject,
      now,
      entry.leaseToken,
      database,
    )
  }
  return reconciled
}

function hasMatchingActiveAccount(entry: AccountMutationJournalEntry) {
  return getActiveAccountHash() === entry.accountHash
}

function shouldReconcileOptimistic(
  entry: AccountMutationJournalEntry,
  options: AccountMutationCoordinatorOptions,
) {
  return options.reconcileOptimistic === true
    || (entry.optimisticAfter !== undefined && entry.optimisticBefore !== undefined)
}

function isObsoleteLeaseError(error: unknown) {
  return error instanceof AccountMutationJournalError
    && (error.code === 'stale_lease' || error.code === 'unknown_mutation')
}

function isConflictRejection(reason: Extract<
  AccountObjectMutationResultV1,
  { status: 'rejected' }
>['reason']) {
  return reason === 'mutation_id_reused'
    || reason === 'object_trip_mismatch'
    || reason === 'receipt_object_missing'
}

function defaultIsOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}
