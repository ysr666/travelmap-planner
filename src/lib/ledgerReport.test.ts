import { describe, expect, it, vi } from 'vitest'
import type { LedgerExpense } from '../types'
import { buildLedgerReportModel, toCsv } from './ledgerReport'

function expense(patch: Partial<LedgerExpense> = {}): LedgerExpense {
  return {
    amountMinor: 10000,
    category: 'lodging',
    createdAt: 1,
    currency: 'CNY',
    date: '2026-06-02',
    id: patch.id ?? 'expense-1',
    itemIds: ['item-1'],
    paymentStatus: 'paid',
    source: { kind: 'ticket', sourceId: 'ticket-1' },
    sourceLinks: [{ available: true, id: 'ticket:1', kind: 'ticket', role: 'payment_receipt', sourceId: 'ticket-1', title: '付款票据' }],
    splitMode: 'equal',
    splitShares: [],
    status: 'confirmed',
    title: '东京酒店',
    tripId: 'trip',
    updatedAt: 1,
    ...patch,
  }
}

const input = {
  budgets: [{ amountMinor: 50000, createdAt: 1, currency: 'CNY', id: 'budget', scope: 'trip' as const, tripId: 'trip', updatedAt: 1 }],
  expenses: [],
  participants: [],
  settings: { createdAt: 1, homeCurrency: 'CNY', id: 'settings', settlementCurrency: 'CNY', tripCurrency: 'CNY', tripId: 'trip', updatedAt: 1 },
  trip: { createdAt: 1, destination: '东京', endDate: '2026-06-10', id: 'trip', startDate: '2026-06-01', title: '东京旅行', updatedAt: 1 },
}

describe('ledger travel archive report', () => {
  it('uses service date first, nets refunds, and excludes missing exchange rates', () => {
    const model = buildLedgerReportModel({
      ...input,
      expenses: [
        expense({ paidAt: '2026-05-20', serviceStartAt: '2026-06-05' }),
        expense({ amountMinor: -2000, category: 'lodging', id: 'refund', originalExpenseId: 'expense-1', refundedAt: '2026-06-06', title: '酒店部分退款' }),
        expense({ amountMinor: 5000, currency: 'USD', id: 'missing-fx', title: '美元账单' }),
      ],
    }, '2026-06-12')
    expect(model.title).toBe('旅行结束报告')
    expect(model.confirmedNetMinor).toBe(8000)
    expect(model.missingExchangeRate.map((record) => record.id)).toEqual(['missing-fx'])
    expect(model.timeline.find((row) => row.expenseId === 'expense-1')?.date).toBe('2026-06-05')
    expect(model.refunds.map((record) => record.id)).toContain('refund')
  })

  it('escapes quotes and line breaks in CSV output', () => {
    expect(toCsv([['标题'], ['东京"酒店\n账单']])).toContain('"东京""酒店\n账单"')
  })

  it('uses the trip time zone rather than UTC for the default report date', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-06-10T16:30:00.000Z'))
      const model = buildLedgerReportModel({
        ...input,
        trip: { ...input.trip, timeZone: 'Asia/Tokyo' },
      })
      expect(model.title).toBe('旅行结束报告')
    } finally {
      vi.useRealTimers()
    }
  })
})
