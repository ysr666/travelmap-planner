import {
  getActiveTravelDatabase,
  type TravelConsoleDatabase,
} from '../../db/database'
import { buildAccountTravelDatabaseName } from '../accountDatabase'
import { getActiveAccountHash } from '../accountStorageScope'
import { AccountCloudTransportError } from './client'
import { commitAccountWorkflowV1 } from './workflowClient'
import {
  assertAccountWorkflowResultMatchesRequest,
  parseAccountWorkflowRunResultV1,
  type AccountWorkflowRequestV1,
  type AccountWorkflowRunResultV1,
} from './workflowContract'
import {
  acknowledgeAccountWorkflow,
  AccountWorkflowJournalError,
  getAccountWorkflowJournalEntry,
  leaseAccountWorkflow,
  listRunnableAccountWorkflows,
  markAccountWorkflowBlocked,
  markAccountWorkflowConflictWithoutRollback,
  markAccountWorkflowForRetry,
  markAccountWorkflowPending,
  reconcileOptimisticAccountWorkflowFailure,
} from './workflowLocalStore'
import type { AccountWorkflowJournalEntry } from './workflowLocalTypes'

export type AccountWorkflowCommit = (
  request: AccountWorkflowRequestV1,
) => Promise<AccountWorkflowRunResultV1>

export type AccountWorkflowProcessResult =
  | { status: 'blocked_auth'; batchMutationId: string }
  | { status: 'blocked_contract'; batchMutationId: string }
  | { status: 'committed'; batchMutationId: string; revisions: number[]; replayed: boolean }
  | { status: 'conflict'; batchMutationId: string; conflictCount: number }
  | { status: 'missing'; batchMutationId: string }
  | { status: 'not_runnable'; batchMutationId: string }
  | { status: 'queued_offline'; batchMutationId: string }
  | { status: 'rejected'; batchMutationId: string }
  | { status: 'retry_scheduled'; batchMutationId: string; retryAt: number }

export type AccountWorkflowCoordinatorOptions = {
  commit?: AccountWorkflowCommit
  database?: TravelConsoleDatabase
  isOnline?: () => boolean
  leaseMs?: number
  now?: () => number
}

export type AccountWorkflowDrainResult = {
  processed: AccountWorkflowProcessResult[]
  skippedBatchMutationIds: string[]
}

export async function processAccountWorkflow(
  batchMutationId: string,
  options: AccountWorkflowCoordinatorOptions = {},
): Promise<AccountWorkflowProcessResult> {
  const now = options.now?.() ?? Date.now()
  const database = options.database ?? getActiveTravelDatabase()
  const existing = await getAccountWorkflowJournalEntry(batchMutationId, database)
  if (!existing) return { batchMutationId, status: 'missing' }
  if (!hasMatchingActiveAccount(existing, database)) {
    return { batchMutationId, status: 'not_runnable' }
  }

  if (!(options.isOnline ?? defaultIsOnline)()) {
    const canQueue = existing.status === 'pending'
      || (existing.status === 'retry' && (existing.retryAt ?? 0) <= now)
      || (existing.status === 'inflight' && (existing.leaseExpiresAt ?? 0) <= now)
    if (!canQueue) return { batchMutationId, status: 'not_runnable' }
    await markAccountWorkflowPending(
      batchMutationId,
      now,
      existing.leaseToken,
      database,
    )
    return { batchMutationId, status: 'queued_offline' }
  }

  const entry = await leaseAccountWorkflow(batchMutationId, {
    database,
    ...(options.leaseMs === undefined ? {} : { leaseMs: options.leaseMs }),
    now,
  })
  if (!entry) return { batchMutationId, status: 'not_runnable' }
  if (!hasMatchingActiveAccount(entry, database)) {
    return { batchMutationId, status: 'not_runnable' }
  }

  let result: AccountWorkflowRunResultV1
  try {
    const rawResult = options.commit
      ? await options.commit(entry.request)
      : await commitAccountWorkflowV1(entry.request, undefined, entry.accountHash)
    try {
      result = assertAccountWorkflowResultMatchesRequest(
        parseAccountWorkflowRunResultV1(rawResult),
        entry.request,
      )
    } catch {
      throw new AccountCloudTransportError('invalid_response', true)
    }
  } catch (error) {
    if (!hasMatchingActiveAccount(entry, database)) {
      return { batchMutationId, status: 'not_runnable' }
    }
    return persistWorkflowTransportFailure(
      entry,
      error,
      options.now?.() ?? Date.now(),
      database,
    )
  }
  if (!hasMatchingActiveAccount(entry, database)) {
    return { batchMutationId, status: 'not_runnable' }
  }
  return persistWorkflowResult(entry, result, options.now?.() ?? now, database)
}

