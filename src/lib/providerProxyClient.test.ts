import { describe, expect, it, vi } from 'vitest'
import {
  PROVIDER_PROXY_DEV_PROVIDER_STORAGE_KEY,
  PROVIDER_PROXY_DEV_URL_STORAGE_KEY,
  ProviderProxyClientError,
  fetchProviderProxyRoutePreview,
  fetchProviderProxyAiTripDraft,
  fetchProviderProxyAiTripEditPlan,
  fetchProviderProxyTravelSearch,
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

describe('provider proxy ai_trip_draft client', () => {
  it('does not include provider secrets in the ai_trip_draft payload', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string)
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
      destination: '东京',
      endDate: '2025-04-02',
      operation: 'ai_trip_draft',
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

describe('provider proxy travel_search client', () => {
  it('validates and sends a search payload without provider secrets', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string)
      expect(body).toMatchObject({
        maxResults: 3,
        operation: 'travel_search',
        query: '杭州博物馆',
        quotaSessionId: 'session-search-1',
        searchType: 'place',
      })
      expect(JSON.stringify(body)).not.toContain('secret-search-key')
      expect(JSON.stringify(body)).not.toContain('Authorization')
      return new Response(JSON.stringify({
        ok: true,
        operation: 'travel_search',
        query: '杭州博物馆',
        source: 'mock',
        results: [
          {
            confidence: 'medium',
            id: 'mock-1',
            retrievedAt: '2026-01-01T00:00:00.000Z',
            snippet: '当前为模拟搜索结果。',
            sourceDomain: 'travel.example',
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
      searchType: 'place',
    }, '/api/provider-proxy', {
      fetcher,
      storage: memoryStorage({ unrelated: 'secret-search-key' }),
    })

    expect(result.ok).toBe(true)
    expect(result.source).toBe('mock')
    expect(result.results[0].sourceDomain).toBe('travel.example')
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

  it('throws ProviderProxyClientError for normalized search errors', async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify({
        code: 'provider_unavailable',
        message: '搜索服务暂不可用。',
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
