import { describe, expect, it, vi } from 'vitest'
import {
  BUS_APPROXIMATION_WARNING,
  buildFallbackStraightRoute,
  fetchDayRoute,
  fetchGoogleRouteOptimization,
  fetchRouteSegment,
  mapTransportModeToRoutingProfile,
  parseOpenRouteServiceGeoJson,
  type RoutingConfig,
} from './routing'
import type { ItineraryItem } from '../types'

const configured: RoutingConfig = {
  provider: 'openrouteservice',
  apiKey: 'test-key',
  googleMapsKey: null,
  configured: true,
  source: 'local',
}

const unconfigured: RoutingConfig = {
  provider: 'none',
  apiKey: null,
  googleMapsKey: null,
  configured: false,
  source: 'none',
}

describe('routing profile mapping', () => {
  it('maps supported transport modes to real OpenRouteService profiles', () => {
    expect(mapTransportModeToRoutingProfile('walk').profile).toBe('foot-walking')
    expect(mapTransportModeToRoutingProfile('car').profile).toBe('driving-car')
    expect(mapTransportModeToRoutingProfile('bus').profile).toBe('driving-car')
    expect(mapTransportModeToRoutingProfile('cycling').profile).toBe('cycling-regular')
  })

  it('marks bus route generation as an approximation', () => {
    expect(mapTransportModeToRoutingProfile('bus').warning).toBe(BUS_APPROXIMATION_WARNING)
  })

  it('keeps train transit and flight as straight fallback modes', () => {
    expect(mapTransportModeToRoutingProfile('train').profile).toBeNull()
    expect(mapTransportModeToRoutingProfile('transit').profile).toBeNull()
    expect(mapTransportModeToRoutingProfile('flight').profile).toBeNull()
  })
})

describe('fallback straight route', () => {
  it('builds one line per adjacent mappable item', () => {
    const result = buildFallbackStraightRoute([
      item('a', 35.1, 139.1, 1),
      item('b', 35.2, 139.2, 2),
      item('c', 35.3, 139.3, 3),
    ])

    expect(result.lineStrings).toEqual([
      [[139.1, 35.1], [139.2, 35.2]],
      [[139.2, 35.2], [139.3, 35.3]],
    ])
  })
})

describe('OpenRouteService requests', () => {
  it('does not call fetch when provider is unconfigured', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch
    const result = await fetchDayRoute([
      item('a', 35.1, 139.1, 1),
      item('b', 35.2, 139.2, 2),
    ], unconfigured, { fetcher })

    expect(fetcher).not.toHaveBeenCalled()
    expect(result.status).toBe('straight')
  })

  it('posts [lng, lat] coordinates and keeps key out of the URL', async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify(orsFixture([[139.1, 35.1], [139.15, 35.15], [139.2, 35.2]])), {
        status: 200,
      })
    }) as unknown as typeof fetch

    const result = await fetchRouteSegment({
      from: [139.1, 35.1],
      to: [139.2, 35.2],
      mode: 'car',
      profile: 'driving-car',
      segmentIndex: 0,
      fromItemId: 'a',
      toItemId: 'b',
    }, configured, { fetcher })

    expect(result.coordinates).toHaveLength(3)
    const [url, init] = (fetcher as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0]
    expect(url).toBe('https://api.openrouteservice.org/v2/directions/driving-car/geojson')
    expect(url).not.toContain('test-key')
    expect((init.headers as Record<string, string>).Authorization).toBe('test-key')
    expect(JSON.parse(init.body as string).coordinates).toEqual([[139.1, 35.1], [139.2, 35.2]])
  })

  it('falls back per segment when a route request fails', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(orsFixture([[139.1, 35.1], [139.2, 35.2]])), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 429 })) as unknown as typeof fetch

    const result = await fetchDayRoute([
      item('a', 35.1, 139.1, 1),
      item('b', 35.2, 139.2, 2, 'car'),
      item('c', 35.3, 139.3, 3, 'car'),
    ], configured, { fetcher, forceRefresh: true })

    expect(result.status).toBe('mixed')
    expect(result.segments.map((segment) => segment.kind)).toEqual(['road', 'straight'])
    expect(result.warnings.join(' ')).toContain('请求过于频繁')
  })

  it('does not call provider for flight segments', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch
    for (const mode of ['train', 'transit', 'flight'] as const) {
      const result = await fetchDayRoute([
        item('a', 35.1, 139.1, 1),
        item('b', 35.2, 139.2, 2, mode),
      ], configured, { fetcher, forceRefresh: true })

      expect(result.status).toBe('straight')
    }
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('uses driving route for bus segments with an approximation warning', async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify(orsFixture([[139.1, 35.1], [139.2, 35.2]])), {
        status: 200,
      })
    }) as unknown as typeof fetch

    const result = await fetchDayRoute([
      item('a', 35.1, 139.1, 1),
      item('b', 35.2, 139.2, 2, 'bus'),
    ], configured, { fetcher, forceRefresh: true })

    expect(result.status).toBe('road')
    expect(result.warnings).toContain(BUS_APPROXIMATION_WARNING)
    const [url] = (fetcher as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0]
    expect(url).toContain('/driving-car/')
  })
})

