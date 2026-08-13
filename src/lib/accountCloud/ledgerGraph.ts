import type {
  LedgerBudget,
  LedgerExpense,
  LedgerParticipant,
  LedgerSettings,
} from '../../types'
import { assertAccountLedgerPayload } from './ledgerPayload'

export type AccountLedgerGraph = {
  budgets: LedgerBudget[]
  expenses: LedgerExpense[]
  itemIds: string[]
  participants: LedgerParticipant[]
  settings: LedgerSettings[]
  ticketIds: string[]
  tripExists: boolean
}

export type AccountLedgerGraphViolation = {
  key: string
  message: string
}

export function assertAccountLedgerGraphPayloads(graph: AccountLedgerGraph, tripId: string) {
  if (!graph.tripExists) throw new Error('账本所属旅行不存在。')
  const records = [
    ['ledger_settings', graph.settings],
    ['ledger_participant', graph.participants],
    ['ledger_budget', graph.budgets],
    ['ledger_expense', graph.expenses],
  ] as const
  for (const [objectType, values] of records) {
    if (values.some((value) => value.tripId !== tripId)) throw new Error('账本记录不属于当前旅行。')
    for (const value of values) assertAccountLedgerPayload(objectType, value)
  }
}

export function listAccountLedgerGraphViolations(
  graph: AccountLedgerGraph,
): AccountLedgerGraphViolation[] {
  const violations: AccountLedgerGraphViolation[] = []
  addPairViolations(
    violations,
    graph.settings,
    () => 'settings',
    'settings_duplicate',
    '一趟旅行只能有一组账本设置。',
  )
  addPairViolations(
    violations,
    graph.participants.filter((participant) => participant.isSelf),
    () => 'self',
    'self_duplicate',
    '账本只能有一个本人。',
  )
  addPairViolations(
    violations,
    graph.participants.filter((participant) => participant.source && participant.sourceId),
    (participant) => `${participant.source}:${participant.sourceId}`,
    'participant_source_duplicate',
    '账本包含重复的同行人来源。',
  )
  addPairViolations(
    violations,
    graph.budgets,
    budgetKey,
    'budget_scope_duplicate',
    '账本包含重复的预算范围。',
  )
  addPairViolations(
    violations,
    graph.expenses.filter((expense) => expense.source.fingerprint),
    (expense) => `${expense.source.kind}:${expense.source.fingerprint}`,
    'expense_source_duplicate',
    '账本包含重复的来源账单。',
  )

  const participantIds = new Set(graph.participants.map((participant) => participant.id))
  const expenseIds = new Set(graph.expenses.map((expense) => expense.id))
  const itemIds = new Set(graph.itemIds)
  const ticketIds = new Set(graph.ticketIds)
  for (const expense of graph.expenses) {
    if (expense.payerParticipantId && !participantIds.has(expense.payerParticipantId)) {
      addMissingViolation(violations, 'payer', expense.id, expense.payerParticipantId, '账单付款人不存在。')
    }
    for (const share of expense.splitShares) {
      if (!participantIds.has(share.participantId)) {
        addMissingViolation(violations, 'share', expense.id, share.participantId, '账单分摊参与人不存在。')
      }
    }
    for (const itemId of expense.itemIds ?? []) {
      if (!itemIds.has(itemId)) {
        addMissingViolation(violations, 'item', expense.id, itemId, '账单关联的行程点不存在。')
      }
    }
    if (expense.originalExpenseId && !expenseIds.has(expense.originalExpenseId)) {
      addMissingViolation(
        violations,
        'original_expense',
        expense.id,
        expense.originalExpenseId,
        '账单关联的原始费用不存在。',
      )
    }
    for (const ticketId of listActiveLedgerTicketReferences(expense)) {
      if (!ticketIds.has(ticketId)) {
        addMissingViolation(violations, 'ticket', expense.id, ticketId, '账单关联的票据不存在。')
      }
    }
  }
  return violations.sort((left, right) => left.key.localeCompare(right.key))
}

export function assertNoNewAccountLedgerGraphViolations(
  before: AccountLedgerGraph,
  after: AccountLedgerGraph,
) {
  const existing = new Set(listAccountLedgerGraphViolations(before).map((violation) => violation.key))
  const introduced = listAccountLedgerGraphViolations(after)
    .find((violation) => !existing.has(violation.key))
  if (introduced) throw new Error(introduced.message)
}

export function listActiveLedgerTicketReferences(expense: LedgerExpense) {
  const unavailableTicketIds = new Set((expense.sourceLinks ?? [])
    .filter((source) => source.kind === 'ticket' && source.available === false && source.sourceId)
    .map((source) => source.sourceId!))
  return [...new Set([
    ...(expense.source.kind === 'ticket'
      && expense.source.sourceId
      && !unavailableTicketIds.has(expense.source.sourceId)
      ? [expense.source.sourceId]
      : []),
    ...(expense.sourceLinks ?? [])
      .filter((source) => source.kind === 'ticket' && source.sourceId && source.available !== false)
      .map((source) => source.sourceId!),
  ])]
}

function budgetKey(budget: LedgerBudget) {
  if (budget.scope === 'trip') return 'trip'
  return `${budget.scope}:${budget.category ?? budget.date}`
}

function addPairViolations<T extends { id: string }>(
  violations: AccountLedgerGraphViolation[],
  records: T[],
  groupKey: (record: T) => string,
  kind: string,
  message: string,
) {
  const groups = new Map<string, T[]>()
  for (const record of records) {
    const key = groupKey(record)
    groups.set(key, [...(groups.get(key) ?? []), record])
  }
  for (const values of groups.values()) {
    const sorted = [...values].sort((left, right) => left.id.localeCompare(right.id))
    for (let left = 0; left < sorted.length; left += 1) {
      for (let right = left + 1; right < sorted.length; right += 1) {
        violations.push({ key: JSON.stringify([kind, sorted[left].id, sorted[right].id]), message })
      }
    }
  }
}

function addMissingViolation(
  violations: AccountLedgerGraphViolation[],
  kind: string,
  expenseId: string,
  referenceId: string,
  message: string,
) {
  violations.push({ key: JSON.stringify([kind, expenseId, referenceId]), message })
}
