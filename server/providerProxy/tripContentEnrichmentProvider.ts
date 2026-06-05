import {
  type ProviderProxyErrorCode,
  type ProviderProxyTripContentEnrichmentItemResult,
  type ProviderProxyTripContentEnrichmentRequest,
} from '../../src/lib/ai/providerProxyContract'
import { extractJsonFromAiText } from './aiJson'
import type { AiBackendReasoningMode } from './aiReasoningPolicy'

export type TripContentEnrichmentProviderErrorCode = Extract<ProviderProxyErrorCode, 'provider_unavailable' | 'provider_error' | 'network_error' | 'unsupported' | 'invalid_response'>

export type TripContentEnrichmentProviderResult =
  | { ok: true; items: ProviderProxyTripContentEnrichmentItemResult[]; source: 'mock' | 'future_ai'; warnings?: string[] }
  | { errorCode: TripContentEnrichmentProviderErrorCode; message?: string; ok: false }

export type TripContentEnrichmentProvider = {
  readonly name: string
  enrich(request: ProviderProxyTripContentEnrichmentRequest, input: TripContentEnrichmentProviderInput): Promise<TripContentEnrichmentProviderResult>
}

export type TripContentEnrichmentProviderInput = {
  prompt: string
  maxOutputTokens: number
  reasoningMode?: AiBackendReasoningMode
}

type OpenAiCompatibleEnv = {
  TRIPMAP_AI_API_KEY?: string
  TRIPMAP_AI_BASE_URL?: string
  TRIPMAP_AI_MODEL?: string
}

type OpenAiCompatibleMessage = {
  role: 'system' | 'user'
  content: string
}

const REQUEST_TIMEOUT_MS = 60_000
const CHAT_COMPLETIONS_PATH = '/chat/completions'
const OPENAI_COMPATIBLE_JSON_RESPONSE_FORMAT = { type: 'json_object' } as const
const OPENAI_COMPATIBLE_THINKING_DISABLED = { type: 'disabled' } as const
const OPENAI_COMPATIBLE_THINKING_ENABLED = { type: 'enabled' } as const

export function buildTripContentEnrichmentProviderInput(
  request: ProviderProxyTripContentEnrichmentRequest,
  requestId?: string,
): TripContentEnrichmentProviderInput {
  return {
    maxOutputTokens: 2400,
    prompt: [
      '你是 TripMap 的旅行内容补充助手，只输出 JSON。',
      '你只能基于下方已提供的 Google Places 和 travel_search 来源摘要生成内容；不要自行联网搜索，不要编造来源外事实。',
      '事实性字段 introduction、openingHours、ticketPrice、notices 必须引用 sourceIds；没有来源时省略该字段。',
      'Google Places 的 priceLevel/priceRange 不是门票价格，除非来源明确说明入场费用，否则 ticketPrice.kind 必须是 unknown 或省略。',
      'recommendedStay 可以基于行程类型和来源内容估算，但必须 basis="ai_estimate"，给出 durationMinutes、text 和 reason。',
      '输出中文，简洁具体。不要输出 Markdown、解释文字或代码块。',
      '输出 schema：{"items":[{"itemId":"...","introduction":{"text":"...","sourceIds":["..."]},"openingHours":{"text":"...","sourceIds":["..."]},"ticketPrice":{"text":"...","sourceIds":["..."],"kind":"admission"},"notices":[{"text":"...","sourceIds":["..."]}],"recommendedStay":{"basis":"ai_estimate","durationMinutes":90,"text":"建议停留约 1.5 小时","reason":"..."},"warnings":["..."]}],"warnings":["..."]}',
      `requestId: ${requestId ?? request.requestId ?? 'unknown'}`,
      `items: ${JSON.stringify(compactRequest(request))}`,
    ].join('\n'),
    reasoningMode: 'off',
  }
}

export function createMockTripContentEnrichmentProvider(): TripContentEnrichmentProvider {
  return {
    name: 'mock',
    async enrich(request) {
      return {
        items: request.items.map(buildMockItemResult),
        ok: true,
        source: 'mock',
        warnings: ['当前为本地示例内容补充，非真实 AI 生成。'],
      }
    },
  }
}

