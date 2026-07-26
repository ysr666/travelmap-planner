import {
  PROVIDER_PROXY_AI_ACTION_PLAN_OPERATION,
  type ProviderProxyAiActionPlanRequest,
  type ProviderProxyAiActionPlanSuccessResponse,
} from '../../src/lib/ai/providerProxyContract'
import { AI_ACTION_PLAN_SCHEMA_VERSION } from '../../src/lib/ai/actionGateway/types'
import { validateAiActionPlan } from '../../src/lib/ai/actionGateway/validation'

export type AiActionPlanProviderErrorCode =
  | 'invalid_response'
  | 'network_error'
  | 'provider_error'
  | 'provider_unavailable'
  | 'unsupported'

export type AiActionPlanProviderResult =
  | { kind: 'plan'; ok: true; response: ProviderProxyAiActionPlanSuccessResponse }
  | { kind: 'raw'; ok: true; rawText: string }
  | { errorCode: AiActionPlanProviderErrorCode; message?: string; ok: false }

export type AiActionPlanProvider = {
  readonly name: string
  plan(input: AiActionPlanProviderInput): Promise<AiActionPlanProviderResult>
}

export type AiActionPlanProviderInput = {
  maxOutputTokens: number
  prompt: string
}

type OpenAiCompatibleEnv = {
  TRIPMAP_AI_API_KEY?: string
  TRIPMAP_AI_BASE_URL?: string
  TRIPMAP_AI_MODEL?: string
}

const REQUEST_TIMEOUT_MS = 45_000
const CHAT_COMPLETIONS_PATH = '/chat/completions'
const OPENAI_COMPATIBLE_JSON_RESPONSE_FORMAT = { type: 'json_object' } as const

export function buildAiActionPlanProviderInput(
  request: ProviderProxyAiActionPlanRequest,
): AiActionPlanProviderInput {
  return {
    maxOutputTokens: 900,
    prompt: [
      '你是 TripMap 的旅行动作规划器，只负责把用户指令映射到已登记动作。',
      '只能选择 availableActions 中的 id；不得输出数据库写入、URL、路由、函数名、Provider 名称或任何未登记动作。',
      '只使用脱敏摘要判断语义目标。不得索取或输出票据文件、Blob、Token、完整数据库、证件号或密钥。',
      '最多 6 个步骤。id 使用短英文标识；dependsOn 只能引用同计划中的步骤 id。',
      '每个动作的 args 只能使用 availableActions.input 明确列出的语义字段；不得添加 ID、patch、状态、路由或函数。',
      'item.move@1 只能使用语义行程点、来源/目标日期和固定 first/last/before/after；目标日期或参照点不明确时不要猜测。',
      'target 优先使用 current_item、first_item，或上下文中唯一且明确的行程点名称。目标不明确时不要猜测具体名称。',
      'place.enrich@1 与 trip.repair@1 不得出现在同一计划中。',
      '输出必须是 JSON，不要 Markdown、代码块或解释。',
      `schema: {"schemaVersion":"${AI_ACTION_PLAN_SCHEMA_VERSION}","summary":"一句中文摘要","steps":[{"id":"step-id","actionId":"registered.action@1","args":{},"dependsOn":[]}]}`,
      `用户指令：${request.command}`,
      `脱敏上下文：${JSON.stringify(request.context)}`,
      `availableActions：${JSON.stringify(request.availableActions)}`,
    ].join('\n'),
  }
}

export function createMockAiActionPlanProvider(
  request: ProviderProxyAiActionPlanRequest,
): AiActionPlanProvider {
  return {
    name: 'mock',
    async plan() {
      const mockPlan = buildMockPlan(request)
      if (!mockPlan) {
        return {
          errorCode: 'invalid_response',
          message: 'Mock action planner could not resolve an unambiguous registered action.',
          ok: false,
        }
      }
      const validation = validateAiActionPlan(mockPlan)
      if (!validation.ok) {
        return { errorCode: 'invalid_response', message: 'Mock action planner produced an invalid plan.', ok: false }
      }
      return {
        kind: 'plan',
        ok: true,
        response: {
          ok: true,
          operation: PROVIDER_PROXY_AI_ACTION_PLAN_OPERATION,
          plan: validation.plan,
          requestId: request.requestId,
          source: 'mock',
        },
      }
    },
  }
}

export function createUnavailableAiActionPlanProvider(): AiActionPlanProvider {
  return {
    name: 'unavailable',
    async plan() {
      return { errorCode: 'provider_unavailable', message: 'AI action planner is not configured.', ok: false }
    },
  }
}

