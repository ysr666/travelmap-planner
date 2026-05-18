import { describe, expect, it } from 'vitest'
import { buildTripContext, getCoordinateState } from './aiTripContext'
import type { Day, ItineraryItem, TicketMeta, Trip } from '../types'

const now = 1000

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    createdAt: now,
    destination: '日本东京',
    endDate: '2026-04-13',
    id: 'trip-1',
    notes: '请不要把完整备注放进上下文',
    startDate: '2026-04-12',
    title: '东京春日旅行',
    updatedAt: now,
    ...overrides,
  }
}

function makeDay(overrides: Partial<Day> = {}): Day {
  return {
    date: '2026-04-12',
    id: 'day-1',
    sortOrder: 1,
    title: '抵达与涩谷',
    tripId: 'trip-1',
    ...overrides,
  }
}

function makeItem(overrides: Partial<ItineraryItem> = {}): ItineraryItem {
  return {
    createdAt: now,
    dayId: 'day-1',
    id: 'item-1',
    sortOrder: 1,
    ticketIds: [],
    title: 'Shibuya Sky ticket',
    tripId: 'trip-1',
    updatedAt: now,
    ...overrides,
  }
}

function makeTicket(overrides: Partial<TicketMeta> = {}): TicketMeta {
  return {
    createdAt: now,
    fileName: 'secret-ticket.pdf',
    fileType: 'pdf',
    id: 'ticket-1',
    mimeType: 'application/pdf',
    size: 2048,
    storageMode: 'copy',
    title: 'Secret Ticket Title',
    tripId: 'trip-1',
    updatedAt: now,
    ...overrides,
  }
}

describe('buildTripContext', () => {
  it('includes safe trip, day, item, and ticket metadata', () => {
    const context = buildTripContext({
      days: [makeDay()],
      items: [
        makeItem({
          address: '2 Chome-24-12 Shibuya',
          lat: 35.65858,
          lng: 139.70204,
          locationName: 'Shibuya Sky',
          notes: '短备注',
          previousTransportDurationMinutes: 25,
          previousTransportMode: 'train',
          previousTransportNote: 'JR',
          startTime: '18:30',
          ticketIds: ['ticket-legacy'],
        }),
      ],
      nowPlainDate: '2026-04-12',
      selectedDayId: 'day-1',
      tickets: [
        makeTicket({ id: 'ticket-1', itemId: 'item-1', scope: 'item' }),
        makeTicket({ id: 'ticket-2', scope: 'trip', storageMode: 'external', fileType: 'other' }),
      ],
      trip: makeTrip(),
    })

    expect(context.trip).toMatchObject({
      destination: '日本东京',
      endDate: '2026-04-13',
      hasNotes: true,
      id: 'trip-1',
      noteLength: 'short',
      startDate: '2026-04-12',
      title: '东京春日旅行',
    })
    expect(context.selectedDayId).toBe('day-1')
    expect(context.nowPlainDate).toBe('2026-04-12')
    expect(context.days[0]).toMatchObject({
      date: '2026-04-12',
      id: 'day-1',
      itemCount: 1,
      title: '抵达与涩谷',
    })
    expect(context.days[0].items[0]).toMatchObject({
      address: '2 Chome-24-12 Shibuya',
      coordinateState: 'present',
      hasNotes: true,
      id: 'item-1',
      locationName: 'Shibuya Sky',
      noteLength: 'short',
      previousTransport: {
        durationMinutes: 25,
        hasDuration: true,
        hasNote: true,
        mode: 'train',
      },
      startTime: '18:30',
      ticketBoundState: 'item_bound',
      ticketCount: 2,
      title: 'Shibuya Sky ticket',
    })
    expect(context.ticketSummary).toMatchObject({
      itemBoundCount: 1,
      totalCount: 2,
      tripBoundCount: 1,
      unassignedCount: 0,
    })
    expect(context.ticketSummary.byStorageMode).toMatchObject({ copy: 1, external: 1, reference: 0 })
  })

  it('does not include sensitive ticket or note content', () => {
    const context = buildTripContext({
      days: [makeDay()],
      items: [
        makeItem({
          address: 'Known public address',
          lat: 12.345678,
          lng: 98.765432,
          notes: 'passport-number-should-stay-out',
          previousTransportNote: 'private-route-note',
        }),
      ],
      tickets: [
        makeTicket({
          externalUrl: 'https://example.com/private-order',
          fileName: 'private-file-name.pdf',
          note: 'ticket-note-secret',
          referenceLocation: 'iCloud Drive/private/passport.pdf',
          storageMode: 'external',
          title: 'private-ticket-title',
        }),
      ],
      trip: makeTrip({ notes: 'trip-note-secret' }),
    })
    const serialized = JSON.stringify(context)

    expect(serialized).not.toContain('passport-number-should-stay-out')
    expect(serialized).not.toContain('private-route-note')
    expect(serialized).not.toContain('trip-note-secret')
    expect(serialized).not.toContain('ticket-note-secret')
    expect(serialized).not.toContain('private-ticket-title')
    expect(serialized).not.toContain('private-file-name.pdf')
    expect(serialized).not.toContain('https://example.com/private-order')
    expect(serialized).not.toContain('iCloud Drive/private/passport.pdf')
    expect(serialized).not.toContain('12.345678')
    expect(serialized).not.toContain('98.765432')
    expect(serialized).toContain('"coordinateState":"present"')
  })

  it('classifies coordinate state without exposing coordinates', () => {
    expect(getCoordinateState({ lat: undefined, lng: undefined })).toBe('missing')
    expect(getCoordinateState({ lat: 35, lng: 139 })).toBe('present')
    expect(getCoordinateState({ lat: 35, lng: undefined })).toBe('invalid')
    expect(getCoordinateState({ lat: 91, lng: 139 })).toBe('invalid')
    expect(getCoordinateState({ lat: Number.NaN, lng: 139 })).toBe('invalid')
  })
})