export function createUnavailableTripContentEnrichmentProvider(): TripContentEnrichmentProvider {
  return {
    name: 'unavailable',
    async enrich() {
      return { errorCode: 'provider_unavailable', message: 'Trip content enrichment provider is not configured.', ok: false }
    },
  }
}

export function createDisabledTripContentEnrichmentProvider(): TripContentEnrichmentProvider {
  return {
    name: 'disabled',
    async enrich() {
      return { errorCode: 'unsupported', message: 'Trip content enrichment provider is disabled.', ok: false }
    },
  }
}

export function createOpenAiCompatibleTripContentEnrichmentProvider(
  env: OpenAiCompatibleEnv,
  fetchImpl: typeof fetch = fetch,
): TripContentEnrichmentProvider {
  const apiKey = env.TRIPMAP_AI_API_KEY?.trim()
  const baseUrl = env.TRIPMAP_AI_BASE_URL?.trim()
  const model = env.TRIPMAP_AI_MODEL?.trim()

  return {
    name: 'openai_compatible',
    async enrich(request, input): Promise<TripContentEnrichmentProviderResult> {
      if (!apiKey || !baseUrl || !model) {
        return { ok: false, errorCode: 'provider_unavailable', message: 'AI provider environment is not fully configured.' }
      }

      const response = await requestOpenAiCompatibleTripContentEnrichment({
        apiKey,
        endpoint: joinUrl(baseUrl, CHAT_COMPLETIONS_PATH),
        fetchImpl,
        maxTokens: input.maxOutputTokens,
        messages: [{ role: 'system', content: input.prompt }],
        model,
        reasoningMode: input.reasoningMode,
      })
      if (!response.ok) {
        return response
      }
      const normalized = normalizeTripContentEnrichmentProviderOutput(response.rawText, request)
      if (!normalized.ok) {
        return normalized
      }
      return {
        items: normalized.items,
        ok: true,
        source: 'future_ai',
        warnings: normalized.warnings,
      }
    },
  }
}

export function normalizeTripContentEnrichmentProviderOutput(
  rawText: string,
  request: ProviderProxyTripContentEnrichmentRequest,
): { ok: true; items: ProviderProxyTripContentEnrichmentItemResult[]; warnings?: string[] } | { errorCode: 'invalid_response'; ok: false } {
  const parsed = extractJsonFromAiText(rawText)
  const record = readRecord(parsed)
  const rawItems = Array.isArray(record.items) ? record.items : Array.isArray(parsed) ? parsed : null
  if (!rawItems) {
    return { errorCode: 'invalid_response', ok: false }
  }
  const sourceIdsByItemId = new Map(request.items.map((item) => [item.itemId, new Set(item.sources.map((source) => source.id))]))
  const results: ProviderProxyTripContentEnrichmentItemResult[] = []
  const seen = new Set<string>()
  for (const rawItem of rawItems) {
    const result = normalizeItemResult(rawItem, sourceIdsByItemId)
    if (!result || seen.has(result.itemId)) {
      return { errorCode: 'invalid_response', ok: false }
    }
    seen.add(result.itemId)
    results.push(result)
  }
  return {
    items: results,
    ok: true,
    warnings: Array.isArray(record.warnings) ? record.warnings.filter((warning): warning is string => typeof warning === 'string').slice(0, 5) : undefined,
  }
}