export function createDisabledAiActionPlanProvider(): AiActionPlanProvider {
  return {
    name: 'disabled',
    async plan() {
      return { errorCode: 'unsupported', message: 'AI action planner is disabled.', ok: false }
    },
  }
}

export function createOpenAiCompatibleAiActionPlanProvider(
  env: OpenAiCompatibleEnv,
  fetchImpl: typeof fetch = fetch,
): AiActionPlanProvider {
  const apiKey = env.TRIPMAP_AI_API_KEY?.trim()
  const baseUrl = env.TRIPMAP_AI_BASE_URL?.trim()
  const model = env.TRIPMAP_AI_MODEL?.trim()

  return {
    name: 'openai_compatible',
    async plan(input): Promise<AiActionPlanProviderResult> {
      if (!apiKey || !baseUrl || !model) {
        return { errorCode: 'provider_unavailable', message: 'AI provider environment is not fully configured.', ok: false }
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
          return { errorCode: 'provider_error', message: 'AI provider returned an error.', ok: false }
        }
        const data = await readJson(response)
        const rawText = extractContent(data)
        if (!rawText) {
          return { errorCode: 'provider_error', message: 'AI provider returned empty content.', ok: false }
        }
        return { kind: 'raw', ok: true, rawText }
      } catch (caught) {
        if (caught instanceof Error && caught.name === 'AbortError') {
          return { errorCode: 'network_error', message: 'AI provider request timed out.', ok: false }
        }
        return { errorCode: 'network_error', message: 'AI provider request failed.', ok: false }
      } finally {
        clearTimeout(timeoutId)
      }
    },
  }
}

function buildMockPlan(request: ProviderProxyAiActionPlanRequest) {
  const command = request.command
  const allowed = new Set(request.availableActions.map((action) => action.id))
  const steps: Array<Record<string, unknown>> = []
  const ticketRequested = /票据|门票|车票|机票|预订/.test(command) && allowed.has('ticket.open@1')
  const repairRequested = /全部|所有|一键|统一|缺失|修复|整理/.test(command) && allowed.has('trip.repair@1')
  const placeRequested = /地点|地址|坐标|位置/.test(command) && allowed.has('place.enrich@1')

  if (ticketRequested) {
    const ticketQuery = extractQuotedTarget(command) ?? extractTicketQuery(command)
    steps.push({
      actionId: 'ticket.open@1',
      args: ticketQuery ? { query: ticketQuery } : {},
      dependsOn: [],
      id: 'open-ticket',
    })
  }
  if (repairRequested) {
    steps.push({
      actionId: 'trip.repair@1',
      args: { scope: inferRepairScope(command) },
      dependsOn: [],
      id: 'repair-trip',
    })
  } else if (placeRequested) {
    steps.push({
      actionId: 'place.enrich@1',
      args: { target: inferPlaceTarget(command) },
      dependsOn: [],
      id: 'enrich-place',
    })
  }
  if (steps.length === 0) {
    return null
  }

  return {
    schemaVersion: AI_ACTION_PLAN_SCHEMA_VERSION,
    steps,
    summary: summarizeMockSteps(steps),
  }
}

function inferRepairScope(command: string): 'day' | 'item' | 'trip' {
  if (/今天|当天|这一日|这一天/.test(command)) return 'day'
  if (/当前站|这一站|这个地点|当前地点/.test(command)) return 'item'
  return 'trip'
}

function inferPlaceTarget(command: string) {
  if (/第一站|首站|第一个地点/.test(command)) return 'first_item'
  if (/当前站|这一站|这个地点|当前地点/.test(command)) return 'current_item'
  return extractQuotedTarget(command) ?? 'current_item'
}

function extractQuotedTarget(command: string) {
  return command.match(/[「“"]([^」”"]{1,80})[」”"]/)?.[1]?.trim()
}

function extractTicketQuery(command: string) {
  const match = command.match(/(?:找|打开|查)(?:一下)?(.{1,40}?)(?:的)?(?:门票|票据|车票|机票|预订)/)
  return match?.[1]?.trim()
}

function summarizeMockSteps(steps: Array<Record<string, unknown>>) {
  const ids = new Set(steps.map((step) => step.actionId))
  return [
    ids.has('ticket.open@1') ? '打开票据' : '',
    ids.has('place.enrich@1') ? '补全地点' : '',
    ids.has('trip.repair@1') ? '智能修复行程' : '',
  ].filter(Boolean).join('并')
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
  const message = firstRecord.message && typeof firstRecord.message === 'object'
    ? firstRecord.message as Record<string, unknown>
    : {}
  return typeof message.content === 'string' ? message.content.trim() : ''
}
