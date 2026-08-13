import { buildLedgerReviewEntries } from '../lib/ledgerReview'
import {
  assertAccountLedgerGraphPayloads,
  assertNoNewAccountLedgerGraphViolations,
  type AccountLedgerGraph,
} from '../lib/accountCloud/ledgerGraph'
import type {
  LedgerBudget,
  LedgerExchangeRateSnapshot,
  LedgerExpense,
  LedgerParticipant,
  LedgerSettings,
} from '../types'
import { db } from './database'
import { createId } from './ids'

export type CreateLedgerSettingsInput = Omit<LedgerSettings, 'id' | 'createdAt' | 'updatedAt'>
export type CreateLedgerParticipantInput = Omit<LedgerParticipant, 'id' | 'createdAt' | 'updatedAt'>
export type CreateLedgerBudgetInput = Omit<LedgerBudget, 'id' | 'createdAt' | 'updatedAt'>
export type CreateLedgerExpenseInput = Omit<LedgerExpense, 'id' | 'createdAt' | 'updatedAt'>

export type BulkLedgerReviewRecord = {
  exchangeRate?: LedgerExchangeRateSnapshot
  expectedUpdatedAt: number
  id: string
}

export type LedgerMutationObjectType =
  | 'ledger_settings'
  | 'ledger_participant'
  | 'ledger_budget'
  | 'ledger_expense'

type LedgerRecord = LedgerSettings | LedgerParticipant | LedgerBudget | LedgerExpense

export type LedgerMutationChange = {
  after: LedgerRecord | null
  before: LedgerRecord | null
  objectId: string
  objectType: LedgerMutationObjectType
  operation: 'delete' | 'upsert'
}

export type LedgerMutationPlan<T> = {
  afterFingerprint: string
  beforeFingerprint: string
  changes: LedgerMutationChange[]
  tripId: string
  value: T
}

export class LedgerMutationConflictError extends Error {}

export async function prepareInitializeLedger({
  budget,
  participant,
  settings,
}: {
  budget: CreateLedgerBudgetInput
  participant: CreateLedgerParticipantInput
  settings: CreateLedgerSettingsInput
}) {
  assertSameTrip([budget.tripId, participant.tripId, settings.tripId])
  const graph = await readLedgerGraph(settings.tripId)
  if (graph.settings.length > 0) throw new LedgerMutationConflictError('账本已经建立，请刷新后重试。')
  const now = Date.now()
  const nextSettings: LedgerSettings = { ...settings, createdAt: now, id: createId('ledger_settings'), updatedAt: now }
  const existingSelf = graph.participants.find((record) => record.isSelf)
  const nextParticipant: LedgerParticipant = existingSelf ?? {
    ...participant,
    createdAt: now,
    id: createId('ledger_person'),
    updatedAt: now,
  }
  const existingTripBudget = graph.budgets.find((record) => record.scope === 'trip')
  const nextBudget: LedgerBudget = existingTripBudget ?? {
    ...budget,
    createdAt: now,
    id: createId('ledger_budget'),
    updatedAt: now,
  }
  return buildPlan(graph, [
    createChange('ledger_settings', nextSettings),
    ...(existingSelf ? [] : [createChange('ledger_participant', nextParticipant)]),
    ...(existingTripBudget ? [] : [createChange('ledger_budget', nextBudget)]),
  ], { budget: nextBudget, participant: nextParticipant, settings: nextSettings })
}

export async function prepareCreateLedgerSettings(input: CreateLedgerSettingsInput) {
  const graph = await readLedgerGraph(input.tripId)
  if (graph.settings.length > 0) throw new LedgerMutationConflictError('一趟旅行只能有一组账本设置。')
  const now = Date.now()
  const record: LedgerSettings = { ...input, createdAt: now, id: createId('ledger_settings'), updatedAt: now }
  return buildPlan(graph, [createChange('ledger_settings', record)], record)
}

export async function prepareUpdateLedgerSettings(
  id: string,
  patch: Partial<Omit<LedgerSettings, 'id' | 'tripId' | 'createdAt' | 'updatedAt'>>,
) {
  const current = await db.ledgerSettings.get(id)
  if (!current) return undefined
  const graph = await readLedgerGraph(current.tripId)
  const record = { ...current, ...patch, updatedAt: nextTimestamp(current.updatedAt) }
  return buildPlan(graph, [updateChange('ledger_settings', current, record)], record)
}

