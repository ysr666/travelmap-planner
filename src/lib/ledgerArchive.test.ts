import { describe, expect, it } from 'vitest'
import type { LedgerExpense, LedgerParticipant, LedgerSettings, Trip } from '../types'
import {
  areLedgerLineItemsBalanced,
  buildLedgerAiQueryContext,
  buildLedgerCandidateMergePatch,
  buildLedgerExpenseFromCandidate,
  buildLedgerForecast,
  buildLedgerIntegrityIssues,
  buildLedgerTimeline,
  findLedgerCandidateMatch,
  queryLedgerLocally,
} from './ledgerArchive'
import { buildCandidate, canAutoConfirmLedgerCandidate, sanitizeLedgerExtractionTextForAi } from './ledgerExtraction'

const participants: LedgerParticipant[] = [{ createdAt: 1, displayName: '我', id: 'p1', isSelf: true, tripId: 'trip', updatedAt: 1 }]
const settings: LedgerSettings = { createdAt: 1, homeCurrency: 'CNY', id: 'settings', settlementCurrency: 'CNY', tripCurrency: 'CNY', tripId: 'trip', updatedAt: 1 }
const trip: Trip = { createdAt: 1, destination: '东京', endDate: '2026-06-10', id: 'trip', startDate: '2026-06-01', title: '东京', updatedAt: 1 }

function expense(patch: Partial<LedgerExpense> = {}): LedgerExpense {
  return {
    amountMinor: 10000,
    category: 'lodging',
    createdAt: 1,
    currency: 'CNY',
    date: '2026-06-02',
    id: 'expense-1',
    itemIds: ['item-1'],
    orderStatus: 'active',
    paidAt: '2026-06-02',
    payerParticipantId: 'p1',
    paymentStatus: 'paid',
    source: { kind: 'inbox', sourceId: 'source-1' },
    sourceLinks: [{ available: true, id: 'inbox:source-1', kind: 'inbox', role: 'payment_receipt', sourceId: 'source-1' }],
    splitMode: 'equal',
    splitShares: [{ participantId: 'p1', weight: 1 }],
    status: 'confirmed',
    title: '东京酒店',
    tripId: 'trip',
    updatedAt: 1,
    ...patch,
  }
}

