import { describe, expect, it } from 'vitest'
import { buildLedgerExpenseDraftCandidates, sanitizeLedgerExtractionTextForAi } from './ledgerExtraction'

describe('ledger expense extraction', () => {
  it('removes account and provider secrets before optional AI extraction', () => {
    const sanitized = sanitizeLedgerExtractionTextForAi('邮箱 test@example.com https://example.com/order?id=1 Authorization: Bearer secret-token 550e8400-e29b-41d4-a716-446655440000')
    expect(sanitized).not.toContain('test@example.com')
    expect(sanitized).not.toContain('example.com')
    expect(sanitized).not.toContain('secret-token')
    expect(sanitized).not.toContain('550e8400')
  })

  it('extracts amount, currency, category and payer from local text only', () => {
    const candidates = buildLedgerExpenseDraftCandidates({
      bookings: [],
      days: [{ date: '2026-04-01', id: 'day', sortOrder: 0, title: '第一天', tripId: 'trip' }],
      existingExpenses: [],
      inboxEntries: [{ category: 'ticket', createdAt: 1, extractedText: '东京晚餐 实付 JPY 3600 付款人 小林', id: 'inbox', sourceKind: 'pasted_text', status: 'ready', tripId: 'trip', updatedAt: 1, warnings: [] }],
      items: [],
      participants: [{ createdAt: 1, displayName: '小林', id: 'lin', tripId: 'trip', updatedAt: 1 }],
      tickets: [],
      tripCurrency: 'JPY',
      tripStartDate: '2026-04-01',
    })
    expect(candidates[0]).toMatchObject({ amountMinor: 3600, category: 'food', currency: 'JPY', payerParticipantId: 'lin' })
  })

  it('does not recreate a source that already has an expense', () => {
    const candidates = buildLedgerExpenseDraftCandidates({
      bookings: [], days: [], inboxEntries: [], items: [], participants: [], tripCurrency: 'CNY', tripStartDate: '2026-04-01',
      existingExpenses: [{ amountMinor: 100, category: 'other', createdAt: 1, currency: 'CNY', date: '2026-04-01', id: 'expense', source: { kind: 'ticket', sourceId: 'ticket' }, splitMode: 'equal', splitShares: [], status: 'draft', title: '票据', tripId: 'trip', updatedAt: 1 }],
      tickets: [{ createdAt: 1, fileName: 'ticket.txt', fileType: 'other', id: 'ticket', mimeType: 'text/plain', size: 1, tripId: 'trip', updatedAt: 1 }],
    })
    expect(candidates).toEqual([])
  })
})
