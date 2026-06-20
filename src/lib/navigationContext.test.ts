import { describe, expect, it } from 'vitest'
import {
  clearTripNavigationContext,
  getTripNavigationTarget,
  readTripNavigationContext,
  recordTripNavigationContext,
} from './navigationContext'

describe('trip navigation context', () => {
  it('extracts only canonical trip-scoped route targets', () => {
    expect(getTripNavigationTarget('#/day?tripId=trip_1&dayId=day_2&view=map')).toEqual({
      dayId: 'day_2',
      tripId: 'trip_1',
    })
    expect(getTripNavigationTarget('#/documents?tripId=trip_1&tab=transport')).toEqual({ tripId: 'trip_1' })
    expect(getTripNavigationTarget('#/search?tripId=trip_1')).toBeNull()
    expect(getTripNavigationTarget('#/trip/new')).toBeNull()
  })

  it('persists only versioned non-sensitive identifiers', () => {
    const storage = createMemoryStorage()
    expect(recordTripNavigationContext({ dayId: 'day_1', tripId: 'trip_1' }, { now: 123, storage })).toEqual({
      dayId: 'day_1',
      tripId: 'trip_1',
      updatedAt: 123,
      version: 1,
    })
    expect(readTripNavigationContext(storage)).toEqual({
      dayId: 'day_1',
      tripId: 'trip_1',
      updatedAt: 123,
      version: 1,
    })
    expect(JSON.parse(storage.getItem('tripmap.navigation-context.v1') ?? '{}')).toEqual({
      dayId: 'day_1',
      tripId: 'trip_1',
      updatedAt: 123,
      version: 1,
    })
  })

  it('keeps the last day within one trip and drops it when the trip changes', () => {
    const storage = createMemoryStorage()
    recordTripNavigationContext({ dayId: 'day_1', tripId: 'trip_1' }, { now: 100, storage })
    recordTripNavigationContext({ tripId: 'trip_1' }, { now: 200, storage })
    expect(readTripNavigationContext(storage)?.dayId).toBe('day_1')

    recordTripNavigationContext({ tripId: 'trip_2' }, { now: 300, storage })
    expect(readTripNavigationContext(storage)).toEqual({ tripId: 'trip_2', updatedAt: 300, version: 1 })
  })

  it('ignores corrupt, stale-version, and oversized records', () => {
    const storage = createMemoryStorage()
    storage.setItem('tripmap.navigation-context.v1', '{broken')
    expect(readTripNavigationContext(storage)).toBeNull()

    storage.setItem('tripmap.navigation-context.v1', JSON.stringify({ tripId: 'trip_1', updatedAt: 1, version: 2 }))
    expect(readTripNavigationContext(storage)).toBeNull()

    storage.setItem('tripmap.navigation-context.v1', JSON.stringify({ tripId: 'x'.repeat(257), updatedAt: 1, version: 1 }))
    expect(readTripNavigationContext(storage)).toBeNull()
  })

  it('clears persisted context', () => {
    const storage = createMemoryStorage()
    recordTripNavigationContext({ tripId: 'trip_1' }, { storage })
    clearTripNavigationContext(storage)
    expect(readTripNavigationContext(storage)).toBeNull()
  })
})

function createMemoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size },
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) },
  }
}
