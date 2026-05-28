import { describe, expect, it } from 'vitest'
import { defaultAiPrivacySettings } from './aiPrivacy'
import { buildAiTripEditContext } from './aiTripEditContext'
import type { Day, ItineraryItem, Trip } from '../../types'

describe('aiTripEditContext', () => {
  it('builds sanitized context without mutating inputs', () => {
    const trip = sampleTrip()
    const days = [sampleDay('day_1')]
    const items = [sampleItem('item_1', {
      address: '西湖区',
      lat: 30.1,
      lng: 120.1,
      locationName: '西湖',
      notes: '不要默认发送的内部备注',
      previousTransportDurationMinutes: 15,
      previousTransportMode: 'walk',
      ticketIds: ['ticket_1'],
    })]
    const original = JSON.parse(JSON.stringify({ days, items, trip }))

    const result = buildAiTripEditContext({ days, items, trip })

    expect(result.ok).toBe(true)
    expect(JSON.parse(JSON.stringify({ days, items, trip }))).toEqual(original)
    if (result.ok) {
      const item = result.context.days[0].items[0]
      expect(item.id).toBe('item_1')
      expect(item.title).toBe('西湖')
      expect(item.hasTicketBindings).toBe(true)
      expect(item.ticketCount).toBe(1)
      expect(item.ticketBoundState).toBe('item_bound')
      expect(item.noteSummary).toBeUndefined()
      expect(item.noteText).toBeUndefined()
      expect(item.coordinateState).toBeUndefined()
      expect(item.locationName).toBeUndefined()
      expect(JSON.stringify(result.context)).not.toContain('lat')
      expect(JSON.stringify(result.context)).not.toContain('ticket_1')
    }
  })

  it('includes only truncated note summary when privacy allows notes summary', () => {
    const longNote = '这是一段需要截断的备注'.repeat(20)
    const result = buildAiTripEditContext({
      days: [sampleDay('day_1')],
      items: [sampleItem('item_1', { notes: longNote })],
      privacy: { ...defaultAiPrivacySettings, allowNotesSummary: true },
      trip: sampleTrip(),
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.context.days[0].items[0].noteSummary?.length).toBeLessThanOrEqual(80)
      expect(result.context.days[0].items[0].noteSummary).toContain('…')
      expect(result.warnings[0]).toContain('截断')
    }
  })

  it('includes coordinate state and full notes only when privacy allows them', () => {
    const result = buildAiTripEditContext({
      days: [sampleDay('day_1')],
      items: [sampleItem('item_1', { lat: 30.1, lng: 120.1, notes: '允许发送的完整备注' })],
      privacy: {
        ...defaultAiPrivacySettings,
        allowCoordinateState: true,
        allowFullNotes: true,
        allowNotesSummary: true,
      },
      trip: sampleTrip(),
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      const item = result.context.days[0].items[0]
      expect(item.coordinateState).toBe('present')
      expect(item.noteText).toBe('允许发送的完整备注')
      expect(item.noteSummary).toBeUndefined()
      expect(JSON.stringify(result.context)).not.toContain('30.1')
      expect(JSON.stringify(result.context)).not.toContain('120.1')
    }
  })

  it('rejects oversized context', () => {
    const result = buildAiTripEditContext({
      days: Array.from({ length: 31 }, (_, index) => sampleDay(`day_${index + 1}`, index + 1)),
      items: [],
      trip: sampleTrip(),
    })

    expect(result.ok).toBe(false)
  })
})

function sampleTrip(): Trip {
  return {
    createdAt: 1,
    destination: '杭州',
    endDate: '2026-07-11',
    id: 'trip_1',
    startDate: '2026-07-10',
    title: '杭州两日',
    updatedAt: 1,
  }
}

function sampleDay(id: string, sortOrder = 1): Day {
  return {
    date: '2026-07-10',
    id,
    sortOrder,
    title: `第 ${sortOrder} 天`,
    tripId: 'trip_1',
  }
}

function sampleItem(id: string, patch: Partial<ItineraryItem> = {}): ItineraryItem {
  return {
    createdAt: 1,
    dayId: 'day_1',
    id,
    sortOrder: 1,
    ticketIds: [],
    title: '西湖',
    tripId: 'trip_1',
    updatedAt: 1,
    ...patch,
  }
}
