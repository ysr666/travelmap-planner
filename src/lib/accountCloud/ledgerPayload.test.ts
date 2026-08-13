import { describe, expect, it } from 'vitest'
import {
  assertAccountLedgerPayload,
  isAccountLedgerPayloadValid,
  type AccountLedgerObjectType,
} from './ledgerPayload'

const TRIP_ID = 'trip_uk'

describe('account ledger payload contract', () => {
  it.each<[AccountLedgerObjectType, Record<string, unknown>]>([
    ['ledger_settings', {
      createdAt: 1,
      homeCurrency: 'CNY',
      id: 'settings_1',
      settlementCurrency: 'CNY',
      tripCurrency: 'GBP',
      tripId: TRIP_ID,
      updatedAt: 1,
    }],
    ['ledger_participant', {
      createdAt: 1,
      displayName: 'Traveler',
      id: 'participant_1',
      isSelf: true,
      source: 'traveler_profile',
      sourceId: 'traveler_1',
      tripId: TRIP_ID,
      updatedAt: 1,
    }],
    ['ledger_budget', {
      amountMinor: 120_000,
      category: 'food',
      createdAt: 1,
      currency: 'GBP',
      id: 'budget_1',
      scope: 'category',
      tripId: TRIP_ID,
      updatedAt: 1,
    }],
    ['ledger_expense', makeExpense()],
  ])('accepts a complete %s payload', (objectType, payload) => {
    expect(isAccountLedgerPayloadValid(objectType, payload)).toBe(true)
    expect(() => assertAccountLedgerPayload(objectType, payload)).not.toThrow()
  })

  it.each([
    ['unknown field', { providerKey: 'secret' }],
    ['lowercase currency', { currency: 'gbp' }],
    ['unsafe participant identity', { payerParticipantId: '../participant' }],
    ['duplicate split participant', {
      splitShares: [
        { participantId: 'participant_1', weight: 1 },
        { participantId: 'participant_1', weight: 2 },
      ],
    }],
    ['amount without currency', { currency: undefined }],
    ['non-HTTPS rate source', {
      exchangeRate: {
        ...makeExpense().exchangeRate as Record<string, unknown>,
        sourceUrl: 'http://example.test/rates',
      },
    }],
    ['duplicate source-link identity', {
      sourceLinks: [makeSourceLink(), makeSourceLink()],
    }],
    ['duplicate line-item identity', {
      lineItems: [makeLineItem(), makeLineItem()],
    }],
    ['control character', { title: 'Dinner\u0000receipt' }],
    ['numeric source identity', { source: { kind: 'ticket', sourceId: 1 } }],
    ['impossible calendar timestamp', { bookedAt: '2026-02-31T12:00:00Z' }],
    ['locale-dependent timestamp', { paidAt: 'July 10, 2026' }],
  ])('rejects %s', (_label, patch) => {
    expect(isAccountLedgerPayloadValid('ledger_expense', { ...makeExpense(), ...patch })).toBe(false)
  })

  it('allows line breaks in notes but not hidden control bytes', () => {
    expect(isAccountLedgerPayloadValid('ledger_expense', {
      ...makeExpense(),
      notes: 'Paid at the venue.\nKeep the paper receipt.',
    })).toBe(true)
    expect(isAccountLedgerPayloadValid('ledger_expense', {
      ...makeExpense(),
      notes: 'receipt\u0001hidden',
    })).toBe(false)
  })

  it('allows a draft currency before amount recognition but never an amount without currency', () => {
    expect(isAccountLedgerPayloadValid('ledger_expense', {
      ...makeExpense(),
      amountMinor: undefined,
    })).toBe(true)
    expect(isAccountLedgerPayloadValid('ledger_expense', {
      ...makeExpense(),
      currency: undefined,
    })).toBe(false)
  })

  it('requires scope-specific budget dimensions', () => {
    const base = {
      amountMinor: 1,
      createdAt: 1,
      currency: 'GBP',
      id: 'budget_1',
      tripId: TRIP_ID,
      updatedAt: 1,
    }
    expect(isAccountLedgerPayloadValid('ledger_budget', { ...base, scope: 'trip' })).toBe(true)
    expect(isAccountLedgerPayloadValid('ledger_budget', { ...base, scope: 'category' })).toBe(false)
    expect(isAccountLedgerPayloadValid('ledger_budget', {
      ...base,
      category: 'food',
      date: '2026-07-10',
      scope: 'category',
    })).toBe(false)
    expect(isAccountLedgerPayloadValid('ledger_budget', {
      ...base,
      date: '2026-07-10',
      scope: 'date',
    })).toBe(true)
  })
})

function makeExpense() {
  return {
    amountMinor: 12_500,
    bookedAt: '2026-07-01T12:00:00.000Z',
    category: 'food',
    city: 'London',
    createdAt: 1,
    currency: 'GBP',
    date: '2026-07-10',
    duplicateAcknowledged: false,
    exchangeRate: {
      baseCurrency: 'GBP',
      effectiveDate: '2026-07-10',
      fetchedAt: '2026-07-10T12:00:00.000Z',
      homeCurrency: 'CNY',
      provider: 'frankfurter',
      rateToHome: '9.5',
      rateToTrip: '1',
      requestedDate: '2026-07-10',
      sourceUrl: 'https://api.frankfurter.app/2026-07-10',
      tripCurrency: 'GBP',
    },
    id: 'expense_1',
    itemIds: ['item_1'],
    lineItems: [makeLineItem()],
    merchant: 'Cafe',
    notes: 'Card payment',
    orderStatus: 'active',
    paidAt: '2026-07-10T12:00:00.000Z',
    payerParticipantId: 'participant_1',
    paymentStatus: 'paid',
    recognitionConfidence: 0.99,
    reviewStatus: 'reviewed',
    source: {
      fingerprint: 'receipt_fingerprint_1',
      kind: 'ticket',
      label: 'Receipt',
      sourceId: 'ticket_1',
    },
    sourceLinks: [makeSourceLink()],
    splitMode: 'equal',
    splitShares: [{ participantId: 'participant_1', weight: 1 }],
    status: 'confirmed',
    title: 'Dinner',
    tripId: TRIP_ID,
    updatedAt: 2,
  }
}

function makeSourceLink() {
  return {
    available: true,
    capturedAt: '2026-07-10T12:00:00.000Z',
    id: 'source_link_1',
    kind: 'ticket',
    label: 'Receipt',
    role: 'payment_receipt',
    sourceId: 'ticket_1',
    title: 'Dinner receipt',
  }
}

function makeLineItem() {
  return {
    amountMinor: 12_500,
    category: 'food',
    currency: 'GBP',
    id: 'line_1',
    kind: 'base',
    title: 'Dinner',
  }
}