export async function prepareCreateLedgerParticipant(input: CreateLedgerParticipantInput) {
  const graph = await readLedgerGraph(input.tripId)
  const now = Date.now()
  const record: LedgerParticipant = { ...input, createdAt: now, id: createId('ledger_person'), updatedAt: now }
  return buildPlan(graph, [createChange('ledger_participant', record)], record)
}

export async function prepareCreateLedgerParticipants(inputs: CreateLedgerParticipantInput[]) {
  if (inputs.length === 0) return undefined
  assertSameTrip(inputs.map((input) => input.tripId))
  const graph = await readLedgerGraph(inputs[0].tripId)
  const now = Date.now()
  const records = inputs.map((input, index): LedgerParticipant => ({
    ...input,
    createdAt: now + index,
    id: createId('ledger_person'),
    updatedAt: now + index,
  }))
  return buildPlan(
    graph,
    records.map((record) => createChange('ledger_participant', record)),
    records,
  )
}

export async function prepareUpdateLedgerParticipant(
  id: string,
  patch: Partial<Omit<LedgerParticipant, 'id' | 'tripId' | 'createdAt' | 'updatedAt'>>,
) {
  const current = await db.ledgerParticipants.get(id)
  if (!current) return undefined
  const graph = await readLedgerGraph(current.tripId)
  const record = { ...current, ...patch, updatedAt: nextTimestamp(current.updatedAt) }
  return buildPlan(graph, [updateChange('ledger_participant', current, record)], record)
}

export async function prepareDeleteLedgerParticipant(id: string) {
  const current = await db.ledgerParticipants.get(id)
  if (!current) return undefined
  const graph = await readLedgerGraph(current.tripId)
  return buildPlan(graph, [deleteChange('ledger_participant', current)], current)
}

export async function prepareCreateLedgerBudget(input: CreateLedgerBudgetInput) {
  const graph = await readLedgerGraph(input.tripId)
  const now = Date.now()
  const record: LedgerBudget = { ...input, createdAt: now, id: createId('ledger_budget'), updatedAt: now }
  return buildPlan(graph, [createChange('ledger_budget', record)], record)
}

export async function prepareUpdateLedgerBudget(
  id: string,
  patch: Partial<Omit<LedgerBudget, 'id' | 'tripId' | 'createdAt' | 'updatedAt'>>,
) {
  const current = await db.ledgerBudgets.get(id)
  if (!current) return undefined
  const graph = await readLedgerGraph(current.tripId)
  const record = { ...current, ...patch, updatedAt: nextTimestamp(current.updatedAt) }
  return buildPlan(graph, [updateChange('ledger_budget', current, record)], record)
}

export async function prepareDeleteLedgerBudget(id: string) {
  const current = await db.ledgerBudgets.get(id)
  if (!current) return undefined
  const graph = await readLedgerGraph(current.tripId)
  return buildPlan(graph, [deleteChange('ledger_budget', current)], current)
}

export async function prepareCreateLedgerExpense(input: CreateLedgerExpenseInput) {
  const graph = await readLedgerGraph(input.tripId)
  const now = Date.now()
  const record: LedgerExpense = { ...input, createdAt: now, id: createId('ledger_expense'), updatedAt: now }
  return buildPlan(graph, [createChange('ledger_expense', record)], record)
}

export async function prepareCreateLedgerExpenseIdempotent(input: CreateLedgerExpenseInput) {
  const graph = await readLedgerGraph(input.tripId)
  const fingerprint = input.source.fingerprint
  const existing = fingerprint
    ? graph.expenses.find((expense) => (
        expense.source.kind === input.source.kind
        && expense.source.fingerprint === fingerprint
      ))
    : undefined
  if (existing) return { plan: null, result: { created: false, record: existing } }
  const now = Date.now()
  const record: LedgerExpense = { ...input, createdAt: now, id: createId('ledger_expense'), updatedAt: now }
  return {
    plan: buildPlan(graph, [createChange('ledger_expense', record)], { created: true, record }),
    result: { created: true, record },
  }
}

export async function prepareUpdateLedgerExpense(
  id: string,
  patch: Partial<Omit<LedgerExpense, 'id' | 'tripId' | 'createdAt' | 'updatedAt'>>,
) {
  const current = await db.ledgerExpenses.get(id)
  if (!current) return undefined
  const graph = await readLedgerGraph(current.tripId)
  const record = { ...current, ...patch, updatedAt: nextTimestamp(current.updatedAt) }
  return buildPlan(graph, [updateChange('ledger_expense', current, record)], record)
}

