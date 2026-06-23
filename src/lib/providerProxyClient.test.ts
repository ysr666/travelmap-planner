import { describe, expect, it, vi } from 'vitest'
import {
  PROVIDER_PROXY_DEV_PROVIDER_STORAGE_KEY,
  PROVIDER_PROXY_DEV_URL_STORAGE_KEY,
  ProviderProxyClientError,
  fetchProviderProxyRouteOrderSuggestion,
  fetchProviderProxyRoutePreview,
  fetchProviderProxyAiTripDraft,
  fetchProviderProxyAiTripDraftRefine,
  fetchProviderProxyAiTripEditPlan,
  fetchProviderProxyAssistantAnswer,
  fetchProviderProxyPlaceLookup,
  fetchProviderProxyTravelSearch,
  fetchProviderProxyTripOperationsSummary,
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

  it('lets explicit empty local override disable env proxy config', () => {
    const storage = memoryStorage({
      [PROVIDER_PROXY_DEV_PROVIDER_STORAGE_KEY]: '',
      [PROVIDER_PROXY_DEV_URL_STORAGE_KEY]: '',
    })

    expect(getProviderProxyConfig({
      env: {
        VITE_ROUTE_PROXY_PROVIDER: 'openrouteservice',
        VITE_ROUTE_PROXY_URL: '/api/provider-proxy',
      },
      storage,
    })).toMatchObject({
      configured: false,
      provider: null,
      proxyUrl: null,
      source: 'none',
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

describe('provider proxy route_order_suggestion client', () => {
  it('validates and sends route order payloads without provider secrets', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string)
      expect(body).toMatchObject({
        operation: 'route_order_suggestion',
        provider: 'auto',
        quotaSessionId: 'session-route-order-1',
      })
      expect(JSON.stringify(body)).not.toContain('secret-route-key')
      expect(JSON.stringify(body)).not.toContain('GOOGLE_ROUTES_API_KEY')
      expect(JSON.stringify(body)).not.toContain('OPENROUTESERVICE_API_KEY')
      return new Response(JSON.stringify({
        ok: true,
        operation: 'route_order_suggestion',
        provider: 'mock',
        retrievedAt: '2026-01-01T00:00:00.000Z',
        suggestedItemIds: ['a', 'c'],
        unchangedItemIds: ['b'],
        summary: '模拟建议',
        warnings: [],
      }), { status: 200 })
    }) as unknown as typeof fetch

    const result = await fetchProviderProxyRouteOrderSuggestion({
      dayId: 'day',
      items: [
        { id: 'a', title: 'A', coordinate: { lat: 35.1, lng: 139.1 } },
        { id: 'b', title: 'B' },
        { id: 'c', title: 'C', coordinate: { lat: 35.2, lng: 139.2 } },
      ],
      operation: 'route_order_suggestion',
      provider: 'auto',
      quotaSessionId: 'session-route-order-1',
      tripId: 'trip',
    }, '/api/provider-proxy', {
      fetcher,
      storage: memoryStorage({ unrelated: 'secret-route-key' }),
    })

    expect(result.ok).toBe(true)
    expect(result.provider).toBe('mock')
    expect(result.suggestedItemIds).toEqual(['a', 'c'])
  })

  it('rejects malformed route order responses with extra or missing ids', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      operation: 'route_order_suggestion',
      provider: 'mock',
      retrievedAt: '2026-01-01T00:00:00.000Z',
      suggestedItemIds: ['a', 'missing'],
      unchangedItemIds: [],
      summary: 'bad',
      warnings: [],
    }), { status: 200 })) as unknown as typeof fetch

    await expect(fetchProviderProxyRouteOrderSuggestion({
      items: [
        { id: 'a', title: 'A', coordinate: { lat: 35.1, lng: 139.1 } },
        { id: 'b', title: 'B', coordinate: { lat: 35.2, lng: 139.2 } },
      ],
      operation: 'route_order_suggestion',
    }, '/api/provider-proxy', { fetcher })).rejects.toMatchObject({
      code: 'invalid_response',
      status: 200,
    })
  })
})

