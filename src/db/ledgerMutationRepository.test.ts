import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { LedgerExpense } from '../types'
import { db } from './database'
import {
  applyLedgerMutationPlan,
  prepareBulkReviewLedgerExpenses,
  prepareCreateLedgerBudget,
  prepareCreateLedgerExpense,
  prepareCreateLedgerExpenseIdempotent,
  prepareCreateLedgerParticipant,
  prepareDeleteLedgerExpense,
  prepareDeleteLedgerParticipant,
  prepareInitializeLedger,
  prepareUpdateLedgerExpense,
} from './ledgerMutationRepository'
import { createTrip } from './repositories'

let tripId = ''

beforeEach(async () => {
  await db.delete()
  await db.open()
  tripId = (await createTrip({
    destination: 'United Kingdom',
    endDate: '2026-07-21',
    startDate: '2026-07-10',
    title: 'UK',
  })).id
})

describe('ledger mutation repository', () => {
  it('initializes settings, self, and trip budget in one stale-safe transaction', async () => {
    const plan = await prepareInitializeLedger(initialLedgerInput())

    const result = await applyLedgerMutationPlan(plan)

    expect(result).toMatchObject({
      budget: { amountMinor: 100_000, scope: 'trip' },
      participant: { displayName: 'Me', isSelf: true },
      settings: { homeCurrency: 'CNY', tripCurrency: 'GBP' },
    })
    await expect(db.ledgerSettings.where('tripId').equals(tripId).count()).resolves.toBe(1)
    await expect(db.ledgerParticipants.where('tripId').equals(tripId).count()).resolves.toBe(1)
    await expect(db.ledgerBudgets.where('tripId').equals(tripId).count()).resolves.toBe(1)
    await expect(prepareInitializeLedger(initialLedgerInput())).rejects.toThrow('已经建立')
  })

  it('repairs a partial legacy baseline without duplicating self or trip budget', async () => {
    await db.ledgerParticipants.put({
      createdAt: 1,
      displayName: 'Existing self',
      id: 'existing_self',
      isSelf: true,
      source: 'manual',
      tripId,
      updatedAt: 1,
    })
    await db.ledgerBudgets.put({
      amountMinor: 50_000,
      createdAt: 1,
      currency: 'GBP',
      id: 'existing_trip_budget',
      scope: 'trip',
      tripId,
      updatedAt: 1,
    })

    const plan = await prepareInitializeLedger(initialLedgerInput())
    expect(plan.changes).toHaveLength(1)
    const result = await applyLedgerMutationPlan(plan)

    expect(result.participant.id).toBe('existing_self')
    expect(result.budget.id).toBe('existing_trip_budget')
    await expect(db.ledgerParticipants.where('tripId').equals(tripId).count()).resolves.toBe(1)
    await expect(db.ledgerBudgets.where('tripId').equals(tripId).count()).resolves.toBe(1)
    await expect(db.ledgerSettings.where('tripId').equals(tripId).count()).resolves.toBe(1)
  })

  it('rejects a stale graph and leaves the planned write unapplied', async () => {
    const plan = await prepareCreateLedgerParticipant({
      displayName: 'Planned',
      source: 'manual',
      tripId,
    })
    await db.ledgerParticipants.put({
      createdAt: 2,
      displayName: 'Concurrent',
      id: 'participant_concurrent',
      source: 'manual',
      tripId,
      updatedAt: 2,
    })

    await expect(applyLedgerMutationPlan(plan)).rejects.toThrow('其他位置更新')
    await expect(db.ledgerParticipants.get(plan.value.id)).resolves.toBeUndefined()
    await expect(db.ledgerParticipants.get('participant_concurrent')).resolves.toBeDefined()
  })

  it('validates participant, itinerary, Ticket, and refund relationships before writes', async () => {
    const initialized = await applyLedgerMutationPlan(await prepareInitializeLedger(initialLedgerInput()))
    const base = makeExpense(initialized.participant.id)

    await expect(prepareCreateLedgerExpense({
      ...base,
      itemIds: ['item_missing'],
    })).rejects.toThrow('行程点不存在')
    await expect(prepareCreateLedgerExpense({
      ...base,
      source: { kind: 'ticket', sourceId: 'ticket_missing' },
    })).rejects.toThrow('票据不存在')
    await expect(prepareCreateLedgerExpense({
      ...base,
      source: { kind: 'ticket', sourceId: 'ticket_missing' },
      sourceLinks: [
        { available: false, id: 'missing_false', kind: 'ticket', role: 'other', sourceId: 'ticket_missing' },
        { available: true, id: 'missing_true', kind: 'ticket', role: 'payment_receipt', sourceId: 'ticket_missing' },
      ],
    })).rejects.toThrow('票据不存在')
    await expect(prepareCreateLedgerExpense({
      ...base,
      originalExpenseId: 'expense_missing',
    })).rejects.toThrow('原始费用不存在')

    const expense = await applyLedgerMutationPlan(await prepareCreateLedgerExpense(base))
    await expect(prepareDeleteLedgerParticipant(initialized.participant.id)).rejects.toThrow('付款人不存在')

    const refund = await applyLedgerMutationPlan(await prepareCreateLedgerExpense({
      ...makeExpense(initialized.participant.id),
      amountMinor: -500,
      originalExpenseId: expense.id,
      source: { fingerprint: 'refund_1', kind: 'manual' },
      status: 'confirmed',
      title: 'Refund',
    }))
    expect(refund.originalExpenseId).toBe(expense.id)
    await expect(prepareDeleteLedgerExpense(expense.id)).rejects.toThrow('原始费用不存在')
  })

  it('deduplicates source fingerprints without creating a second plan', async () => {
    const initialized = await applyLedgerMutationPlan(await prepareInitializeLedger(initialLedgerInput()))
    const input = makeExpense(initialized.participant.id)
    const first = await prepareCreateLedgerExpenseIdempotent(input)
    expect(first.plan).not.toBeNull()
    await applyLedgerMutationPlan(first.plan!)

    const second = await prepareCreateLedgerExpenseIdempotent(input)

    expect(second.plan).toBeNull()
    expect(second.result).toMatchObject({ created: false, record: { id: first.result.record.id } })
    await expect(db.ledgerExpenses.where('tripId').equals(tripId).count()).resolves.toBe(1)
  })

  it('reviews multiple expenses atomically and rejects a stale member', async () => {
    const initialized = await applyLedgerMutationPlan(await prepareInitializeLedger(initialLedgerInput()))
    const first = await applyLedgerMutationPlan(await prepareCreateLedgerExpense({
      ...makeExpense(initialized.participant.id),
      reviewStatus: 'auto_confirmed',
      source: { fingerprint: 'auto_1', kind: 'manual' },
      title: 'Auto one',
    }))
    const second = await applyLedgerMutationPlan(await prepareCreateLedgerExpense({
      ...makeExpense(initialized.participant.id),
      reviewStatus: 'auto_confirmed',
      source: { fingerprint: 'auto_2', kind: 'manual' },
      title: 'Auto two',
    }))
    const plan = await prepareBulkReviewLedgerExpenses({
      action: 'mark_reviewed',
      records: [first, second].map((expense) => ({
        expectedUpdatedAt: expense.updatedAt,
        id: expense.id,
      })),
      tripId,
    })
    expect(plan).toBeDefined()
    await db.ledgerExpenses.update(second.id, { updatedAt: second.updatedAt + 1 })

    await expect(applyLedgerMutationPlan(plan!)).rejects.toThrow('其他位置更新')
    await expect(db.ledgerExpenses.get(first.id)).resolves.toMatchObject({ reviewStatus: 'auto_confirmed' })
  })

  it('rejects duplicate budget scopes before persisting either record', async () => {
    await applyLedgerMutationPlan(await prepareCreateLedgerBudget({
      amountMinor: 1_000,
      category: 'food',
      currency: 'GBP',
      scope: 'category',
      tripId,
    }))

    await expect(prepareCreateLedgerBudget({
      amountMinor: 2_000,
      category: 'food',
      currency: 'GBP',
      scope: 'category',
      tripId,
    })).rejects.toThrow('重复的预算范围')
    await expect(db.ledgerBudgets.where('tripId').equals(tripId).count()).resolves.toBe(1)
  })

  it('preserves an explicitly unavailable Ticket source without locking unrelated ledger edits', async () => {
    await db.ledgerExpenses.put({
      ...makeExpense('participant_missing'),
      payerParticipantId: undefined,
      createdAt: 1,
      id: 'historical_expense',
      source: { kind: 'ticket', sourceId: 'deleted_ticket' },
      sourceLinks: [{
        available: false,
        id: 'deleted_ticket_link',
        kind: 'ticket',
        role: 'payment_receipt',
        sourceId: 'deleted_ticket',
      }],
      splitShares: [],
      updatedAt: 1,
    })

    const plan = await prepareCreateLedgerBudget({
      amountMinor: 2_000,
      category: 'food',
      currency: 'GBP',
      scope: 'category',
      tripId,
    })
    await expect(applyLedgerMutationPlan(plan)).resolves.toMatchObject({ category: 'food' })
  })

  it('allows a historical dangling link to persist but rejects a newly introduced one', async () => {
    const historical = {
      ...makeExpense('participant_missing'),
      payerParticipantId: undefined,
      createdAt: 1,
      id: 'historical_expense',
      itemIds: ['deleted_item'],
      splitShares: [],
      updatedAt: 1,
    }
    await db.ledgerExpenses.put(historical)

    const plan = await prepareCreateLedgerParticipant({
      displayName: 'Traveler',
      source: 'manual',
      tripId,
    })
    await expect(applyLedgerMutationPlan(plan)).resolves.toMatchObject({ displayName: 'Traveler' })

    await expect(prepareUpdateLedgerExpense(historical.id, {
      itemIds: ['deleted_item', 'another_missing_item'],
    })).rejects.toThrow('行程点不存在')
  })
})

function initialLedgerInput() {
  return {
    budget: {
      amountMinor: 100_000,
      currency: 'GBP',
      scope: 'trip' as const,
      tripId,
    },
    participant: {
      displayName: 'Me',
      isSelf: true,
      source: 'manual' as const,
      tripId,
    },
    settings: {
      homeCurrency: 'CNY',
      settlementCurrency: 'CNY',
      tripCurrency: 'GBP',
      tripId,
    },
  }
}

function makeExpense(participantId: string): Omit<LedgerExpense, 'createdAt' | 'id' | 'updatedAt'> {
  return {
    amountMinor: 1_200,
    category: 'food',
    currency: 'GBP',
    date: '2026-07-10',
    payerParticipantId: participantId,
    source: { fingerprint: 'receipt_1', kind: 'manual' },
    splitMode: 'equal',
    splitShares: [{ participantId, weight: 1 }],
    status: 'confirmed',
    title: 'Dinner',
    tripId,
  }
}
