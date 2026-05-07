import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildRouteCacheSignature,
  buildCurrentRouteCacheIdentity,
  clearRouteCache,
  enforceRouteCacheLimit,
  getRouteCacheStats,
  loadRouteCache,
  normalizeRouteGeometry,
  pruneStaleRouteCachesForDay,
  saveRouteCache,
  setRouteCacheMaxBytes,
} from './routeCache'
import type { LngLat } from './routing'
import type { ItineraryItem, TransportMode } from '../types'

describe('route cache signatures', () => {
  it('changes when coordinates order or mode changes', () => {
    const base = [item('a', 35.1, 139.1, 1), item('b', 35.2, 139.2, 2, 'car')]
    const sameWithTitleChanged = [{ ...base[0], title: 'new title', notes: 'new note' }, base[1]]
    const coordinateChanged = [base[0], { ...base[1], lng: 139.3 }]
    const orderChanged = [{ ...base[0], sortOrder: 2 }, { ...base[1], sortOrder: 1 }]
    const modeChanged = [base[0], { ...base[1], previousTransportMode: 'walk' as TransportMode }]

    const signature = buildCurrentRouteCacheIdentity({ tripId: 'trip', dayId: 'day', items: base }).signature

    expect(buildCurrentRouteCacheIdentity({ tripId: 'trip', dayId: 'day', items: sameWithTitleChanged }).signature).toBe(signature)
    expect(buildCurrentRouteCacheIdentity({ tripId: 'trip', dayId: 'day', items: coordinateChanged }).signature).not.toBe(signature)
    expect(buildCurrentRouteCacheIdentity({ tripId: 'trip', dayId: 'day', items: orderChanged }).signature).not.toBe(signature)
    expect(buildCurrentRouteCacheIdentity({ tripId: 'trip', dayId: 'day', items: modeChanged }).signature).not.toBe(signature)
  })

  it('does not include API key or config source in persistent route cache signature', () => {
    const base = [item('a', 35.1, 139.1, 1), item('b', 35.2, 139.2, 2, 'bus')]
    const identity = buildCurrentRouteCacheIdentity({ tripId: 'trip', dayId: 'day', items: base })

    expect(identity.signature).not.toContain('fake-key')
    expect(identity.signature).not.toContain('local')
    expect(buildRouteCacheSignature({
      tripId: 'trip',
      dayId: 'day',
      provider: 'openrouteservice',
      coordinateKey: identity.coordinateKey,
      modeKey: identity.modeKey,
      routingVersion: identity.routingVersion,
    })).toBe(identity.signature)
  })
})

describe('route geometry validation', () => {
  it('rejects empty single-point invalid and swapped coordinates', () => {
    expect(() => normalizeRouteGeometry([])).toThrow('不能为空')
    expect(() => normalizeRouteGeometry([[[139.1, 35.1]]])).toThrow('至少需要每段 2 个坐标')
    expect(() => normalizeRouteGeometry([[[139.1, 35.1], [Number.NaN, 35.2]]])).toThrow('合法范围')
    expect(() => normalizeRouteGeometry([[[35.1, 139.1], [35.2, 139.2]]])).toThrow('合法范围')
  })
})

