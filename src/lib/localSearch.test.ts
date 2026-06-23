import { describe, expect, it } from 'vitest'
import { buildLocalSearchIndex, buildLocalSearchView, normalizeSearchText } from './localSearch'
import type {
  Day,
  ItineraryItem,
  LedgerExpense,
  TicketMeta,
  TransportBooking,
  TransportSegment,
  Trip,
} from '../types'

describe('local search', () => {
  it('builds cross-domain records with narrow canonical deep links', () => {
    const index = buildFixtureIndex()

    expect(index.map((record) => record.category)).toEqual(['trip', 'item', 'ticket', 'transport', 'ledger'])
    expect(index.find((record) => record.category === 'transport')).toMatchObject({
      params: { bookingId: 'booking_1', tab: 'transport', tripId: 'trip_1' },
      route: 'documents',
    })
    expect(index.find((record) => record.category === 'ledger')).toMatchObject({
      params: { expenseId: 'expense_1', tripId: 'trip_1' },
      route: 'ledger/expense',
    })
  })

  it('ranks title matches above secondary context matches', () => {
    const index = buildFixtureIndex()
    const results = buildLocalSearchView(index, { query: '东京' }).results

    expect(results[0].record.title).toBe('东京春日旅行')
    expect(results.map((result) => result.record.category)).toContain('item')
  })

  it('normalizes full-width characters and compact service numbers', () => {
    const index = buildFixtureIndex()

    expect(normalizeSearchText(' ＭＵ ５１３７ ')).toBe('mu 5137')
    expect(buildLocalSearchView(index, { query: 'MU5137' }).results[0]?.record.id).toBe('transport:booking_1')
  })

  it('filters categories and returns query-aware counts', () => {
    const view = buildLocalSearchView(buildFixtureIndex(), { filter: 'transport', query: '东京' })

    expect(view.counts.all).toBeGreaterThan(1)
    expect(view.counts.transport).toBe(1)
    expect(view.results).toHaveLength(1)
    expect(view.groups.map((group) => group.category)).toEqual(['transport'])
  })

  it('does not index ledger order numbers or notes', () => {
    const index = buildFixtureIndex()

    expect(buildLocalSearchView(index, { query: 'SECRET-ORDER-7788' }).totalMatches).toBe(0)
    expect(buildLocalSearchView(index, { query: 'PRIVATE-LEDGER-NOTE' }).totalMatches).toBe(0)
  })
})

function buildFixtureIndex() {
  return buildLocalSearchIndex({
    bookings: [booking()],
    days: [day()],
    expenses: [expense()],
    items: [item()],
    segments: [segment()],
    tickets: [ticket()],
    trips: [trip()],
  })
}

function trip(): Trip {
  return {
    createdAt: 1,
    destination: '日本东京',
    endDate: '2026-04-17',
    id: 'trip_1',
    startDate: '2026-04-12',
    title: '东京春日旅行',
    updatedAt: 100,
  }
}

function day(): Day {
  return { date: '2026-04-12', id: 'day_1', sortOrder: 0, title: '抵达东京', tripId: 'trip_1' }
}

function item(): ItineraryItem {
  return {
    address: 'Shibuya City, Tokyo',
    createdAt: 1,
    dayId: 'day_1',
    id: 'item_1',
    locationName: 'Shibuya Sky',
    sortOrder: 0,
    startTime: '18:00',
    ticketIds: ['ticket_1'],
    title: 'Shibuya Sky 夜景',
    tripId: 'trip_1',
    updatedAt: 90,
  }
}

function ticket(): TicketMeta {
  return {
    createdAt: 1,
    fileName: 'shibuya.pdf',
    fileType: 'pdf',
    id: 'ticket_1',
    itemId: 'item_1',
    mimeType: 'application/pdf',
    size: 100,
    storageMode: 'copy',
    ticketCategory: 'admission_ticket',
    title: 'Shibuya Sky 门票',
    tripId: 'trip_1',
    updatedAt: 80,
  }
}

function booking(): TransportBooking {
  return {
    createdAt: 1,
    externalActions: [],
    id: 'booking_1',
    kind: 'flight',
    providerName: '东方航空',
    status: 'confirmed',
    title: '上海飞东京',
    tripId: 'trip_1',
    updatedAt: 70,
  }
}

function segment(): TransportSegment {
  return {
    arrivalDate: '2026-04-12',
    arrivalPlace: '东京羽田',
    arrivalTimeZone: 'Asia/Tokyo',
    bookingId: 'booking_1',
    carrier: '东方航空',
    createdAt: 1,
    departureDate: '2026-04-12',
    departurePlace: '上海虹桥',
    departureTimeZone: 'Asia/Shanghai',
    id: 'segment_1',
    kind: 'flight',
    serviceNumber: 'MU 5137',
    sortOrder: 0,
    status: 'scheduled',
    tripId: 'trip_1',
    updatedAt: 75,
  }
}

function expense(): LedgerExpense {
  return {
    amountMinor: 320000,
    category: 'transport',
    city: '东京',
    createdAt: 1,
    currency: 'JPY',
    date: '2026-04-12',
    id: 'expense_1',
    merchant: '东方航空',
    notes: 'PRIVATE-LEDGER-NOTE',
    orderNumber: 'SECRET-ORDER-7788',
    source: { kind: 'manual' },
    splitMode: 'equal',
    splitShares: [],
    status: 'confirmed',
    title: '上海飞东京机票',
    tripId: 'trip_1',
    updatedAt: 60,
  }
}