export async function prepareDeleteLedgerExpense(id: string) {
  const current = await db.ledgerExpenses.get(id)
  if (!current) return undefined
  const graph = await readLedgerGraph(current.tripId)
  return buildPlan(graph, [deleteChange('ledger_expense', current)], current)
}

export async function prepareBulkReviewLedgerExpenses({
  action,
  records,
  tripId,
}: {
  action: 'confirm' | 'mark_reviewed'
  records: BulkLedgerReviewRecord[]
  tripId: string
}) {
  if (records.length === 0) return undefined
  if (new Set(records.map((record) => record.id)).size !== records.length) {
    throw new Error('批量审核包含重复账单，请刷新后重试。')
  }
  const graph = await readLedgerGraph(tripId)
  const reviewById = new Map(buildLedgerReviewEntries(graph.expenses).map((entry) => [entry.expense.id, entry]))
  const now = Date.now()
  const next = records.map((record, index) => {
    const expense = graph.expenses.find((candidate) => candidate.id === record.id)
    if (!expense || expense.updatedAt !== record.expectedUpdatedAt) {
      throw new Error('账单已在其他位置更新，请刷新后重试。')
    }
    const review = reviewById.get(record.id)
    if (action === 'confirm' && !review?.canBulkConfirm) throw new Error(`「${expense.title}」仍有阻塞问题，不能批量确认。`)
    if (action === 'mark_reviewed' && !review?.canMarkReviewed) throw new Error(`「${expense.title}」不属于待阅自动归档。`)
    return {
      ...expense,
      ...(action === 'confirm' ? {
        ...(record.exchangeRate ? { exchangeRate: record.exchangeRate } : {}),
        reviewStatus: 'reviewed' as const,
        status: 'confirmed' as const,
      } : { reviewStatus: 'reviewed' as const }),
      updatedAt: Math.max(now + index, expense.updatedAt + 1),
    }
  })
  return buildPlan(
    graph,
    next.map((record) => updateChange(
      'ledger_expense',
      graph.expenses.find((expense) => expense.id === record.id)!,
      record,
    )),
    next,
  )
}

export async function applyLedgerMutationPlan<T>(
  plan: LedgerMutationPlan<T>,
  { touchTrip = true }: { touchTrip?: boolean } = {},
) {
  return db.transaction(
    'rw',
    [
      db.trips,
      db.itineraryItems,
      db.ticketMetas,
      db.ledgerSettings,
      db.ledgerParticipants,
      db.ledgerBudgets,
      db.ledgerExpenses,
    ],
    async () => {
      const current = await readLedgerGraph(plan.tripId)
      if (fingerprintGraph(current) !== plan.beforeFingerprint) {
        throw new LedgerMutationConflictError('账本已在其他位置更新，请刷新后重试。')
      }
      const after = applyChangesToGraph(current, plan.changes)
      assertAccountLedgerGraphPayloads(after, plan.tripId)
      assertNoNewAccountLedgerGraphViolations(current, after)
      if (fingerprintGraph(after) !== plan.afterFingerprint) {
        throw new LedgerMutationConflictError('账本修改计划已变化，请重新生成预览。')
      }
      for (const change of plan.changes) {
        await writeChange(change)
      }
      if (touchTrip) await db.trips.update(plan.tripId, { updatedAt: Date.now() })
      return plan.value
    },
  )
}

async function readLedgerGraph(tripId: string): Promise<AccountLedgerGraph> {
  const [trip, settings, participants, budgets, expenses, items, tickets] = await Promise.all([
    db.trips.get(tripId),
    db.ledgerSettings.where('tripId').equals(tripId).toArray(),
    db.ledgerParticipants.where('tripId').equals(tripId).toArray(),
    db.ledgerBudgets.where('tripId').equals(tripId).toArray(),
    db.ledgerExpenses.where('tripId').equals(tripId).toArray(),
    db.itineraryItems.where('tripId').equals(tripId).primaryKeys(),
    db.ticketMetas.where('tripId').equals(tripId).primaryKeys(),
  ])
  const graph = {
    budgets: sortRecords(budgets),
    expenses: sortRecords(expenses),
    itemIds: [...items].sort(),
    participants: sortRecords(participants),
    settings: sortRecords(settings),
    ticketIds: [...tickets].sort(),
    tripExists: Boolean(trip),
  }
  assertAccountLedgerGraphPayloads(graph, tripId)
  return graph
}

