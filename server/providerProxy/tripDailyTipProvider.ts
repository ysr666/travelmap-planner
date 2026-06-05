import {
  type ProviderProxyErrorCode,
  type ProviderProxyTripDailyTipRequest,
  type ProviderProxyTripDailyTipSectionResult,
} from '../../src/lib/ai/providerProxyContract'
import { extractJsonFromAiText } from './aiJson'
import type { AiBackendReasoningMode } from './aiReasoningPolicy'

export type TripDailyTipProviderErrorCode = Extract<ProviderProxyErrorCode, 'provider_unavailable' | 'provider_error' | 'network_error' | 'unsupported' | 'invalid_response'>

export type TripDailyTipProviderResult =
  | { ok: true; sections: ProviderProxyTripDailyTipSectionResult[]; source: 'mock' | 'future_ai'; sourceIds: string[]; summary: string; warnings?: string[] }
  | { errorCode: TripDailyTipProviderErrorCode; message?: string; ok: false }

export type TripDailyTipProvider = {
  readonly name: string
  generate(request: ProviderProxyTripDailyTipRequest, input: TripDailyTipProviderInput): Promise<TripDailyTipProviderResult>
}

export type TripDailyTipProviderInput = {
  maxOutputTokens: number
  prompt: string
  reasoningMode?: AiBackendReasoningMode
}

type OpenAiCompatibleEnv = {
  TRIPMAP_AI_API_KEY?: string
  TRIPMAP_AI_BASE_URL?: string
  TRIPMAP_AI_MODEL?: string
}

type OpenAiCompatibleMessage = {
  content: string
  role: 'system' | 'user'
}

const REQUEST_TIMEOUT_MS = 60_000
const CHAT_COMPLETIONS_PATH = '/chat/completions'
const OPENAI_COMPATIBLE_JSON_RESPONSE_FORMAT = { type: 'json_object' } as const
const OPENAI_COMPATIBLE_THINKING_DISABLED = { type: 'disabled' } as const
const OPENAI_COMPATIBLE_THINKING_ENABLED = { type: 'enabled' } as const

export function buildTripDailyTipProviderInput(
  request: ProviderProxyTripDailyTipRequest,
  requestId?: string,
): TripDailyTipProviderInput {
  return {
    maxOutputTokens: 1200,
    prompt: [
      '你是 TripMap 的今日旅行提示助手，只输出 JSON。',
      '你只能基于下方 localSections 和 sources 生成一屏出行提示。不要自行联网搜索，不要编造来源外事实。',
      '开放时间、票价、注意事项和路线风险等事实型内容必须引用 sourceIds；没有来源时省略对应 section。',
      '不要输出写入行程点、路线缓存、票据、云端同步或 provider metadata 的操作。',
      '输出中文，短句，适合出发前快速查看。不要输出 Markdown、解释文字或代码块。',
      '输出 schema：{"summary":"...","sections":[{"key":"opening_hours","title":"开放时间","text":"...","sourceIds":["..."]}],"sourceIds":["..."],"warnings":["..."]}',
      `requestId: ${requestId ?? request.requestId ?? 'unknown'}`,
      `request: ${JSON.stringify(compactRequest(request))}`,
    ].join('\n'),
    reasoningMode: 'off',
  }
}

