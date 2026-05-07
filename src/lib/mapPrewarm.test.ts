import { describe, expect, it } from 'vitest'
import { buildDayPrewarmQueue, shouldSkipMapPrewarm } from './mapPrewarm'
import type { Day, ItineraryItem } from '../types'

describe('map prewarm queue', () => {
  it('orders current day, next day, previous day, then nearby days', () => {
    const days = [day('d1', 1), day('d2', 2), day('d3', 3), day('d4', 4), day('d5', 5)]
    const queue = buildDayPrewarmQueue({
      days,
      currentDayId: 'd3',
      itemsByDayId: Object.fromEntries(days.map((entry) => [entry.id, [item(entry.id, 35 + entry.sortOrder, 139)]])),
    })

    expect(queue.map((entry) => entry.dayId)).toEqual(['d3', 'd4', 'd2', 'd5', 'd1'])
  })

  it('limits longer trips to current day plus two neighboring days on each side', () => {
    const days = Array.from({ length: 8 }, (_, index) => day(`d${index + 1}`, index + 1))
    const queue = buildDayPrewarmQueue({
      days,
      currentDayId: 'd4',
      itemsByDayId: Object.fromEntries(days.map((entry) => [entry.id, [item(entry.id, 35 + entry.sortOrder, 139)]])),
    })

    expect(queue.map((entry) => entry.dayId)).toEqual(['d4', 'd5', 'd3', 'd6', 'd2'])
  })

  it('skips days without valid coordinates', () => {
    const days = [day('d1', 1), day('d2', 2), day('d3', 3)]
    const queue = buildDayPrewarmQueue({
      days,
      currentDayId: 'd2',
      itemsByDayId: {
        d1: [item('d1', 35.1, 139.1)],
        d2: [item('d2', Number.NaN, 139.2)],
        d3: [item('d3', 35.3, 139.3)],
      },
    })

    expect(queue.map((entry) => entry.dayId)).toEqual(['d3', 'd1'])
  })
})

describe('map prewarm network guard', () => {
  it('skips prewarm on data saver or slow networks', () => {
    expect(shouldSkipMapPrewarm({ saveData: true })).toBe(true)
    expect(shouldSkipMapPrewarm({ effectiveType: '2g' })).toBe(true)
    expect(shouldSkipMapPrewarm({ effectiveType: 'slow-2g' })).toBe(true)
  })

  it('allows prewarm when network information is unavailable or normal', () => {
    expect(shouldSkipMapPrewarm(null)).toBe(false)
    expect(shouldSkipMapPrewarm({ effectiveType: '4g' })).toBe(false)
  })
})

function day(id: string, sortOrder: number): Day {
  return {
    id,
    tripId: 'trip',
    date: `2026-05-${String(sortOrder).padStart(2, '0')}`,
    title: id,
    sortOrder,
  }
}

function item(id: string, lat: number, lng: number): ItineraryItem {
  return {
    id: `${id}-item`,
    tripId: 'trip',
    dayId: id,
    title: id,
    lat,
    lng,
    ticketIds: [],
    sortOrder: 1,
    createdAt: 1,
    updatedAt: 1,
  }
}
