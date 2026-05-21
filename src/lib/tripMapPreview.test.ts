import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearRouteCache } from './routeCache'
import {
  buildTripPreviewRouteCacheIdentity,
  fetchTripPreviewRoute,
  getTripPreviewOptimizationDay,
  selectTripPreviewRoutingConfig,
} from './tripMapPreview'
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
  it('does not use Google route geometry on MapLibre preview', () => {
    expect(selectTripPreviewRoutingConfig('maplibre', googleConfig).provider).toBe('none')
    expect(selectTripPreviewRoutingConfig('maplibre', orsConfig).provider).toBe('openrouteservice')
    expect(selectTripPreviewRoutingConfig('google', { ...orsConfig, googleMapsKey: 'google-key' }).provider).toBe('google')
  })
})

describe('trip map preview optimization eligibility', () => {
  it('requires at least two intermediate waypoints before showing Google order suggestions', () => {
    const days = [day('day-1', 1)]

    expect(getTripPreviewOptimizationDay({
      days,
      itemsByDay: {
        'day-1': [
          item('a', 35.1, 139.1, 1),
          item('b', 35.2, 139.2, 2),
          item('c', 35.3, 139.3, 3),
        ],
      },
      selectedDay: days[0],
    })).toBeNull()
    expect(getTripPreviewOptimizationDay({
      days,
      itemsByDay: {
        'day-1': [
          item('a', 35.1, 139.1, 1),
          item('b', 35.2, 139.2, 2),
          item('c', 35.3, 139.3, 3),
          item('d', 35.4, 139.4, 4),
        ],
      },
      selectedDay: days[0],
    })?.id).toBe('day-1')
  })
})

describe('trip map preview route fetching', () => {
  beforeEach(async () => {
    await clearRouteCache()
  })

  it('caches generated ORS geometry and reuses it for the same trip preview identity', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(orsFixture([[139.1, 35.1], [139.2, 35.2]])), {
      status: 200,
    })) as unknown as typeof fetch
    const days = [day('day-1', 1), day('day-2', 2)]
    const itemsByDay = {
      'day-1': [item('a', 35.1, 139.1, 1), item('b', 35.2, 139.2, 2)],
      'day-2': [item('c', 35.3, 139.3, 1)],
    }

    const first = await fetchTripPreviewRoute({ config: orsConfig, days, fetcher, itemsByDay, tripId: 'trip' })
    const second = await fetchTripPreviewRoute({ config: orsConfig, days, fetcher, itemsByDay, tripId: 'trip' })

    expect(first.source).toBe('generated')
    expect(second.source).toBe('cache')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('generates route geometry per day without connecting separate days', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      void _url
      const body = JSON.parse(init?.body as string)
      return new Response(JSON.stringify(orsFixture(body.coordinates)), { status: 200 })
    }) as unknown as typeof fetch
    const days = [day('day-1', 1), day('day-2', 2)]
    const itemsByDay = {
      'day-1': [item('a', 35.11, 139.11, 1), item('b', 35.22, 139.22, 2)],
      'day-2': [
        { ...item('c', 35.33, 139.33, 1), dayId: 'day-2' },
        { ...item('d', 35.44, 139.44, 2), dayId: 'day-2' },
      ],
    }

    const result = await fetchTripPreviewRoute({ config: orsConfig, days, fetcher, itemsByDay, tripId: 'trip' })

    expect(result.lineStrings).toEqual([
      [[139.11, 35.11], [139.22, 35.22]],
      [[139.33, 35.33], [139.44, 35.44]],
    ])
    expect(fetcher).toHaveBeenCalledTimes(2)
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

function orsFixture(coordinates: number[][]) {
  return {
    features: [
      {
        geometry: { coordinates, type: 'LineString' },
        properties: { summary: { distance: 1000, duration: 600 } },
        type: 'Feature',
      },
    ],
    type: 'FeatureCollection',
  }
}