export function createMockTripDailyTipProvider(): TripDailyTipProvider {
  return {
    name: 'mock',
    async generate(request) {
      const sourceIds = request.sources.slice(0, 4).map((source) => source.id)
      if (sourceIds.length === 0) {
        return {
          errorCode: 'invalid_response',
          message: 'Trip daily tip requires source-bearing summaries.',
          ok: false,
        }
      }
      return {
        ok: true,
        sections: request.localSections
          .filter((section) => section.items.some((item) => item.sourceIds?.some((sourceId) => sourceIds.includes(sourceId))))
          .slice(0, 4)
          .map((section) => ({
            key: section.key,
            sourceIds: section.items.flatMap((item) => item.sourceIds ?? []).filter((sourceId, index, array) => sourceIds.includes(sourceId) && array.indexOf(sourceId) === index).slice(0, 3),
            text: section.items[0]?.text || `${section.title}请以来源页面为准。`,
            title: section.title,
          }))
          .filter((section) => section.sourceIds.length > 0),
        source: 'mock',
        sourceIds,
        summary: `${request.dayTitle ?? request.targetDate ?? '目标日'} 出发前请优先核对已保存来源中的开放状态、票价和路线风险。`,
        warnings: ['当前为本地示例今日提示，非真实 AI 生成。'],
      }
    },
  }
}

export function createUnavailableTripDailyTipProvider(): TripDailyTipProvider {
  return {
    name: 'unavailable',
    async generate() {
      return { errorCode: 'provider_unavailable', message: 'Trip daily tip provider is not configured.', ok: false }
    },
  }
}

export function createDisabledTripDailyTipProvider(): TripDailyTipProvider {
  return {
    name: 'disabled',
    async generate() {
      return { errorCode: 'unsupported', message: 'Trip daily tip provider is disabled.', ok: false }
    },
  }
}

export function createOpenAiCompatibleTripDailyTipProvider(
  env: OpenAiCompatibleEnv,
  fetchImpl: typeof fetch = fetch,
): TripDailyTipProvider {
  const apiKey = env.TRIPMAP_AI_API_KEY?.trim()
  const baseUrl = env.TRIPMAP_AI_BASE_URL?.trim()
  const model = env.TRIPMAP_AI_MODEL?.trim()

  return {
    name: 'openai_compatible',
    async generate(request, input): Promise<TripDailyTipProviderResult> {
      if (!apiKey || !baseUrl || !model) {
        return { errorCode: 'provider_unavailable', message: 'AI provider environment is not fully configured.', ok: false }
      }
      const response = await requestOpenAiCompatibleTripDailyTip({
        apiKey,
        endpoint: joinUrl(baseUrl, CHAT_COMPLETIONS_PATH),
        fetchImpl,
        maxTokens: input.maxOutputTokens,
        messages: [{ content: input.prompt, role: 'system' }],
        model,
        reasoningMode: input.reasoningMode,
      })
      if (!response.ok) {
        return response
      }
      const normalized = normalizeTripDailyTipProviderOutput(response.rawText, request)
      if (!normalized.ok) {
        return normalized
      }
      return {
        ok: true,
        sections: normalized.sections,
        source: 'future_ai',
        sourceIds: normalized.sourceIds,
        summary: normalized.summary,
        warnings: normalized.warnings,
      }
    },
  }
}

export function normalizeTripDailyTipProviderOutput(
  rawText: string,
  request: ProviderProxyTripDailyTipRequest,
): { ok: true; sections: ProviderProxyTripDailyTipSectionResult[]; sourceIds: string[]; summary: string; warnings?: string[] } | { errorCode: 'invalid_response'; ok: false } {
  const parsed = extractJsonFromAiText(rawText)
  const record = readRecord(parsed)
  const summary = typeof record.summary === 'string' ? record.summary.trim().slice(0, 700) : ''
  if (!summary) {
    return { errorCode: 'invalid_response', ok: false }
  }
  const validSourceIds = new Set(request.sources.map((source) => source.id))
  const sections: ProviderProxyTripDailyTipSectionResult[] = []
  if (Array.isArray(record.sections)) {
    for (const rawSection of record.sections) {
      const section = normalizeSection(rawSection, validSourceIds)
      if (!section) {
        return { errorCode: 'invalid_response', ok: false }
      }
      sections.push(section)
    }
  }
  const sourceIds = normalizeSourceIds(record.sourceIds, validSourceIds)
  if (!sourceIds.length || sections.some((section) => section.sourceIds.some((sourceId) => !sourceIds.includes(sourceId)))) {
    return { errorCode: 'invalid_response', ok: false }
  }
  return {
    ok: true,
    sections,
    sourceIds,
    summary,
    warnings: Array.isArray(record.warnings) ? record.warnings.filter((warning): warning is string => typeof warning === 'string').slice(0, 5) : undefined,
  }
}

