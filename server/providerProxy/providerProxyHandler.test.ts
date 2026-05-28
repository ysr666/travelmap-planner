import { describe, expect, it, vi } from 'vitest'
import { validateAiTripDraft } from '../../src/lib/ai/aiTripDraft'
import { createProviderProxyMemoryQuotaStorage, type ProviderProxyQuotaMemoryEntry } from './quotaGuard'
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
    const quotaStorage = createProviderProxyMemoryQuotaStorage()
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch
    const input = {
      env: { TRIPMAP_PROVIDER_PROXY_MOCK: '1' },
      fetcher,
      quotaLimits: { maxRouteRequestsPerWindow: 1, windowMs: 60_000 },
      quotaStorage,
    }

    expect((await handleProviderProxyRequest({ ...input, request: jsonRequest(validRequest()) })).status).toBe(200)
    const blocked = await handleProviderProxyRequest({ ...input, request: jsonRequest(validRequest()) })

    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toMatchObject({ code: 'quota_exceeded', ok: false })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('normalizes durable quota storage failures and does not call providers', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch
    const response = await handleProviderProxyRequest({
      env: {
        OPENROUTESERVICE_API_KEY: 'server-secret-value',
        TRIPMAP_PROVIDER_QUOTA_D1: {
          prepare() {
            throw new Error('D1 raw SQL failure with session and stack')
          },
        },
      },
      fetcher,
      request: jsonRequest(validRequest()),
    })

    expect(response.status).toBe(429)
    const text = await response.text()
    expect(text).not.toContain('D1 raw SQL failure')
    expect(text).not.toContain('server-secret-value')
    expect(text).not.toContain('session-a')
    expect(text).not.toContain('stack')
    expect(JSON.parse(text)).toMatchObject({
      code: 'quota_exceeded',
      ok: false,
      operation: 'route_preview',
      requestId: 'request-1',
    })
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

function validRouteOrderRequest() {
  return {
    dayId: 'day',
    items: [
      { coordinate: { lat: 35.1, lng: 139.1 }, id: 'a', title: 'A' },
      { coordinate: { lat: 35.2, lng: 139.2 }, id: 'b', title: 'B' },
      { coordinate: { lat: 35.3, lng: 139.3 }, id: 'c', title: 'C' },
      { coordinate: { lat: 35.4, lng: 139.4 }, id: 'd', title: 'D' },
      { id: 'x', title: 'No coordinates' },
    ],
    operation: 'route_order_suggestion',
    provider: 'auto',
    quotaSessionId: 'session-a',
    requestId: 'route-order-request-1',
    tripId: 'trip',
  }
}

describe('provider proxy handler quota routing', () => {
  it('uses the expected isolated quota bucket for every operation', async () => {
    const cases = [
      { bucket: 'route|', request: validRequest() },
      { bucket: 'route|', request: validRouteOrderRequest() },
      { bucket: 'search|', request: validSearchRequest() },
      { bucket: 'place|', request: validPlaceLookupRequest() },
      { bucket: 'ai_draft|', request: validAiDraftRequest() },
      { bucket: 'ai_draft_repair|', request: validRepairRequest() },
      { bucket: 'ai_trip_edit|', request: validEditRequest() },
    ]

    for (const testCase of cases) {
      const consume = vi.fn(async () => ({ allowed: true as const, remaining: 1, resetAt: Date.now() + 60_000 }))
      const response = await handleProviderProxyRequest({
        env: { TRIPMAP_PROVIDER_PROXY_MOCK: '1' },
        quotaHasher: () => 'identity-hash',
        quotaStorage: { consume },
        request: jsonRequest(testCase.request),
      })

      expect(response.status).toBe(200)
      expect(consume).toHaveBeenCalledWith(expect.objectContaining({
        key: `${testCase.bucket}identity-hash`,
      }))
    }
  })

  it('returns normalized quota_exceeded before provider fetch on over-limit storage result', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch
    const response = await handleProviderProxyRequest({
      env: { OPENROUTESERVICE_API_KEY: 'server-secret-value' },
      fetcher,
      quotaStorage: {
        consume: vi.fn(async () => ({ allowed: false as const, reason: 'rate_limit' as const, resetAt: Date.now() + 60_000 })),
      },
      request: jsonRequest(validRequest()),
    })

    expect(response.status).toBe(429)
    const text = await response.text()
    expect(text).not.toContain('server-secret-value')
    expect(JSON.parse(text)).toMatchObject({
      code: 'quota_exceeded',
      ok: false,
      operation: 'route_preview',
    })
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('provider proxy handler route_order_suggestion', () => {
  it('returns deterministic mock route order suggestions without provider calls', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch
    const response = await handleProviderProxyRequest({
      env: { TRIPMAP_PROVIDER_PROXY_MOCK: '1' },
      fetcher,
      request: jsonRequest(validRouteOrderRequest()),
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      ok: true,
      operation: 'route_order_suggestion',
      provider: 'mock',
      suggestedItemIds: ['a', 'c', 'b', 'd'],
      unchangedItemIds: ['x'],
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('returns provider_unavailable without Google Routes env and without leaking server details', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch
    const response = await handleProviderProxyRequest({
      env: { OPENROUTESERVICE_API_KEY: 'server-ors-secret' },
      fetcher,
      request: jsonRequest(validRouteOrderRequest()),
    })

    expect(response.status).toBe(503)
    const text = await response.text()
    expect(text).not.toContain('server-ors-secret')
    expect(JSON.parse(text)).toMatchObject({
      code: 'provider_unavailable',
      ok: false,
      operation: 'route_order_suggestion',
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('calls Google Routes with exact FieldMask and only coordinate payload', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>
      const bodyText = init?.body as string
      const body = JSON.parse(bodyText)
      expect(headers['X-Goog-Api-Key']).toBe('server-google-routes-secret')
      expect(headers['X-Goog-FieldMask']).toBe('routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.optimizedIntermediateWaypointIndex')
      expect(body.optimizeWaypointOrder).toBe(true)
      expect(body.routingPreference).toBe('TRAFFIC_UNAWARE')
      expect(body.travelMode).toBe('DRIVE')
      expect(bodyText).not.toContain('trip')
      expect(bodyText).not.toContain('day')
      expect(bodyText).not.toContain('"a"')
      expect(bodyText).not.toContain('"title"')
      expect(bodyText).not.toContain('server-google-routes-secret')
      return new Response(JSON.stringify({
        routes: [
          {
            distanceMeters: 1800,
            duration: '900s',
            optimizedIntermediateWaypointIndex: [1, 0],
            polyline: { encodedPolyline: 'raw-polyline-should-not-return' },
          },
        ],
      }), { status: 200 })
    }) as unknown as typeof fetch

    const response = await handleProviderProxyRequest({
      env: { GOOGLE_ROUTES_API_KEY: 'server-google-routes-secret' },
      fetcher,
      request: jsonRequest(validRouteOrderRequest()),
    })

    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).not.toContain('server-google-routes-secret')
    expect(text).not.toContain('raw-polyline-should-not-return')
    expect(JSON.parse(text)).toMatchObject({
      distanceMeters: 1800,
      durationSeconds: 900,
      ok: true,
      operation: 'route_order_suggestion',
      provider: 'google',
      suggestedItemIds: ['a', 'c', 'b', 'd'],
    })
  })

  it('uses shared Google Maps Platform key for route_order_suggestion when dedicated Routes key is absent', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>
      expect(headers['X-Goog-Api-Key']).toBe('shared-google-platform-secret')
      return new Response(JSON.stringify({
        routes: [
          {
            distanceMeters: 1800,
            duration: '900s',
            optimizedIntermediateWaypointIndex: [1, 0],
            polyline: { encodedPolyline: 'raw-polyline-should-not-return' },
          },
        ],
      }), { status: 200 })
    }) as unknown as typeof fetch

    const response = await handleProviderProxyRequest({
      env: { GOOGLE_MAPS_PLATFORM_API_KEY: 'shared-google-platform-secret' },
      fetcher,
      request: jsonRequest(validRouteOrderRequest()),
    })

    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).not.toContain('shared-google-platform-secret')
    expect(JSON.parse(text)).toMatchObject({
      ok: true,
      operation: 'route_order_suggestion',
      provider: 'google',
    })
  })

  it('checks route_order_suggestion quota before provider calls', async () => {
    const quotaStorage = createProviderProxyMemoryQuotaStorage()
    const fetcher = vi.fn() as unknown as typeof fetch
    const input = {
      env: { TRIPMAP_PROVIDER_PROXY_MOCK: '1' },
      fetcher,
      quotaLimits: { maxRouteRequestsPerWindow: 1, windowMs: 60_000 },
      quotaStorage,
    }

    expect((await handleProviderProxyRequest({ ...input, request: jsonRequest(validRouteOrderRequest()) })).status).toBe(200)
    const blocked = await handleProviderProxyRequest({ ...input, request: jsonRequest(validRouteOrderRequest()) })

    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toMatchObject({
      code: 'quota_exceeded',
      ok: false,
      operation: 'route_order_suggestion',
    })
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('provider proxy handler travel_search', () => {
  it('returns deterministic mock travel_search results without provider calls', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch
    const input = {
      env: {
        TRIPMAP_PROVIDER_PROXY_MOCK: '1',
        TRIPMAP_SEARCH_API_KEY: 'test-search-key',
        TRIPMAP_SEARCH_PROVIDER: 'tavily',
      },
      fetcher,
    }

    const first = await handleProviderProxyRequest({ ...input, request: jsonRequest(validSearchRequest()) })
    const second = await handleProviderProxyRequest({ ...input, request: jsonRequest(validSearchRequest()) })

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    const firstBody = await first.json()
    const secondBody = await second.json()
    expect(firstBody).toEqual(secondBody)
    expect(firstBody).toMatchObject({
      ok: true,
      operation: 'travel_search',
      query: '杭州博物馆',
      source: 'mock',
    })
    expect(firstBody.warnings).toContain('当前为模拟搜索结果，不代表实时网页信息。')
    expect(firstBody.retrievedAt).toBe('2026-01-01T00:00:00.000Z')
    expect(firstBody.results[0].domain).toBe('travel.example')
    expect(firstBody.results[0].displayUrl).toContain('travel.example')
    expect(firstBody.results[0].sourceType).toBe('official')
    expect(firstBody.results[0].confidence).toBe('medium')
    expect(firstBody.results[0].url).toMatch(/^https:\/\/travel\.example\//)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('returns provider_unavailable when travel_search mock is disabled', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch
    const response = await handleProviderProxyRequest({
      fetcher,
      request: jsonRequest(validSearchRequest()),
    })

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      code: 'provider_unavailable',
      ok: false,
      operation: 'travel_search',
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('returns unsupported when travel_search is explicitly disabled', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch
    const response = await handleProviderProxyRequest({
      env: { TRIPMAP_SEARCH_PROVIDER: 'disabled' },
      fetcher,
      request: jsonRequest(validSearchRequest()),
    })

    expect(response.status).toBe(501)
    expect(await response.json()).toMatchObject({
      code: 'unsupported',
      ok: false,
      operation: 'travel_search',
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('returns provider_unavailable when Tavily search is selected without a key', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch
    const response = await handleProviderProxyRequest({
      env: { TRIPMAP_SEARCH_PROVIDER: 'tavily' },
      fetcher,
      request: jsonRequest(validSearchRequest()),
    })

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      code: 'provider_unavailable',
      ok: false,
      operation: 'travel_search',
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('uses configured Tavily provider through injected fetch and normalizes response', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      results: [
        {
          content: 'Official opening hours source.',
          score: 0.82,
          title: 'Official hours',
          url: 'https://official.example/hours',
        },
      ],
    }), { headers: { 'Content-Type': 'application/json' }, status: 200 })) as unknown as typeof fetch
    const response = await handleProviderProxyRequest({
      env: {
        TRIPMAP_SEARCH_API_KEY: 'test-search-key',
        TRIPMAP_SEARCH_PROVIDER: 'tavily',
      },
      fetcher,
      request: jsonRequest({ ...validSearchRequest(), maxResults: 9, searchType: 'opening_hours' }),
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      ok: true,
      operation: 'travel_search',
      query: '杭州博物馆',
      source: 'future_search',
    })
    expect(body.results).toHaveLength(1)
    expect(body.results[0]).toMatchObject({
      confidence: 'high',
      displayUrl: 'official.example/hours',
      domain: 'official.example',
      sourceType: 'official',
      title: 'Official hours',
      url: 'https://official.example/hours',
    })
    const [, init] = vi.mocked(fetcher).mock.calls[0]
    expect(JSON.parse(String(init?.body)).max_results).toBe(5)
  })

  it('does not leak raw search provider messages or secrets when unavailable', async () => {
    const response = await handleProviderProxyRequest({
      env: { TRIPMAP_AI_PROVIDER_KEY: 'secret-ai-key' },
      request: jsonRequest(validSearchRequest()),
    })

    expect(response.status).toBe(503)
    const text = await response.text()
    expect(text).not.toContain('secret-ai-key')
    expect(text).not.toContain('Travel search provider is not configured')
    expect(JSON.parse(text)).toMatchObject({
      code: 'provider_unavailable',
      ok: false,
      operation: 'travel_search',
    })
  })

  it('does not leak Tavily provider body, headers, stack traces, or secrets', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      error: 'raw-tavily-provider-body',
      message: 'Authorization Bearer test-search-key stack trace',
    }), { headers: { 'Content-Type': 'application/json' }, status: 500 })) as unknown as typeof fetch
    const response = await handleProviderProxyRequest({
      env: {
        TRIPMAP_SEARCH_API_KEY: 'test-search-key',
        TRIPMAP_SEARCH_PROVIDER: 'tavily',
      },
      fetcher,
      request: jsonRequest(validSearchRequest()),
    })

    expect(response.status).toBe(502)
    const text = await response.text()
    expect(text).not.toContain('raw-tavily-provider-body')
    expect(text).not.toContain('test-search-key')
    expect(text).not.toContain('Authorization')
    expect(text).not.toContain('Bearer')
    expect(text).not.toContain('stack trace')
    expect(JSON.parse(text)).toMatchObject({
      code: 'provider_error',
      ok: false,
      operation: 'travel_search',
    })
  })

  it('rejects invalid and forbidden travel_search requests', async () => {
    const invalid = await handleProviderProxyRequest({
      env: { TRIPMAP_PROVIDER_PROXY_MOCK: '1' },
      request: jsonRequest({ ...validSearchRequest(), query: '' }),
    })
    const forbidden = await handleProviderProxyRequest({
      env: { TRIPMAP_PROVIDER_PROXY_MOCK: '1' },
      request: jsonRequest({ ...validSearchRequest(), apiKey: 'secret-search-key' }),
    })

    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ code: 'invalid_request', ok: false })
    expect(forbidden.status).toBe(400)
    expect(await forbidden.json()).toMatchObject({ code: 'invalid_request', ok: false })
  })

  it('checks isolated travel_search quota before mock search', async () => {
    const quotaStorage = createProviderProxyMemoryQuotaStorage()
    const fetcher = vi.fn() as unknown as typeof fetch
    const input = {
      env: { TRIPMAP_PROVIDER_PROXY_MOCK: '1' },
      fetcher,
      quotaLimits: { maxTravelSearchRequestsPerWindow: 1, windowMs: 60_000 },
      quotaStorage,
    }

    expect((await handleProviderProxyRequest({ ...input, request: jsonRequest(validSearchRequest()) })).status).toBe(200)
    const blocked = await handleProviderProxyRequest({
      ...input,
      request: jsonRequest({ ...validSearchRequest(), requestId: 'search-2' }),
    })

    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toMatchObject({ code: 'quota_exceeded', ok: false, operation: 'travel_search' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('checks isolated travel_search quota before Tavily fetch', async () => {
    const store = new Map<string, ProviderProxyQuotaMemoryEntry>()
    store.set('search|blocked-search-hash', {
      count: 1,
      expiresAt: Date.now() + 60_000,
      windowStartedAt: Date.now(),
    })
    const quotaStorage = createProviderProxyMemoryQuotaStorage(store)
    const fetcher = vi.fn() as unknown as typeof fetch
    const response = await handleProviderProxyRequest({
      env: {
        TRIPMAP_SEARCH_API_KEY: 'test-search-key',
        TRIPMAP_SEARCH_PROVIDER: 'tavily',
      },
      fetcher,
      quotaHasher: () => 'blocked-search-hash',
      quotaLimits: { maxTravelSearchRequestsPerWindow: 1, windowMs: 60_000 },
      quotaStorage,
      request: jsonRequest(validSearchRequest()),
    })

    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({ code: 'quota_exceeded', ok: false, operation: 'travel_search' })
    expect(fetcher).not.toHaveBeenCalled()
  })
})

function validSearchRequest() {
  return {
    maxResults: 2,
    operation: 'travel_search',
    query: '杭州博物馆',
    quotaSessionId: 'session-search-1',
    requestId: 'search-1',
    searchType: 'official_site',
  }
}

describe('provider proxy handler place_lookup', () => {
  it('returns deterministic mock place_lookup results without provider calls', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch
    const input = {
      env: {
        TRIPMAP_GOOGLE_PLACES_API_KEY: 'test-place-key',
        TRIPMAP_PLACE_PROVIDER: 'google_places',
        TRIPMAP_PROVIDER_PROXY_MOCK: '1',
      },
      fetcher,
    }

    const first = await handleProviderProxyRequest({ ...input, request: jsonRequest(validPlaceLookupRequest()) })
    const second = await handleProviderProxyRequest({ ...input, request: jsonRequest(validPlaceLookupRequest()) })

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    const firstBody = await first.json()
    const secondBody = await second.json()
    expect(firstBody).toEqual(secondBody)
    expect(firstBody).toMatchObject({
      ok: true,
      operation: 'place_lookup',
      source: 'mock',
    })
    expect(firstBody.warnings).toContain('当前为模拟地点结果，不代表真实 Google Places 数据。')
    expect(firstBody.retrievedAt).toBe('2026-01-01T00:00:00.000Z')
    expect(firstBody.results[0]).toMatchObject({
      provider: 'google_places',
      retrievedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('returns provider_unavailable when place_lookup provider is missing', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch
    const response = await handleProviderProxyRequest({
      fetcher,
      request: jsonRequest(validPlaceLookupRequest()),
    })

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      code: 'provider_unavailable',
      ok: false,
      operation: 'place_lookup',
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('returns unsupported when place_lookup is explicitly disabled', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch
    const response = await handleProviderProxyRequest({
      env: { TRIPMAP_PLACE_PROVIDER: 'disabled' },
      fetcher,
      request: jsonRequest(validPlaceLookupRequest()),
    })

    expect(response.status).toBe(501)
    expect(await response.json()).toMatchObject({
      code: 'unsupported',
      ok: false,
      operation: 'place_lookup',
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('returns provider_unavailable when Google Places is selected without a key', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch
    const response = await handleProviderProxyRequest({
      env: { TRIPMAP_PLACE_PROVIDER: 'google_places' },
      fetcher,
      request: jsonRequest(validPlaceLookupRequest()),
    })

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      code: 'provider_unavailable',
      ok: false,
      operation: 'place_lookup',
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('uses configured Google Places provider through injected fetch and normalizes response', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      places: [
        {
          displayName: { text: '杭州博物馆' },
          formattedAddress: '浙江省杭州市上城区粮道山18号',
          googleMapsUri: 'https://maps.google.com/?cid=123',
          id: 'places/mock-google-1',
          location: { latitude: 30.245, longitude: 120.17 },
        },
      ],
    }), { headers: { 'Content-Type': 'application/json' }, status: 200 })) as unknown as typeof fetch
    const response = await handleProviderProxyRequest({
      env: {
        TRIPMAP_GOOGLE_PLACES_API_KEY: 'test-place-key',
        TRIPMAP_PLACE_PROVIDER: 'google_places',
      },
      fetcher,
      request: jsonRequest({ ...validPlaceLookupRequest(), maxResults: 9 }),
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      ok: true,
      operation: 'place_lookup',
      source: 'google_places',
    })
    expect(body.results).toHaveLength(1)
    expect(body.results[0]).toMatchObject({
      displayName: '杭州博物馆',
      formattedAddress: '浙江省杭州市上城区粮道山18号',
      googleMapsUri: 'https://maps.google.com/?cid=123',
      location: { lat: 30.245, lng: 120.17 },
      placeId: 'places/mock-google-1',
      provider: 'google_places',
    })
    const [, init] = vi.mocked(fetcher).mock.calls[0]
    expect(JSON.parse(String(init?.body)).pageSize).toBe(5)
    expect((init?.headers as Record<string, string>)['X-Goog-FieldMask']).toBe('places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri')
    expect((init?.headers as Record<string, string>)['X-Goog-FieldMask']).not.toContain('*')
  })

  it('uses shared Google Maps Platform key for place_lookup when dedicated Places key is absent', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)['X-Goog-Api-Key']).toBe('shared-google-platform-secret')
      return new Response(JSON.stringify({
        places: [
          {
            displayName: { text: '杭州博物馆' },
            formattedAddress: '浙江省杭州市上城区粮道山18号',
            id: 'places/mock-google-1',
            location: { latitude: 30.245, longitude: 120.17 },
          },
        ],
      }), { headers: { 'Content-Type': 'application/json' }, status: 200 })
    }) as unknown as typeof fetch
    const response = await handleProviderProxyRequest({
      env: {
        GOOGLE_MAPS_PLATFORM_API_KEY: 'shared-google-platform-secret',
        TRIPMAP_PLACE_PROVIDER: 'google_places',
      },
      fetcher,
      request: jsonRequest(validPlaceLookupRequest()),
    })

    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).not.toContain('shared-google-platform-secret')
    expect(JSON.parse(text)).toMatchObject({
      ok: true,
      operation: 'place_lookup',
      source: 'google_places',
    })
  })

  it('does not leak Google provider body, headers, stack traces, or secrets', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      error: 'raw-google-provider-body',
      message: 'Authorization Bearer test-place-key stack trace',
    }), { headers: { 'Content-Type': 'application/json' }, status: 500 })) as unknown as typeof fetch
    const response = await handleProviderProxyRequest({
      env: {
        TRIPMAP_GOOGLE_PLACES_API_KEY: 'test-place-key',
        TRIPMAP_PLACE_PROVIDER: 'google_places',
      },
      fetcher,
      request: jsonRequest(validPlaceLookupRequest()),
    })

    expect(response.status).toBe(502)
    const text = await response.text()
    expect(text).not.toContain('raw-google-provider-body')
    expect(text).not.toContain('test-place-key')
    expect(text).not.toContain('Authorization')
    expect(text).not.toContain('Bearer')
    expect(text).not.toContain('stack trace')
    expect(JSON.parse(text)).toMatchObject({
      code: 'provider_error',
      ok: false,
      operation: 'place_lookup',
    })
  })

  it('rejects invalid and forbidden place_lookup requests', async () => {
    const invalid = await handleProviderProxyRequest({
      env: { TRIPMAP_PROVIDER_PROXY_MOCK: '1' },
      request: jsonRequest({ ...validPlaceLookupRequest(), query: '' }),
    })
    const forbidden = await handleProviderProxyRequest({
      env: { TRIPMAP_PROVIDER_PROXY_MOCK: '1' },
      request: jsonRequest({ ...validPlaceLookupRequest(), notes: 'private note' }),
    })

    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ code: 'invalid_request', ok: false })
    expect(forbidden.status).toBe(400)
    expect(await forbidden.json()).toMatchObject({ code: 'invalid_request', ok: false })
  })

  it('checks isolated place_lookup quota before mock lookup', async () => {
    const quotaStorage = createProviderProxyMemoryQuotaStorage()
    const fetcher = vi.fn() as unknown as typeof fetch
    const input = {
      env: { TRIPMAP_PROVIDER_PROXY_MOCK: '1' },
      fetcher,
      quotaLimits: { maxPlaceLookupRequestsPerWindow: 1, windowMs: 60_000 },
      quotaStorage,
    }

    expect((await handleProviderProxyRequest({ ...input, request: jsonRequest(validPlaceLookupRequest()) })).status).toBe(200)
    const blocked = await handleProviderProxyRequest({
      ...input,
      request: jsonRequest({ ...validPlaceLookupRequest(), requestId: 'place-2' }),
    })

    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toMatchObject({ code: 'quota_exceeded', ok: false, operation: 'place_lookup' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('checks isolated place_lookup quota before Google Places fetch', async () => {
    const store = new Map<string, ProviderProxyQuotaMemoryEntry>()
    store.set('place|blocked-place-hash', {
      count: 1,
      expiresAt: Date.now() + 60_000,
      windowStartedAt: Date.now(),
    })
    const quotaStorage = createProviderProxyMemoryQuotaStorage(store)
    const fetcher = vi.fn() as unknown as typeof fetch
    const response = await handleProviderProxyRequest({
      env: {
        TRIPMAP_GOOGLE_PLACES_API_KEY: 'test-place-key',
        TRIPMAP_PLACE_PROVIDER: 'google_places',
      },
      fetcher,
      quotaHasher: () => 'blocked-place-hash',
      quotaLimits: { maxPlaceLookupRequestsPerWindow: 1, windowMs: 60_000 },
      quotaStorage,
      request: jsonRequest(validPlaceLookupRequest()),
    })

    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({ code: 'quota_exceeded', ok: false, operation: 'place_lookup' })
    expect(fetcher).not.toHaveBeenCalled()
  })
})

function validPlaceLookupRequest() {
  return {
    locale: 'zh-CN',
    maxResults: 2,
    operation: 'place_lookup',
    query: '杭州博物馆',
    quotaSessionId: 'session-place-1',
    region: 'CN',
    requestId: 'place-1',
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
    const quotaStorage = createProviderProxyMemoryQuotaStorage()
    const input = {
      env: { TRIPMAP_PROVIDER_PROXY_MOCK: '1' },
      quotaLimits: { maxAiDraftRequestsPerWindow: 1, windowMs: 60_000 },
      quotaStorage,
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

  it('returns unsupported when AI provider key is set but mock is off', async () => {
    const response = await handleProviderProxyRequest({
      env: { TRIPMAP_AI_PROVIDER_KEY: 'some-key' },
      request: jsonRequest(validAiDraftRequest()),
    })

    expect(response.status).toBe(501)
    const body = await response.json()
    expect(body).toMatchObject({ code: 'unsupported', ok: false })
  })

  it('mock draft still passes validateAiTripDraft through provider abstraction', async () => {
    const response = await handleProviderProxyRequest({
      env: { TRIPMAP_PROVIDER_PROXY_MOCK: '1' },
      request: jsonRequest(validAiDraftRequest()),
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    const validation = validateAiTripDraft(body.draft)
    expect(validation.valid).toBe(true)
    expect(body.source).toBe('mock')
    expect(body.warnings).toContain('当前为本地示例草稿，非真实 AI 生成。')
  })

  it('mock mode takes priority over openai_compatible provider', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch
    const response = await handleProviderProxyRequest({
      env: {
        TRIPMAP_AI_API_KEY: 'secret-key',
        TRIPMAP_AI_BASE_URL: 'https://api.example.com/v1',
        TRIPMAP_AI_MODEL: 'gpt-4o-mini',
        TRIPMAP_AI_PROVIDER: 'openai_compatible',
        TRIPMAP_PROVIDER_PROXY_MOCK: '1',
      },
      fetcher,
      request: jsonRequest(validAiDraftRequest()),
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.source).toBe('mock')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('openai_compatible with missing env returns provider_unavailable', async () => {
    const response = await handleProviderProxyRequest({
      env: { TRIPMAP_AI_PROVIDER: 'openai_compatible' },
      request: jsonRequest(validAiDraftRequest()),
    })

    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body).toMatchObject({ code: 'provider_unavailable', ok: false })
  })

  it('openai_compatible returns valid draft from injected fetch', async () => {
    const draft = {
      title: '东京之旅',
      destination: '东京',
      startDate: '2025-04-01',
      endDate: '2025-04-05',
      days: [
        { date: '2025-04-01', items: [{ title: '浅草寺' }] },
        { date: '2025-04-02', items: [{ title: '明治神宫' }] },
        { date: '2025-04-03', items: [{ title: '涩谷' }] },
        { date: '2025-04-04', items: [{ title: '银座' }] },
        { date: '2025-04-05', items: [{ title: '新宿' }] },
      ],
    }
    const fetcher = vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(draft) } }] }),
      { status: 200 },
    )) as unknown as typeof fetch

    const response = await handleProviderProxyRequest({
      env: {
        TRIPMAP_AI_API_KEY: 'secret-key',
        TRIPMAP_AI_BASE_URL: 'https://api.example.com/v1',
        TRIPMAP_AI_MODEL: 'gpt-4o-mini',
        TRIPMAP_AI_PROVIDER: 'openai_compatible',
      },
      fetcher,
      request: jsonRequest(validAiDraftRequest()),
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.source).toBe('future_ai')
    expect(body.draft.title).toBe('东京之旅')
  })

  it('openai_compatible does not leak API key in response', async () => {
    const fetcher = vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content: 'invalid json' } }] }),
      { status: 200 },
    )) as unknown as typeof fetch

    const response = await handleProviderProxyRequest({
      env: {
        TRIPMAP_AI_API_KEY: 'secret-ai-key-12345',
        TRIPMAP_AI_BASE_URL: 'https://api.example.com/v1',
        TRIPMAP_AI_MODEL: 'gpt-4o-mini',
        TRIPMAP_AI_PROVIDER: 'openai_compatible',
      },
      fetcher,
      request: jsonRequest(validAiDraftRequest()),
    })

    const text = await response.text()
    expect(text).not.toContain('secret-ai-key-12345')
    expect(text).not.toContain('Bearer')
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

