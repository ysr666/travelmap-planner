import { describe, expect, it, vi } from 'vitest'
import {
  BUS_APPROXIMATION_WARNING,
  ROUTING_API_KEY_STORAGE_KEY,
  ROUTING_PROVIDER_STORAGE_KEY,
  buildFallbackStraightRoute,
  fetchDayRoute,
  getRoutingConfig,
  isRoutingConfigured,
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

const proxyConfigured: RoutingConfig = {
  provider: 'openrouteservice',
  apiKey: null,
  googleMapsKey: null,
  routeProxyUrl: '/api/provider-proxy',
  configured: true,
  source: 'proxy',
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

describe('routing provider boundary', () => {
  it('does not call fetch when provider is unconfigured', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch
    const result = await fetchDayRoute([
      item('a', 35.1, 139.1, 1),
      item('b', 35.2, 139.2, 2),
    ], unconfigured, { fetcher })

    expect(fetcher).not.toHaveBeenCalled()
    expect(result.status).toBe('straight')
  })

  it('ignores legacy frontend route keys and keeps Google Maps key for map rendering only', () => {
    const storage = memoryStorage({
      [ROUTING_PROVIDER_STORAGE_KEY]: 'openrouteservice',
      [ROUTING_API_KEY_STORAGE_KEY]: 'legacy-local-ors-secret',
      'tripmap:google-maps-api-key': 'browser-google-maps-key',
    })
    const env = {
      VITE_GOOGLE_MAPS_API_KEY: 'browser-env-google-maps-key',
      VITE_OPENROUTESERVICE_API_KEY: 'legacy-env-ors-secret',
      VITE_ROUTING_PROVIDER: 'openrouteservice',
    } as Partial<ImportMetaEnv> & Record<string, string>

    const config = getRoutingConfig({ env, storage })

    expect(config).toMatchObject({
      apiKey: null,
      configured: false,
      googleMapsKey: 'browser-google-maps-key',
      provider: 'none',
      source: 'none',
    })
    expect(isRoutingConfigured(config)).toBe(false)
  })

  it('does not call direct route providers even when a legacy config carries an API key', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch

    const result = await fetchDayRoute([
      item('a', 35.1, 139.1, 1),
      item('b', 35.2, 139.2, 2),
    ], configured, { fetcher, forceRefresh: true })

    expect(fetcher).not.toHaveBeenCalled()
    expect(result.status).toBe('straight')
    expect(result.warnings.join(' ')).toContain('路线服务未配置')
  })

  it('does not call provider for flight segments', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch
    for (const mode of ['train', 'transit', 'flight'] as const) {
      const result = await fetchDayRoute([
        item('a', 35.1, 139.1, 1),
        item('b', 35.2, 139.2, 2, mode),
      ], proxyConfigured, { fetcher, forceRefresh: true })

      expect(result.status).toBe('straight')
    }
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('uses driving profile for bus segments through the provider proxy', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string)
      expect(body.segments[0].profile).toBe('driving-car')
      return new Response(JSON.stringify({
        ok: true,
        operation: 'route_preview',
        provider: 'openrouteservice',
        route: {
          lineStrings: [[[139.1, 35.1], [139.2, 35.2]]],
          segments: [
            {
              coordinates: [[139.1, 35.1], [139.2, 35.2]],
              distanceMeters: 1200,
              durationSeconds: 600,
              fromItemId: 'a',
              kind: 'road',
              segmentIndex: 0,
              toItemId: 'b',
            },
          ],
          status: 'road',
          warnings: [],
        },
      }), { status: 200 })
    }) as unknown as typeof fetch

    const result = await fetchDayRoute([
      item('a', 35.1, 139.1, 1),
      item('b', 35.2, 139.2, 2, 'bus'),
    ], proxyConfigured, { fetcher, forceRefresh: true })

    expect(result.status).toBe('road')
    expect(result.warnings).toContain(BUS_APPROXIMATION_WARNING)
  })

  it('can generate a day route through the provider proxy without sending secrets', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string)
      expect(body.provider).toBe('openrouteservice')
      expect(body.coordinates).toEqual([[139.1, 35.1], [139.2, 35.2]])
      expect(JSON.stringify(body)).not.toContain('test-key')
      return new Response(JSON.stringify({
        ok: true,
        operation: 'route_preview',
        provider: 'openrouteservice',
        route: {
          lineStrings: [[[139.1, 35.1], [139.2, 35.2]]],
          segments: [
            {
              coordinates: [[139.1, 35.1], [139.2, 35.2]],
              distanceMeters: 1200,
              durationSeconds: 600,
              fromItemId: 'a',
              kind: 'road',
              segmentIndex: 0,
              toItemId: 'b',
            },
          ],
          status: 'road',
          warnings: [],
        },
      }), { status: 200 })
    }) as unknown as typeof fetch

    const result = await fetchDayRoute([
      item('a', 35.1, 139.1, 1),
      item('b', 35.2, 139.2, 2),
    ], proxyConfigured, { fetcher, forceRefresh: true })

    expect(result.status).toBe('road')
    expect(result.provider).toBe('openrouteservice')
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url] = (fetcher as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0]
    expect(url).toBe('/api/provider-proxy')
  })
})

describe('OpenRouteService response parser', () => {
  it('rejects malformed route responses', () => {
    expect(() => parseOpenRouteServiceGeoJson({ features: [] })).toThrow('路线服务返回的数据格式不正确')
    expect(() => parseOpenRouteServiceGeoJson(orsFixture([[139.1, 35.1]]))).toThrow('没有返回可用路线')
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

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial))
  return {
    get length() {
      return values.size
    },
    clear() {
      values.clear()
    },
    getItem(key: string) {
      return values.get(key) ?? null
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null
    },
    removeItem(key: string) {
      values.delete(key)
    },
    setItem(key: string, value: string) {
      values.set(key, value)
    },
  }
}
