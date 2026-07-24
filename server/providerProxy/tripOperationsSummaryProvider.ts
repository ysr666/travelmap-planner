import {
  type ProviderProxyErrorCode,
  type ProviderProxyTripOperationsSummaryRequest,
  type ProviderProxyTripOperationsSummarySuccessResponse,
} from '../../src/lib/ai/providerProxyContract'
import { extractJsonFromAiText } from './aiJson'
import type { AiBackendReasoningMode } from './aiReasoningPolicy'

export type TripOperationsSummaryProviderErrorCode = Extract<ProviderProxyErrorCode, 'provider_unavailable' | 'provider_error' | 'network_error' | 'unsupported' | 'invalid_response'>

export type TripOperationsSummaryProviderResult =
  | { ok: true; response: Omit<ProviderProxyTripOperationsSummarySuccessResponse, 'ok' | 'operation' | 'requestId'> }
  | { errorCode: TripOperationsSummaryProviderErrorCode; message?: string; ok: false }

export type TripOperationsSummaryProvider = {
  readonly name: string
  summarize(request: ProviderProxyTripOperationsSummaryRequest, input: TripOperationsSummaryProviderInput): Promise<TripOperationsSummaryProviderResult>
}

export type TripOperationsSummaryProviderInput = {
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

export function buildTripOperationsSummaryProviderInput(
  request: ProviderProxyTripOperationsSummaryRequest,
  requestId?: string,
): TripOperationsSummaryProviderInput {
  return {
    maxOutputTokens: 700,
    prompt: [
      '你是 TripMap 的旅行执行建议摘要助手，只输出 JSON。',
      '你只能基于下方 sanitized recommendations 总结当前最该做什么。',
      '不要编造行程事实，不要输出任何写入、同步、清理、路线或票据操作。',
      '输出中文，短句，适合显示在移动端一屏内。',
      '输出 schema：{"summary":"...","highlights":["..."],"warnings":["..."]}',
      `requestId: ${requestId ?? request.requestId ?? 'unknown'}`,
      `request: ${JSON.stringify(compactRequest(request))}`,
    ].join('\n'),
    reasoningMode: 'off',
  }
}

export function createMockTripOperationsSummaryProvider(): TripOperationsSummaryProvider {
  return {
    name: 'mock',
    async summarize(request) {
      const first = request.recommendations[0]
      return {
        ok: true,
        response: {
          highlights: request.recommendations.slice(0, 3).map((recommendation) => `${severityLabel(recommendation.severity)}：${recommendation.title}`),
          source: 'mock',
          summary: first
            ? `${phaseLabel(request.phase)}先处理「${first.title}」，再检查其余 ${Math.max(0, request.recommendations.length - 1)} 项建议。`
            : `${phaseLabel(request.phase)}暂无需要摘要的建议。`,
          warnings: ['当前为本地示例执行摘要，非真实 AI 生成。'],
        },
      }
    },
  }
}

export function createUnavailableTripOperationsSummaryProvider(): TripOperationsSummaryProvider {
  return {
    name: 'unavailable',
    async summarize() {
      return { errorCode: 'provider_unavailable', message: 'Trip operations summary provider is not configured.', ok: false }
    },
  }
}

export function createDisabledTripOperationsSummaryProvider(): TripOperationsSummaryProvider {
  return {
    name: 'disabled',
    async summarize() {
      return { errorCode: 'unsupported', message: 'Trip operations summary provider is disabled.', ok: false }
    },
  }
}

export function createOpenAiCompatibleTripOperationsSummaryProvider(
  env: OpenAiCompatibleEnv,
  fetchImpl: typeof fetch = fetch,
): TripOperationsSummaryProvider {
  const apiKey = env.TRIPMAP_AI_API_KEY?.trim()
  const baseUrl = env.TRIPMAP_AI_BASE_URL?.trim()
  const model = env.TRIPMAP_AI_MODEL?.trim()

  return {
    name: 'openai_compatible',
    async summarize(_request, input): Promise<TripOperationsSummaryProviderResult> {
      if (!apiKey || !baseUrl || !model) {
        return { errorCode: 'provider_unavailable', message: 'AI provider environment is not fully configured.', ok: false }
      }
      const response = await requestOpenAiCompatibleSummary({
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
      const normalized = normalizeTripOperationsSummaryProviderOutput(response.rawText)
      if (!normalized.ok) {
        return normalized
      }
      return {
        ok: true,
        response: {
          highlights: normalized.highlights,
          source: 'future_ai',
          summary: normalized.summary,
          warnings: normalized.warnings,
        },
      }
    },
  }
}

export function normalizeTripOperationsSummaryProviderOutput(
  rawText: string,
): { highlights: string[]; ok: true; summary: string; warnings?: string[] } | { errorCode: 'invalid_response'; ok: false } {
  const parsed = extractJsonFromAiText(rawText)
  const record = readRecord(parsed)
  const summary = typeof record.summary === 'string' ? record.summary.trim().slice(0, 700) : ''
  if (!summary) {
    return { errorCode: 'invalid_response', ok: false }
  }
  const highlights = Array.isArray(record.highlights)
    ? record.highlights
      .filter((highlight): highlight is string => typeof highlight === 'string' && highlight.trim().length > 0)
      .map((highlight) => highlight.trim().slice(0, 180))
      .slice(0, 5)
    : []
  return {
    highlights,
    ok: true,
    summary,
    warnings: Array.isArray(record.warnings) ? record.warnings.filter((warning): warning is string => typeof warning === 'string').slice(0, 5) : undefined,
  }
}

async function requestOpenAiCompatibleSummary({
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
}): Promise<{ ok: true; rawText: string } | { errorCode: TripOperationsSummaryProviderErrorCode; ok: false }> {
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
      return { errorCode: response.status === 401 || response.status === 403 ? 'provider_unavailable' : 'provider_error', ok: false }
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

function compactRequest(request: ProviderProxyTripOperationsSummaryRequest) {
  return {
    destination: request.destination,
    phase: request.phase,
    recommendations: request.recommendations,
    tripTitle: request.tripTitle,
  }
}

function phaseLabel(phase: ProviderProxyTripOperationsSummaryRequest['phase']) {
  if (phase === 'pre_trip') return '出发前'
  if (phase === 'travel_morning') return '当天早晨'
  if (phase === 'travel_evening') return '当天晚上'
  if (phase === 'post_trip') return '旅行结束后'
  return '旅行中'
}

function severityLabel(severity: string) {
  if (severity === 'high') return '高风险'
  if (severity === 'medium') return '建议'
  return '低风险'
}

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

function readRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? input as Record<string, unknown> : {}
}