describe('provider proxy handler ai_trip_draft_repair', () => {
  it('returns mock repair in mock mode', async () => {
    const response = await handleProviderProxyRequest({
      env: { TRIPMAP_PROVIDER_PROXY_MOCK: '1' },
      request: jsonRequest(validRepairRequest()),
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      ok: true,
      operation: 'ai_trip_draft_repair',
      source: 'mock',
    })
  })

  it('mock repair passes validateAiTripDraft', async () => {
    const response = await handleProviderProxyRequest({
      env: { TRIPMAP_PROVIDER_PROXY_MOCK: '1' },
      request: jsonRequest(validRepairRequest()),
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    const validation = validateAiTripDraft(body.draft)
    expect(validation.valid).toBe(true)
  })

  it('checks quota for repair requests', async () => {
    const quotaStorage = createProviderProxyMemoryQuotaStorage()
    const input = {
      env: { TRIPMAP_PROVIDER_PROXY_MOCK: '1' },
      quotaLimits: { maxAiDraftRepairRequestsPerWindow: 1, windowMs: 60_000 },
      quotaStorage,
    }

    expect((await handleProviderProxyRequest({ ...input, request: jsonRequest(validRepairRequest()) })).status).toBe(200)
    const blocked = await handleProviderProxyRequest({ ...input, request: jsonRequest(validRepairRequest()) })

    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toMatchObject({ code: 'quota_exceeded', ok: false })
  })

  it('returns provider_unavailable when no mock and no AI provider key', async () => {
    const response = await handleProviderProxyRequest({
      env: {},
      request: jsonRequest(validRepairRequest()),
    })

    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body).toMatchObject({ code: 'provider_unavailable', ok: false })
  })

  it('openai_compatible returns valid repaired draft from injected fetch', async () => {
    const repairedDraft = {
      ...validRepairRequest().draft,
      days: [
        {
          date: '2025-04-01',
          items: [
            { title: '浅草寺深度参观', locationName: '浅草寺', startTime: '09:00', endTime: '11:00' },
            { title: '午餐休息', startTime: '12:00', endTime: '13:00' },
          ],
        },
      ],
    }
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>
      expect(body.response_format).toEqual({ type: 'json_object' })
      expect(body.thinking).toEqual({ type: 'disabled' })
      expect(JSON.stringify(body)).not.toContain('secret-key')
      expect(JSON.stringify(body)).not.toContain('ticketBlobs')
      expect(JSON.stringify(body)).not.toContain('routeCaches')
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(repairedDraft) } }] }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    const response = await handleProviderProxyRequest({
      env: {
        TRIPMAP_AI_API_KEY: 'secret-key',
        TRIPMAP_AI_BASE_URL: 'https://api.example.com/v1',
        TRIPMAP_AI_MODEL: 'gpt-4o-mini',
        TRIPMAP_AI_PROVIDER: 'openai_compatible',
      },
      fetcher,
      request: jsonRequest(validRepairRequest()),
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.operation).toBe('ai_trip_draft_repair')
    expect(body.source).toBe('future_ai')
    expect(body.draft.days[0].items[1].title).toBe('午餐休息')
  })

  it('ignores frontend repair reasoningMode when backend policy keeps repair simple', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>
      expect(body.thinking).toEqual({ type: 'disabled' })
      expect(body.reasoning_effort).toBeUndefined()
      expect(body.temperature).toBe(0.2)
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(validRepairRequest().draft) } }] }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    const response = await handleProviderProxyRequest({
      env: {
        TRIPMAP_AI_API_KEY: 'secret-key',
        TRIPMAP_AI_BASE_URL: 'https://api.example.com/v1',
        TRIPMAP_AI_MODEL: 'gpt-4o-mini',
        TRIPMAP_AI_PROVIDER: 'openai_compatible',
      },
      fetcher,
      request: jsonRequest({
        ...validRepairRequest(),
        quotaSessionId: 'session-repair-reasoning-simple',
        reasoningMode: 'high',
        requestId: 'repair-reasoning-simple',
      }),
    })

    expect(response.status).toBe(200)
  })

  it('uses high thinking only when backend repair policy marks complexity high', async () => {
    const highComplexityRequest = {
      ...validRepairRequest(),
      quotaSessionId: 'session-repair-reasoning-high',
      qualityFindings: [
        { ruleId: 'time_overlap', severity: 'critical', title: '时间重叠', message: '当天有重叠时间。', dayDate: '2025-04-01' },
      ],
      requestId: 'repair-reasoning-high',
    }
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>
      expect(body.thinking).toEqual({ type: 'enabled' })
      expect(body.reasoning_effort).toBe('high')
      expect(body.temperature).toBeUndefined()
      expect(JSON.stringify(body)).not.toContain('secret-key')
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(highComplexityRequest.draft) } }] }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    const response = await handleProviderProxyRequest({
      env: {
        TRIPMAP_AI_API_KEY: 'secret-key',
        TRIPMAP_AI_BASE_URL: 'https://api.example.com/v1',
        TRIPMAP_AI_MODEL: 'gpt-4o-mini',
        TRIPMAP_AI_PROVIDER: 'openai_compatible',
      },
      fetcher,
      request: jsonRequest(highComplexityRequest),
    })

    expect(response.status).toBe(200)
  })

  it('does not leak env secrets in repair response', async () => {
    const response = await handleProviderProxyRequest({
      env: {
        TRIPMAP_AI_PROVIDER_KEY: 'secret-ai-key',
        TRIPMAP_PROVIDER_PROXY_MOCK: '1',
      },
      request: jsonRequest({
        ...validRepairRequest(),
        quotaSessionId: 'session-repair-secret-leak',
        requestId: 'repair-secret-leak',
      }),
    })

    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).not.toContain('secret-ai-key')
    expect(text).not.toContain('TRIPMAP_AI_PROVIDER_KEY')
  })

  it('rejects repair request with invalid draft', async () => {
    const response = await handleProviderProxyRequest({
      env: { TRIPMAP_PROVIDER_PROXY_MOCK: '1' },
      request: jsonRequest({
        ...validRepairRequest(),
        draft: { title: '', startDate: 'bad', endDate: '2025-04-05', days: [] },
      }),
    })

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body).toMatchObject({ code: 'invalid_request', ok: false })
  })
})

