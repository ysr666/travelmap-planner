import { enqueueObjectDelete, enqueueObjectUpsert } from '../lib/objectSyncLocal'
import { recordTripWriteForSync } from '../lib/tripSyncQueue'
import * as repo from './ledgerRepositories'

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

function markLedgerChanged(tripId: string, reason: string) {
  recordTripWriteForSync(tripId, reason, { emitChangeEvent: true })
}