describe('ledger archive v2', () => {
  it('auto-confirms balanced paid candidates at the balanced confidence threshold', () => {
    const candidate = buildCandidate({
      fallbackCurrency: 'CNY',
      fallbackTitle: '东京酒店',
      itemIds: [],
      participants,
      source: { kind: 'inbox', sourceId: 'mail-1' },
      text: '订单号 ABCDE12345\n酒店: Tokyo Stay\n支付成功\n总计 CNY 100.00\n付款时间: 2026-06-02',
      tripStartDate: trip.startDate,
    })
    expect(candidate.recognitionConfidence).toBeGreaterThanOrEqual(0.85)
    expect(canAutoConfirmLedgerCandidate(candidate)).toBe(true)
    expect(buildLedgerExpenseFromCandidate(candidate, trip.id, participants)).toMatchObject({ reviewStatus: 'auto_confirmed', status: 'confirmed' })
  })

  it('keeps order confirmations without payment evidence as drafts', () => {
    const candidate = buildCandidate({
      fallbackCurrency: 'CNY',
      fallbackTitle: '酒店预订',
      participants,
      source: { kind: 'inbox', sourceId: 'mail-2' },
      text: '订单确认 订单号 HOTEL12345\n总计 CNY 100.00\n预订时间: 2026-06-01',
      tripStartDate: trip.startDate,
    })
    expect(candidate.paymentStatus).toBe('unknown')
    expect(canAutoConfirmLedgerCandidate(candidate)).toBe(false)
    expect(buildLedgerExpenseFromCandidate(candidate, trip.id, participants).status).toBe('draft')
  })

  it('matches order and payment sources by full order number and merges source chains atomically', () => {
    const existing = expense({ merchant: 'Tokyo Stay', orderNumber: 'ABCDE12345' })
    const candidate = buildCandidate({
      fallbackCurrency: 'CNY',
      fallbackTitle: '付款通知',
      participants,
      source: { kind: 'ticket', sourceId: 'ticket-2' },
      text: '订单号 ABCDE12345\n酒店: Tokyo Stay\n支付成功\n总计 CNY 100.00',
      tripStartDate: trip.startDate,
    })
    expect(findLedgerCandidateMatch(candidate, [existing])?.kind).toBe('order')
    expect(buildLedgerCandidateMergePatch(existing, candidate).sourceLinks).toHaveLength(2)
  })

  it('requires line items to sum exactly to the signed bill total', () => {
    expect(areLedgerLineItemsBalanced({ amountMinor: 9000, lineItems: [
      { amountMinor: 10000, category: 'food', currency: 'CNY', id: 'base', kind: 'base', title: '餐费' },
      { amountMinor: -1000, category: 'food', currency: 'CNY', id: 'discount', kind: 'discount', title: '折扣' },
    ] })).toBe(true)
    expect(areLedgerLineItemsBalanced({ amountMinor: 9001, lineItems: [{ amountMinor: 9000, category: 'food', currency: 'CNY', id: 'base', kind: 'base', title: '餐费' }] })).toBe(false)
  })

  it('extracts city, tax and base line items when their integer total is balanced', () => {
    const candidate = buildCandidate({
      fallbackCurrency: 'CNY',
      fallbackTitle: '酒店账单',
      participants,
      source: { kind: 'ticket', sourceId: 'ticket-lines' },
      text: '城市: 东京\n酒店账单\n小计 CNY 90.00\n税费 CNY 10.00\n总计 CNY 100.00\n支付成功',
      tripStartDate: trip.startDate,
    })
    expect(candidate.city).toBe('东京')
    expect(candidate.lineItems.map((item) => item.kind)).toEqual(['base', 'tax'])
    expect(candidate.lineItems.reduce((sum, item) => sum + item.amountMinor, 0)).toBe(candidate.amountMinor)
  })

  it('reports missing receipts, itinerary links and cancelled paid bills without reversals', () => {
    const issues = buildLedgerIntegrityIssues([expense({ itemIds: [], orderStatus: 'cancelled', sourceLinks: [{ available: true, id: 'order', kind: 'inbox', role: 'order_confirmation' }] })])
    expect(issues.map((issue) => issue.kind)).toEqual(expect.arrayContaining(['paid_without_receipt', 'unlinked_itinerary', 'cancelled_not_reversed']))
  })

  it('builds independent booking, payment and service timelines', () => {
    const events = buildLedgerTimeline([expense({ bookedAt: '2026-05-01', paidAt: '2026-05-02', serviceStartAt: '2026-06-02' })])
    expect(events.map((event) => event.kind)).toEqual(['booking', 'payment', 'service'])
  })

  it('forecasts final spend deterministically and flags category budget risk', () => {
    const forecast = buildLedgerForecast({
      budgets: [
        { amountMinor: 50000, createdAt: 1, currency: 'CNY', id: 'total', scope: 'trip', tripId: 'trip', updatedAt: 1 },
        { amountMinor: 12000, category: 'lodging', createdAt: 1, currency: 'CNY', id: 'lodging', scope: 'category', tripId: 'trip', updatedAt: 1 },
      ],
      expenses: [expense({ amountMinor: 10000, date: '2026-06-02' })],
      settings,
      today: '2026-06-05',
      trip,
    })
    expect(forecast.projectedMinor).toBeGreaterThan(forecast.actualMinor)
    expect(forecast.dailyAvailableMinor).toBeGreaterThanOrEqual(0)
    expect(forecast.riskCategories).toContain('lodging')
  })

  it('keeps authoritative totals local and removes order numbers from AI query context', () => {
    const record = expense({ orderNumber: 'SECRET-ORDER-123' })
    const result = queryLedgerLocally('东京酒店一共多少钱？', [record], settings)
    expect(result.totalMinor).toBe(10000)
    expect(JSON.stringify(buildLedgerAiQueryContext([record], result))).not.toContain('SECRET-ORDER-123')
    expect(sanitizeLedgerExtractionTextForAi('订单号 SECRET-ORDER-123 支付成功')).not.toContain('SECRET-ORDER-123')
  })
})