function validRepairRequest() {
  return {
    operation: 'ai_trip_draft_repair',
    requestId: 'repair-1',
    quotaSessionId: 'session-repair-1',
    draft: {
      title: '东京之旅',
      destination: '东京',
      startDate: '2025-04-01',
      endDate: '2025-04-05',
      days: [
        {
          date: '2025-04-01',
          items: [
            { title: '浅草寺', locationName: '浅草寺', startTime: '09:00', endTime: '11:00' },
          ],
        },
      ],
    },
    qualityFindings: [
      { ruleId: 'dense_day', severity: 'warning', title: '行程偏密', message: '当天行程偏密。', dayDate: '2025-04-01' },
    ],
  }
}

describe('provider proxy handler ai_trip_edit_plan', () => {
  it('returns deterministic mock edit patch without provider calls', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch
    const input = {
      env: { TRIPMAP_PROVIDER_PROXY_MOCK: '1' },
      fetcher,
    }

    const first = await handleProviderProxyRequest({ ...input, request: jsonRequest(validEditRequest()) })
    const second = await handleProviderProxyRequest({ ...input, request: jsonRequest(validEditRequest()) })

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    const firstBody = await first.json()
    const secondBody = await second.json()
    expect(firstBody).toEqual(secondBody)
    expect(firstBody).toMatchObject({
      ok: true,
      operation: 'ai_trip_edit_plan',
      source: 'mock',
    })
    expect(firstBody.patchPlan.operations.length).toBeGreaterThanOrEqual(1)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('returns mock edit patch with warning for English realtime intent without search calls', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch
    const response = await handleProviderProxyRequest({
      env: { TRIPMAP_PROVIDER_PROXY_MOCK: '1' },
      fetcher,
      request: jsonRequest(validEditRequest('Check whether Tower of London is open today and adjust the plan.')),
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      ok: true,
      operation: 'ai_trip_edit_plan',
      source: 'mock',
    })
    expect(body.patchPlan.operations).toHaveLength(0)
    expect(body.patchPlan.warnings).toContain('联网搜索暂未接入，未查询实时信息。')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('returns provider_unavailable when edit provider is not configured', async () => {
    const response = await handleProviderProxyRequest({
      request: jsonRequest(validEditRequest()),
    })

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      code: 'provider_unavailable',
      ok: false,
      operation: 'ai_trip_edit_plan',
    })
  })

  it('rejects invalid and forbidden edit requests', async () => {
    const invalid = await handleProviderProxyRequest({
      env: { TRIPMAP_PROVIDER_PROXY_MOCK: '1' },
      request: jsonRequest({ ...validEditRequest(), command: '' }),
    })
    const forbidden = await handleProviderProxyRequest({
      env: { TRIPMAP_PROVIDER_PROXY_MOCK: '1' },
      request: jsonRequest({
        ...validEditRequest(),
        context: { ...validEditRequest().context, routeCache: {} },
      }),
    })

    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ code: 'invalid_request', ok: false })
    expect(forbidden.status).toBe(400)
    expect(await forbidden.json()).toMatchObject({ code: 'invalid_request', ok: false })
  })

  it('checks isolated ai_trip_edit quota before mock provider', async () => {
    const quotaStorage = createProviderProxyMemoryQuotaStorage()
    const input = {
      env: { TRIPMAP_PROVIDER_PROXY_MOCK: '1' },
      quotaLimits: { maxAiTripEditRequestsPerWindow: 1, windowMs: 60_000 },
      quotaStorage,
    }

    expect((await handleProviderProxyRequest({ ...input, request: jsonRequest(validEditRequest()) })).status).toBe(200)
    const blocked = await handleProviderProxyRequest({
      ...input,
      request: jsonRequest({ ...validEditRequest(), requestId: 'edit-2' }),
    })

    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toMatchObject({ code: 'quota_exceeded', ok: false, operation: 'ai_trip_edit_plan' })
  })

  it('returns valid future_ai patch from injected OpenAI-compatible fetch', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>
      expect(body.response_format).toEqual({ type: 'json_object' })
      expect(body.thinking).toEqual({ type: 'disabled' })
      expect(JSON.stringify(body)).not.toContain('secret-key')
      expect(JSON.stringify(body)).not.toContain('ticketBlobs')
      expect(JSON.stringify(body)).not.toContain('routeCache')
      expect(JSON.stringify(body)).not.toContain('cloudToken')
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              operations: [{ item: { title: '咖啡休息' }, reason: '增加休息。', targetDayId: 'day_1', type: 'add_item' }],
              summary: '新增休息',
            }),
          },
        }],
      }))
    }) as unknown as typeof fetch

    const response = await handleProviderProxyRequest({
      env: {
        TRIPMAP_AI_API_KEY: 'secret-key',
        TRIPMAP_AI_BASE_URL: 'https://api.example.com/v1',
        TRIPMAP_AI_MODEL: 'gpt-4o-mini',
        TRIPMAP_AI_PROVIDER: 'openai_compatible',
      },
      fetcher,
      request: jsonRequest(validEditRequest()),
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.source).toBe('future_ai')
    expect(body.patchPlan.operations[0].type).toBe('add_item')
  })

  it('returns invalid_response for invalid raw edit output', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"summary":"bad","operations":[{"type":"rewrite_all"}]}' } }],
    }))) as unknown as typeof fetch

    const response = await handleProviderProxyRequest({
      env: {
        TRIPMAP_AI_API_KEY: 'secret-key',
        TRIPMAP_AI_BASE_URL: 'https://api.example.com/v1',
        TRIPMAP_AI_MODEL: 'gpt-4o-mini',
        TRIPMAP_AI_PROVIDER: 'openai_compatible',
      },
      fetcher,
      request: jsonRequest({ ...validEditRequest(), quotaSessionId: 'session-edit-invalid' }),
    })

    expect(response.status).toBe(502)
    const text = await response.text()
    expect(text).not.toContain('rewrite_all')
    expect(text).not.toContain('secret-key')
    expect(JSON.parse(text)).toMatchObject({ code: 'invalid_response', ok: false })
  })

  it('uses high thinking only when backend edit policy marks complexity high', async () => {
    const request = validEditRequestWithItemCount(80)
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>
      expect(body.thinking).toEqual({ type: 'enabled' })
      expect(body.reasoning_effort).toBe('high')
      expect(body.temperature).toBeUndefined()
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              operations: [{ itemId: 'item_1', reason: '更新标题。', title: '更新标题', type: 'update_item_title' }],
              summary: '更新标题',
            }),
          },
        }],
      }))
    }) as unknown as typeof fetch

    const response = await handleProviderProxyRequest({
      env: {
        TRIPMAP_AI_API_KEY: 'secret-key',
        TRIPMAP_AI_BASE_URL: 'https://api.example.com/v1',
        TRIPMAP_AI_MODEL: 'gpt-4o-mini',
        TRIPMAP_AI_PROVIDER: 'openai_compatible',
      },
      fetcher,
      request: jsonRequest(request),
    })

    expect(response.status).toBe(200)
  })
})

function validEditRequest(command = '第二天太满了，帮我放松一点') {
  return {
    command,
    context: {
      days: [
        {
          date: '2026-07-10',
          id: 'day_1',
          items: [
            { dayId: 'day_1', id: 'item_1', title: '西湖' },
            { dayId: 'day_1', id: 'item_2', title: '商场' },
          ],
          title: '第一天',
        },
      ],
      trip: {
        destination: '杭州',
        endDate: '2026-07-11',
        id: 'trip_1',
        startDate: '2026-07-10',
        title: '杭州两日',
      },
    },
    operation: 'ai_trip_edit_plan',
    quotaSessionId: 'session-edit-1',
    requestId: 'edit-1',
  }
}

function validEditRequestWithItemCount(itemCount: number) {
  return {
    ...validEditRequest(),
    context: {
      ...validEditRequest().context,
      days: [
        {
          ...validEditRequest().context.days[0],
          items: Array.from({ length: itemCount }, (_, index) => ({
            dayId: 'day_1',
            id: `item_${index + 1}`,
            title: `项目 ${index + 1}`,
          })),
        },
      ],
    },
    quotaSessionId: 'session-edit-high',
    requestId: 'edit-high',
  }
}