describe('provider proxy trip_operations_summary client', () => {
  it('sends only sanitized recommendations and parses summary response', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string)
      expect(body).toMatchObject({
        operation: 'trip_operations_summary',
        phase: 'traveling',
        quotaSessionId: 'session-ops',
      })
      expect(JSON.stringify(body)).not.toContain('secret-ai-key')
      expect(JSON.stringify(body)).not.toContain('ticketIds')
      expect(JSON.stringify(body)).not.toContain('routeCache')
      return new Response(JSON.stringify({
        highlights: ['先生成路线'],
        ok: true,
        operation: 'trip_operations_summary',
        source: 'mock',
        summary: '先处理路线，再检查票据。',
      }), { status: 200 })
    }) as unknown as typeof fetch

    const result = await fetchProviderProxyTripOperationsSummary({
      operation: 'trip_operations_summary',
      phase: 'traveling',
      quotaSessionId: 'session-ops',
      recommendations: [{
        actionKind: 'generate_routes',
        actionLabel: '生成路线',
        message: '2 天缺少路线。',
        severity: 'low',
        title: '2 天缺路线',
        type: 'missing_route',
      }],
      tripTitle: '杭州三日',
    }, '/api/provider-proxy', {
      fetcher,
      storage: memoryStorage({ unrelated: 'secret-ai-key' }),
    })

    expect(result.ok).toBe(true)
    expect(result.summary).toContain('路线')
    expect(result.highlights).toEqual(['先生成路线'])
  })
})

describe('provider proxy ai_trip_draft client', () => {
  it('does not include provider secrets in the ai_trip_draft payload', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string)
      expect(body).toMatchObject({
        dayCount: 2,
        interestTags: ['美食'],
        interestText: '咖啡馆',
        operation: 'ai_trip_draft',
        partySize: 2,
      })
      expect(JSON.stringify(body)).not.toContain('secret-ai-key')
      expect(JSON.stringify(body)).not.toContain('TRIPMAP_AI_PROVIDER_KEY')
      return new Response(JSON.stringify({
        ok: true,
        operation: 'ai_trip_draft',
        source: 'mock',
        draft: {
          title: '东京之旅',
          destination: '东京',
          startDate: '2025-04-01',
          endDate: '2025-04-02',
          days: [{ date: '2025-04-01', items: [{ title: '上午游览' }] }],
        },
      }), { status: 200 })
    }) as unknown as typeof fetch

    const result = await fetchProviderProxyAiTripDraft({
      dayCount: 2,
      destination: '东京',
      endDate: '2025-04-02',
      interestTags: ['美食'],
      interestText: '咖啡馆',
      operation: 'ai_trip_draft',
      partySize: 2,
      startDate: '2025-04-01',
    }, '/api/provider-proxy', {
      fetcher,
      storage: memoryStorage({ unrelated: 'secret-ai-key' }),
    })

    expect(result.ok).toBe(true)
    expect(result.draft.title).toBe('东京之旅')
    expect(result.source).toBe('mock')
  })

  it('returns valid response from mock proxy', async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify({
        ok: true,
        operation: 'ai_trip_draft',
        source: 'mock',
        draft: {
          title: '巴黎之旅',
          destination: '巴黎',
          startDate: '2025-07-01',
          endDate: '2025-07-03',
          days: [
            { date: '2025-07-01', items: [{ title: '上午游览' }] },
            { date: '2025-07-02', items: [{ title: '下午参观' }] },
            { date: '2025-07-03', items: [{ title: '晚间散步' }] },
          ],
        },
        warnings: ['当前为本地示例草稿，非真实 AI 生成。'],
      }), { status: 200 })
    }) as unknown as typeof fetch

    const result = await fetchProviderProxyAiTripDraft({
      destination: '巴黎',
      endDate: '2025-07-03',
      operation: 'ai_trip_draft',
      startDate: '2025-07-01',
    }, '/api/provider-proxy', { fetcher })

    expect(result.ok).toBe(true)
    expect(result.draft.destination).toBe('巴黎')
    expect(result.draft.days).toHaveLength(3)
  })
})

