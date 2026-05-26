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
    const store = createProviderProxyMemoryQuotaStore()
    const fetcher = vi.fn() as unknown as typeof fetch
    const input = {
      env: { TRIPMAP_PROVIDER_PROXY_MOCK: '1' },
      fetcher,
      quotaLimits: { maxTravelSearchRequestsPerWindow: 1, windowMs: 60_000 },
      quotaStore: store,
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
    const store = createProviderProxyMemoryQuotaStore()
    store.set('search|session-search-1|no-ip', { count: 1, windowStartedAt: Date.now() })
    const fetcher = vi.fn() as unknown as typeof fetch
    const response = await handleProviderProxyRequest({
      env: {
        TRIPMAP_SEARCH_API_KEY: 'test-search-key',
        TRIPMAP_SEARCH_PROVIDER: 'tavily',
      },
      fetcher,
      quotaLimits: { maxTravelSearchRequestsPerWindow: 1, windowMs: 60_000 },
      quotaStore: store,
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
    const store = createProviderProxyMemoryQuotaStore()
    const input = {
      env: { TRIPMAP_PROVIDER_PROXY_MOCK: '1' },
      quotaLimits: { maxAiDraftRepairRequestsPerWindow: 1, windowMs: 60_000 },
      quotaStore: store,
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
    const store = createProviderProxyMemoryQuotaStore()
    const input = {
      env: { TRIPMAP_PROVIDER_PROXY_MOCK: '1' },
      quotaLimits: { maxAiTripEditRequestsPerWindow: 1, windowMs: 60_000 },
      quotaStore: store,
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
