import { describe, expect, it, vi } from 'vitest'
import { validateAiTripDraft } from '../../src/lib/aiTripDraft'
import { createProviderProxyMemoryQuotaStore } from './quotaGuard'
import { handleProviderProxyRequest } from './providerProxyHandler'

describe('provider proxy handler HTTP safety', () => {
  it('handles CORS preflight and rejects unsupported methods', async () => {
    const options = await handleProviderProxyRequest({
      env: { TRIPMAP_PROVIDER_PROXY_ALLOWED_ORIGINS: 'https://tripmap.example' },
      request: new Request('https://tripmap.example/api/provider-proxy', {
        headers: { Origin: 'https://tripmap.example' },
        method: 'OPTIONS',
      }),
    })
    expect(options.status).toBe(204)
    expect(options.headers.get('Access-Control-Allow-Origin')).toBe('https://tripmap.example')

    const get = await handleProviderProxyRequest({
      request: new Request('https://tripmap.example/api/provider-proxy', { method: 'GET' }),
    })
    expect(get.status).toBe(405)
    expect(get.headers.get('Allow')).toContain('POST')
  })

  it('validates application/json content type', async () => {
    const response = await handleProviderProxyRequest({
      request: new Request('https://tripmap.example/api/provider-proxy', {
        body: JSON.stringify(validRequest()),
        headers: { 'Content-Type': 'text/plain' },
        method: 'POST',
      }),
    })

    expect(response.status).toBe(415)
    expect(await response.json()).toMatchObject({ code: 'invalid_request', ok: false })
  })
})

describe('provider proxy handler route preview', () => {
  it('returns mock route preview without provider secrets or provider calls', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch
    const response = await handleProviderProxyRequest({
      env: { TRIPMAP_PROVIDER_PROXY_MOCK: '1' },
      fetcher,
      request: jsonRequest(validRequest()),
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      ok: true,
      operation: 'route_preview',
      provider: 'openrouteservice',
    })
    expect(JSON.stringify(body)).not.toContain('OPENROUTESERVICE_API_KEY')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('calls ORS with server env secret and never returns that secret', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe('server-secret-value')
      return new Response(JSON.stringify({
        features: [
          {
            geometry: { coordinates: [[139.1, 35.1], [139.2, 35.2]], type: 'LineString' },
            properties: { summary: { distance: 1000, duration: 600 } },
            type: 'Feature',
          },
        ],
        type: 'FeatureCollection',
      }), { status: 200 })
    }) as unknown as typeof fetch

    const response = await handleProviderProxyRequest({
      env: { OPENROUTESERVICE_API_KEY: 'server-secret-value' },
      fetcher,
      request: jsonRequest(validRequest()),
    })

    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).not.toContain('server-secret-value')
    expect(JSON.parse(text)).toMatchObject({ ok: true, provider: 'openrouteservice' })
  })

  it('normalizes provider errors without passing through raw bodies', async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify({
        error: 'raw provider body with server-secret-value',
      }), { status: 403 })
    }) as unknown as typeof fetch

    const response = await handleProviderProxyRequest({
      env: { OPENROUTESERVICE_API_KEY: 'server-secret-value' },
      fetcher,
      request: jsonRequest(validRequest()),
    })

    expect(response.status).toBe(503)
    const text = await response.text()
    expect(text).not.toContain('raw provider body')
    expect(text).not.toContain('server-secret-value')
    expect(JSON.parse(text)).toMatchObject({ code: 'provider_unavailable', ok: false })
  })

  it('checks quota before provider calls', async () => {
    const store = createProviderProxyMemoryQuotaStore()
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch
    const input = {
      env: { TRIPMAP_PROVIDER_PROXY_MOCK: '1' },
      fetcher,
      quotaLimits: { maxRouteRequestsPerWindow: 1, windowMs: 60_000 },
      quotaStore: store,
    }

    expect((await handleProviderProxyRequest({ ...input, request: jsonRequest(validRequest()) })).status).toBe(200)
    const blocked = await handleProviderProxyRequest({ ...input, request: jsonRequest(validRequest()) })

    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toMatchObject({ code: 'quota_exceeded', ok: false })
    expect(fetcher).not.toHaveBeenCalled()
  })
})

function jsonRequest(body: unknown) {
  return new Request('https://tripmap.example/api/provider-proxy', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
}

function validRequest() {
  return {
    coordinates: [[139.1, 35.1], [139.2, 35.2]],
    dayId: 'day',
    operation: 'route_preview',
    provider: 'openrouteservice',
    quotaSessionId: 'session-a',
    requestId: 'request-1',
    segments: [
      {
        fromCoordinateIndex: 0,
        fromItemId: 'a',
        mode: 'car',
        profile: 'driving-car',
        segmentIndex: 0,
        toCoordinateIndex: 1,
        toItemId: 'b',
      },
    ],
    tripId: 'trip',
  }
}

describe('provider proxy handler ai_trip_draft', () => {
  it('returns mock draft in mock mode without calling fetcher', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch
    const response = await handleProviderProxyRequest({
      env: { TRIPMAP_PROVIDER_PROXY_MOCK: '1' },
      fetcher,
      request: jsonRequest(validAiDraftRequest()),
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      ok: true,
      operation: 'ai_trip_draft',
      source: 'mock',
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('mock draft passes validateAiTripDraft', async () => {
    const response = await handleProviderProxyRequest({
      env: { TRIPMAP_PROVIDER_PROXY_MOCK: '1' },
      request: jsonRequest(validAiDraftRequest()),
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    const validation = validateAiTripDraft(body.draft)
    expect(validation.valid).toBe(true)
    expect(validation.errors).toHaveLength(0)
  })

  it('returns provider_unavailable when no mock and no AI provider key', async () => {
    const response = await handleProviderProxyRequest({
      env: {},
      request: jsonRequest(validAiDraftRequest()),
    })

    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body).toMatchObject({ code: 'provider_unavailable', ok: false })
  })

  it('checks quota for ai_trip_draft requests', async () => {
    const store = createProviderProxyMemoryQuotaStore()
    const input = {
      env: { TRIPMAP_PROVIDER_PROXY_MOCK: '1' },
      quotaLimits: { maxAiDraftRequestsPerWindow: 1, windowMs: 60_000 },
      quotaStore: store,
    }

    expect((await handleProviderProxyRequest({ ...input, request: jsonRequest(validAiDraftRequest()) })).status).toBe(200)
    const blocked = await handleProviderProxyRequest({ ...input, request: jsonRequest(validAiDraftRequest()) })

    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toMatchObject({ code: 'quota_exceeded', ok: false })
  })

  it('does not leak env secrets in ai_trip_draft response', async () => {
    const response = await handleProviderProxyRequest({
      env: {
        TRIPMAP_AI_PROVIDER_KEY: 'secret-ai-key',
        TRIPMAP_PROVIDER_PROXY_MOCK: '1',
      },
      request: jsonRequest(validAiDraftRequest()),
    })

    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).not.toContain('secret-ai-key')
    expect(text).not.toContain('TRIPMAP_AI_PROVIDER_KEY')
  })
})

function validAiDraftRequest() {
  return {
    destination: '东京',
    endDate: '2025-04-05',
    operation: 'ai_trip_draft',
    quotaSessionId: 'session-ai-1',
    requestId: 'req-ai-1',
    startDate: '2025-04-01',
  }
}