describe('provider proxy ai_trip_draft_refine client', () => {
  it('does not include provider secrets in refine payload and parses a valid draft', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string)
      expect(body).toMatchObject({
        operation: 'ai_trip_draft_refine',
        preferences: {
          partySize: 3,
          preferTransport: 'walking',
        },
        scope: { kind: 'day', date: '2025-04-02' },
      })
      expect(JSON.stringify(body)).not.toContain('secret-ai-key')
      expect(JSON.stringify(body)).not.toContain('TRIPMAP_AI_API_KEY')
      expect(JSON.stringify(body)).not.toContain('Bearer')
      return new Response(JSON.stringify({
        ok: true,
        operation: 'ai_trip_draft_refine',
        source: 'mock',
        draft: {
          ...validRefineDraft(),
          days: validRefineDraft().days.map((day) => day.date === '2025-04-02'
            ? { ...day, title: '优化后的文化日', items: [{ title: '东京国立博物馆' }] }
            : day),
        },
      }), { status: 200 })
    }) as unknown as typeof fetch

    const result = await fetchProviderProxyAiTripDraftRefine({
      draft: validRefineDraft(),
      operation: 'ai_trip_draft_refine',
      preferences: { partySize: 3, preferTransport: 'walking' },
      scope: { kind: 'day', date: '2025-04-02' },
    }, '/api/provider-proxy', {
      fetcher,
      storage: memoryStorage({ unrelated: 'secret-ai-key' }),
    })

    expect(result.ok).toBe(true)
    expect(result.draft.days[1].title).toBe('优化后的文化日')
  })

  it('rejects invalid refine responses', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      operation: 'ai_trip_draft_refine',
      source: 'mock',
      draft: { title: '', startDate: 'bad', endDate: '2025-04-02', days: [] },
    }), { status: 200 })) as unknown as typeof fetch

    await expect(fetchProviderProxyAiTripDraftRefine({
      draft: validRefineDraft(),
      operation: 'ai_trip_draft_refine',
      scope: { kind: 'day', date: '2025-04-02' },
    }, '/api/provider-proxy', { fetcher })).rejects.toMatchObject({
      code: 'invalid_response',
      status: 200,
    })
  })
})

function validRefineDraft() {
  return {
    title: '东京之旅',
    destination: '东京',
    startDate: '2025-04-01',
    endDate: '2025-04-03',
    days: [
      { date: '2025-04-01', title: '抵达', items: [{ title: '浅草寺' }] },
      { date: '2025-04-02', title: '文化', items: [{ title: '上野公园' }] },
      { date: '2025-04-03', title: '购物', items: [{ title: '银座' }] },
    ],
  }
}

