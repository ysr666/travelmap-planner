import { getActiveAccountHash } from '../lib/accountStorageScope'
import { isAccountCloudV2AccountEnabled } from '../lib/accountCloud/feature'
import { executeProductAccountWorkflowIfEnabled } from '../lib/accountCloud/workflowRuntimeLoader'
import type { JsonObject } from '../lib/accountCloud/contract'
import { enqueueObjectDelete, enqueueObjectUpsert } from '../lib/objectSyncLocal'
import { recordTripWriteForSync } from '../lib/tripSyncQueue'
import type {
  BulkLedgerReviewRecord,
  CreateLedgerBudgetInput,
  CreateLedgerExpenseInput,
  CreateLedgerParticipantInput,
  CreateLedgerSettingsInput,
  LedgerMutationPlan,
} from './ledgerMutationRepository'
import type { LedgerBudget, LedgerExpense, LedgerParticipant, LedgerSettings } from '../types'

export type { BulkLedgerReviewRecord }

export async function initializeLedger(input: {
  budget: CreateLedgerBudgetInput
  participant: CreateLedgerParticipantInput
  settings: CreateLedgerSettingsInput
}) {
  const repo = await import('./ledgerMutationRepository')
  const plan = await repo.prepareInitializeLedger(input)
  return executeLedgerPlan(plan, 'ledger-initialized', repo.applyLedgerMutationPlan)
}

export async function createLedgerSettings(input: CreateLedgerSettingsInput) {
  const repo = await import('./ledgerMutationRepository')
  const plan = await repo.prepareCreateLedgerSettings(input)
  return executeLedgerPlan(plan, 'ledger-settings-created', repo.applyLedgerMutationPlan)
}

export async function updateLedgerSettings(
  id: string,
  patch: Partial<Omit<LedgerSettings, 'id' | 'tripId' | 'createdAt' | 'updatedAt'>>,
) {
  const repo = await import('./ledgerMutationRepository')
  const plan = await repo.prepareUpdateLedgerSettings(id, patch)
  if (!plan) return undefined
  return executeLedgerPlan(plan, 'ledger-settings-updated', repo.applyLedgerMutationPlan)
}

export async function createLedgerParticipant(input: CreateLedgerParticipantInput) {
  const repo = await import('./ledgerMutationRepository')
  const plan = await repo.prepareCreateLedgerParticipant(input)
  return executeLedgerPlan(plan, 'ledger-participant-created', repo.applyLedgerMutationPlan)
}

export async function createLedgerParticipants(inputs: CreateLedgerParticipantInput[]) {
  const repo = await import('./ledgerMutationRepository')
  const plan = await repo.prepareCreateLedgerParticipants(inputs)
  if (!plan) return []
  return executeLedgerPlan(plan, 'ledger-participants-created', repo.applyLedgerMutationPlan)
}

export async function updateLedgerParticipant(
  id: string,
  patch: Partial<Omit<LedgerParticipant, 'id' | 'tripId' | 'createdAt' | 'updatedAt'>>,
) {
  const repo = await import('./ledgerMutationRepository')
  const plan = await repo.prepareUpdateLedgerParticipant(id, patch)
  if (!plan) return undefined
  return executeLedgerPlan(plan, 'ledger-participant-updated', repo.applyLedgerMutationPlan)
}

export async function deleteLedgerParticipant(id: string) {
  const repo = await import('./ledgerMutationRepository')
  const plan = await repo.prepareDeleteLedgerParticipant(id)
  if (!plan) return undefined
  const record = await executeLedgerPlan(plan, 'ledger-participant-deleted', repo.applyLedgerMutationPlan)
  return record
}

export async function createLedgerBudget(input: CreateLedgerBudgetInput) {
  const repo = await import('./ledgerMutationRepository')
  const plan = await repo.prepareCreateLedgerBudget(input)
  return executeLedgerPlan(plan, 'ledger-budget-created', repo.applyLedgerMutationPlan)
}

export async function updateLedgerBudget(
  id: string,
  patch: Partial<Omit<LedgerBudget, 'id' | 'tripId' | 'createdAt' | 'updatedAt'>>,
) {
  const repo = await import('./ledgerMutationRepository')
  const plan = await repo.prepareUpdateLedgerBudget(id, patch)
  if (!plan) return undefined
  return executeLedgerPlan(plan, 'ledger-budget-updated', repo.applyLedgerMutationPlan)
}

export async function deleteLedgerBudget(id: string) {
  const repo = await import('./ledgerMutationRepository')
  const plan = await repo.prepareDeleteLedgerBudget(id)
  if (!plan) return undefined
  return executeLedgerPlan(plan, 'ledger-budget-deleted', repo.applyLedgerMutationPlan)
}

export async function createLedgerExpense(input: CreateLedgerExpenseInput) {
  const repo = await import('./ledgerMutationRepository')
  const plan = await repo.prepareCreateLedgerExpense(input)
  return executeLedgerPlan(plan, 'ledger-expense-created', repo.applyLedgerMutationPlan)
}