export async function drainAccountWorkflowJournal(
  options: AccountWorkflowCoordinatorOptions & { limit?: number; tripId?: string } = {},
): Promise<AccountWorkflowDrainResult> {
  const database = options.database ?? getActiveTravelDatabase()
  const entries = await listRunnableAccountWorkflows({
    database,
    limit: options.limit,
    now: options.now?.() ?? Date.now(),
    tripId: options.tripId,
  })
  const blockedObjectKeys = new Set<string>()
  const processed: AccountWorkflowProcessResult[] = []
  const skippedBatchMutationIds: string[] = []

  for (const [index, entry] of entries.entries()) {
    if (entry.objectKeys.some((objectKey) => blockedObjectKeys.has(objectKey))) {
      skippedBatchMutationIds.push(entry.batchMutationId)
      continue
    }
    const result = await processAccountWorkflow(entry.batchMutationId, { ...options, database })
    processed.push(result)
    if (result.status !== 'committed' && result.status !== 'missing') {
      for (const objectKey of entry.objectKeys) blockedObjectKeys.add(objectKey)
    }
    if (result.status === 'queued_offline') {
      for (const remaining of entries.slice(index + 1)) {
        if (!skippedBatchMutationIds.includes(remaining.batchMutationId)) {
          skippedBatchMutationIds.push(remaining.batchMutationId)
        }
      }
      break
    }
  }
  return { processed, skippedBatchMutationIds }
}

async function persistWorkflowResult(
  entry: AccountWorkflowJournalEntry,
  result: AccountWorkflowRunResultV1,
  now: number,
  database: TravelConsoleDatabase,
): Promise<AccountWorkflowProcessResult> {
  const batchMutationId = entry.batchMutationId
  try {
    if (result.status === 'applied' || result.status === 'idempotent') {
      try {
        const acknowledgement = await acknowledgeAccountWorkflow(
          batchMutationId,
          result,
          now,
          entry.leaseToken,
          database,
        )
        if (acknowledgement.status === 'stale_local') {
          return { batchMutationId, conflictCount: 0, status: 'conflict' }
        }
        return {
          batchMutationId,
          replayed: result.status === 'idempotent',
          revisions: acknowledgement.revisions.map((revision) => revision.revision),
          status: 'committed',
        }
      } catch (error) {
        if (!(error instanceof AccountWorkflowJournalError)) throw error
        if (error.code === 'stale_lease' || error.code === 'unknown_batch') {
          return { batchMutationId, status: 'not_runnable' }
        }
        if (error.code !== 'stale_ack') throw error
        await markAccountWorkflowConflictWithoutRollback(batchMutationId, {
          database,
          errorCode: 'server_conflict',
          leaseToken: entry.leaseToken,
          now,
          serverAcknowledged: true,
        })
        return { batchMutationId, conflictCount: 0, status: 'conflict' }
      }
    }

    if (result.status === 'conflict') {
      const reconciled = await reconcileOptimisticAccountWorkflowFailure(batchMutationId, {
        conflicts: result.conflicts,
        database,
        errorCode: 'server_conflict',
        leaseToken: entry.leaseToken,
        now,
        retainJournal: true,
      })
      if (reconciled === 'missing' || reconciled === 'stale_lease') {
        return { batchMutationId, status: 'not_runnable' }
      }
      return {
        batchMutationId,
        conflictCount: result.conflicts.length,
        status: 'conflict',
      }
    }

    if (result.status !== 'rejected') {
      throw new Error('Unsupported account workflow result.')
    }

    if (result.reason === 'account_context_mismatch') {
      await markAccountWorkflowBlocked(
        batchMutationId,
        'blocked_auth',
        'authentication_required',
        now,
        entry.leaseToken,
        database,
      )
      return { batchMutationId, status: 'blocked_auth' }
    }

    if (isConflictRejection(result.reason)) {
      const reconciled = await reconcileOptimisticAccountWorkflowFailure(batchMutationId, {
        database,
        errorCode: 'server_rejected',
        leaseToken: entry.leaseToken,
        now,
        retainJournal: true,
      })
      if (reconciled === 'missing' || reconciled === 'stale_lease') {
        return { batchMutationId, status: 'not_runnable' }
      }
      return { batchMutationId, conflictCount: 0, status: 'conflict' }
    }

    const reconciled = await reconcileOptimisticAccountWorkflowFailure(batchMutationId, {
      database,
      errorCode: 'server_rejected',
      leaseToken: entry.leaseToken,
      now,
      retainJournal: false,
    })
    if (reconciled === 'missing' || reconciled === 'stale_lease') {
      return { batchMutationId, status: 'not_runnable' }
    }
    if (reconciled === 'stale_local') {
      return { batchMutationId, conflictCount: 0, status: 'conflict' }
    }
    return { batchMutationId, status: 'rejected' }
  } catch (error) {
    if (isObsoleteLeaseError(error)) return { batchMutationId, status: 'not_runnable' }
    throw error
  }
}