describe('provider proxy travel_search client', () => {
  it('validates and sends a search payload without provider secrets', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string)
      expect(body).toMatchObject({
        maxResults: 3,
        operation: 'travel_search',
        query: '杭州博物馆',
        quotaSessionId: 'session-search-1',
        searchType: 'official_site',
      })
      expect(JSON.stringify(body)).not.toContain('secret-search-key')
      expect(JSON.stringify(body)).not.toContain('Authorization')
      return new Response(JSON.stringify({
        ok: true,
        operation: 'travel_search',
        query: '杭州博物馆',
        retrievedAt: '2026-01-01T00:00:00.000Z',
        source: 'mock',
        results: [
          {
            confidence: 'medium',
            displayUrl: 'travel.example/search/mock-1',
            domain: 'travel.example',
            retrievedAt: '2026-01-01T00:00:00.000Z',
            snippet: '当前为模拟搜索结果。',
            sourceType: 'official',
            title: '模拟搜索结果',
            url: 'https://travel.example/search/mock-1',
          },
        ],
        warnings: ['当前为模拟搜索结果，不代表实时网页信息。'],
      }), { status: 200 })
    }) as unknown as typeof fetch

    const result = await fetchProviderProxyTravelSearch({
      maxResults: 3,
      operation: 'travel_search',
      query: '杭州博物馆',
      quotaSessionId: 'session-search-1',
      searchType: 'official_site',
    }, '/api/provider-proxy', {
      fetcher,
      storage: memoryStorage({ unrelated: 'secret-search-key' }),
    })

    expect(result.ok).toBe(true)
    expect(result.source).toBe('mock')
    expect(result.retrievedAt).toBe('2026-01-01T00:00:00.000Z')
    expect(result.results[0].domain).toBe('travel.example')
    expect(result.results[0].displayUrl).toBe('travel.example/search/mock-1')
  })

  it('rejects invalid search requests before POST', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch

    await expect(fetchProviderProxyTravelSearch({
      operation: 'travel_search',
      query: '',
      searchType: 'general',
      maxResults: 5,
    }, '/api/provider-proxy', { fetcher })).rejects.toBeInstanceOf(ProviderProxyClientError)

    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects malformed search success responses instead of accepting partial results', async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify({
        ok: true,
        operation: 'travel_search',
        query: '杭州博物馆',
        retrievedAt: '2026-01-01T00:00:00.000Z',
        source: 'mock',
        results: [
          {
            domain: 'travel.example',
            retrievedAt: '2026-01-01T00:00:00.000Z',
            snippet: '缺少 displayUrl。',
            title: '模拟搜索结果',
            url: 'https://travel.example/search/mock-1',
          },
        ],
      }), { status: 200 })
    }) as unknown as typeof fetch

    await expect(fetchProviderProxyTravelSearch({
      operation: 'travel_search',
      query: '杭州博物馆',
    }, '/api/provider-proxy', { fetcher })).rejects.toMatchObject({
      code: 'invalid_response',
      status: 200,
    })
  })

  it('rejects unsafe search result URLs', async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify({
        ok: true,
        operation: 'travel_search',
        query: '杭州博物馆',
        retrievedAt: '2026-01-01T00:00:00.000Z',
        source: 'mock',
        results: [
          {
            displayUrl: 'javascript:alert(1)',
            domain: 'travel.example',
            retrievedAt: '2026-01-01T00:00:00.000Z',
            snippet: 'unsafe',
            title: 'unsafe',
            url: 'javascript:alert(1)',
          },
        ],
      }), { status: 200 })
    }) as unknown as typeof fetch

    await expect(fetchProviderProxyTravelSearch({
      operation: 'travel_search',
      query: '杭州博物馆',
    }, '/api/provider-proxy', { fetcher })).rejects.toMatchObject({
      code: 'invalid_response',
    })
  })

  it('throws ProviderProxyClientError for normalized search errors', async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify({
        code: 'provider_unavailable',
        details: 'raw provider body with secret-search-key',
        message: 'raw provider body with secret-search-key',
        ok: false,
        operation: 'travel_search',
      }), { status: 503 })
    }) as unknown as typeof fetch

    await expect(fetchProviderProxyTravelSearch({
      operation: 'travel_search',
      query: '杭州博物馆',
      searchType: 'general',
      maxResults: 5,
    }, '/api/provider-proxy', { fetcher })).rejects.toMatchObject({
      code: 'provider_unavailable',
      details: undefined,
      message: '搜索服务暂不可用。',
      status: 503,
    })
  })
})

