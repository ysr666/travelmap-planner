import type { AiPrivacySettings } from '../aiPrivacy'
import {
  parseGlobalAiCommandIntent,
  type GlobalAiCommandContext,
} from '../globalAiCommandRouter'
import {
  PROVIDER_PROXY_AI_ACTION_PLAN_OPERATION,
  type ProviderProxyAiActionPlanRequest,
} from '../providerProxyContract'
import { listAiActionCatalog } from './registry'
import {
  AI_ACTION_PLAN_SCHEMA_VERSION,
  type AiActionItemTimeUpdateArgs,
  type AiActionPlanV1,
} from './types'
import { validateAiActionPlan } from './validation'

const ACTION_VERBS = [
  '打开',
  '找到',
  '找一下',
  '查找',
  '补全',
  '补充',
  '修复',
  '处理',
  '整理',
  '完成',
  '调整',
  '挪到',
  '移到',
  '进入',
  '查看',
]

export function buildDeterministicAiActionPlan(command: string): AiActionPlanV1 | null {
  const normalized = command.trim()
  if (!normalized) return null
  const steps: Array<Record<string, unknown>> = []
  const intent = parseGlobalAiCommandIntent(normalized)

  if (intent.kind === 'ticket_lookup') {
    steps.push({
      actionId: 'ticket.open@1',
      args: intent.query ? { query: intent.query } : {},
      dependsOn: [],
      id: 'open-ticket',
    })
  }

  if (intent.kind === 'page_navigation') {
    steps.push(intent.target === 'tickets'
      ? {
          actionId: 'ticket.open@1',
          args: {},
          dependsOn: [],
          id: 'open-ticket-gallery',
        }
      : {
          actionId: 'workspace.open@1',
          args: { target: intent.target },
          dependsOn: [],
          id: 'open-workspace',
        })
  }

  const timeUpdate = parseDeterministicTimeUpdate(normalized)
  if (timeUpdate) {
    steps.push({
      actionId: 'item.time.update@1',
      args: timeUpdate,
      dependsOn: [],
      id: 'update-item-time',
    })
  }

  if (isTripRepairCommand(normalized)) {
    steps.push({
      actionId: 'trip.repair@1',
      args: {
        scope: inferRepairScope(normalized),
        ...(inferSemanticTarget(normalized) ? { target: inferSemanticTarget(normalized) } : {}),
      },
      dependsOn: [],
      id: 'repair-trip',
    })
  } else if (isPlaceEnrichmentCommand(normalized)) {
    steps.push({
      actionId: 'place.enrich@1',
      args: { target: inferSemanticTarget(normalized) ?? normalized },
      dependsOn: [],
      id: 'enrich-place',
    })
  }

  if (steps.length === 0) return null
  const validation = validateAiActionPlan({
    schemaVersion: AI_ACTION_PLAN_SCHEMA_VERSION,
    steps,
    summary: summarizeSteps(steps),
  })
  return validation.ok ? validation.plan : null
}

export function shouldRequestAiActionPlan(command: string) {
  const normalized = command.trim()
  if (!normalized || buildDeterministicAiActionPlan(normalized)) return false
  return ACTION_VERBS.some((verb) => normalized.includes(verb)) &&
    ['票', '地点', '地址', '坐标', '行程', '路线', '问题', '建议', '资料', '文档', '账本', '地图', '设置', '时间', '开始', '结束']
      .some((noun) => normalized.includes(noun))
}

export function buildAiActionPlanProviderRequest(
  command: string,
  context: GlobalAiCommandContext & { scopeLabel?: string },
  privacy: AiPrivacySettings,
): ProviderProxyAiActionPlanRequest {
  const summaries: ProviderProxyAiActionPlanRequest['context']['summaries'] = [{
    key: 'page_scope',
    label: '当前范围',
    value: context.currentItem ? '当前行程点' : context.currentDay ? '当前日期' : context.trip ? '当前旅行' : '全部旅行',
  }]
  if (context.trip) {
    summaries.push({
      key: 'trip_shape',
      label: '旅行结构',
      value: `${context.days.length} 天，${context.items.length} 个行程点`,
    })
  }
  if (privacy.allowItineraryBasics && context.trip) {
    summaries.push({
      key: 'trip',
      label: '旅行',
      value: [context.trip.title, context.trip.startDate, context.trip.endDate].filter(Boolean).join(' · '),
    })
    if (context.currentDay) {
      summaries.push({ key: 'current_day', label: '当前日期', value: context.currentDay.title })
    }
    if (context.currentItem) {
      summaries.push({ key: 'current_item', label: '当前行程点', value: context.currentItem.title })
    }
  }
  if (privacy.allowLocationText && context.trip?.destination) {
    summaries.push({ key: 'destination', label: '目的地', value: context.trip.destination })
  }
  if (privacy.allowTicketMetadata) {
    summaries.push({ key: 'ticket_count', label: '票据数量', value: String(context.tickets.length) })
  }
  const genericScope = context.currentItem
    ? '当前行程点'
    : context.currentDay
      ? '当前日期'
      : context.trip
        ? '当前旅行'
        : '全部旅行'
  return {
    availableActions: listAiActionCatalog(),
    command: command.trim(),
    context: {
      scopeLabel: privacy.allowItineraryBasics && context.scopeLabel ? context.scopeLabel : genericScope,
      summaries,
    },
    locale: 'zh-CN',
    operation: PROVIDER_PROXY_AI_ACTION_PLAN_OPERATION,
  }
}