function buildMockItemResult(item: ProviderProxyTripContentEnrichmentRequest['items'][number]): ProviderProxyTripContentEnrichmentItemResult {
  const placesSource = item.sources.find((source) => source.sourceType === 'google_places' || source.sourceType === 'map')
  const ticketSource = item.sources.find((source) => source.sourceType === 'ticketing')
  const bestSource = item.sources[0]
  const sourceIds = bestSource ? [bestSource.id] : []
  const openingSourceId = placesSource?.id ?? bestSource?.id
  const notices = bestSource ? [{
    sourceIds: [bestSource.id],
    text: '出发前请以来源页面核对开放状态、预约要求和临时闭馆信息。',
  }] : undefined

  return {
    itemId: item.itemId,
    introduction: item.place?.editorialSummary && placesSource
      ? { sourceIds: [placesSource.id], text: item.place.editorialSummary }
      : sourceIds.length ? { sourceIds, text: `${item.title}适合作为本日重点游览点，建议结合现场开放状态安排。` } : undefined,
    notices,
    openingHours: item.place?.regularOpeningHours?.weekdayDescriptions.length && openingSourceId
      ? { sourceIds: [openingSourceId], text: item.place.regularOpeningHours.weekdayDescriptions.join('；') }
      : undefined,
    recommendedStay: {
      basis: 'ai_estimate',
      durationMinutes: estimateStayMinutes(item.title),
      reason: '根据景点类型、行程点粒度和来源摘要估算。',
      text: `建议停留约 ${formatDuration(estimateStayMinutes(item.title))}`,
    },
    ticketPrice: ticketSource
      ? { kind: 'admission', sourceIds: [ticketSource.id], text: ticketSource.snippet || '请以购票来源页面为准。' }
      : undefined,
  }
}

function compactRequest(request: ProviderProxyTripContentEnrichmentRequest) {
  return request.items.map((item) => ({
    address: item.address,
    date: item.date,
    dayTitle: item.dayTitle,
    destination: item.destination,
    itemId: item.itemId,
    locationName: item.locationName,
    place: item.place,
    sources: item.sources.map((source) => ({
      confidence: source.confidence,
      displayUrl: source.displayUrl,
      id: source.id,
      label: source.label,
      retrievedAt: source.retrievedAt,
      snippet: source.snippet,
      sourceType: source.sourceType,
      title: source.title,
    })),
    title: item.title,
  }))
}

function normalizeItemResult(
  input: unknown,
  sourceIdsByItemId: Map<string, Set<string>>,
): ProviderProxyTripContentEnrichmentItemResult | null {
  const record = readRecord(input)
  const itemId = readNonEmptyString(record.itemId)
  const validSourceIds = sourceIdsByItemId.get(itemId)
  if (!itemId || !validSourceIds) {
    return null
  }
  const introduction = normalizeFact(record.introduction, validSourceIds)
  const openingHours = normalizeFact(record.openingHours, validSourceIds)
  const ticketPrice = normalizeTicketFact(record.ticketPrice, validSourceIds)
  const notices = normalizeFacts(record.notices, validSourceIds)
  const recommendedStay = normalizeStay(record.recommendedStay, validSourceIds)
  if (
    (record.introduction !== undefined && !introduction) ||
    (record.openingHours !== undefined && !openingHours) ||
    (record.ticketPrice !== undefined && !ticketPrice) ||
    (record.notices !== undefined && !notices) ||
    (record.recommendedStay !== undefined && !recommendedStay)
  ) {
    return null
  }
  return {
    itemId,
    introduction,
    notices,
    openingHours,
    recommendedStay,
    ticketPrice,
    warnings: Array.isArray(record.warnings) ? record.warnings.filter((warning): warning is string => typeof warning === 'string').slice(0, 5) : undefined,
  }
}

function normalizeFact(input: unknown, validSourceIds: Set<string>) {
  if (input === undefined) return undefined
  const record = readRecord(input)
  const text = clampText(readNonEmptyString(record.text), 700)
  const sourceIds = normalizeSourceIds(record.sourceIds, validSourceIds)
  if (!text || sourceIds.length === 0) return undefined
  return { sourceIds, text }
}

function normalizeTicketFact(input: unknown, validSourceIds: Set<string>): ProviderProxyTripContentEnrichmentItemResult['ticketPrice'] {
  const fact = normalizeFact(input, validSourceIds)
  if (!fact) return undefined
  const record = readRecord(input)
  const kind = record.kind === 'admission' || record.kind === 'place_price_level' || record.kind === 'unknown'
    ? record.kind
    : 'unknown'
  return { ...fact, kind }
}

function normalizeFacts(input: unknown, validSourceIds: Set<string>) {
  if (input === undefined) return undefined
  if (!Array.isArray(input)) return undefined
  const facts = input.flatMap((rawFact) => {
    const fact = normalizeFact(rawFact, validSourceIds)
    return fact ? [fact] : []
  }).slice(0, 5)
  return facts.length ? facts : undefined
}

