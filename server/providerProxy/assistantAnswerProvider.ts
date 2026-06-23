import type {
  ProviderProxyAssistantAnswerRequest,
  ProviderProxyAssistantAnswerSuccessResponse,
} from '../../src/lib/ai/providerProxyContract'

export type AssistantAnswerProviderErrorCode =
  | 'provider_unavailable'
  | 'quota_exceeded'
  | 'provider_error'
  | 'network_error'
  | 'unsupported'

export type AssistantAnswerProviderResult =
  | { ok: true; kind: 'answer'; response: ProviderProxyAssistantAnswerSuccessResponse }
  | { ok: true; kind: 'raw'; rawText: string }
  | { ok: false; errorCode: AssistantAnswerProviderErrorCode; message?: string }

export type AssistantAnswerProvider = {
  readonly name: string
  answer(input: AssistantAnswerProviderInput): Promise<AssistantAnswerProviderResult>
}

export type AssistantAnswerProviderInput = {
  prompt: string
  maxOutputTokens: number
}

type OpenAiCompatibleEnv = {
  TRIPMAP_AI_API_KEY?: string
  TRIPMAP_AI_BASE_URL?: string
  TRIPMAP_AI_MODEL?: string
}

const REQUEST_TIMEOUT_MS = 45_000
const CHAT_COMPLETIONS_PATH = '/chat/completions'
const OPENAI_COMPATIBLE_JSON_RESPONSE_FORMAT = { type: 'json_object' } as const

export function buildAssistantAnswerProviderInput(
  request: ProviderProxyAssistantAnswerRequest,
): AssistantAnswerProviderInput {
  return {
    maxOutputTokens: 900,
    prompt: [
      '你是 TripMap 的只读旅行助手。',
      '只能基于用户问题和已脱敏上下文回答；不要声称读取了完整数据库、票据文件、证件明文、实时网页、地图或云端 payload。',
      '不要提出任何会直接写入本地数据的动作；需要修改时只建议用户进入预览和确认流程。',
      '如果上下文不足，请明确说明限制并给出下一步。',
      '输出必须是 JSON，不要 Markdown、不要代码块。',
      'schema: {"answer":"中文短回答","caveats":["限制"],"sourceCards":[{"id":"...","kind":"local_context|trip_intelligence|provider_caveat|confirmed_search_source","title":"...","detail":"..."}]}',
      `上下文标签：${request.context.scopeLabel}`,
      `用户问题：${request.question}`,
      `脱敏上下文：${JSON.stringify(request.context)}`,
    ].join('\n'),
  }
}

export function createMockAssistantAnswerProvider(request: ProviderProxyAssistantAnswerRequest): AssistantAnswerProvider {
  return {
    name: 'mock',
    async answer() {
      const summaries = request.context.summaries.slice(0, 4)
      const summaryText = summaries.length > 0
        ? summaries.map((summary) => `${summary.label}：${summary.value}`).join('；')
        : '当前没有足够的本地摘要。'
      return {
        kind: 'answer',
        ok: true,
        response: {
          answer: `我会基于「${request.context.scopeLabel}」的脱敏摘要回答。${summaryText}`,
          caveats: ['这是只读回答；需要修改行程或费用时仍会进入预览和确认。'],
          ok: true,
          operation: 'assistant_answer',
          requestId: request.requestId,
          source: 'mock',
          sourceCards: request.context.sourceCards.slice(0, 4),
        },
      }
    },
  }
}

export function createUnavailableAssistantAnswerProvider(): AssistantAnswerProvider {
  return {
    name: 'unavailable',
    async answer() {
      return { ok: false, errorCode: 'provider_unavailable', message: 'Assistant answer provider is not configured.' }
    },
  }
}

export function createDisabledAssistantAnswerProvider(): AssistantAnswerProvider {
  return {
    name: 'disabled',
    async answer() {
      return { ok: false, errorCode: 'unsupported', message: 'Assistant answer provider is disabled.' }
    },
  }
}

export function createOpenAiCompatibleAssistantAnswerProvider(
  env: OpenAiCompatibleEnv,
  fetchImpl: typeof fetch = fetch,
): AssistantAnswerProvider {
  const apiKey = env.TRIPMAP_AI_API_KEY?.trim()
  const baseUrl = env.TRIPMAP_AI_BASE_URL?.trim()
  const model = env.TRIPMAP_AI_MODEL?.trim()

  return {
    name: 'openai_compatible',
    async answer(input): Promise<AssistantAnswerProviderResult> {
      if (!apiKey || !baseUrl || !model) {
        return { ok: false, errorCode: 'provider_unavailable', message: 'AI provider environment is not fully configured.' }
      }
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      try {
        const response = await fetchImpl(joinUrl(baseUrl, CHAT_COMPLETIONS_PATH), {
          body: JSON.stringify({
            max_tokens: input.maxOutputTokens,
            messages: [{ content: input.prompt, role: 'system' }],
            model,
            response_format: OPENAI_COMPATIBLE_JSON_RESPONSE_FORMAT,
          }),
          headers: {
            Authorization: `Bearer ${apiKey}`,
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
        return { kind: 'raw', ok: true, rawText }
      } catch (caught) {
        if (caught instanceof Error && caught.name === 'AbortError') {
          return { ok: false, errorCode: 'network_error', message: 'AI provider request timed out.' }
        }
        return { ok: false, errorCode: 'network_error', message: 'AI provider request failed.' }
      } finally {
        clearTimeout(timeoutId)
      }
    },
  }
}

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function extractContent(data: unknown) {
  const record = data && typeof data === 'object' ? data as Record<string, unknown> : {}
  const choices = Array.isArray(record.choices) ? record.choices : []
  const first = choices[0]
  const firstRecord = first && typeof first === 'object' ? first as Record<string, unknown> : {}
  const message = firstRecord.message && typeof firstRecord.message === 'object' ? firstRecord.message as Record<string, unknown> : {}
  return typeof message.content === 'string' ? message.content.trim() : ''
}
