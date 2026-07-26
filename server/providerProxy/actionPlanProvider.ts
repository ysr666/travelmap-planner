import {
  PROVIDER_PROXY_AI_ACTION_PLAN_OPERATION,
  type ProviderProxyAiActionPlanRequest,
  type ProviderProxyAiActionPlanSuccessResponse,
} from '../../src/lib/ai/providerProxyContract'
import { AI_ACTION_PLAN_SCHEMA_VERSION } from '../../src/lib/ai/actionGateway/types'
import { buildDeterministicAiActionPlan } from '../../src/lib/ai/actionGateway/planner'
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
      'item.delete@1 只删除一个明确的语义行程点；不得选择票据、订单、账本、旅行或任何永久删除目标，也不得与其他结构写入组合。',
      'history.undo@1 的 kind 只能是 item_delete；不得输出记录 ID、快照、指纹、状态或数据库字段，也不得与其他写入组合。',
      'item.execution.update@1 只能选择 completed、skipped 或 active；不得根据时间、位置或猜测自动改变进度。',
      'item.replan.preference.update@1 只能输出登记的偏好枚举与有界分钟数；不得输出 patch、内部字段或自由文本。',
      'trip.replan.apply@1 只处理用户明确报告的 late、delay、closure、cancelled 或 weather_unsuitable；问题、假设和否定表达不得生成写入动作。',
      'trip.replan.apply@1 只能输出语义目标、固定策略和 1-240 分钟延误；不得输出事件 ID、记录 ID、证据、备注、时间戳、快照、patch、路线、函数或 Provider。',
      '行程进度、重排偏好或突发重排动作必须与其他写入动作分开。',
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
  const deterministic = buildDeterministicAiActionPlan(command)
  const deterministicReplan = deterministic?.steps.length === 1
    && deterministic.steps[0].actionId === 'trip.replan.apply@1'
    && allowed.has('trip.replan.apply@1')
    ? deterministic.steps[0]
    : null
  if (deterministicReplan) {
    return {
      schemaVersion: AI_ACTION_PLAN_SCHEMA_VERSION,
      steps: [{
        actionId: deterministicReplan.actionId,
        args: deterministicReplan.args,
        dependsOn: [],
        id: 'apply-adaptive-replan',
      }],
      summary: '应用突发重排',
    }
  }
  const steps: Array<Record<string, unknown>> = []
  const ticketRequested = /票据|门票|车票|机票|预订/.test(command) && allowed.has('ticket.open@1')
  const repairRequested = /全部|所有|一键|统一|缺失|修复|整理/.test(command) && allowed.has('trip.repair@1')
  const placeRequested = /地点|地址|坐标|位置/.test(command) && allowed.has('place.enrich@1')
  const protectedDeleteTarget = /票据|门票|订单|预订|付款|退款|账本|费用|旅行/.test(command)
  const undoRequested = /撤销|恢复/.test(command)
    && /删除|移除/.test(command)
    && !protectedDeleteTarget
    && allowed.has('history.undo@1')
  const deleteRequested = !undoRequested
    && /删除|移除/.test(command)
    && !protectedDeleteTarget
    && allowed.has('item.delete@1')
  const executionState = !undoRequested && !deleteRequested
    ? inferExecutionState(command)
    : undefined
  const preferenceArgs = !undoRequested && !deleteRequested && !executionState
    ? inferReplanPreferenceArgs(command)
    : null

  if (undoRequested) {
    const target = extractQuotedTarget(command)
    steps.push({
      actionId: 'history.undo@1',
      args: { kind: 'item_delete', ...(target ? { target } : {}) },
      dependsOn: [],
      id: 'undo-item-delete',
    })
  } else if (deleteRequested) {
    const target = inferItemTarget(command)
    if (target) {
      steps.push({
        actionId: 'item.delete@1',
        args: { target },
        dependsOn: [],
        id: 'delete-item',
      })
    }
  } else if (executionState && allowed.has('item.execution.update@1')) {
    const target = inferItemTarget(command)
    if (target) {
      steps.push({
        actionId: 'item.execution.update@1',
        args: { state: executionState, target },
        dependsOn: [],
        id: 'update-item-execution',
      })
    }
  } else if (preferenceArgs && allowed.has('item.replan.preference.update@1')) {
    const target = inferItemTarget(command)
    if (target) {
      steps.push({
        actionId: 'item.replan.preference.update@1',
        args: { ...preferenceArgs, target },
        dependsOn: [],
        id: 'update-item-replan-preference',
      })
    }
  }

  const hasBoundedItemWrite = steps.some((step) =>
    step.actionId === 'item.execution.update@1'
    || step.actionId === 'item.replan.preference.update@1',
  )
  if (!undoRequested && !deleteRequested && !hasBoundedItemWrite && ticketRequested) {
    const ticketQuery = extractQuotedTarget(command) ?? extractTicketQuery(command)
    steps.push({
      actionId: 'ticket.open@1',
      args: ticketQuery ? { query: ticketQuery } : {},
      dependsOn: [],
      id: 'open-ticket',
    })
  }
  if (!undoRequested && !deleteRequested && !hasBoundedItemWrite && repairRequested) {
    steps.push({
      actionId: 'trip.repair@1',
      args: { scope: inferRepairScope(command) },
      dependsOn: [],
      id: 'repair-trip',
    })
  } else if (!undoRequested && !deleteRequested && !hasBoundedItemWrite && placeRequested) {
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

function inferItemTarget(command: string) {
  if (/第一站|首站|第一个行程点/.test(command)) return 'first_item'
  if (/当前站|这一站|这个行程点|当前行程点/.test(command)) return 'current_item'
  return extractQuotedTarget(command)
}

function inferExecutionState(command: string) {
  if (
    /(?:不要|别|无需|不用|不必|禁止|不允许)\s*(?:把|将)?[^，。；;]{0,40}(?:完成|跳过)/.test(command)
    || /(?:是不是|是否|有没有)[^，。；;]{0,40}(?:完成|跳过)/.test(command)
    || /(?:完成|跳过)[^，。；;]{0,12}(?:吗|么|\?|？)\s*$/.test(command)
  ) {
    return undefined
  }
  if (/可以(?:直接)?跳过|可跳过|跳过也行/.test(command)) return undefined
  if (/恢复|重置/.test(command) && /待进行|未完成|未处理|进行中/.test(command)) {
    return 'active'
  }
  if (/已完成|标记为完成|设为完成/.test(command)) return 'completed'
  if (/已跳过|标记为跳过|设为跳过/.test(command)) return 'skipped'
  return undefined
}

function inferReplanPreferenceArgs(command: string) {
  if (
    /(?:不要|别|无需|不用|不必)\s*(?:把|将|让)?[^，。；;]{0,24}(?:固定|不能动|必须保留|可移动|优先级|缓冲|预留|停留)/.test(command)
    || /(?:是不是|是否|有没有|能否|可不可以)[^，。；;]{0,40}(?:固定|移动|必去|优先级|跳过)/.test(command)
    || /(?:固定|移动|必去|优先级|跳过|下雨|雨天)[^，。；;]{0,12}(?:吗|么|\?|？)\s*$/.test(command)
  ) {
    return null
  }
  const args: Record<string, string | number> = {}
  if (/不能动|不可动|固定|必须按原计划/.test(command)) {
    args.flexibility = 'fixed'
    args.priority = 'must_keep'
  } else if (/可以挪|可移动|能移动|可以调整时间/.test(command)) {
    args.flexibility = 'movable'
  } else if (/可舍弃|可以舍弃|不重要|可以跳过/.test(command)) {
    args.flexibility = 'optional'
    args.priority = 'low'
  }
  if (/必须保留|一定要去|必去|最高优先级/.test(command)) args.priority = 'must_keep'
  else if (/高优先级|尽量保留|很想去/.test(command)) args.priority = 'high'
  else if (/低优先级|不太重要/.test(command)) args.priority = 'low'
  if (/雨天不适合|下雨不去|下雨别去|怕下雨/.test(command)) {
    args.weatherSuitability = 'avoid_rain'
  } else if (/室内优先|适合下雨|雨天可去/.test(command)) {
    args.weatherSuitability = 'indoor_preferred'
  } else if (/全天候|下雨也行/.test(command)) {
    args.weatherSuitability = 'any_weather'
  }
  if (/老人|小孩|孩子|少走路|轻松一点|体力弱/.test(command)) {
    args.mobilitySuitability = 'easy'
  } else if (/徒步|爬山|体力挑战|比较累/.test(command)) {
    args.mobilitySuitability = 'demanding'
  }
  const buffer = command.match(/(?:缓冲|间隔|预留)\s*(\d{1,3})\s*(?:分钟|分)/)
  if (buffer) args.bufferMinutes = Number(buffer[1])
  const stay = command.match(/(?:停留|玩|参观)\s*(\d{1,3})\s*(?:分钟|分)/)
  if (stay) args.minimumStayMinutes = Number(stay[1])
  return Object.keys(args).length > 0 ? args : null
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
    ids.has('history.undo@1') ? '撤销行程点删除' : '',
    ids.has('item.delete@1') ? '删除行程点' : '',
    ids.has('item.execution.update@1') ? '更新行程进度' : '',
    ids.has('item.replan.preference.update@1') ? '更新重排偏好' : '',
    ids.has('trip.replan.apply@1') ? '应用突发重排' : '',
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
