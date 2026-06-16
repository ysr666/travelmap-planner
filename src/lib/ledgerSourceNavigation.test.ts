import { describe, expect, it } from 'vitest'
import { buildLedgerSourceNavigationTarget } from './ledgerSourceNavigation'

describe('ledger source navigation', () => {
  it('builds precise targets for every supported source kind', () => {
    expect(buildLedgerSourceNavigationTarget({ kind: 'ticket', sourceId: 'ticket-1' }, 'trip')).toEqual({ route: 'documents', params: { tab: 'attachments', ticketId: 'ticket-1', tripId: 'trip' } })
    expect(buildLedgerSourceNavigationTarget({ kind: 'transport_booking', sourceId: 'booking-1' }, 'trip')).toEqual({ route: 'documents', params: { bookingId: 'booking-1', tab: 'transport', tripId: 'trip' } })
    expect(buildLedgerSourceNavigationTarget({ kind: 'inbox', sourceId: 'inbox-1' }, 'trip')).toEqual({ route: 'inbox', params: { inboxEntryId: 'inbox-1', tripId: 'trip' } })
    expect(buildLedgerSourceNavigationTarget({ kind: 'itinerary_note', sourceId: 'item-1' }, 'trip', [{ dayId: 'day-1', id: 'item-1' }])).toEqual({ route: 'item', params: { dayId: 'day-1', itemId: 'item-1', tripId: 'trip' } })
  })

  it('does not fabricate routes for deleted or manual sources', () => {
    expect(buildLedgerSourceNavigationTarget({ kind: 'itinerary_note', sourceId: 'gone' }, 'trip', [])).toBeUndefined()
    expect(buildLedgerSourceNavigationTarget({ kind: 'manual' }, 'trip')).toBeUndefined()
  })
})