describe('route cache storage', () => {
  beforeEach(async () => {
    await clearRouteCache()
    await setRouteCacheMaxBytes(20 * 1024 * 1024)
  })

  it('saves loads and updates lastUsedAt', async () => {
    const identity = buildCurrentRouteCacheIdentity({
      tripId: 'trip',
      dayId: 'day',
      items: [item('a', 35.1, 139.1, 1), item('b', 35.2, 139.2, 2)],
    })

    const saved = await saveRouteCache({
      tripId: 'trip',
      dayId: 'day',
      ...identity,
      lineStrings: sampleLineStrings(),
      warnings: ['test warning'],
    })
    expect(saved.saved).toBe(true)

    const loaded = await loadRouteCache(identity.signature)
    expect(loaded?.lineStrings).toEqual([[[139.1, 35.1], [139.2, 35.2]]])
    expect(loaded?.warnings).toEqual(['test warning'])
    expect(loaded?.lastUsedAt).toBeTruthy()
  })

  it('can load an existing OpenRouteService cache without provider configuration', async () => {
    const identity = buildCurrentRouteCacheIdentity({
      tripId: 'trip',
      dayId: 'day',
      items: [item('a', 35.1, 139.1, 1), item('b', 35.2, 139.2, 2)],
    })

    await saveRouteCache({
      tripId: 'trip',
      dayId: 'day',
      ...identity,
      lineStrings: sampleLineStrings(),
    })

    expect((await loadRouteCache(identity.signature))?.provider).toBe('openrouteservice')
  })

  it('prunes stale signatures for the same day', async () => {
    const base = [item('a', 35.1, 139.1, 1), item('b', 35.2, 139.2, 2)]
    const current = buildCurrentRouteCacheIdentity({ tripId: 'trip', dayId: 'day', items: base })
    const stale = buildCurrentRouteCacheIdentity({ tripId: 'trip', dayId: 'day', items: [base[0], { ...base[1], lat: 35.3 }] })

    await saveRouteCache(routeCacheInput(stale, 'day'))
    await saveRouteCache(routeCacheInput(current, 'day'))
    await pruneStaleRouteCachesForDay('trip', 'day', current.signature)

    expect(await loadRouteCache(current.signature)).not.toBeNull()
    expect(await loadRouteCache(stale.signature)).toBeNull()
  })

  it('enforces max size with oldest entries first and can clear all cache', async () => {
    const first = buildCurrentRouteCacheIdentity({ tripId: 'trip', dayId: 'day1', items: [item('a', 35.1, 139.1, 1), item('b', 35.2, 139.2, 2)] })
    const second = buildCurrentRouteCacheIdentity({ tripId: 'trip', dayId: 'day2', items: [item('c', 35.3, 139.3, 1), item('d', 35.4, 139.4, 2)] })
    await saveRouteCache(routeCacheInput(first, 'day1'))
    await saveRouteCache(routeCacheInput(second, 'day2'))
    await enforceRouteCacheLimit(1)

    const statsAfterLimit = await getRouteCacheStats()
    expect(statsAfterLimit.count).toBe(0)

    await saveRouteCache(routeCacheInput(first, 'day1'))
    expect((await getRouteCacheStats()).count).toBe(1)
    await clearRouteCache()
    expect((await getRouteCacheStats()).count).toBe(0)
  })

  it('does not save a route larger than the configured max', async () => {
    await setRouteCacheMaxBytes(200)
    const identity = buildCurrentRouteCacheIdentity({
      tripId: 'trip',
      dayId: 'day',
      items: [item('a', 35.1, 139.1, 1), item('b', 35.2, 139.2, 2)],
    })

    const saved = await saveRouteCache({
      tripId: 'trip',
      dayId: 'day',
      ...identity,
      lineStrings: sampleLineStrings(),
    })

    expect(saved.saved).toBe(false)
    expect((await getRouteCacheStats()).count).toBe(0)
  })
})

function routeCacheInput(identity: ReturnType<typeof buildCurrentRouteCacheIdentity>, dayId = 'day') {
  return {
    tripId: 'trip',
    dayId,
    ...identity,
    lineStrings: sampleLineStrings(),
  }
}

function sampleLineStrings(): LngLat[][] {
  return [[[139.1, 35.1], [139.2, 35.2]]]
}

function item(
  id: string,
  lat: number,
  lng: number,
  sortOrder: number,
  previousTransportMode: TransportMode = 'car',
): ItineraryItem {
  return {
    id,
    tripId: 'trip',
    dayId: 'day',
    title: id,
    lat,
    lng,
    previousTransportMode,
    ticketIds: [],
    sortOrder,
    createdAt: 1,
    updatedAt: 1,
  }
}