describe('provider proxy place_lookup client', () => {
  it('validates and sends a place lookup payload without provider secrets', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string)
      expect(body).toMatchObject({
        locale: 'zh-CN',
        maxResults: 3,
        operation: 'place_lookup',
        query: '杭州博物馆',
        quotaSessionId: 'session-place-1',
        region: 'CN',
      })
      expect(JSON.stringify(body)).not.toContain('secret-place-key')
      expect(JSON.stringify(body)).not.toContain('X-Goog-Api-Key')
      expect(JSON.stringify(body)).not.toContain('Authorization')
      return new Response(JSON.stringify({
        ok: true,
        operation: 'place_lookup',
        retrievedAt: '2026-01-01T00:00:00.000Z',
        source: 'mock',
        results: [
          {
            displayName: '杭州博物馆',
            formattedAddress: '浙江省杭州市上城区粮道山18号',
            googleMapsUri: 'https://maps.google.com/?cid=123',
            location: { lat: 30.245, lng: 120.17 },
            placeId: 'places/mock-1',
            provider: 'google_places',
            retrievedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      }), { status: 200 })
    }) as unknown as typeof fetch

    const result = await fetchProviderProxyPlaceLookup({
      locale: 'zh-CN',
      maxResults: 3,
      operation: 'place_lookup',
      query: '杭州博物馆',
      quotaSessionId: 'session-place-1',
      region: 'cn',
    }, '/api/provider-proxy', {
      fetcher,
      storage: memoryStorage({ unrelated: 'secret-place-key' }),
    })

    expect(result.ok).toBe(true)
    expect(result.source).toBe('mock')
    expect(result.results[0]).toMatchObject({
      displayName: '杭州博物馆',
      formattedAddress: '浙江省杭州市上城区粮道山18号',
      location: { lat: 30.245, lng: 120.17 },
      provider: 'google_places',
    })
  })

  it('rejects invalid place lookup requests before POST', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch

    await expect(fetchProviderProxyPlaceLookup({
      operation: 'place_lookup',
      query: '',
      maxResults: 5,
    }, '/api/provider-proxy', { fetcher })).rejects.toBeInstanceOf(ProviderProxyClientError)

    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects malformed place lookup success responses instead of accepting partial results', async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify({
        ok: true,
        operation: 'place_lookup',
        retrievedAt: '2026-01-01T00:00:00.000Z',
        source: 'google_places',
        results: [
          {
            formattedAddress: '缺少名称。',
            placeId: 'places/bad',
            provider: 'google_places',
            retrievedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      }), { status: 200 })
    }) as unknown as typeof fetch

    await expect(fetchProviderProxyPlaceLookup({
      operation: 'place_lookup',
      query: '杭州博物馆',
    }, '/api/provider-proxy', { fetcher })).rejects.toMatchObject({
      code: 'invalid_response',
      status: 200,
    })
  })

  it('rejects unsafe Google Maps URIs in normalized place lookup responses', async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify({
        ok: true,
        operation: 'place_lookup',
        retrievedAt: '2026-01-01T00:00:00.000Z',
        source: 'google_places',
        results: [
          {
            displayName: 'Unsafe',
            formattedAddress: 'Unsafe address',
            googleMapsUri: 'javascript:alert(1)',
            placeId: 'places/unsafe',
            provider: 'google_places',
            retrievedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      }), { status: 200 })
    }) as unknown as typeof fetch

    await expect(fetchProviderProxyPlaceLookup({
      operation: 'place_lookup',
      query: '杭州博物馆',
    }, '/api/provider-proxy', { fetcher })).rejects.toMatchObject({
      code: 'invalid_response',
    })
  })

  it('throws ProviderProxyClientError for normalized place lookup errors without raw body leak', async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify({
        code: 'provider_unavailable',
        details: 'raw provider body with secret-place-key',
        message: 'raw provider body with secret-place-key',
        ok: false,
        operation: 'place_lookup',
      }), { status: 503 })
    }) as unknown as typeof fetch

    await expect(fetchProviderProxyPlaceLookup({
      operation: 'place_lookup',
      query: '杭州博物馆',
      maxResults: 5,
    }, '/api/provider-proxy', { fetcher })).rejects.toMatchObject({
      code: 'provider_unavailable',
      details: undefined,
      message: '地点查询服务暂不可用。',
      status: 503,
    })
  })
})