async function persistWorkflowTransportFailure(
  entry: AccountWorkflowJournalEntry,
  error: unknown,
  now: number,
  database: TravelConsoleDatabase,
): Promise<AccountWorkflowProcessResult> {
  const batchMutationId = entry.batchMutationId
  try {
    if (error instanceof AccountCloudTransportError) {
      if (error.code === 'authentication_required') {
        await markAccountWorkflowBlocked(
          batchMutationId,
          'blocked_auth',
          error.code,
          now,
          entry.leaseToken,
          database,
        )
        return { batchMutationId, status: 'blocked_auth' }
      }
      if (error.retryable) {
        const updated = await markAccountWorkflowForRetry(
          batchMutationId,
          error.code,
          now,
          entry.leaseToken,
          database,
        )
        return {
          batchMutationId,
          retryAt: updated.retryAt ?? now,
          status: 'retry_scheduled',
        }
      }
      return rollbackTerminalWorkflow(entry, error.code, now, database)
    }
    const updated = await markAccountWorkflowForRetry(
      batchMutationId,
      'request_failed',
      now,
      entry.leaseToken,
      database,
    )
    return {
      batchMutationId,
      retryAt: updated.retryAt ?? now,
      status: 'retry_scheduled',
    }
  } catch (transitionError) {
    if (isObsoleteLeaseError(transitionError)) {
      return { batchMutationId, status: 'not_runnable' }
    }
    throw transitionError
  }
}

async function rollbackTerminalWorkflow(
  entry: AccountWorkflowJournalEntry,
  errorCode: 'contract_unavailable' | 'invalid_response' | 'permission_denied' | 'request_failed',
  now: number,
  database: TravelConsoleDatabase,
): Promise<AccountWorkflowProcessResult> {
  const reconciled = await reconcileOptimisticAccountWorkflowFailure(entry.batchMutationId, {
    database,
    errorCode,
    leaseToken: entry.leaseToken,
    now,
    retainJournal: false,
  })
  if (reconciled === 'missing' || reconciled === 'stale_lease') {
    return { batchMutationId: entry.batchMutationId, status: 'not_runnable' }
  }
  if (reconciled === 'stale_local') {
    return { batchMutationId: entry.batchMutationId, conflictCount: 0, status: 'conflict' }
  }
  return { batchMutationId: entry.batchMutationId, status: 'blocked_contract' }
}

function isConflictRejection(reason: Extract<
  AccountWorkflowRunResultV1,
  { status: 'rejected' }
>['reason']) {
  return reason === 'batch_mutation_id_reused'
    || reason === 'mutation_id_reused'
    || reason === 'object_trip_mismatch'
}

function hasMatchingActiveAccount(
  entry: AccountWorkflowJournalEntry,
  database: TravelConsoleDatabase,
) {
  return getActiveAccountHash() === entry.accountHash
    && getActiveTravelDatabase() === database
    && database.name === buildAccountTravelDatabaseName(entry.accountHash)
}

function isObsoleteLeaseError(error: unknown) {
  return error instanceof AccountWorkflowJournalError
    && (
      error.code === 'account_context_mismatch'
      || error.code === 'stale_lease'
      || error.code === 'unknown_batch'
    )
}

function defaultIsOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}
