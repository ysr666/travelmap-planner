import type { AiTripEditPatchPlan } from '../../src/lib/aiTripEditPatch'
import { validateAiTripEditPatchPlan } from '../../src/lib/aiTripEditPatch'
import type { ProviderProxyAiTripEditPlanRequest } from '../../src/lib/providerProxyContract'
import type { AiBackendReasoningMode } from './aiReasoningPolicy'
import { commandNeedsRealtimeSearch, type AiTripEditProviderInput } from './aiTripEditPrompt'

export type AiTripEditProviderErrorCode =
  | 'provider_unavailable'
  | 'quota_exceeded'
  | 'provider_error'
  | 'network_error'
  | 'unsupported'

export type AiTripEditProviderResult =
  | { ok: true; kind: 'raw'; rawText: string }
  | { ok: true; kind: 'patch'; patchPlan: AiTripEditPatchPlan; source: 'mock'; warnings?: string[] }
  | { ok: false; errorCode: AiTripEditProviderErrorCode; message?: string }

export type AiTripEditProvider = {
  readonly name: string
  planEdit(input: AiTripEditProviderInput): Promise<AiTripEditProviderResult>
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
const REALTIME_WARNING = '联网搜索暂未接入，未查询实时信息。'

export function createMockAiTripEditProvider(request: ProviderProxyAiTripEditPlanRequest): AiTripEditProvider {
  return {
    name: 'mock',
    async planEdit() {
      const patchPlan = buildMockPatchPlan(request)
      const validation = validateAiTripEditPatchPlan(patchPlan, request.context)
      if (!validation.ok) {
        return { ok: false, errorCode: 'provider_error', message: 'Mock edit provider produced invalid patch plan.' }
      }
      return {
        kind: 'patch',
        ok: true,
        patchPlan: validation.plan,
        source: 'mock',
        warnings: ['当前为本地示例修改方案，非真实 AI 生成。', ...(validation.plan.warnings ?? [])],
      }
    },
  }
}

export function createUnavailableAiTripEditProvider(): AiTripEditProvider {
  return {
    name: 'unavailable',
    async planEdit() {
      return { ok: false, errorCode: 'provider_unavailable', message: 'AI trip edit provider is not configured.' }
    },
  }
}

export function createDisabledAiTripEditProvider(): AiTripEditProvider {
  return {
    name: 'disabled',
    async planEdit() {
      return { ok: false, errorCode: 'unsupported', message: 'AI trip edit provider is disabled.' }
    },
  }
}

export function createOpenAiCompatibleAiTripEditProvider(
  env: OpenAiCompatibleEnv,
  fetchImpl: typeof fetch = fetch,
): AiTripEditProvider {
  const apiKey = env.TRIPMAP_AI_API_KEY?.trim()
  const baseUrl = env.TRIPMAP_AI_BASE_URL?.trim()
  const model = env.TRIPMAP_AI_MODEL?.trim()

  return {
    name: 'openai_compatible',
    async planEdit(input): Promise<AiTripEditProviderResult> {
      if (!apiKey || !baseUrl || !model) {
        return { ok: false, errorCode: 'provider_unavailable', message: 'AI provider environment is not fully configured.' }
      }

      return requestOpenAiCompatibleTripEditPlan({
        apiKey,
        endpoint: joinUrl(baseUrl, CHAT_COMPLETIONS_PATH),
        fetchImpl,
        maxTokens: input.maxOutputTokens,
        messages: [{ role: 'system', content: input.prompt }],
        model,
        reasoningMode: input.reasoningMode,
      })
    },
  }
}

function buildMockPatchPlan(request: ProviderProxyAiTripEditPlanRequest): AiTripEditPatchPlan {
  const firstDay = request.context.days[0]
  const allItems = request.context.days.flatMap((day) => day.items)
  const command = request.command
  const warnings = commandNeedsRealtimeSearch(command) ? [REALTIME_WARNING] : []

  if (command.includes('删除')) {
    const matched = allItems.find((item) => command.includes(item.title) && !item.hasTicketBindings)
      ?? allItems.find((item) => !item.hasTicketBindings)
    if (matched) {
      return {
        operations: [{ itemId: matched.id, reason: '根据指令移除一个可安全删除的项目。', type: 'delete_item' }],
        summary: '生成一个删除项目的修改建议。',
        warnings,
      }
    }
  }

  if (command.includes('放松') || command.includes('太满')) {
    const lastFlexibleItem = [...allItems].reverse().find((item) => !item.hasTicketBindings)
    if (lastFlexibleItem && allItems.length > 1) {
      return {
        operations: [{ itemId: lastFlexibleItem.id, reason: '减少当天安排密度。', type: 'delete_item' }],
        summary: '删除一个非票据绑定项目，让行程更松弛。',
        warnings,
      }
    }
  }

  return {
    operations: [{
      item: {
        endTime: '16:00',
        startTime: '15:30',
        title: '咖啡休息',
      },
      reason: '增加一个轻量休息节点。',
      targetDayId: firstDay.id,
      type: 'add_item',
    }],
    summary: '新增一个休息安排，作为安全的示例修改。',
    warnings,
  }
}

async function requestOpenAiCompatibleTripEditPlan({
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
}): Promise<AiTripEditProviderResult> {
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

    return { kind: 'raw', ok: true, rawText }
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
  reasoningMode: AiBackendReasoningMode
}): Record<string, unknown> {
  if (reasoningMode === 'high') {
    return {
      max_tokens: maxTokens,
      messages,
      model,
      reasoning_effort: 'high',
      response_format: OPENAI_COMPATIBLE_JSON_RESPONSE_FORMAT,
      thinking: OPENAI_COMPATIBLE_THINKING_ENABLED,
    }
  }

  return {
    max_tokens: maxTokens,
    messages,
    model,
    response_format: OPENAI_COMPATIBLE_JSON_RESPONSE_FORMAT,
    temperature: 0.2,
    thinking: OPENAI_COMPATIBLE_THINKING_DISABLED,
  }
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + path
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

function extractContent(data: Record<string, unknown>): string | null {
  const choices = data.choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const choice = choices[0] as Record<string, unknown>
  const message = choice?.message as Record<string, unknown> | undefined
  const content = message?.content
  return typeof content === 'string' && content.trim() ? content : null
}
