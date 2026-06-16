import { enqueueObjectDelete, enqueueObjectUpsert } from '../lib/objectSyncLocal'
import { recordTripWriteForSync } from '../lib/tripSyncQueue'
import { buildLedgerReviewEntries } from '../lib/ledgerReview'
import type { LedgerExchangeRateSnapshot } from '../types'
import { db } from './database'
import * as repo from './ledgerRepositories'

export type BulkLedgerReviewRecord = {
  exchangeRate?: LedgerExchangeRateSnapshot
  expectedUpdatedAt: number
  id: string
}

export async function createLedgerSettings(input: repo.CreateLedgerSettingsInput) {
  const record = await repo.createLedgerSettings(input)
  await enqueueObjectUpsert({ object: record, objectType: 'ledger_settings' })
  markLedgerChanged(record.tripId, 'ledger-settings-created')
  return record
}

export async function updateLedgerSettings(id: string, patch: Parameters<typeof repo.updateLedgerSettings>[1]) {
  const record = await repo.updateLedgerSettings(id, patch)
  if (record) {
    await enqueueObjectUpsert({ object: record, objectType: 'ledger_settings' })
    markLedgerChanged(record.tripId, 'ledger-settings-updated')
  }
  return record
}

export async function createLedgerParticipant(input: repo.CreateLedgerParticipantInput) {
  const record = await repo.createLedgerParticipant(input)
  await enqueueObjectUpsert({ object: record, objectType: 'ledger_participant' })
  markLedgerChanged(record.tripId, 'ledger-participant-created')
  return record
}

export async function updateLedgerParticipant(id: string, patch: Parameters<typeof repo.updateLedgerParticipant>[1]) {
  const record = await repo.updateLedgerParticipant(id, patch)
  if (record) {
    await enqueueObjectUpsert({ object: record, objectType: 'ledger_participant' })
    markLedgerChanged(record.tripId, 'ledger-participant-updated')
  }
  return record
}

export async function deleteLedgerParticipant(id: string) {
  const record = await repo.deleteLedgerParticipant(id)
  if (record) {
    await enqueueObjectDelete({ objectId: record.id, objectType: 'ledger_participant', tripId: record.tripId })
    markLedgerChanged(record.tripId, 'ledger-participant-deleted')
  }
}

export async function createLedgerBudget(input: repo.CreateLedgerBudgetInput) {
  const record = await repo.createLedgerBudget(input)
  await enqueueObjectUpsert({ object: record, objectType: 'ledger_budget' })
  markLedgerChanged(record.tripId, 'ledger-budget-created')
  return record
}

export async function updateLedgerBudget(id: string, patch: Parameters<typeof repo.updateLedgerBudget>[1]) {
  const record = await repo.updateLedgerBudget(id, patch)
  if (record) {
    await enqueueObjectUpsert({ object: record, objectType: 'ledger_budget' })
    markLedgerChanged(record.tripId, 'ledger-budget-updated')
  }
  return record
}

export async function deleteLedgerBudget(id: string) {
  const record = await repo.deleteLedgerBudget(id)
  if (record) {
    await enqueueObjectDelete({ objectId: record.id, objectType: 'ledger_budget', tripId: record.tripId })
    markLedgerChanged(record.tripId, 'ledger-budget-deleted')
  }
}

export async function createLedgerExpense(input: repo.CreateLedgerExpenseInput) {
  const record = await repo.createLedgerExpense(input)
  await enqueueObjectUpsert({ object: record, objectType: 'ledger_expense' })
  markLedgerChanged(record.tripId, 'ledger-expense-created')
  return record
}

export async function updateLedgerExpense(id: string, patch: Parameters<typeof repo.updateLedgerExpense>[1]) {
  const record = await repo.updateLedgerExpense(id, patch)
  if (record) {
    await enqueueObjectUpsert({ object: record, objectType: 'ledger_expense' })
    markLedgerChanged(record.tripId, 'ledger-expense-updated')
  }
  return record
}

export async function deleteLedgerExpense(id: string) {
  const record = await repo.deleteLedgerExpense(id)
  if (record) {
    await enqueueObjectDelete({ objectId: record.id, objectType: 'ledger_expense', tripId: record.tripId })
    markLedgerChanged(record.tripId, 'ledger-expense-deleted')
  }
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
  if (records.length === 0) return []
  if (new Set(records.map((record) => record.id)).size !== records.length) throw new Error('批量审核包含重复账单，请刷新后重试。')
  const now = Date.now()
  const updated = await db.transaction('rw', db.ledgerExpenses, db.trips, async () => {
    const current = await db.ledgerExpenses.where('tripId').equals(tripId).toArray()
    const reviewById = new Map(buildLedgerReviewEntries(current).map((entry) => [entry.expense.id, entry]))
    const selected = records.map((record) => {
      const expense = current.find((candidate) => candidate.id === record.id)
      if (!expense || expense.updatedAt !== record.expectedUpdatedAt) throw new Error('账单已在其他位置更新，请刷新后重试。')
      const review = reviewById.get(record.id)
      if (action === 'confirm' && !review?.canBulkConfirm) throw new Error(`「${expense.title}」仍有阻塞问题，不能批量确认。`)
      if (action === 'mark_reviewed' && !review?.canMarkReviewed) throw new Error(`「${expense.title}」不属于待阅自动归档。`)
      return { expense, record }
    })
    const next = selected.map(({ expense, record }, index) => ({
      ...expense,
      ...(action === 'confirm' ? {
        ...(record.exchangeRate ? { exchangeRate: record.exchangeRate } : {}),
        reviewStatus: 'reviewed' as const,
        status: 'confirmed' as const,
      } : { reviewStatus: 'reviewed' as const }),
      updatedAt: Math.max(now + index, expense.updatedAt + 1),
    }))
    await db.ledgerExpenses.bulkPut(next)
    await db.trips.update(tripId, { updatedAt: now })
    return next
  })
  for (const expense of updated) await enqueueObjectUpsert({ object: expense, objectType: 'ledger_expense' })
  recordTripWriteForSync(tripId, `ledger-expenses-bulk-${action}`, { emitChangeEvent: true, now })
  return updated
}

function markLedgerChanged(tripId: string, reason: string) {
  recordTripWriteForSync(tripId, reason, { emitChangeEvent: true })
}
