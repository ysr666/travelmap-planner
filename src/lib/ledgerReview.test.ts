import { describe, expect, it } from 'vitest'
import type { LedgerExpense } from '../types'
import { buildLedgerReviewEntries, buildLedgerReviewEntry } from './ledgerReview'

function expense(patch: Partial<LedgerExpense> = {}): LedgerExpense {
  return {
    amountMinor: 10_000,
    category: 'lodging',
    createdAt: 1,
    currency: 'JPY',
    date: '2026-06-01',
    id: patch.id ?? 'expense-1',
    itemIds: ['item-1'],
    payerParticipantId: 'person-1',
    paymentStatus: 'paid',
    reviewStatus: 'needs_review',
    source: { kind: 'inbox', sourceId: patch.id ?? 'source-1' },
    sourceLinks: [{ available: true, id: `inbox:${patch.id ?? 'source-1'}`, kind: 'inbox', role: 'payment_receipt', sourceId: patch.id ?? 'source-1' }],
    splitMode: 'equal',
    splitShares: [{ participantId: 'person-1', weight: 1 }],
    status: 'draft',
    title: '东京酒店',
    tripId: 'trip-1',
    updatedAt: 1,
    ...patch,
  }
}

describe('ledger review queue', () => {
  it('keeps auto-confirmed expenses visible until reviewed', () => {
    const entry = buildLedgerReviewEntry(expense({ reviewStatus: 'auto_confirmed', status: 'confirmed' }))
    expect(entry.buckets).toContain('auto_archived')
    expect(entry.canMarkReviewed).toBe(true)
  })

  it('allows missing payer and itinerary while blocking missing payment evidence', () => {
    const allowed = buildLedgerReviewEntry(expense({ itemIds: [], payerParticipantId: undefined }))
    expect(allowed.canBulkConfirm).toBe(true)
    expect(allowed.buckets).toContain('missing_fields')

    const blocked = buildLedgerReviewEntry(expense({ paymentStatus: 'unknown', sourceLinks: [] }))
    expect(blocked.canBulkConfirm).toBe(false)
    expect(blocked.issues).toContainEqual(expect.objectContaining({ kind: 'missing_payment_evidence', blocking: true }))
  })

  it('orders duplicate and blocking records before normal drafts and auto archives', () => {
    const duplicateA = expense({ id: 'duplicate-a', source: { kind: 'manual' }, sourceLinks: [], title: '同笔消费' })
    const duplicateB = expense({ id: 'duplicate-b', source: { kind: 'manual' }, sourceLinks: [], title: '同笔消费' })
    const normal = expense({ id: 'normal' })
    const auto = expense({ amountMinor: 20_000, id: 'auto', reviewStatus: 'auto_confirmed', status: 'confirmed', title: '自动归档车票' })
    const entries = buildLedgerReviewEntries([auto, normal, duplicateA, duplicateB])
    expect(entries.slice(0, 2).every((entry) => entry.buckets.includes('duplicate'))).toBe(true)
    expect(entries.at(-1)?.expense.id).toBe('auto')
  })
})
