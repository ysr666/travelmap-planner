import { describe, expect, it } from 'vitest'
import type { LedgerExpenseDraftCandidate } from '../../ledgerExtraction'
import { mapInboxInputToSuggestions } from './inboxAdapter'

describe('inbox intelligence adapter', () => {
  it('maps assigned local expense evidence to a confirm-only draft suggestion', () => {
    const [suggestion] = mapInboxInputToSuggestions({
      expenseDraftCandidates: [candidate({ itemIds: ['item-1'] })],
    })

    expect(suggestion).toEqual(expect.objectContaining({
      affectedItemIds: ['item-1'],
      scope: 'inbox',
      status: 'needs_confirmation',
    }))
    expect(suggestion.action).toEqual(expect.objectContaining({
      kind: 'ledger_create_expense_draft_from_candidate',
      mode: 'confirm_required',
    }))
    expect(suggestion.message).toContain('关联到现有行程点')
  })

  it('labels unlinked material as a possible on-site expense', () => {
    const [suggestion] = mapInboxInputToSuggestions({
      expenseDraftCandidates: [candidate()],
    })

    expect(suggestion.message).toContain('可能是现场消费')
    expect(suggestion.affectedItemIds).toEqual([])
  })
})

function candidate(patch: Partial<LedgerExpenseDraftCandidate> = {}): LedgerExpenseDraftCandidate {
  return {
    amountMinor: 500,
    category: 'food',
    currency: 'JPY',
    date: '2026-04-01',
    extractedText: '实付 JPY 500',
    itemIds: [],
    lineItems: [],
    orderStatus: 'active',
    paymentStatus: 'paid',
    recognitionConfidence: 0.9,
    source: { fingerprint: 'receipt-1', kind: 'inbox', sourceId: 'entry-1' },
    sourceLink: {
      available: true,
      capturedAt: '2026-04-01T00:00:00.000Z',
      fingerprint: 'receipt-1',
      id: 'inbox:entry-1',
      kind: 'inbox',
      role: 'payment_receipt',
      sourceId: 'entry-1',
    },
    sourceRole: 'payment_receipt',
    title: '冰激凌收据',
    warnings: [],
    ...patch,
  }
}
