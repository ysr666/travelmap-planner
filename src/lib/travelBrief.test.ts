import { describe, expect, it } from 'vitest'
import { buildTripContext } from './ai/aiTripContext'
import { analyzeTripContext } from './tripCheck'
import {
  buildDayBrief,
  buildTripBrief,
  getBriefItemsForPrivacyAudit,
  type DayBrief,
  type TripBrief,
} from './travelBrief'
import type { Day, ItineraryItem, TicketMeta, Trip } from '../types'

const now = 1000

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    createdAt: now,
    destination: '日本东京',
    endDate: '2026-04-13',
    id: 'trip-1',
    notes: 'trip-note-secret',
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
    externalUrl: 'https://example.com/private-order',
    fileName: 'private-file-name.pdf',
    fileType: 'pdf',
    id: 'ticket-1',
    itemId: 'item-1',
    mimeType: 'application/pdf',
    note: 'ticket-note-secret',
    referenceLocation: 'iCloud Drive/private/passport.pdf',
    size: 2048,
    storageMode: 'external',
    title: 'private-ticket-title',
    tripId: 'trip-1',
    updatedAt: now,
    ...overrides,
  }
}

function buildBriefs({
  days = [makeDay()],
  items,
  nowPlainDate = '2026-04-12',
  selectedDayId = 'day-1',
  tickets = [],
  trip = makeTrip(),
}: {
  days?: Day[]
  items: ItineraryItem[]
  nowPlainDate?: string
  selectedDayId?: string
  tickets?: TicketMeta[]
  trip?: Trip
}) {
  const context = buildTripContext({
    days,
    items,
    nowPlainDate,
    selectedDayId,
    tickets,
    trip,
  })
  const result = analyzeTripContext(context)

  return {
    context,
    dayBrief: buildDayBrief(context, result, selectedDayId),
    result,
    tripBrief: buildTripBrief(context, result),
  }
}

function allBriefSources(brief: DayBrief | TripBrief) {
  return getBriefItemsForPrivacyAudit(brief).map((item) => item.source)
}

describe('travel brief', () => {
  it('produces a clean local summary when no obvious issue is found', () => {
    const { dayBrief, tripBrief } = buildBriefs({
      items: [makeItem()],
      tickets: [],
    })

    expect(tripBrief.status.message).toContain('未发现明显问题')
    expect(tripBrief.summaries).toEqual([
      expect.objectContaining({ label: '本地检查', value: '未发现明显问题' }),
    ])
    expect(tripBrief.topFindings).toHaveLength(0)
    expect(dayBrief?.status.message).toContain('未发现明显问题')
    expect(dayBrief?.reminders[0]).toEqual(expect.objectContaining({
      message: expect.stringContaining('基于当前本地行程信息'),
      source: 'local_rule',
    }))
  })

  it('summarizes missing coordinates and missing previous transport duration', () => {
    const { tripBrief } = buildBriefs({
      items: [
        makeItem({ id: 'item-a', lat: undefined, lng: undefined, sortOrder: 1 }),
        makeItem({ id: 'item-b', previousTransportDurationMinutes: undefined, sortOrder: 2 }),
      ],
    })

    expect(tripBrief.summaries).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '缺少坐标', value: '1 项' }),
      expect.objectContaining({ label: '交通耗时待补', value: '1 项' }),
    ]))
    expect(tripBrief.reminders).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: 'missing_transport_duration' }),
    ]))
  })

  it('counts only the selected day in day brief', () => {
    const dayOne = makeDay({ id: 'day-1', sortOrder: 1, title: '第一天' })
    const dayTwo = makeDay({ date: '2026-04-13', id: 'day-2', sortOrder: 2, title: '第二天' })
    const { dayBrief } = buildBriefs({
      days: [dayOne, dayTwo],
      items: [
        makeItem({ dayId: 'day-1', id: 'item-a', lat: undefined, lng: undefined, sortOrder: 1 }),
        makeItem({ dayId: 'day-2', id: 'item-b', sortOrder: 1 }),
        makeItem({
          dayId: 'day-2',
          id: 'item-c',
          previousTransportDurationMinutes: undefined,
          sortOrder: 2,
        }),
      ],
      selectedDayId: 'day-2',
    })

    expect(dayBrief?.dayId).toBe('day-2')
    expect(dayBrief?.stats).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'items', value: '2 个' }),
      expect.objectContaining({ id: 'coordinates', value: '0 项' }),
      expect.objectContaining({ id: 'transport', value: '1 项待补' }),
    ]))
    expect(dayBrief?.summaries).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '交通耗时待补', value: '1 项' }),
    ]))
    expect(dayBrief?.summaries).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '缺少坐标', value: '1 项' }),
    ]))
  })

  it('keeps overlap, short gap, dense day, and empty day reminders conservative', () => {
    const denseItems = Array.from({ length: 7 }, (_, index) =>
      makeItem({
        endTime: index === 0 ? '10:00' : undefined,
        id: `item-${index + 1}`,
        previousTransportDurationMinutes: 10,
        sortOrder: index + 1,
        startTime: index === 0 ? '09:00' : index === 1 ? '10:20' : undefined,
      }),
    )
    const { dayBrief: denseBrief } = buildBriefs({ items: denseItems })
    expect(denseBrief?.summaries).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '安排偏密', value: '1 项' }),
      expect.objectContaining({ label: '间隔偏短', value: '1 项' }),
    ]))
    expect(JSON.stringify({
      reminders: denseBrief?.reminders,
      status: denseBrief?.status,
      summaries: denseBrief?.summaries,
      topFindings: denseBrief?.topFindings,
    })).not.toMatch(/天气|开放时间|实时|公交线路|地铁/)

    const { dayBrief: overlapBrief } = buildBriefs({
      items: [
        makeItem({ endTime: '11:00', id: 'item-a', sortOrder: 1, startTime: '10:00' }),
        makeItem({
          id: 'item-b',
          previousTransportDurationMinutes: 10,
          sortOrder: 2,
          startTime: '10:30',
        }),
      ],
    })
    expect(overlapBrief?.reminders[0]).toEqual(expect.objectContaining({ ruleId: 'overlap_time' }))

    const { dayBrief: emptyBrief } = buildBriefs({ items: [] })
    expect(emptyBrief?.summaries).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '空白日期', value: '1 项' }),
    ]))
  })

  it('does not serialize forbidden sensitive fields from context inputs', () => {
    const { dayBrief, tripBrief } = buildBriefs({
      items: [
        makeItem({
          address: 'Known public address',
          lat: 12.345678,
          lng: 98.765432,
          notes: 'passport-number-should-stay-out',
          previousTransportNote: 'private-route-note',
          title: 'Shibuya Sky ticket',
        }),
      ],
      tickets: [makeTicket()],
    })
    const serialized = JSON.stringify({ dayBrief, tripBrief })

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
  })

  it('emits only local_rule brief sources in this phase', () => {
    const { dayBrief, tripBrief } = buildBriefs({
      items: [
        makeItem({ id: 'item-a', lat: undefined, lng: undefined, sortOrder: 1 }),
        makeItem({
          id: 'item-b',
          previousTransportDurationMinutes: undefined,
          sortOrder: 2,
          title: '门票预约',
        }),
      ],
    })

    expect(allBriefSources(tripBrief).every((source) => source === 'local_rule')).toBe(true)
    expect(dayBrief).not.toBeNull()
    expect(dayBrief && allBriefSources(dayBrief).every((source) => source === 'local_rule')).toBe(true)
  })
})
