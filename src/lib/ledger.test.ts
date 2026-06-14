import { describe, expect, it } from 'vitest'
import {
  allocateLargestRemainder,
  buildLedgerSettlement,
  buildLedgerSummary,
  convertMinorByRate,
  findDuplicateExpenseIds,
  parseMoneyInput,
} from './ledger'
import type { LedgerExpense, LedgerParticipant, LedgerSettings } from '../types'

const settings: LedgerSettings = {
  createdAt: 1,
  homeCurrency: 'CNY',
  id: 'settings',
  settlementCurrency: 'CNY',
  tripCurrency: 'JPY',
  tripId: 'trip',
  updatedAt: 1,
}
const participants: LedgerParticipant[] = [
  { createdAt: 1, displayName: '我', id: 'me', isSelf: true, tripId: 'trip', updatedAt: 1 },
  { createdAt: 1, displayName: '小林', id: 'lin', tripId: 'trip', updatedAt: 1 },
  { createdAt: 1, displayName: '小周', id: 'zhou', tripId: 'trip', updatedAt: 1 },
]

describe('trip ledger calculations', () => {
  it('parses localized amounts and converts integer minor units with decimal rates', () => {
    expect(parseMoneyInput('1,234.56', 'USD')).toBe(123456)
    expect(parseMoneyInput('1.234,56', 'EUR')).toBe(123456)
    expect(convertMinorByRate(1000, 'JPY', 'CNY', '0.05')).toBe(5000)
  })

  it('allocates every minor unit deterministically', () => {
    const result = allocateLargestRemainder(100, [
      { participantId: 'a', weight: 1 },
      { participantId: 'b', weight: 1 },
      { participantId: 'c', weight: 1 },
    ])
    expect([...result.values()].reduce((sum, value) => sum + value, 0)).toBe(100)
    expect(result.get('a')).toBe(34)
  })

  it('flags exact and heuristic duplicates without deleting records', () => {
    const first = expense({ id: 'one', source: { kind: 'ticket', sourceId: 'ticket-1' } })
    const second = expense({ id: 'two', source: { kind: 'ticket', sourceId: 'ticket-1' } })
    const duplicates = findDuplicateExpenseIds([first, second])
    expect([...duplicates].sort()).toEqual(['one', 'two'])
  })

  it('keeps drafts out of spent totals and reports incomplete confirmed expenses', () => {
    const confirmed = expense({ id: 'confirmed' })
    const draft = expense({ id: 'draft', status: 'draft' })
    const incomplete = expense({ id: 'incomplete', payerParticipantId: undefined, splitShares: [] })
    const summary = buildLedgerSummary({
      budgets: [{ amountMinor: 1500, createdAt: 1, currency: 'JPY', id: 'budget', scope: 'trip', tripId: 'trip', updatedAt: 1 }],
      expenses: [confirmed, draft, incomplete],
      participants,
      settings,
    })
    expect(summary.spentTripMinor).toBe(2000)
    expect(summary.pendingTripMinor).toBe(1000)
    expect(summary.warnings.some((warning) => warning.kind === 'over_budget')).toBe(true)
    expect(summary.warnings.some((warning) => warning.kind === 'missing_payer')).toBe(true)
  })

  it('builds a minimal deterministic net settlement and excludes incomplete fees', () => {
    const shared = expense({
      amountMinor: 3000,
      exchangeRate: {
        baseCurrency: 'JPY', effectiveDate: '2026-04-01', fetchedAt: '2026-04-01T00:00:00Z', homeCurrency: 'CNY', provider: 'frankfurter', rateToHome: '0.05', rateToTrip: '1', requestedDate: '2026-04-01', tripCurrency: 'JPY',
      },
      payerParticipantId: 'me',
      splitShares: participants.map((participant) => ({ participantId: participant.id, weight: 1 })),
    })
    const incomplete = expense({ id: 'bad', payerParticipantId: undefined })
    const result = buildLedgerSettlement({ expenses: [shared, incomplete], participants, settings })
    expect(result.transfers).toEqual([
      expect.objectContaining({ amountMinor: 5000, fromParticipantId: 'lin', toParticipantId: 'me' }),
      expect.objectContaining({ amountMinor: 5000, fromParticipantId: 'zhou', toParticipantId: 'me' }),
    ])
    expect(result.excluded).toEqual([expect.objectContaining({ expenseId: 'bad' })])
  })
})

function expense(patch: Partial<LedgerExpense> = {}): LedgerExpense {
  return {
    amountMinor: 1000,
    category: 'food',
    createdAt: 1,
    currency: 'JPY',
    date: '2026-04-01',
    id: 'expense',
    payerParticipantId: 'me',
    source: { kind: 'manual' },
    splitMode: 'equal',
    splitShares: [{ participantId: 'me', weight: 1 }],
    status: 'confirmed',
    title: '晚餐',
    tripId: 'trip',
    updatedAt: 1,
    ...patch,
  }
}
