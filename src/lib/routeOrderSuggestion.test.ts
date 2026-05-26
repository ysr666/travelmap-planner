import { describe, expect, it } from 'vitest'
import {
  buildRouteOrderSuggestionRequestItems,
  buildRouteOrderSuggestionSortPatches,
  getRouteOrderSuggestionCandidateDay,
} from './routeOrderSuggestion'
import type { Day, ItineraryItem } from '../types'

describe('route order suggestion helpers', () => {
  it('builds request items without notes tickets or provider secrets', () => {
    const requestItems = buildRouteOrderSuggestionRequestItems([
      item('a', 1, { lat: 35.1, lng: 139.1, notes: 'private note', ticketIds: ['ticket'] }),
      item('b', 2, { address: 'Address', locationName: 'Location' }),
    ])

    expect(requestItems).toEqual([
      { coordinate: { lat: 35.1, lng: 139.1 }, id: 'a', title: 'a' },
      { address: 'Address', coordinate: undefined, id: 'b', locationName: 'Location', title: 'b' },
    ])
    expect(JSON.stringify(requestItems)).not.toContain('private note')
    expect(JSON.stringify(requestItems)).not.toContain('ticket')
  })

  it('keeps non-coordinate slots when building sort patches', () => {
    const items = [
      item('a', 1, { lat: 35.1, lng: 139.1 }),
      item('x', 2),
      item('b', 3, { lat: 35.2, lng: 139.2 }),
      item('c', 4, { lat: 35.3, lng: 139.3 }),
    ]

    expect(buildRouteOrderSuggestionSortPatches(items, ['a', 'c', 'b'])).toEqual([
      { id: 'c', sortOrder: 3 },
      { id: 'b', sortOrder: 4 },
    ])
  })

  it('selects the selected eligible day when available', () => {
    const dayOne = day('day-1', 1)
    const dayTwo = day('day-2', 2)

    expect(getRouteOrderSuggestionCandidateDay({
      days: [dayOne, dayTwo],
      itemsByDay: {
        'day-1': [item('a', 1, { lat: 35.1, lng: 139.1 })],
        'day-2': [item('b', 1, { lat: 35.2, lng: 139.2 }), item('c', 2, { lat: 35.3, lng: 139.3 })],
      },
      selectedDay: dayTwo,
    })?.id).toBe('day-2')
  })
})

function day(id: string, sortOrder: number): Day {
  return {
    date: '2026-04-12',
    id,
    sortOrder,
    title: id,
    tripId: 'trip',
  }
}

function item(
  id: string,
  sortOrder: number,
  patch: Partial<ItineraryItem> = {},
): ItineraryItem {
  return {
    createdAt: 1,
    dayId: 'day',
    id,
    sortOrder,
    ticketIds: [],
    title: id,
    tripId: 'trip',
    updatedAt: 1,
    ...patch,
  }
}