describe('provider proxy ai_trip_edit_plan client', () => {
  it('validates and sends an edit payload without secrets', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string)
      expect(body).toMatchObject({
        command: '第二天太满了，帮我放松一点',
        operation: 'ai_trip_edit_plan',
        quotaSessionId: 'session-edit-1',
      })
      expect(JSON.stringify(body)).not.toContain('secret-ai-key')
      expect(JSON.stringify(body)).not.toContain('Authorization')
      return new Response(JSON.stringify({
        ok: true,
        operation: 'ai_trip_edit_plan',
        patchPlan: {
          operations: [{ item: { title: '咖啡休息' }, reason: '增加休息。', targetDayId: 'day_1', type: 'add_item' }],
          summary: '新增休息',
        },
        source: 'mock',
      }), { status: 200 })
    }) as unknown as typeof fetch

    const result = await fetchProviderProxyAiTripEditPlan({
      command: '第二天太满了，帮我放松一点',
      context: editContext(),
      operation: 'ai_trip_edit_plan',
      quotaSessionId: 'session-edit-1',
    }, '/api/provider-proxy', {
      fetcher,
      storage: memoryStorage({ unrelated: 'secret-ai-key' }),
    })

    expect(result.ok).toBe(true)
    expect(result.patchPlan.operations[0].type).toBe('add_item')
  })

  it('rejects invalid edit requests before POST', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch

    await expect(fetchProviderProxyAiTripEditPlan({
      command: '',
      context: editContext(),
      operation: 'ai_trip_edit_plan',
    }, '/api/provider-proxy', { fetcher })).rejects.toBeInstanceOf(ProviderProxyClientError)

    expect(fetcher).not.toHaveBeenCalled()
  })

  it('throws ProviderProxyClientError for normalized edit errors', async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify({
        code: 'provider_unavailable',
        message: 'AI 修改建议服务暂不可用。',
        ok: false,
        operation: 'ai_trip_edit_plan',
      }), { status: 503 })
    }) as unknown as typeof fetch

    await expect(fetchProviderProxyAiTripEditPlan({
      command: '放松一点',
      context: editContext(),
      operation: 'ai_trip_edit_plan',
    }, '/api/provider-proxy', { fetcher })).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 503,
    })
  })
})

describe('provider proxy assistant_answer client', () => {
  it('posts a redacted assistant answer request and parses the structured response', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body).toMatchObject({
        operation: 'assistant_answer',
        question: '你能做什么？',
      })
      expect(JSON.stringify(body)).not.toContain('Authorization')
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer access-token')
      return new Response(JSON.stringify({
        answer: '我可以回答旅行问题。',
        caveats: ['不会写入。'],
        ok: true,
        operation: 'assistant_answer',
        source: 'future_ai',
        sourceCards: [{ id: 'local', kind: 'local_context', title: '本地摘要' }],
      }))
    }) as unknown as typeof fetch

    const result = await fetchProviderProxyAssistantAnswer({
      context: {
        scopeLabel: '全部旅行',
        sourceCards: [{ id: 'local', kind: 'local_context', title: '本地摘要' }],
        summaries: [{ key: 'trip_count', label: '旅行数量', value: '1 个旅行' }],
      },
      operation: 'assistant_answer',
      question: '你能做什么？',
    }, '/api/provider-proxy', {
      accessToken: 'access-token',
      fetcher,
      storage: memoryStorage(),
    })

    expect(result).toMatchObject({ ok: true, operation: 'assistant_answer', source: 'future_ai' })
  })
})

function editContext() {
  return {
    days: [
      {
        date: '2026-07-10',
        id: 'day_1',
        items: [{ dayId: 'day_1', id: 'item_1', title: '西湖' }],
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
  }
}

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