describe('OpenRouteService response parser', () => {
  it('rejects malformed route responses', () => {
    expect(() => parseOpenRouteServiceGeoJson({ features: [] })).toThrow('路线服务返回的数据格式不正确')
    expect(() => parseOpenRouteServiceGeoJson(orsFixture([[139.1, 35.1]]))).toThrow('没有返回可用路线')
  })
})

describe('Google route optimization', () => {
  it('does not request optimization when there is only one intermediate waypoint', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch
    await expect(fetchGoogleRouteOptimization([
      item('a', 35.1, 139.1, 1),
      item('b', 35.2, 139.2, 2),
      item('c', 35.3, 139.3, 3),
    ], 'google-key', { fetcher })).rejects.toThrow('至少需要 4 个带坐标地点')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('returns suggested waypoint order without mutating itinerary items', async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify({
        routes: [
          {
            distanceMeters: 4200,
            duration: '900s',
            optimizedIntermediateWaypointIndex: [1, 0],
            polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' },
          },
        ],
      }), { status: 200 })
    }) as unknown as typeof fetch
    const items = [
      item('a', 35.1, 139.1, 1),
      item('b', 35.2, 139.2, 2),
      item('c', 35.3, 139.3, 3),
      item('d', 35.4, 139.4, 4),
    ]

    const result = await fetchGoogleRouteOptimization(items, 'google-key', { fetcher })

    expect(result.suggestedItems.map((nextItem) => nextItem.id)).toEqual(['a', 'c', 'b', 'd'])
    expect(items.map((nextItem) => nextItem.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(result.distanceMeters).toBe(4200)
    expect(result.durationSeconds).toBe(900)
    const [, init] = (fetcher as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.optimizeWaypointOrder).toBe(true)
    expect((init.headers as Record<string, string>)['X-Goog-Api-Key']).toBe('google-key')
  })

  it('accepts the plural optimized waypoint field used by the Maps JavaScript routes library', async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify({
        routes: [
          {
            optimizedIntermediateWaypointIndices: [1, 0],
          },
        ],
      }), { status: 200 })
    }) as unknown as typeof fetch
    const result = await fetchGoogleRouteOptimization([
      item('a', 35.1, 139.1, 1),
      item('b', 35.2, 139.2, 2),
      item('c', 35.3, 139.3, 3),
      item('d', 35.4, 139.4, 4),
    ], 'google-key', { fetcher })

    expect(result.suggestedItems.map((nextItem) => nextItem.id)).toEqual(['a', 'c', 'b', 'd'])
  })
})

function item(
  id: string,
  lat: number,
  lng: number,
  sortOrder: number,
  previousTransportMode: ItineraryItem['previousTransportMode'] = 'car',
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

function orsFixture(coordinates: number[][]) {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates,
        },
        properties: {
          summary: {
            distance: 1200,
            duration: 600,
          },
        },
      },
    ],
  }
}
