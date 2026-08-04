import { describe, expect, it } from 'vitest'
import { buildTripScheduleFocus } from './tripScheduleFocus'
import type { Day, ItineraryItem } from '../types'

const days: Day[] = [
  { id: 'day-1', tripId: 'trip-1', date: '2026-06-15', title: '第一天', sortOrder: 1 },
  { id: 'day-2', tripId: 'trip-1', date: '2026-06-16', title: '第二天', sortOrder: 2 },
]

const secondDayItem: ItineraryItem = {
  id: 'item-2',
  tripId: 'trip-1',
  dayId: 'day-2',
  title: '第二天地点',
  ticketIds: [],
  sortOrder: 1,
  createdAt: 1,
  updatedAt: 1,
}

describe('buildTripScheduleFocus', () => {
  it('prefers the live day over the selected day', () => {
    expect(buildTripScheduleFocus({
      days,
      itemsByDay: { 'day-2': [secondDayItem] },
      liveDay: days[1],
      selectedDay: days[0],
    })).toEqual({ day: days[1], dayIndex: 1, items: [secondDayItem] })
  })

  it('falls back to the selected day and then the first day', () => {
    expect(buildTripScheduleFocus({
      days,
      itemsByDay: {},
      liveDay: null,
      selectedDay: days[1],
    })?.day.id).toBe('day-2')
    expect(buildTripScheduleFocus({
      days,
      itemsByDay: {},
      liveDay: null,
      selectedDay: null,
    })?.day.id).toBe('day-1')
  })

  it('returns null when the trip has no days', () => {
    expect(buildTripScheduleFocus({
      days: [],
      itemsByDay: {},
      liveDay: null,
      selectedDay: null,
    })).toBeNull()
  })
})