function buildPlan<T>(graph: AccountLedgerGraph, changes: LedgerMutationChange[], value: T): LedgerMutationPlan<T> {
  if (changes.length < 1 || changes.length > 128) throw new Error('账本批次大小无效。')
  const keys = changes.map((change) => `${change.objectType}:${change.objectId}`)
  if (new Set(keys).size !== keys.length) throw new Error('账本批次包含重复对象。')
  for (const change of changes) {
    if (change.before && change.after && change.before.tripId !== change.after.tripId) {
      throw new Error('账本对象不能跨旅行移动。')
    }
  }
  const after = applyChangesToGraph(graph, changes)
  assertAccountLedgerGraphPayloads(after, changes[0].before?.tripId ?? changes[0].after!.tripId)
  assertNoNewAccountLedgerGraphViolations(graph, after)
  return {
    afterFingerprint: fingerprintGraph(after),
    beforeFingerprint: fingerprintGraph(graph),
    changes,
    tripId: changes[0].before?.tripId ?? changes[0].after!.tripId,
    value,
  }
}

function applyChangesToGraph(graph: AccountLedgerGraph, changes: LedgerMutationChange[]): AccountLedgerGraph {
  const next = {
    ...graph,
    budgets: [...graph.budgets],
    expenses: [...graph.expenses],
    participants: [...graph.participants],
    settings: [...graph.settings],
  }
  for (const change of changes) {
    const key = graphKey(change.objectType)
    const records = next[key] as LedgerRecord[]
    const current = records.find((record) => record.id === change.objectId) ?? null
    if (stableStringify(current) !== stableStringify(change.before)) {
      throw new LedgerMutationConflictError('账本修改基线不一致，请刷新后重试。')
    }
    next[key] = sortRecords(change.operation === 'delete'
      ? records.filter((record) => record.id !== change.objectId)
      : [...records.filter((record) => record.id !== change.objectId), change.after!]) as never
  }
  return next
}

function createChange(objectType: LedgerMutationObjectType, record: LedgerRecord): LedgerMutationChange {
  return { after: record, before: null, objectId: record.id, objectType, operation: 'upsert' }
}

function updateChange(
  objectType: LedgerMutationObjectType,
  before: LedgerRecord,
  after: LedgerRecord,
): LedgerMutationChange {
  return { after, before, objectId: before.id, objectType, operation: 'upsert' }
}

function deleteChange(objectType: LedgerMutationObjectType, before: LedgerRecord): LedgerMutationChange {
  return { after: null, before, objectId: before.id, objectType, operation: 'delete' }
}

async function writeChange(change: LedgerMutationChange) {
  if (change.operation === 'delete') {
    switch (change.objectType) {
      case 'ledger_settings': return db.ledgerSettings.delete(change.objectId)
      case 'ledger_participant': return db.ledgerParticipants.delete(change.objectId)
      case 'ledger_budget': return db.ledgerBudgets.delete(change.objectId)
      case 'ledger_expense': return db.ledgerExpenses.delete(change.objectId)
    }
  }
  switch (change.objectType) {
    case 'ledger_settings': return db.ledgerSettings.put(change.after as LedgerSettings)
    case 'ledger_participant': return db.ledgerParticipants.put(change.after as LedgerParticipant)
    case 'ledger_budget': return db.ledgerBudgets.put(change.after as LedgerBudget)
    case 'ledger_expense': return db.ledgerExpenses.put(change.after as LedgerExpense)
  }
}

function graphKey(objectType: LedgerMutationObjectType): 'settings' | 'participants' | 'budgets' | 'expenses' {
  switch (objectType) {
    case 'ledger_settings': return 'settings'
    case 'ledger_participant': return 'participants'
    case 'ledger_budget': return 'budgets'
    case 'ledger_expense': return 'expenses'
  }
}

function sortRecords<T extends { id: string }>(records: T[]) {
  return [...records].sort((left, right) => left.id.localeCompare(right.id))
}

function nextTimestamp(previous: number) {
  return Math.max(Date.now(), previous + 1)
}

function assertSameTrip(tripIds: string[]) {
  if (tripIds.length === 0 || new Set(tripIds).size !== 1) throw new Error('账本批次必须属于同一趟旅行。')
}

function fingerprintGraph(graph: AccountLedgerGraph) {
  return stableStringify(graph)
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
