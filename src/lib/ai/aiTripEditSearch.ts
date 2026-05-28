import type { AiTripEditContext, AiTripEditContextItem } from './aiTripEditContext'
import {
  PROVIDER_PROXY_TRAVEL_SEARCH_OPERATION,
  type ProviderProxyAiTripEditSearchSummary,
  type ProviderProxyTravelSearchRequest,
  type ProviderProxyTravelSearchSuccessResponse,
  type ProviderProxyTravelSearchType,
} from './providerProxyContract'

export type AiTripEditSearchIntent =
  | { needed: true; searchType: ProviderProxyTravelSearchType; reason: string }
  | { needed: false }

const MAX_SEARCH_QUERY_LENGTH = 300
const MAX_PROMPT_SOURCES = 3
const MAX_SOURCE_SNIPPET_LENGTH = 240

export function detectAiTripEditSearchIntent(command: string): AiTripEditSearchIntent {
  const normalized = command.toLocaleLowerCase().replace(/\s+/g, ' ').trim()
  if (!normalized) return { needed: false }

  if (
    containsAny(command, ['今天开放', '今天开门吗', '是否开门', '开门吗', '营业时间', '开放时间', '闭馆', '关门']) ||
    matchesAny(normalized, [
      /\bopen\s+today\b/,
      /\bopen\s+now\b/,
      /\bopening\s+hours?\b/,
      /\bhours\s+today\b/,
      /\bcurrently\s+open\b/,
      /\bclosed\s+today\b/,
    ])
  ) {
    return { needed: true, reason: 'opening_hours', searchType: 'opening_hours' }
  }

  if (containsAny(command, ['门票价格', '票价', '门票']) || matchesAny(normalized, [/\bticket\s+prices?\b/, /\bticket\s+cost\b/, /\badmission\s+fee\b/])) {
    return { needed: true, reason: 'ticket_price', searchType: 'ticket_price' }
  }

  if (containsAny(command, ['官方网站', '官网']) || matchesAny(normalized, [/\bofficial\s+(?:site|website)\b/])) {
    return { needed: true, reason: 'official_site', searchType: 'official_site' }
  }

  if (containsAny(command, ['怎么去', '交通', '停运', '延误', '中断']) || matchesAny(normalized, [/\btransport\b/, /\btransit\b/, /\bhow\s+to\s+get\s+there\b/, /\bdisruption\b/, /\bdelay(?:ed|s)?\b/])) {
    return { needed: true, reason: 'transport', searchType: 'transport' }
  }

  if (containsAny(command, ['附近吃饭', '附近餐厅', '餐厅', '吃饭']) || matchesAny(normalized, [/\bnearby\s+(?:food|restaurants?)\b/, /\brestaurants?\s+nearby\b/])) {
    return { needed: true, reason: 'nearby_food', searchType: 'nearby_food' }
  }

  if (containsAny(command, ['最新', '近期', '搜索', '查询', '查一下']) || matchesAny(normalized, [/\blatest\b/, /\brecent\b/, /\bsearch\b/, /\blook\s+up\b/, /\bquery\b/])) {
    return { needed: true, reason: 'general', searchType: 'general' }
  }

  return { needed: false }
}

export function buildAiTripEditSearchRequest(
  command: string,
  context: AiTripEditContext,
): ProviderProxyTravelSearchRequest | null {
  const intent = detectAiTripEditSearchIntent(command)
  if (!intent.needed) return null

  return {
    maxResults: MAX_PROMPT_SOURCES,
    operation: PROVIDER_PROXY_TRAVEL_SEARCH_OPERATION,
    query: buildSearchQuery(command, context),
    searchType: intent.searchType,
  }
}

export function summarizeTravelSearchResultsForPrompt(
  response: ProviderProxyTravelSearchSuccessResponse,
): ProviderProxyAiTripEditSearchSummary | null {
  const results = response.results.slice(0, MAX_PROMPT_SOURCES).map((result) => ({
    confidence: result.confidence,
    displayUrl: result.displayUrl,
    domain: result.domain,
    retrievedAt: result.retrievedAt,
    snippet: clampText(result.snippet, MAX_SOURCE_SNIPPET_LENGTH),
    sourceType: result.sourceType,
    title: result.title,
    url: result.url,
  }))

  if (results.length === 0) return null

  return {
    query: clampText(response.query, MAX_SEARCH_QUERY_LENGTH),
    results,
    retrievedAt: response.retrievedAt,
    source: response.source,
    warnings: response.warnings?.slice(0, 3),
  }
}

function buildSearchQuery(command: string, context: AiTripEditContext): string {
  const itemContext = selectRelevantItems(command, context)
    .map(formatItemForQuery)
    .filter(Boolean)

  const parts = [
    clampText(command, 180),
    context.trip.destination,
    context.trip.title,
    ...itemContext,
  ].filter((part): part is string => Boolean(part?.trim()))

  return clampText(dedupe(parts).join(' '), MAX_SEARCH_QUERY_LENGTH)
}

function selectRelevantItems(command: string, context: AiTripEditContext): AiTripEditContextItem[] {
  const items = context.days.flatMap((day) => day.items)
  const matched = items.filter((item) => {
    return [item.title, item.locationName, item.address]
      .filter((value): value is string => Boolean(value))
      .some((value) => command.includes(value))
  })
  return (matched.length > 0 ? matched : items).slice(0, 3)
}

function formatItemForQuery(item: AiTripEditContextItem): string {
  return dedupe([item.title, item.locationName, item.address].filter((value): value is string => Boolean(value?.trim()))).join(' ')
}

function containsAny(text: string, patterns: string[]) {
  return patterns.some((pattern) => text.includes(pattern))
}

function matchesAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text))
}

function dedupe(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function clampText(value: string, maxLength: number) {
  const trimmed = value.trim()
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed
}
