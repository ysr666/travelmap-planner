import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildCurrentRouteCacheIdentity, clearRouteCache, peekRouteCache } from './routeCache'
import { generateRoutePreviewsForTrip } from './routeGeneration'
import { buildTripPreviewRouteCacheIdentity } from './tripMapPreview'
import type { RoutingConfig } from './routing'
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

describe('route preview generation', () => {
  beforeEach(async () => {
    await clearRouteCache()
  })

  it('generates day routes and updates the trip preview cache after explicit invocation', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as { coordinates: number[][] }
      return new Response(JSON.stringify(orsFixture(body.coordinates)), { status: 200 })
    }) as unknown as typeof fetch
    const days = [day('day-1', 1)]
    const itemsByDay = {
      'day-1': [item('a', 35.1, 139.1, 1), item('b', 35.2, 139.2, 2)],
    }

    const result = await generateRoutePreviewsForTrip({
      config: orsConfig,
      days,
      fetcher,
      itemsByDay,
      tripId: 'trip',
    })
    const dayIdentity = buildCurrentRouteCacheIdentity({
      dayId: 'day-1',
      items: itemsByDay['day-1'],
      provider: 'openrouteservice',
      tripId: 'trip',
    })
    const previewIdentity = buildTripPreviewRouteCacheIdentity({
      days,
      itemsByDay,
      provider: 'openrouteservice',
      tripId: 'trip',
    })

    expect(result.generatedCount).toBe(1)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(await peekRouteCache(dayIdentity.signature)).not.toBeNull()
    expect(await peekRouteCache(previewIdentity.signature)).not.toBeNull()
  })

  it('does not call route services when no persistent provider is configured', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch
    const result = await generateRoutePreviewsForTrip({
      config: unavailableConfig,
      days: [day('day-1', 1)],
      fetcher,
      itemsByDay: {
        'day-1': [item('a', 35.1, 139.1, 1), item('b', 35.2, 139.2, 2)],
      },
      tripId: 'trip',
    })

    expect(result.provider).toBeNull()
    expect(result.generatedCount).toBe(0)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('preserves successful days when a later day fails', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(orsFixture([[139.1, 35.1], [139.2, 35.2]])), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 429 })) as unknown as typeof fetch
    const days = [day('day-1', 1), day('day-2', 2)]
    const itemsByDay = {
      'day-1': [item('a', 35.1, 139.1, 1), item('b', 35.2, 139.2, 2)],
      'day-2': [
        { ...item('c', 35.3, 139.3, 1), dayId: 'day-2' },
        { ...item('d', 35.4, 139.4, 2), dayId: 'day-2' },
      ],
    }

    const result = await generateRoutePreviewsForTrip({
      config: orsConfig,
      days,
      fetcher,
      itemsByDay,
      tripId: 'trip',
    })
    const dayIdentity = buildCurrentRouteCacheIdentity({
      dayId: 'day-1',
      items: itemsByDay['day-1'],
      provider: 'openrouteservice',
      tripId: 'trip',
    })

    expect(result.generatedCount).toBe(1)
    expect(result.failedCount).toBe(1)
    expect(await peekRouteCache(dayIdentity.signature)).not.toBeNull()
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