function normalizeStay(input: unknown, validSourceIds: Set<string>): ProviderProxyTripContentEnrichmentItemResult['recommendedStay'] {
  if (input === undefined) return undefined
  const record = readRecord(input)
  const basis = record.basis === 'source' ? 'source' : record.basis === 'ai_estimate' ? 'ai_estimate' : undefined
  const durationMinutes = Number(record.durationMinutes)
  const text = clampText(readNonEmptyString(record.text), 160)
  const reason = clampText(readNonEmptyString(record.reason), 240)
  const sourceIds = normalizeSourceIds(record.sourceIds, validSourceIds)
  if (!basis || !Number.isInteger(durationMinutes) || durationMinutes < 10 || durationMinutes > 720 || !text || !reason) return undefined
  if (basis === 'source' && sourceIds.length === 0) return undefined
  return { basis, durationMinutes, reason, sourceIds: sourceIds.length ? sourceIds : undefined, text }
}

function normalizeSourceIds(input: unknown, validSourceIds: Set<string>) {
  if (!Array.isArray(input)) return []
  return Array.from(new Set(input.filter((value): value is string => typeof value === 'string' && validSourceIds.has(value))))
}

async function requestOpenAiCompatibleTripContentEnrichment({
  apiKey,
  endpoint,
  fetchImpl,
  maxTokens,
  messages,
  model,
  reasoningMode = 'off',
}: {
  apiKey: string
  endpoint: string
  fetchImpl: typeof fetch
  maxTokens: number
  messages: OpenAiCompatibleMessage[]
  model: string
  reasoningMode?: AiBackendReasoningMode
}): Promise<{ ok: true; rawText: string } | { ok: false; errorCode: TripContentEnrichmentProviderErrorCode; message?: string }> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetchImpl(endpoint, {
      body: JSON.stringify(buildOpenAiCompatibleChatBody({ maxTokens, messages, model, reasoningMode })),
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: controller.signal,
    })

    if (!response.ok) {
      return { ok: false, errorCode: 'provider_error', message: 'AI provider returned an error.' }
    }

    const data = await readJson(response)
    const rawText = extractContent(data)
    if (!rawText) {
      return { ok: false, errorCode: 'provider_error', message: 'AI provider returned empty content.' }
    }

    return { ok: true, rawText }
  } catch (caught) {
    if (caught instanceof Error && caught.name === 'AbortError') {
      return { ok: false, errorCode: 'network_error', message: 'AI provider request timed out.' }
    }
    return { ok: false, errorCode: 'network_error', message: 'AI provider request failed.' }
  } finally {
    clearTimeout(timeoutId)
  }
}

function buildOpenAiCompatibleChatBody({
  maxTokens,
  messages,
  model,
  reasoningMode,
}: {
  maxTokens: number
  messages: OpenAiCompatibleMessage[]
  model: string
  reasoningMode?: AiBackendReasoningMode
}) {
  return {
    max_tokens: maxTokens,
    messages,
    model,
    response_format: OPENAI_COMPATIBLE_JSON_RESPONSE_FORMAT,
    thinking: reasoningMode === 'off' ? OPENAI_COMPATIBLE_THINKING_DISABLED : OPENAI_COMPATIBLE_THINKING_ENABLED,
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function extractContent(input: unknown): string {
  const record = readRecord(input)
  const choices = Array.isArray(record.choices) ? record.choices : []
  for (const choice of choices) {
    const message = readRecord(readRecord(choice).message)
    const content = message.content
    if (typeof content === 'string' && content.trim()) {
      return content
    }
    if (Array.isArray(content)) {
      const joined = content
        .map((part) => readRecord(part).text)
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join('\n')
      if (joined.trim()) return joined
    }
  }
  return ''
}

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

function estimateStayMinutes(title: string) {
  if (/博物馆|museum|美术馆|gallery/i.test(title)) return 150
  if (/公园|park|街区|market|街|商圈/i.test(title)) return 90
  if (/餐|咖啡|restaurant|cafe/i.test(title)) return 60
  return 90
}

function formatDuration(minutes: number) {
  if (minutes % 60 === 0) return `${minutes / 60} 小时`
  if (minutes > 60) return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
  return `${minutes} 分钟`
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function clampText(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1)).trim()}…`
}
