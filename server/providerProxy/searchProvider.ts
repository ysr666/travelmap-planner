import {
  PROVIDER_PROXY_TRAVEL_SEARCH_OPERATION,
  type ProviderProxyErrorCode,
  type ProviderProxyValidatedTravelSearchRequest,
  type ProviderProxyTravelSearchResult,
  type ProviderProxyTravelSearchSourceType,
  type ProviderProxyTravelSearchSuccessResponse,
} from '../../src/lib/providerProxyContract'

export type TravelSearchProviderErrorCode = Extract<ProviderProxyErrorCode, 'provider_unavailable' | 'provider_error' | 'network_error' | 'unsupported'>

export type TravelSearchProviderResult =
  | { ok: true; response: ProviderProxyTravelSearchSuccessResponse }
  | { errorCode: TravelSearchProviderErrorCode; message: string; ok: false }

export type TravelSearchProvider = {
  readonly name: string
  search(request: ProviderProxyValidatedTravelSearchRequest): Promise<TravelSearchProviderResult>
}

const MOCK_SEARCH_WARNING = '当前为模拟搜索结果，不代表实时网页信息。'
const DEFAULT_MOCK_RETRIEVED_AT = '2026-01-01T00:00:00.000Z'

export function createMockTravelSearchProvider(options: { now?: Date | string } = {}): TravelSearchProvider {
  const retrievedAt = normalizeRetrievedAt(options.now)
  return {
    name: 'mock',
    async search(request) {
      return {
        ok: true,
        response: {
          ok: true,
          operation: PROVIDER_PROXY_TRAVEL_SEARCH_OPERATION,
          query: request.query,
          retrievedAt,
          requestId: request.requestId,
          results: buildMockSearchResults(request, retrievedAt),
          source: 'mock',
          warnings: [MOCK_SEARCH_WARNING],
        },
      }
    },
  }
}

export function createDisabledTravelSearchProvider(): TravelSearchProvider {
  return {
    name: 'disabled',
    async search() {
      return { errorCode: 'unsupported', message: 'Travel search is not enabled.', ok: false }
    },
  }
}

export function createUnavailableTravelSearchProvider(): TravelSearchProvider {
  return {
    name: 'unavailable',
    async search() {
      return { errorCode: 'provider_unavailable', message: 'Travel search provider is not configured.', ok: false }
    },
  }
}

function buildMockSearchResults(
  request: ProviderProxyValidatedTravelSearchRequest,
  retrievedAt: string,
): ProviderProxyTravelSearchResult[] {
  return Array.from({ length: request.maxResults }, (_, index) => {
    const position = index + 1
    const id = `mock-${stableHash(`${request.searchType}:${request.query}:${request.region ?? ''}:${position}`)}`
    const slug = encodeURIComponent(`${request.searchType}-${request.query}-${position}`)
    const url = `https://travel.example/search/${slug}`
    return {
      confidence: position === 1 ? 'medium' : 'low',
      displayUrl: `travel.example/search/${id}`,
      domain: 'travel.example',
      retrievedAt,
      snippet: `模拟搜索片段 ${position}：${request.query}。此结果仅用于 provider proxy 合同测试，不代表实时网页信息。`,
      sourceType: mapMockSourceType(request.searchType),
      title: `模拟搜索结果 ${position}：${request.query}`,
      url,
    }
  })
}

function mapMockSourceType(searchType: ProviderProxyValidatedTravelSearchRequest['searchType']): ProviderProxyTravelSearchSourceType {
  if (searchType === 'opening_hours' || searchType === 'official_site') return 'official'
  if (searchType === 'ticket_price') return 'ticketing'
  if (searchType === 'transport') return 'map'
  if (searchType === 'nearby_food') return 'travel_site'
  return 'unknown'
}

function normalizeRetrievedAt(value: Date | string | undefined): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string' && value.trim()) return value.trim()
  return DEFAULT_MOCK_RETRIEVED_AT
}

function stableHash(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return hash.toString(36)
}
