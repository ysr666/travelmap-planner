import { describe, expect, it } from 'vitest'
import {
  createDisabledTravelSearchProvider,
  createMockTravelSearchProvider,
  createUnavailableTravelSearchProvider,
} from './searchProvider'

function validSearchRequest() {
  return {
    maxResults: 3,
    operation: 'travel_search' as const,
    query: '杭州博物馆',
    searchType: 'place' as const,
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
      expect(first.response.results).toHaveLength(3)
      expect(first.response.results[0].retrievedAt).toBe('2026-02-03T04:05:06.000Z')
    }
  })

  it('uses example domains and required mock warning', async () => {
    const provider = createMockTravelSearchProvider()
    const result = await provider.search(validSearchRequest())

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.response.warnings).toContain('当前为模拟搜索结果，不代表实时网页信息。')
      for (const item of result.response.results) {
        expect(item.sourceDomain).toBe('travel.example')
        expect(item.url).toMatch(/^https:\/\/travel\.example\//)
        expect(item.url).not.toContain('amap.com')
        expect(item.url).not.toContain('google.com')
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
})
