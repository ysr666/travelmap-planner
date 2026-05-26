import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildCurrentRouteCacheIdentity,
  clearRouteCache,
  saveRouteCache,
} from './routeCache'
import {
  evaluateTripRoutePreparation,
  getPersistentRouteProvider,
  loadTripRoutePreparation,
} from './routePreparation'
import type { LngLat, RoutingConfig } from './routing'
import type { Day, ItineraryItem, TransportMode } from '../types'

const orsConfig: RoutingConfig = {
  provider: 'openrouteservice',
  apiKey: 'ors-key',
  googleMapsKey: null,
  configured: true,
  source: 'local',
}

const unavailableConfig: RoutingConfig = {
  provider: 'none',
  apiKey: null,
  googleMapsKey: null,
  configured: false,
  source: 'none',
}

const proxyConfig: RoutingConfig = {
  provider: 'openrouteservice',
  apiKey: null,
  googleMapsKey: null,
  routeProxyUrl: '/api/provider-proxy',
  configured: true,
  source: 'proxy',
}

describe('route preparation readiness', () => {
  beforeEach(async () => {
    await clearRouteCache()
  })

  it('classifies no coordinates one coordinate and ready days', () => {
    const days = [day('no-coords', 1), day('one', 2), day('ready', 3)]
    const result = evaluateTripRoutePreparation({
      days,
      itemsByDay: {
        one: [item('a', 35.1, 139.1, 1)],
        ready: [item('b', 35.1, 139.1, 1), item('c', 35.2, 139.2, 2)],
      },
      provider: 'openrouteservice',
      tripId: 'trip',
    })

    expect(result.days.map((routeDay) => routeDay.status)).toEqual([
      'no_coordinates',
      'not_enough_points',
      'ready_to_generate',
    ])
    expect(result.targetDayIds).toEqual(['ready'])
  })

  it('detects cached and stale day route signatures', async () => {
    const currentItems = [item('a', 35.1, 139.1, 1), item('b', 35.2, 139.2, 2)]
    const staleItems = [currentItems[0], { ...currentItems[1], lat: 35.3 }]
    const currentIdentity = buildCurrentRouteCacheIdentity({
      dayId: 'cached',
      items: currentItems,
      provider: 'openrouteservice',
      tripId: 'trip',
    })
    const staleIdentity = buildCurrentRouteCacheIdentity({
      dayId: 'stale',
      items: staleItems,
      provider: 'openrouteservice',
      tripId: 'trip',
    })

    await saveRouteCache({
      dayId: 'cached',
      lineStrings: sampleLineStrings(),
      tripId: 'trip',
      ...currentIdentity,
    })
    await saveRouteCache({
      dayId: 'stale',
      lineStrings: sampleLineStrings(),
      tripId: 'trip',
      ...staleIdentity,
    })

    const result = await loadTripRoutePreparation({
      days: [day('cached', 1), day('stale', 2)],
      itemsByDay: {
        cached: currentItems,
        stale: currentItems.map((nextItem) => ({ ...nextItem, dayId: 'stale' })),
      },
      provider: 'openrouteservice',
      tripId: 'trip',
    })

    expect(result.days.map((routeDay) => routeDay.status)).toEqual(['cached', 'stale_if_cache_key_changed'])
    expect(result.cachedDayCount).toBe(1)
    expect(result.staleDayCount).toBe(1)
  })

  it('keeps provider identities separate', async () => {
    const items = [item('a', 35.1, 139.1, 1), item('b', 35.2, 139.2, 2)]
    const googleIdentity = buildCurrentRouteCacheIdentity({
      dayId: 'day-1',
      items,
      provider: 'google',
      tripId: 'trip',
    })
    await saveRouteCache({
      dayId: 'day-1',
      lineStrings: sampleLineStrings(),
      tripId: 'trip',
      ...googleIdentity,
    })

    const orsResult = await loadTripRoutePreparation({
      days: [day('day-1', 1)],
      itemsByDay: { 'day-1': items },
      provider: 'openrouteservice',
      tripId: 'trip',
    })
    const googleResult = await loadTripRoutePreparation({
      days: [day('day-1', 1)],
      itemsByDay: { 'day-1': items },
      provider: 'google',
      tripId: 'trip',
    })

    expect(orsResult.days[0].status).toBe('ready_to_generate')
    expect(googleResult.days[0].status).toBe('cached')
  })

  it('reports provider unavailable without hiding eligible days', () => {
    const result = evaluateTripRoutePreparation({
      days: [day('day-1', 1)],
      itemsByDay: { 'day-1': [item('a', 35.1, 139.1, 1), item('b', 35.2, 139.2, 2)] },
      provider: getPersistentRouteProvider(unavailableConfig),
      tripId: 'trip',
    })

    expect(getPersistentRouteProvider(orsConfig)).toBeNull()
    expect(getPersistentRouteProvider(proxyConfig)).toBe('openrouteservice')
    expect(result.providerConfigured).toBe(false)
    expect(result.canGenerate).toBe(false)
    expect(result.days[0].status).toBe('ready_to_generate')
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
  lat: number,
  lng: number,
  sortOrder: number,
  previousTransportMode: TransportMode = 'car',
): ItineraryItem {
  return {
    createdAt: 1,
    dayId: 'day-1',
    id,
    lat,
    lng,
    previousTransportMode,
    sortOrder,
    ticketIds: [],
    title: id,
    tripId: 'trip',
    updatedAt: 1,
  }
}

function sampleLineStrings(): LngLat[][] {
  return [[[139.1, 35.1], [139.2, 35.2]]]
}
