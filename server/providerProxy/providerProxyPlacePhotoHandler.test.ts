import { describe, expect, it, vi } from 'vitest'
import { createProviderOperationsMemoryStorage } from './providerOperationsGuard'
import { createProviderProxyMemoryQuotaStorage } from './quotaGuard'
import { handleProviderProxyRequest } from './providerProxyHandler'

const PHOTO_REF = 'places/ChIJN1t_tDeuEmsRUsoyG83frY4/photos/ATKogpcFidelityPhotoReference'

function validPhotoRequest() {
  return {
    maxHeightPx: 480,
    maxWidthPx: 640,
    operation: 'place_photo',
    photoRef: PHOTO_REF,
    quotaSessionId: 'photo-session-1',
    requestId: 'photo-1',
  }
}

function pngHeader(width: number, height: number) {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

function secureJsonRequest(body: unknown, overrides: Record<string, string> = {}) {
  return new Request('https://travelmap-planner.pages.dev/api/provider-proxy', {
    body: JSON.stringify(body),
    headers: {
      Authorization: 'Bearer test-token',
      'CF-Connecting-IP': '203.0.113.8',
      'Content-Type': 'application/json',
      Origin: 'https://travelmap-planner.pages.dev',
      ...overrides,
    },
    method: 'POST',
  })
}

function photoFetcher() {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if ((init?.headers as Record<string, string> | undefined)?.['X-Goog-Api-Key']) {
      return new Response(JSON.stringify({
        photoUri: 'https://lh3.googleusercontent.com/place-photo-content',
      }), { headers: { 'Content-Type': 'application/json' }, status: 200 })
    }
    const bytes = pngHeader(640, 480)
    return new Response(bytes, {
      headers: { 'Content-Length': String(bytes.byteLength), 'Content-Type': 'image/png' },
      status: 200,
    })
  }) as unknown as typeof fetch
}

describe('provider proxy place_photo handler', () => {
  it('enforces production origin and auth before any media provider call', async () => {
    const fetcher = photoFetcher()
    const authVerifier = vi.fn(async () => ({ ok: false as const }))
    const common = {
      authVerifier,
      env: {
        TRIPMAP_GOOGLE_PLACES_API_KEY: 'server-photo-secret',
        TRIPMAP_PROVIDER_PROXY_ENV: 'production',
      },
      fetcher,
      operationsStorage: createProviderOperationsMemoryStorage(),
      quotaStorage: createProviderProxyMemoryQuotaStorage(),
    }

    const badOrigin = await handleProviderProxyRequest({
      ...common,
      request: secureJsonRequest(validPhotoRequest(), { Origin: 'https://evil.example' }),
    })
    expect(badOrigin.status).toBe(403)
    expect(authVerifier).not.toHaveBeenCalled()

    const badAuth = await handleProviderProxyRequest({
      ...common,
      request: secureJsonRequest(validPhotoRequest()),
    })
    expect(badAuth.status).toBe(401)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('returns a constrained private image response after shared controls pass', async () => {
    const fetcher = photoFetcher()
    const response = await handleProviderProxyRequest({
      authVerifier: vi.fn(async () => ({ ok: true as const, userId: 'verified-user' })),
      env: {
        TRIPMAP_GOOGLE_PLACES_API_KEY: 'server-photo-secret',
        TRIPMAP_PROVIDER_PROXY_ENV: 'production',
      },
      fetcher,
      operationsStorage: createProviderOperationsMemoryStorage(),
      quotaStorage: createProviderProxyMemoryQuotaStorage(),
      request: secureJsonRequest(validPhotoRequest()),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=300')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'")
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(pngHeader(640, 480))
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('rejects unknown or sensitive request fields before provider execution', async () => {
    const fetcher = photoFetcher()
    const response = await handleProviderProxyRequest({
      env: { TRIPMAP_GOOGLE_PLACES_API_KEY: 'server-photo-secret' },
      fetcher,
      request: new Request('https://tripmap.example/api/provider-proxy', {
        body: JSON.stringify({ ...validPhotoRequest(), apiKey: 'client-secret' }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'invalid_request', operation: 'place_photo' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('shares the bounded place quota and blocks before fetching', async () => {
    const fetcher = photoFetcher()
    const quotaStorage = createProviderProxyMemoryQuotaStorage()
    const common = {
      env: { TRIPMAP_GOOGLE_PLACES_API_KEY: 'server-photo-secret' },
      fetcher,
      quotaLimits: { maxPlaceLookupRequestsPerWindow: 1, windowMs: 60_000 },
      quotaStorage,
    }

    const first = await handleProviderProxyRequest({
      ...common,
      request: new Request('https://tripmap.example/api/provider-proxy', {
        body: JSON.stringify(validPhotoRequest()),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    })
    const second = await handleProviderProxyRequest({
      ...common,
      request: new Request('https://tripmap.example/api/provider-proxy', {
        body: JSON.stringify(validPhotoRequest()),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    })

    expect(first.status).toBe(200)
    expect(second.status).toBe(429)
    expect(await second.json()).toMatchObject({ code: 'quota_exceeded', operation: 'place_photo' })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
