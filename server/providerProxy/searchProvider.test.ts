import { describe, expect, it, vi } from 'vitest'
import {
  createDisabledTravelSearchProvider,
  createMockTravelSearchProvider,
  createTavilyTravelSearchProvider,
  createUnavailableTravelSearchProvider,
} from './searchProvider'

function validSearchRequest() {
  return {
    maxResults: 3,
    operation: 'travel_search' as const,
    query: '杭州博物馆',
    searchType: 'official_site' as const,
  }
}

describe('travel search provider foundation', () => {
  it('returns deterministic mock results for the same request', async () => {
    const provider = createMockTravelSearchProvider({ now: '2026-02-03T04:05:06.000Z' })
    const first = await provider.search(validSearchRequest())
    const second = await provider.search(validSearchRequest())

    expect(first).toEqual(second)
    expect(first.ok).toBe(true)
    if (first.ok) {
      expect(first.response.source).toBe('mock')
      expect(first.response.retrievedAt).toBe('2026-02-03T04:05:06.000Z')
      expect(first.response.results).toHaveLength(3)
      expect(first.response.results[0].retrievedAt).toBe('2026-02-03T04:05:06.000Z')
      expect(first.response.results[0].sourceType).toBe('official')
      expect(first.response.results[0].confidence).toBe('medium')
    }
  })

  it('uses example domains and required mock warning', async () => {
    const provider = createMockTravelSearchProvider()
    const result = await provider.search(validSearchRequest())

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.response.warnings).toContain('当前为模拟搜索结果，不代表实时网页信息。')
      for (const item of result.response.results) {
        expect(item.domain).toBe('travel.example')
        expect(item.displayUrl).toContain('travel.example')
        expect(item.url).toMatch(/^https:\/\/travel\.example\//)
        expect(item.url).not.toContain('amap.com')
        expect(item.url).not.toContain('google.com')
        expect(item.snippet).toContain('模拟搜索片段')
      }
    }
  })

  it('respects maxResults', async () => {
    const provider = createMockTravelSearchProvider()
    const result = await provider.search({ ...validSearchRequest(), maxResults: 1 })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.response.results).toHaveLength(1)
    }
  })

  it('returns normalized disabled and unavailable errors without network dependencies', async () => {
    await expect(createDisabledTravelSearchProvider().search(validSearchRequest())).resolves.toMatchObject({
      errorCode: 'unsupported',
      ok: false,
    })
    await expect(createUnavailableTravelSearchProvider().search(validSearchRequest())).resolves.toMatchObject({
      errorCode: 'provider_unavailable',
      ok: false,
    })
  })

  it('calls Tavily with injected fetch and compact query-only body', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      answer: 'raw answer should not be returned',
      results: [
        {
          content: 'Official visitor hours and ticketing details.',
          raw_content: 'raw provider body should not be returned',
          score: 0.92,
          title: 'Museum official site',
          url: 'https://www.example.com/visit?secret=ignored',
        },
      ],
      usage: { credits: 1 },
    }), { headers: { 'Content-Type': 'application/json' }, status: 200 })) as unknown as typeof fetch
    const provider = createTavilyTravelSearchProvider(
      { TRIPMAP_SEARCH_API_KEY: 'test-search-key' },
      fetcher,
      { now: '2026-02-03T04:05:06.000Z' },
    )

    const result = await provider.search({
      ...validSearchRequest(),
      locale: 'zh-CN',
      maxResults: 5,
      region: 'CN',
      searchType: 'ticket_price',
    })

    expect(result.ok).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = vi.mocked(fetcher).mock.calls[0]
    expect(url).toBe('https://api.tavily.com/search')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer test-search-key',
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(String(init?.body))).toEqual({
      include_answer: false,
      include_images: false,
      include_raw_content: false,
      max_results: 5,
      query: '杭州博物馆',
      search_depth: 'basic',
    })
    expect(String(init?.body)).not.toContain('CN')
    expect(String(init?.body)).not.toContain('ticket_price')

    if (result.ok) {
      expect(result.response).toMatchObject({
        ok: true,
        operation: 'travel_search',
        query: '杭州博物馆',
        retrievedAt: '2026-02-03T04:05:06.000Z',
        source: 'future_search',
      })
      expect(result.response.results).toEqual([
        {
          confidence: 'high',
          displayUrl: 'example.com/visit',
          domain: 'example.com',
          retrievedAt: '2026-02-03T04:05:06.000Z',
          snippet: 'Official visitor hours and ticketing details.',
          sourceType: 'ticketing',
          title: 'Museum official site',
          url: 'https://www.example.com/visit?secret=ignored',
        },
      ])
      expect(JSON.stringify(result.response)).not.toContain('raw provider body')
      expect(JSON.stringify(result.response)).not.toContain('raw answer')
      expect(JSON.stringify(result.response)).not.toContain('usage')
    }
  })

  it('rejects malformed Tavily responses without returning raw provider details', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      error: 'raw-provider-error',
      message: 'Bearer test-search-key failed',
    }), { headers: { 'Content-Type': 'application/json' }, status: 200 })) as unknown as typeof fetch
    const provider = createTavilyTravelSearchProvider(
      { TRIPMAP_SEARCH_API_KEY: 'test-search-key' },
      fetcher,
      { now: '2026-02-03T04:05:06.000Z' },
    )

    const result = await provider.search(validSearchRequest())

    expect(result).toMatchObject({
      errorCode: 'provider_error',
      ok: false,
    })
    expect(JSON.stringify(result)).not.toContain('raw-provider-error')
    expect(JSON.stringify(result)).not.toContain('test-search-key')
    expect(JSON.stringify(result)).not.toContain('Bearer')
  })

  it('filters unsafe and malformed Tavily result URLs', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      results: [
        { content: 'Unsafe JavaScript URL.', score: 0.9, title: 'Unsafe', url: 'javascript:alert(1)' },
        { content: 'Unsafe FTP URL.', score: 0.9, title: 'FTP', url: 'ftp://example.com/file' },
        { content: 'Missing title.', score: 0.9, url: 'https://example.com/missing-title' },
        { content: 'Useful safe result.', score: 0.61, title: 'Safe result', url: 'https://safe.example/path' },
      ],
    }), { headers: { 'Content-Type': 'application/json' }, status: 200 })) as unknown as typeof fetch
    const provider = createTavilyTravelSearchProvider(
      { TRIPMAP_SEARCH_API_KEY: 'test-search-key' },
      fetcher,
      { now: '2026-02-03T04:05:06.000Z' },
    )

    const result = await provider.search(validSearchRequest())

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.response.results).toHaveLength(1)
      expect(result.response.results[0]).toMatchObject({
        confidence: 'medium',
        displayUrl: 'safe.example/path',
        domain: 'safe.example',
        snippet: 'Useful safe result.',
        title: 'Safe result',
        url: 'https://safe.example/path',
      })
    }
  })

  it('returns an empty sourced response when Tavily has no usable source-bearing results', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      results: [
        { content: '', score: 0.9, title: 'Empty content', url: 'https://example.com/empty' },
        { content: 'Unsafe URL only.', score: 0.9, title: 'Unsafe', url: 'data:text/plain,nope' },
      ],
    }), { headers: { 'Content-Type': 'application/json' }, status: 200 })) as unknown as typeof fetch
    const provider = createTavilyTravelSearchProvider(
      { TRIPMAP_SEARCH_API_KEY: 'test-search-key' },
      fetcher,
      { now: '2026-02-03T04:05:06.000Z' },
    )

    const result = await provider.search(validSearchRequest())

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.response.results).toEqual([])
      expect(result.response.warnings).toContain('搜索服务未返回可用来源。')
    }
  })
})
