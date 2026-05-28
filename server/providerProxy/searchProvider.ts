import {
  PROVIDER_PROXY_TRAVEL_SEARCH_OPERATION,
  type ProviderProxyErrorCode,
  type ProviderProxyValidatedTravelSearchRequest,
  type ProviderProxyTravelSearchConfidence,
  type ProviderProxyTravelSearchResult,
  type ProviderProxyTravelSearchSourceType,
  type ProviderProxyTravelSearchSuccessResponse,
} from '../../src/lib/ai/providerProxyContract'

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
const TAVILY_SEARCH_ENDPOINT = 'https://api.tavily.com/search'
const TAVILY_REQUEST_TIMEOUT_MS = 20_000
const TAVILY_NO_USABLE_RESULTS_WARNING = '搜索服务未返回可用来源。'
const MAX_TAVILY_TITLE_LENGTH = 160
const MAX_TAVILY_SNIPPET_LENGTH = 500
const MAX_TAVILY_DISPLAY_URL_LENGTH = 180

type TavilyTravelSearchProviderEnv = {
  TRIPMAP_SEARCH_API_KEY?: string
}

type TavilyTravelSearchProviderOptions = {
  now?: Date | string
}

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

export function createTavilyTravelSearchProvider(
  env: TavilyTravelSearchProviderEnv,
  fetchImpl: typeof fetch = fetch,
  options: TavilyTravelSearchProviderOptions = {},
): TravelSearchProvider {
  const apiKey = env.TRIPMAP_SEARCH_API_KEY?.trim()

  return {
    name: 'tavily',
    async search(request) {
      if (!apiKey) {
        return { errorCode: 'provider_unavailable', message: 'Travel search provider is not configured.', ok: false }
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), TAVILY_REQUEST_TIMEOUT_MS)
      let response: Response
      try {
        response = await fetchImpl(TAVILY_SEARCH_ENDPOINT, {
          body: JSON.stringify(buildTavilySearchBody(request)),
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          method: 'POST',
          signal: controller.signal,
        })
      } catch {
        clearTimeout(timeoutId)
        return { errorCode: 'network_error', message: 'Travel search provider request failed.', ok: false }
      }
      clearTimeout(timeoutId)

      if (!response.ok) {
        return {
          errorCode: response.status === 401 || response.status === 403 ? 'provider_unavailable' : 'provider_error',
          message: 'Travel search provider returned an error.',
          ok: false,
        }
      }

      let data: unknown
      try {
        data = await response.json()
      } catch {
        return { errorCode: 'provider_error', message: 'Travel search provider returned invalid JSON.', ok: false }
      }

      const retrievedAt = normalizeRetrievedAt(options.now ?? new Date())
      const normalized = normalizeTavilySearchResponse(data, request, retrievedAt)
      return normalized
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

function buildTavilySearchBody(request: ProviderProxyValidatedTravelSearchRequest) {
  return {
    include_answer: false,
    include_images: false,
    include_raw_content: false,
    max_results: Math.min(request.maxResults, 5),
    query: request.query,
    search_depth: 'basic',
  }
}

function normalizeTavilySearchResponse(
  input: unknown,
  request: ProviderProxyValidatedTravelSearchRequest,
  retrievedAt: string,
): TravelSearchProviderResult {
  const record = readRecord(input)
  if (!Array.isArray(record.results)) {
    return { errorCode: 'provider_error', message: 'Travel search provider returned an invalid response.', ok: false }
  }

  const results = record.results.flatMap((item): ProviderProxyTravelSearchResult[] => {
    const result = normalizeTavilySearchResult(item, request, retrievedAt)
    return result ? [result] : []
  }).slice(0, request.maxResults)

  return {
    ok: true,
    response: {
      ok: true,
      operation: PROVIDER_PROXY_TRAVEL_SEARCH_OPERATION,
      query: request.query,
      requestId: request.requestId,
      results,
      retrievedAt,
      source: 'future_search',
      warnings: results.length > 0 ? undefined : [TAVILY_NO_USABLE_RESULTS_WARNING],
    },
  }
}

function normalizeTavilySearchResult(
  input: unknown,
  request: ProviderProxyValidatedTravelSearchRequest,
  retrievedAt: string,
): ProviderProxyTravelSearchResult | null {
  const record = readRecord(input)
  const title = clampText(readNonEmptyString(record.title), MAX_TAVILY_TITLE_LENGTH)
  const snippet = clampText(readNonEmptyString(record.content), MAX_TAVILY_SNIPPET_LENGTH)
  const parsedUrl = parseSafeResultUrl(readNonEmptyString(record.url))

  if (!title || !snippet || !parsedUrl) {
    return null
  }

  return {
    confidence: mapTavilyConfidence(record.score),
    displayUrl: clampText(formatDisplayUrl(parsedUrl), MAX_TAVILY_DISPLAY_URL_LENGTH),
    domain: normalizeDomain(parsedUrl.hostname),
    retrievedAt,
    snippet,
    sourceType: mapMockSourceType(request.searchType),
    title,
    url: parsedUrl.toString(),
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseSafeResultUrl(value: string): URL | null {
  if (!value) return null
  try {
    const parsed = new URL(value)
    if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || !parsed.hostname || parsed.username || parsed.password) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function normalizeDomain(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '')
}

function formatDisplayUrl(url: URL): string {
  const domain = normalizeDomain(url.hostname)
  const path = url.pathname && url.pathname !== '/' ? url.pathname : ''
  return `${domain}${path}`
}

function mapTavilyConfidence(value: unknown): ProviderProxyTravelSearchConfidence | undefined {
  const score = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(score)) return undefined
  if (score >= 0.8) return 'high'
  if (score >= 0.5) return 'medium'
  return 'low'
}

function normalizeRetrievedAt(value: Date | string | undefined): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string' && value.trim()) return value.trim()
  return DEFAULT_MOCK_RETRIEVED_AT
}

function clampText(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1)).trim()}…`
}

function stableHash(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return hash.toString(36)
}