export async function createLedgerExpenseIdempotent(input: CreateLedgerExpenseInput) {
  const repo = await import('./ledgerMutationRepository')
  const prepared = await repo.prepareCreateLedgerExpenseIdempotent(input)
  if (prepared.plan) {
    try {
      return await executeLedgerPlan(prepared.plan, 'ledger-expense-created', repo.applyLedgerMutationPlan)
    } catch (error) {
      const recovered = await repo.prepareCreateLedgerExpenseIdempotent(input)
      if (recovered.plan) throw error
      await preserveIdempotentLedgerRecovery(recovered.result.record)
      return recovered.result
    }
  }
  await preserveIdempotentLedgerRecovery(prepared.result.record)
  return prepared.result
}

export async function updateLedgerExpense(
  id: string,
  patch: Partial<Omit<LedgerExpense, 'id' | 'tripId' | 'createdAt' | 'updatedAt'>>,
) {
  const repo = await import('./ledgerMutationRepository')
  const plan = await repo.prepareUpdateLedgerExpense(id, patch)
  if (!plan) return undefined
  return executeLedgerPlan(plan, 'ledger-expense-updated', repo.applyLedgerMutationPlan)
}

export async function deleteLedgerExpense(id: string) {
  const repo = await import('./ledgerMutationRepository')
  const plan = await repo.prepareDeleteLedgerExpense(id)
  if (!plan) return undefined
  return executeLedgerPlan(plan, 'ledger-expense-deleted', repo.applyLedgerMutationPlan)
}

export async function bulkReviewLedgerExpenses({
  action,
  records,
  tripId,
}: {
  action: 'confirm' | 'mark_reviewed'
  records: BulkLedgerReviewRecord[]
  tripId: string
}) {
  const repo = await import('./ledgerMutationRepository')
  const plan = await repo.prepareBulkReviewLedgerExpenses({ action, records, tripId })
  if (!plan) return []
  return executeLedgerPlan(plan, `ledger-expenses-bulk-${action}`, repo.applyLedgerMutationPlan)
}

async function executeLedgerPlan<T>(
  plan: LedgerMutationPlan<T>,
  reason: string,
  apply: <Value>(plan: LedgerMutationPlan<Value>, options?: { touchTrip?: boolean }) => Promise<Value>,
) {
  const accountCloudEnabled = isAccountCloudV2AccountEnabled(getActiveAccountHash())
  const accountCloud = await executeProductAccountWorkflowIfEnabled({
    apply: () => apply(plan, { touchTrip: false }),
    steps: plan.changes.map((change) => ({
      objectId: change.objectId,
      objectType: change.objectType,
      operation: change.operation,
      ...(change.after ? { payload: change.after as unknown as JsonObject } : {}),
    })),
    tripId: plan.tripId,
    workflowId: 'ledger.batch@1',
  })
  if (accountCloud.handled) return accountCloud.value

  const value = await apply(plan, { touchTrip: !accountCloudEnabled })
  await Promise.all(plan.changes.map((change) => enqueueLegacyLedgerChange(change, plan.tripId)))
  markLedgerChanged(plan.tripId, reason)
  return value
}

function enqueueLegacyLedgerChange(change: LedgerMutationPlan<unknown>['changes'][number], tripId: string) {
  if (change.operation === 'delete') {
    return enqueueObjectDelete({ objectId: change.objectId, objectType: change.objectType, tripId })
  }
  switch (change.objectType) {
    case 'ledger_settings':
      return enqueueObjectUpsert({ object: change.after as LedgerSettings, objectType: change.objectType })
    case 'ledger_participant':
      return enqueueObjectUpsert({ object: change.after as LedgerParticipant, objectType: change.objectType })
    case 'ledger_budget':
      return enqueueObjectUpsert({ object: change.after as LedgerBudget, objectType: change.objectType })
    case 'ledger_expense':
      return enqueueObjectUpsert({ object: change.after as LedgerExpense, objectType: change.objectType })
  }
}

async function preserveIdempotentLedgerRecovery(record: LedgerExpense) {
  const accountCloudEnabled = isAccountCloudV2AccountEnabled(getActiveAccountHash())
  if (accountCloudEnabled) {
    const objectKey = `ledger_expense:${record.id}`
    const [{ getActiveTravelDatabase }, { getAccountObjectRevision }] = await Promise.all([
      import('./database'),
      import('../lib/accountCloud/localStore'),
    ])
    const database = getActiveTravelDatabase()
    const [revision, singlePending, workflowPending] = await Promise.all([
      getAccountObjectRevision(objectKey, database),
      database.accountMutationJournal.where('objectKey').equals(objectKey).count(),
      database.accountWorkflowJournal.where('objectKeys').equals(objectKey).count(),
    ])
    if (revision || singlePending > 0 || workflowPending > 0) return
  }
  await enqueueObjectUpsert({ object: record, objectType: 'ledger_expense' })
  markLedgerChanged(record.tripId, 'ledger-expense-recovered')
}

function markLedgerChanged(tripId: string, reason: string) {
  recordTripWriteForSync(tripId, reason, { emitChangeEvent: true })
}
