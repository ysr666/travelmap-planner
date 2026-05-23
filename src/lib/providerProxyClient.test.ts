import { describe, expect, it, vi } from 'vitest'
import {
  PROVIDER_PROXY_DEV_PROVIDER_STORAGE_KEY,
  PROVIDER_PROXY_DEV_URL_STORAGE_KEY,
  fetchProviderProxyRoutePreview,
  getProviderProxyConfig,
} from './providerProxyClient'

describe('provider proxy client config', () => {
  it('selects proxy mode only with URL and concrete provider', () => {
    expect(getProviderProxyConfig({
      env: {
        VITE_ROUTE_PROXY_PROVIDER: 'openrouteservice',
        VITE_ROUTE_PROXY_URL: '/api/provider-proxy',
      },
      storage: null,
    })).toMatchObject({
      configured: true,
      provider: 'openrouteservice',
      proxyUrl: '/api/provider-proxy',
      source: 'proxy',
    })

    expect(getProviderProxyConfig({
      env: {
        VITE_ROUTE_PROXY_PROVIDER: 'auto',
        VITE_ROUTE_PROXY_URL: '/api/provider-proxy',
      },
      storage: null,
    }).configured).toBe(false)
  })

  it('supports developer-only local override for e2e proxy fixtures', () => {
    const storage = memoryStorage({
      [PROVIDER_PROXY_DEV_PROVIDER_STORAGE_KEY]: 'google',
      [PROVIDER_PROXY_DEV_URL_STORAGE_KEY]: '/api/provider-proxy',
    })

    expect(getProviderProxyConfig({ env: {}, storage })).toMatchObject({
      configured: true,
      provider: 'google',
    })
  })
})

describe('provider proxy client request', () => {
  it('does not include provider secrets in the proxy payload', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string)
      expect(JSON.stringify(body)).not.toContain('secret-route-key')
      expect(JSON.stringify(body)).not.toContain('GOOGLE_ROUTES_API_KEY')
      expect(JSON.stringify(body)).not.toContain('OPENROUTESERVICE_API_KEY')
      return new Response(JSON.stringify({
        ok: true,
        operation: 'route_preview',
        provider: 'openrouteservice',
        route: {
          lineStrings: [[[139.1, 35.1], [139.2, 35.2]]],
          segments: [
            {
              coordinates: [[139.1, 35.1], [139.2, 35.2]],
              kind: 'road',
              segmentIndex: 0,
            },
          ],
          status: 'road',
          warnings: [],
        },
      }), { status: 200 })
    }) as unknown as typeof fetch

    const result = await fetchProviderProxyRoutePreview({
      coordinates: [[139.1, 35.1], [139.2, 35.2]],
      operation: 'route_preview',
      provider: 'openrouteservice',
      segments: [
        {
          fromCoordinateIndex: 0,
          mode: 'car',
          profile: 'driving-car',
          segmentIndex: 0,
          toCoordinateIndex: 1,
        },
      ],
    }, '/api/provider-proxy', {
      fetcher,
      storage: memoryStorage({ unrelated: 'secret-route-key' }),
    })

    expect(result.ok).toBe(true)
    const [, init] = (fetcher as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0]
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })
})

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial))
  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size
    },
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  }
}
