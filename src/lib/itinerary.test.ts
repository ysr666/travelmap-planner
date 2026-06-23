import { describe, expect, it } from 'vitest'
import { describeItemTime, describePreviousTransport, sortItineraryItems, sortItineraryItemsByPlanOrder } from './itinerary'
import type { ItineraryItem } from '../types'

function makeItem(overrides: Partial<ItineraryItem> = {}): ItineraryItem {
  return {
    id: 'item-1',
    tripId: 'trip-1',
    dayId: 'day-1',
    title: 'Test',
    sortOrder: 0,
    ticketIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

describe('sortItineraryItems', () => {
  it('sorts by startTime ascending', () => {
    const items = [
      makeItem({ id: 'b', startTime: '10:00' }),
      makeItem({ id: 'a', startTime: '08:00' }),
      makeItem({ id: 'c', startTime: '14:00' }),
    ]
    const sorted = sortItineraryItems(items)
    expect(sorted.map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('places items without startTime after items with startTime', () => {
    const items = [
      makeItem({ id: 'no-time', sortOrder: 0 }),
      makeItem({ id: 'has-time', startTime: '09:00', sortOrder: 1 }),
    ]
    const sorted = sortItineraryItems(items)
    expect(sorted.map((i) => i.id)).toEqual(['has-time', 'no-time'])
  })

  it('falls back to sortOrder when startTime is equal or missing', () => {
    const items = [
      makeItem({ id: 'c', sortOrder: 3 }),
      makeItem({ id: 'a', sortOrder: 1 }),
      makeItem({ id: 'b', sortOrder: 2 }),
    ]
    const sorted = sortItineraryItems(items)
    expect(sorted.map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('does not mutate the original array', () => {
    const items = [makeItem({ id: 'b', startTime: '10:00' }), makeItem({ id: 'a', startTime: '08:00' })]
    const original = [...items]
    sortItineraryItems(items)
    expect(items.map((i) => i.id)).toEqual(original.map((i) => i.id))
  })
})

describe('sortItineraryItemsByPlanOrder', () => {
  it('keeps explicit plan order even when times are not chronological', () => {
    const items = [
      makeItem({ id: 'early', sortOrder: 2, startTime: '08:00' }),
      makeItem({ id: 'late', sortOrder: 1, startTime: '18:00' }),
    ]

    expect(sortItineraryItemsByPlanOrder(items).map((item) => item.id)).toEqual(['late', 'early'])
    expect(sortItineraryItems(items).map((item) => item.id)).toEqual(['early', 'late'])
  })

  it('uses time and id only to stabilize duplicate legacy sort orders', () => {
    const items = [
      makeItem({ id: 'b', sortOrder: 1, startTime: '10:00' }),
      makeItem({ id: 'a', sortOrder: 1, startTime: '09:00' }),
    ]
    expect(sortItineraryItemsByPlanOrder(items).map((item) => item.id)).toEqual(['a', 'b'])
  })
})

describe('describeItemTime', () => {
  it('returns range when both start and end are set', () => {
    expect(describeItemTime(makeItem({ startTime: '09:00', endTime: '11:00' }))).toBe('09:00 - 11:00')
  })

  it('returns only startTime when endTime is missing', () => {
    expect(describeItemTime(makeItem({ startTime: '09:00' }))).toBe('09:00')
  })

  it('returns only endTime when startTime is missing', () => {
    expect(describeItemTime(makeItem({ endTime: '11:00' }))).toBe('11:00')
  })

  it('returns fallback when both are missing', () => {
    expect(describeItemTime(makeItem())).toBe('时间未定')
  })
})

describe('describePreviousTransport', () => {
  it('returns null when no transport info is set', () => {
    expect(describePreviousTransport(makeItem())).toBeNull()
  })

  it('includes transport mode label', () => {
    const result = describePreviousTransport(makeItem({ previousTransportMode: 'walk' }))
    expect(result).toBe('步行')
  })

  it('includes duration', () => {
    const result = describePreviousTransport(makeItem({ previousTransportDurationMinutes: 25 }))
    expect(result).toBe('25 分钟')
  })

  it('joins multiple details with separator', () => {
    const result = describePreviousTransport(
      makeItem({ previousTransportMode: 'car', previousTransportDurationMinutes: 15, previousTransportNote: '高速' }),
    )
    expect(result).toBe('打车/驾车 15 分钟 · 高速')
  })

  it('trims note whitespace', () => {
    const result = describePreviousTransport(makeItem({ previousTransportNote: '  注意路况  ' }))
    expect(result).toBe('注意路况')
  })
})