function normalizeSection(input: unknown, validSourceIds: Set<string>): ProviderProxyTripDailyTipSectionResult | null {
  const record = readRecord(input)
  const key = record.key
  if (key !== 'opening_hours' && key !== 'ticket_price' && key !== 'notices' && key !== 'route_risk') {
    return null
  }
  const title = typeof record.title === 'string' ? record.title.trim().slice(0, 80) : ''
  const text = typeof record.text === 'string' ? record.text.trim().slice(0, 700) : ''
  const sourceIds = normalizeSourceIds(record.sourceIds, validSourceIds)
  if (!title || !text || sourceIds.length === 0) {
    return null
  }
  return { key, sourceIds, text, title }
}

function normalizeSourceIds(input: unknown, validSourceIds: Set<string>) {
  if (!Array.isArray(input)) {
    return []
  }
  const seen = new Set<string>()
  return input.filter((value): value is string => {
    if (typeof value !== 'string' || !validSourceIds.has(value) || seen.has(value)) {
      return false
    }
    seen.add(value)
    return true
  })
}

function compactRequest(request: ProviderProxyTripDailyTipRequest) {
  return {
    dayTitle: request.dayTitle,
    destination: request.destination,
    items: request.items,
    localSections: request.localSections,
    mode: request.mode,
    routeStatus: request.routeStatus,
    sources: request.sources.map((source) => ({
      confidence: source.confidence,
      displayUrl: source.displayUrl,
      id: source.id,
      label: source.label,
      retrievedAt: source.retrievedAt,
      snippet: source.snippet,
      sourceType: source.sourceType,
      title: source.title,
    })),
    targetDate: request.targetDate,
    tripTitle: request.tripTitle,
  }
}

async function requestOpenAiCompatibleTripDailyTip({
  apiKey,
  endpoint,
  fetchImpl,
  maxTokens,
  messages,
  model,
  reasoningMode,
}: {
  apiKey: string
  endpoint: string
  fetchImpl: typeof fetch
  maxTokens: number
  messages: OpenAiCompatibleMessage[]
  model: string
  reasoningMode?: AiBackendReasoningMode
}): Promise<{ ok: true; rawText: string } | { errorCode: TripDailyTipProviderErrorCode; ok: false }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetchImpl(endpoint, {
      body: JSON.stringify({
        max_tokens: maxTokens,
        messages,
        model,
        response_format: OPENAI_COMPATIBLE_JSON_RESPONSE_FORMAT,
        temperature: 0.2,
        ...(reasoningMode && reasoningMode !== 'auto'
          ? { thinking: reasoningMode === 'off' ? OPENAI_COMPATIBLE_THINKING_DISABLED : OPENAI_COMPATIBLE_THINKING_ENABLED }
          : {}),
      }),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: controller.signal,
    })
    if (!response.ok) {
      return { errorCode: response.status === 401 || response.status === 403 ? 'provider_unavailable' : response.status === 429 ? 'provider_error' : 'provider_error', ok: false }
    }
    const body = readRecord(await response.json())
    const choices = Array.isArray(body.choices) ? body.choices : []
    const first = readRecord(choices[0])
    const message = readRecord(first.message)
    const content = typeof message.content === 'string' ? message.content : ''
    return content ? { ok: true, rawText: content } : { errorCode: 'invalid_response', ok: false }
  } catch {
    return { errorCode: 'network_error', ok: false }
  } finally {
    clearTimeout(timeout)
  }
}

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

function readRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? input as Record<string, unknown> : {}
}
