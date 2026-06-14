import { db } from './database'
import { createId } from './ids'
import type { Table } from 'dexie'
import type {
  ExchangeRateCache,
  LedgerBudget,
  LedgerExpense,
  LedgerParticipant,
  LedgerSettings,
} from '../types'

export type CreateLedgerSettingsInput = Omit<LedgerSettings, 'id' | 'createdAt' | 'updatedAt'>
export type CreateLedgerParticipantInput = Omit<LedgerParticipant, 'id' | 'createdAt' | 'updatedAt'>
export type CreateLedgerBudgetInput = Omit<LedgerBudget, 'id' | 'createdAt' | 'updatedAt'>
export type CreateLedgerExpenseInput = Omit<LedgerExpense, 'id' | 'createdAt' | 'updatedAt'>

export async function getLedgerSettingsByTrip(tripId: string) {
  return db.ledgerSettings.where('tripId').equals(tripId).first()
}

export async function createLedgerSettings(input: CreateLedgerSettingsInput) {
  const now = Date.now()
  const settings: LedgerSettings = { ...input, createdAt: now, id: createId('ledger_settings'), updatedAt: now }
  await putLedgerRecord(db.ledgerSettings, settings)
  return settings
}

export async function updateLedgerSettings(id: string, patch: Partial<Omit<LedgerSettings, 'id' | 'tripId' | 'createdAt' | 'updatedAt'>>) {
  const record = await db.ledgerSettings.get(id)
  if (!record) return undefined
  const updatedAt = Date.now()
  await db.transaction('rw', db.ledgerSettings, db.trips, async () => {
    await db.ledgerSettings.update(id, { ...patch, updatedAt })
    await db.trips.update(record.tripId, { updatedAt })
  })
  return db.ledgerSettings.get(id)
}

export async function listLedgerParticipants(tripId: string) {
  return db.ledgerParticipants.where('tripId').equals(tripId).sortBy('createdAt')
}

export async function createLedgerParticipant(input: CreateLedgerParticipantInput) {
  const now = Date.now()
  const participant: LedgerParticipant = { ...input, createdAt: now, id: createId('ledger_person'), updatedAt: now }
  await putLedgerRecord(db.ledgerParticipants, participant)
  return participant
}

export async function updateLedgerParticipant(id: string, patch: Partial<Omit<LedgerParticipant, 'id' | 'tripId' | 'createdAt' | 'updatedAt'>>) {
  return updateLedgerRecord(db.ledgerParticipants, id, patch)
}

export async function deleteLedgerParticipant(id: string) {
  const participant = await db.ledgerParticipants.get(id)
  if (!participant) return undefined
  const usedByExpense = await db.ledgerExpenses.where('tripId').equals(participant.tripId).filter((expense) =>
    expense.payerParticipantId === id || expense.splitShares.some((share) => share.participantId === id),
  ).first()
  if (usedByExpense) throw new Error('该同行人已用于费用付款或分摊，暂不能删除。')
  await deleteLedgerRecord(db.ledgerParticipants, participant)
  return participant
}

export async function listLedgerBudgets(tripId: string) {
  return db.ledgerBudgets.where('tripId').equals(tripId).sortBy('createdAt')
}

export async function createLedgerBudget(input: CreateLedgerBudgetInput) {
  const now = Date.now()
  const budget: LedgerBudget = { ...input, createdAt: now, id: createId('ledger_budget'), updatedAt: now }
  await putLedgerRecord(db.ledgerBudgets, budget)
  return budget
}

export async function updateLedgerBudget(id: string, patch: Partial<Omit<LedgerBudget, 'id' | 'tripId' | 'createdAt' | 'updatedAt'>>) {
  return updateLedgerRecord(db.ledgerBudgets, id, patch)
}

export async function deleteLedgerBudget(id: string) {
  const budget = await db.ledgerBudgets.get(id)
  if (!budget) return undefined
  await deleteLedgerRecord(db.ledgerBudgets, budget)
  return budget
}

export async function listLedgerExpenses(tripId: string) {
  const expenses = await db.ledgerExpenses.where('tripId').equals(tripId).toArray()
  return expenses.sort((first, second) => second.date.localeCompare(first.date) || second.createdAt - first.createdAt)
}

export async function getLedgerExpense(id: string) {
  return db.ledgerExpenses.get(id)
}

export async function createLedgerExpense(input: CreateLedgerExpenseInput) {
  const now = Date.now()
  const expense: LedgerExpense = { ...input, createdAt: now, id: createId('ledger_expense'), updatedAt: now }
  await putLedgerRecord(db.ledgerExpenses, expense)
  return expense
}

export async function updateLedgerExpense(id: string, patch: Partial<Omit<LedgerExpense, 'id' | 'tripId' | 'createdAt' | 'updatedAt'>>) {
  return updateLedgerRecord(db.ledgerExpenses, id, patch)
}

export async function deleteLedgerExpense(id: string) {
  const expense = await db.ledgerExpenses.get(id)
  if (!expense) return undefined
  await deleteLedgerRecord(db.ledgerExpenses, expense)
  return expense
}

export function buildExchangeRateCacheId(requestedDate: string, baseCurrency: string, quoteCurrency: string) {
  return `${requestedDate}:${baseCurrency.toUpperCase()}:${quoteCurrency.toUpperCase()}`
}

export async function getExchangeRateCache(requestedDate: string, baseCurrency: string, quoteCurrency: string) {
  return db.exchangeRateCache.get(buildExchangeRateCacheId(requestedDate, baseCurrency, quoteCurrency))
}

export async function putExchangeRateCache(record: Omit<ExchangeRateCache, 'id' | 'updatedAt'>) {
  const value: ExchangeRateCache = {
    ...record,
    id: buildExchangeRateCacheId(record.requestedDate, record.baseCurrency, record.quoteCurrency),
    updatedAt: Date.now(),
  }
  await db.exchangeRateCache.put(value)
  return value
}

async function putLedgerRecord<T extends { id: string; tripId: string }>(table: Table<T, string>, record: T) {
  await db.transaction('rw', table, db.trips, async () => {
    await table.add(record)
    await db.trips.update(record.tripId, { updatedAt: Date.now() })
  })
}

async function updateLedgerRecord<T extends { id: string; tripId: string; updatedAt: number }>(
  table: Table<T, string>,
  id: string,
  patch: object,
) {
  const record = await table.get(id)
  if (!record) return undefined
  const updatedAt = Date.now()
  await db.transaction('rw', table, db.trips, async () => {
    await table.update(id, { ...patch, updatedAt } as never)
    await db.trips.update(record.tripId, { updatedAt })
  })
  return table.get(id)
}

async function deleteLedgerRecord<T extends { id: string; tripId: string }>(
  table: Table<T, string>,
  record: T,
) {
  await db.transaction('rw', table, db.trips, async () => {
    await table.delete(record.id)
    await db.trips.update(record.tripId, { updatedAt: Date.now() })
  })
}
