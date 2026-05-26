import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearRouteCache, saveRouteCache } from './routeCache'
import {
  buildTripPreviewRouteCacheIdentity,
  fetchTripPreviewRoute,
  selectTripPreviewRoutingConfig,
} from './tripMapPreview'
import type { LngLat } from './routing'
import type { Day, ItineraryItem, TransportMode } from '../types'

const googleConfig = {
  provider: 'google' as const,
  apiKey: null,
  googleMapsKey: 'google-key',
  configured: true,
  source: 'local' as const,
}

const orsConfig = {
  provider: 'openrouteservice' as const,
  apiKey: 'ors-key',
  googleMapsKey: null,
  configured: true,
  source: 'local' as const,
}

const proxyConfig = {
  provider: 'openrouteservice' as const,
  apiKey: null,
  googleMapsKey: 'google-key',
  routeProxyUrl: '/api/provider-proxy',
  configured: true,
  source: 'proxy' as const,
}

describe('trip map preview cache identity', () => {
  it('changes on coordinate order mode or provider changes but ignores titles', () => {
    const days = [day('day-1', 1)]
    const items = [item('a', 35.1, 139.1, 1), item('b', 35.2, 139.2, 2, 'car')]
    const base = buildTripPreviewRouteCacheIdentity({
      days,
      itemsByDay: { 'day-1': items },
      provider: 'openrouteservice',
      tripId: 'trip',
    }).signature

    expect(buildTripPreviewRouteCacheIdentity({
      days,
      itemsByDay: { 'day-1': [{ ...items[0], title: 'Changed' }, items[1]] },
      provider: 'openrouteservice',
      tripId: 'trip',
    }).signature).toBe(base)
    expect(buildTripPreviewRouteCacheIdentity({
      days,
      itemsByDay: { 'day-1': [items[0], { ...items[1], lat: 35.25 }] },
      provider: 'openrouteservice',
      tripId: 'trip',
    }).signature).not.toBe(base)
    expect(buildTripPreviewRouteCacheIdentity({
      days,
      itemsByDay: { 'day-1': [{ ...items[0], sortOrder: 2 }, { ...items[1], sortOrder: 1 }] },
      provider: 'openrouteservice',
      tripId: 'trip',
    }).signature).not.toBe(base)
    expect(buildTripPreviewRouteCacheIdentity({
      days,
      itemsByDay: { 'day-1': [items[0], { ...items[1], previousTransportMode: 'walk' }] },
      provider: 'openrouteservice',
      tripId: 'trip',
    }).signature).not.toBe(base)
    expect(buildTripPreviewRouteCacheIdentity({
      days,
      itemsByDay: { 'day-1': items },
      provider: 'google',
      tripId: 'trip',
    }).signature).not.toBe(base)
  })
})

describe('trip map preview route provider selection', () => {
  it('uses only provider proxy route geometry and keeps Google Maps key for rendering only', () => {
    expect(selectTripPreviewRoutingConfig('maplibre', googleConfig).provider).toBe('none')
    expect(selectTripPreviewRoutingConfig('maplibre', orsConfig).provider).toBe('none')
    expect(selectTripPreviewRoutingConfig('google', { ...orsConfig, googleMapsKey: 'google-key' }).provider).toBe('none')
    expect(selectTripPreviewRoutingConfig('google', proxyConfig).provider).toBe('openrouteservice')
  })
})

describe('trip map preview route fetching', () => {
  beforeEach(async () => {
    await clearRouteCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads cached ORS geometry for the same trip preview identity', async () => {
    const days = [day('day-1', 1), day('day-2', 2)]
    const itemsByDay = {
      'day-1': [item('a', 35.1, 139.1, 1), item('b', 35.2, 139.2, 2)],
      'day-2': [item('c', 35.3, 139.3, 1)],
    }
    const identity = buildTripPreviewRouteCacheIdentity({
      days,
      itemsByDay,
      provider: 'openrouteservice',
      tripId: 'trip',
    })
    await saveRouteCache({
      ...identity,
      lineStrings: [[[139.1, 35.1], [139.2, 35.2]]] as LngLat[][],
      scope: 'trip-preview',
      tripId: 'trip',
    })

    const result = await fetchTripPreviewRoute({ config: orsConfig, days, itemsByDay, tripId: 'trip' })

    expect(result.source).toBe('cache')
    expect(result.lineStrings).toEqual([[[139.1, 35.1], [139.2, 35.2]]])
  })

  it('falls back to straight lines without calling route services', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const days = [day('day-1', 1), day('day-2', 2)]
    const itemsByDay = {
      'day-1': [item('a', 35.11, 139.11, 1), item('b', 35.22, 139.22, 2)],
      'day-2': [
        { ...item('c', 35.33, 139.33, 1), dayId: 'day-2' },
        { ...item('d', 35.44, 139.44, 2), dayId: 'day-2' },
      ],
    }

    const result = await fetchTripPreviewRoute({ config: orsConfig, days, itemsByDay, tripId: 'trip' })

    expect(result.source).toBe('straight')
    expect(result.lineStrings).toEqual([
      [[139.11, 35.11], [139.22, 35.22]],
      [[139.33, 35.33], [139.44, 35.44]],
    ])
    expect(fetcher).not.toHaveBeenCalled()
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
