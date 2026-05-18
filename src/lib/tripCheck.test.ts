import { describe, expect, it } from 'vitest'
import { buildTripContext } from './aiTripContext'
import { analyzeTripContext, isTicketLikeItem } from './tripCheck'
import type { Day, ItineraryItem, TicketMeta, Trip } from '../types'

const now = 1000

function makeTrip(): Trip {
  return {
    createdAt: now,
    destination: '日本东京',
    endDate: '2026-04-13',
    id: 'trip-1',
    startDate: '2026-04-12',
    title: '东京春日旅行',
    updatedAt: now,
  }
}

function makeDay(overrides: Partial<Day> = {}): Day {
  return {
    date: '2026-04-12',
    id: 'day-1',
    sortOrder: 1,
    title: '第一天',
    tripId: 'trip-1',
    ...overrides,
  }
}

function makeItem(overrides: Partial<ItineraryItem> = {}): ItineraryItem {
  return {
    createdAt: now,
    dayId: 'day-1',
    id: 'item-1',
    lat: 35,
    lng: 139,
    previousTransportDurationMinutes: 20,
    sortOrder: 1,
    ticketIds: [],
    title: '普通地点',
    tripId: 'trip-1',
    updatedAt: now,
    ...overrides,
  }
}

function makeTicket(overrides: Partial<TicketMeta> = {}): TicketMeta {
  return {
    createdAt: now,
    fileName: 'ticket.pdf',
    fileType: 'pdf',
    id: 'ticket-1',
    itemId: 'item-1',
    mimeType: 'application/pdf',
    size: 12,
    storageMode: 'copy',
    title: '门票',
    tripId: 'trip-1',
    updatedAt: now,
    ...overrides,
  }
}

function analyze({
  days = [makeDay()],
  items,
  tickets = [],
}: {
  days?: Day[]
  items: ItineraryItem[]
  tickets?: TicketMeta[]
}) {
  return analyzeTripContext(buildTripContext({
    days,
    items,
    tickets,
    trip: makeTrip(),
  }))
}

function allFindings(result: ReturnType<typeof analyzeTripContext>) {
  return [...result.warnings, ...result.suggestions]
}

describe('analyzeTripContext', () => {
  it('warns for missing coordinates and keeps item evidence', () => {
    const result = analyze({
      items: [makeItem({ id: 'item-missing-coordinate', lat: undefined, lng: undefined })],
    })

    expect(result.warnings).toEqual([
      expect.objectContaining({
        affectedDayIds: ['day-1'],
        affectedItemIds: ['item-missing-coordinate'],
        ruleId: 'missing_coordinate',
        severity: 'warning',
        source: 'local_rule',
      }),
    ])
    expect(result.evidence[0]).toMatchObject({
      dayId: 'day-1',
      itemId: 'item-missing-coordinate',
    })
  })

  it('warns for invalid coordinates', () => {
    const result = analyze({
      items: [makeItem({ id: 'item-invalid-coordinate', lat: 91 })],
    })

    expect(result.warnings.map((finding) => finding.ruleId)).toContain('invalid_coordinate')
  })

  it('warns for missing transport duration between adjacent items', () => {
    const result = analyze({
      items: [
        makeItem({ id: 'item-a', sortOrder: 1 }),
        makeItem({ id: 'item-b', previousTransportDurationMinutes: undefined, sortOrder: 2 }),
      ],
    })

    expect(result.warnings).toEqual([
      expect.objectContaining({
        affectedItemIds: ['item-a', 'item-b'],
        ruleId: 'missing_transport_duration',
      }),
    ])
  })

  it('only suggests missing tickets for obvious ticket-like titles', () => {
    expect(isTicketLikeItem({ title: '美术馆' })).toBe(false)
    expect(isTicketLikeItem({ title: '美术馆门票' })).toBe(true)
    expect(isTicketLikeItem({ title: 'Dinner reservation' })).toBe(true)

    const result = analyze({
      items: [
        makeItem({ id: 'item-ticket', title: 'Shibuya Sky ticket' }),
        makeItem({ id: 'item-place', sortOrder: 2, title: '东京站周边' }),
      ],
    })

    expect(result.suggestions).toEqual([
      expect.objectContaining({
        affectedItemIds: ['item-ticket'],
        ruleId: 'missing_ticket',
        source: 'local_rule',
      }),
    ])
  })

  it('does not suggest missing tickets when the item has a bound ticket', () => {
    const result = analyze({
      items: [makeItem({ id: 'item-1', ticketIds: ['ticket-1'], title: 'Shibuya Sky ticket' })],
      tickets: [makeTicket({ id: 'ticket-1', itemId: 'item-1' })],
    })

    expect(result.suggestions.map((finding) => finding.ruleId)).not.toContain('missing_ticket')
  })

  it('reports empty and dense days', () => {
    const emptyResult = analyze({ items: [] })
    expect(emptyResult.suggestions).toEqual([
      expect.objectContaining({
        affectedDayIds: ['day-1'],
        ruleId: 'empty_day',
        severity: 'info',
      }),
    ])

    const denseItems = Array.from({ length: 7 }, (_, index) =>
      makeItem({
        id: `item-${index + 1}`,
        previousTransportDurationMinutes: index === 0 ? undefined : 10,
        sortOrder: index + 1,
      }),
    )
    const denseResult = analyze({ items: denseItems })
    expect(denseResult.suggestions.map((finding) => finding.ruleId)).toContain('dense_day')
  })

  it('detects short gaps, overlaps, and long day spans', () => {
    const shortGapResult = analyze({
      items: [
        makeItem({ endTime: '10:00', id: 'item-a', sortOrder: 1, startTime: '09:00' }),
        makeItem({ id: 'item-b', previousTransportDurationMinutes: 10, sortOrder: 2, startTime: '10:20' }),
      ],
    })
    expect(shortGapResult.warnings.map((finding) => finding.ruleId)).toContain('short_gap')

    const overlapResult = analyze({
      items: [
        makeItem({ endTime: '11:00', id: 'item-a', sortOrder: 1, startTime: '10:00' }),
        makeItem({ id: 'item-b', previousTransportDurationMinutes: 10, sortOrder: 2, startTime: '10:30' }),
      ],
    })
    expect(overlapResult.warnings).toEqual([
      expect.objectContaining({
        ruleId: 'overlap_time',
        severity: 'critical',
      }),
    ])

    const longSpanResult = analyze({
      items: [
        makeItem({ id: 'item-a', sortOrder: 1, startTime: '06:00' }),
        makeItem({ endTime: '23:00', id: 'item-b', previousTransportDurationMinutes: 10, sortOrder: 2 }),
      ],
    })
    expect(longSpanResult.suggestions.map((finding) => finding.ruleId)).toContain('long_day_span')
  })

  it('emits only local_rule findings in this phase', () => {
    const result = analyze({
      items: [
        makeItem({ id: 'item-a', lat: undefined, lng: undefined, sortOrder: 1 }),
        makeItem({ id: 'item-b', previousTransportDurationMinutes: undefined, sortOrder: 2, title: '门票预约' }),
      ],
    })

    expect(allFindings(result).length).toBeGreaterThan(0)
    expect(allFindings(result).every((finding) => finding.source === 'local_rule')).toBe(true)
  })
})
