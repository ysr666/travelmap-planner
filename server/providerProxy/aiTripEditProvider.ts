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
  const targetDay = selectRequestedDay(request) ?? request.context.days[0]
  const allItems = request.context.days.flatMap((day) => day.items)
  const command = request.command
  const warnings = commandNeedsRealtimeSearch(command) ? [REALTIME_WARNING] : []

  if (mentionsMissingAddress(command)) {
    const missingAddressItems = allItems.filter((item) => !item.address)
    if (missingAddressItems.length > 0) {
      return {
        operations: missingAddressItems.slice(0, 3).map((item) => ({
          itemId: item.id,
          note: '缺少地址，请补充。',
          reason: '按指令标记缺少地址的行程项。',
          type: 'update_item_note',
        })),
        summary: '标记缺少地址的行程项。',
        warnings,
      }
    }
  }

  if (mentionsShoppingAvoidance(command)) {
    const shoppingItem = allItems.find((item) => isShoppingLike(item.title))
    if (shoppingItem) {
      if (isTicketBound(shoppingItem)) {
        return {
          operations: [{
            itemId: shoppingItem.id,
            reason: '购物项目绑定票据，不直接移除，改为更轻松的安排。',
            title: '轻松散步',
            type: 'update_item_title',
          }],
          summary: '将购物安排改为轻松活动。',
          warnings,
        }
      }
      return {
        operations: [{
          itemId: shoppingItem.id,
          reason: '按指令移除购物类项目。',
          type: 'remove_item',
        }],
        summary: '移除一个购物类项目。',
        warnings,
      }
    }
  }

  if (mentionsCoffeeBreak(command)) {
    return {
      operations: [{
        item: {
          endTime: '16:00',
          startTime: '15:30',
          title: command.includes('咖啡') ? '咖啡休息' : '休息',
        },
        reason: '增加一个轻量休息节点。',
        targetDayId: targetDay.id,
        type: 'add_item',
      }],
      summary: '新增一个休息安排。',
      warnings,
    }
  }

  if (command.includes('删除')) {
    const matched = allItems.find((item) => command.includes(item.title) && !isTicketBound(item))
      ?? allItems.find((item) => !isTicketBound(item))
    if (matched) {
      return {
        operations: [{ itemId: matched.id, reason: '根据指令移除一个可安全删除的项目。', type: 'remove_item' }],
        summary: '生成一个删除项目的修改建议。',
        warnings,
      }
    }
  }

  if (command.includes('放松') || command.includes('太满')) {
    const targetDayItems = targetDay.items.length > 0 ? targetDay.items : allItems
    const lastFlexibleItem = [...targetDayItems].reverse().find((item) => !isTicketBound(item))
    if (lastFlexibleItem && allItems.length > 1) {
      return {
        operations: [{ itemId: lastFlexibleItem.id, reason: '减少当天安排密度。', type: 'remove_item' }],
        summary: '删除一个非票据绑定项目，让行程更松弛。',
        warnings,
      }
    }
  }

  return {
    operations: [],
    summary: '未生成可写入修改。',
    warnings: [...warnings, '暂未识别可安全自动转换的修改，请换一种更具体的说法。'],
  }
}

function selectRequestedDay(request: ProviderProxyAiTripEditPlanRequest) {
  const command = request.command
  const dayNumber = parseChineseDayNumber(command) ?? parseArabicDayNumber(command)
  if (dayNumber !== null) {
    return request.context.days[dayNumber - 1]
  }
  return undefined
}

function parseChineseDayNumber(command: string): number | null {
  const match = command.match(/第([一二三四五六七八九十])天/)
  if (!match) return null
  const value = match[1]
  const map: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  }
  return map[value] ?? null
}

function parseArabicDayNumber(command: string): number | null {
  const match = command.match(/\bday\s*(\d{1,2})\b/i) ?? command.match(/第(\d{1,2})天/)
  if (!match) return null
  const value = Number(match[1])
  return Number.isInteger(value) && value > 0 ? value : null
}

function mentionsCoffeeBreak(command: string) {
  return /咖啡|休息|coffee|break|rest/i.test(command)
}

function mentionsMissingAddress(command: string) {
  return /没有地址|缺少地址|missing address|without address/i.test(command)
}

function mentionsShoppingAvoidance(command: string) {
  return /不要购物|别购物|不购物|no shopping|avoid shopping/i.test(command)
}

function isShoppingLike(title: string) {
  return /购物|商场|商城|shopping|mall|outlet|market/i.test(title)
}

function isTicketBound(item: { hasTicketBindings?: boolean; ticketBoundState?: string; ticketCount?: number }) {
  return item.hasTicketBindings || item.ticketBoundState === 'item_bound' || (item.ticketCount ?? 0) > 0
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