function isTripRepairCommand(command: string) {
  const repairVerb = ['修复', '一键处理', '全部处理', '智能整理'].some((value) => command.includes(value))
  const broadScope = ['全部', '所有', '缺失', '问题', '建议', '路线', '行程'].some((value) => command.includes(value))
  return repairVerb && broadScope
}

function isPlaceEnrichmentCommand(command: string) {
  const placeNoun = ['地点', '地址', '坐标', '位置'].some((value) => command.includes(value))
  const actionVerb = ['补', '查', '找', '完善', '修复'].some((value) => command.includes(value))
  return placeNoun && actionVerb
}

function inferRepairScope(command: string): 'day' | 'item' | 'trip' {
  if (['今天', '当天', '这一日', '这一天'].some((value) => command.includes(value))) return 'day'
  if (['这一站', '当前站', '这个地点', '当前地点'].some((value) => command.includes(value))) return 'item'
  return 'trip'
}

function inferSemanticTarget(command: string) {
  if (['第一站', '首站', '第一个地点'].some((value) => command.includes(value))) return 'first_item'
  if (['当前站', '这一站', '这个地点', '当前地点'].some((value) => command.includes(value))) return 'current_item'
  const quoted = command.match(/[「“"]([^」”"]{1,80})[」”"]/)
  return quoted?.[1]?.trim()
}

function parseDeterministicTimeUpdate(command: string): AiActionItemTimeUpdateArgs | null {
  if (['如果', '假如', '模拟', '会怎样'].some((value) => command.includes(value)) || /\bwhat\s*if\b/i.test(command)) {
    return null
  }
  const match = command.match(
    /(?:改到|改为|调整到|调整为|挪到|移到|安排到)\s*([0-2]?\d(?:[:：][0-5]\d|[点时](?:[0-5]?\d分?)?)?)(?:\s*(?:-|—|–|至|到)\s*([0-2]?\d(?:[:：][0-5]\d|[点时](?:[0-5]?\d分?)?)?))?/,
  )
  if (!match || match.index === undefined) return null
  const startTime = normalizePlannerTime(match[1])
  const endTime = match[2] ? normalizePlannerTime(match[2]) : undefined
  if (!startTime || (match[2] && !endTime)) return null

  const semanticTarget = inferSemanticTarget(command)
  const namedTarget = command
    .slice(0, match.index)
    .replace(/^(?:请|麻烦|帮我|给我|把|将)+/g, '')
    .replace(/(?:的)?(?:开始)?时间$/g, '')
    .replace(/[，,：:\s]+$/g, '')
    .trim()
  const target = semanticTarget ?? namedTarget
  if (!target || target.length > 160) return null
  return {
    ...(endTime ? { endTime } : {}),
    startTime,
    target,
  }
}

function normalizePlannerTime(value: string) {
  const normalized = value.trim().replace('：', ':')
  if (normalized.includes(':')) {
    const [hoursText, minutesText] = normalized.split(':')
    return formatPlannerTime(Number(hoursText), Number(minutesText))
  }
  const match = normalized.match(/^(\d{1,2})(?:[点时](\d{1,2})?分?)?$/)
  if (!match) return ''
  return formatPlannerTime(Number(match[1]), Number(match[2] ?? 0))
}

function formatPlannerTime(hours: number, minutes: number) {
  if (!Number.isInteger(hours) || hours < 0 || hours > 23) return ''
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 59) return ''
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function summarizeSteps(steps: Array<Record<string, unknown>>) {
  const actionIds = new Set(steps.map((step) => step.actionId))
  const labels = [
    actionIds.has('workspace.open@1') ? '打开页面' : '',
    actionIds.has('ticket.open@1') ? '打开票据' : '',
    actionIds.has('item.time.update@1') ? '调整行程时间' : '',
    actionIds.has('place.enrich@1') ? '补全地点' : '',
    actionIds.has('trip.repair@1') ? '智能修复行程' : '',
  ].filter(Boolean)
  return labels.join('并') || '处理旅行任务'
}
