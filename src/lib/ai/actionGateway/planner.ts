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
  type AiActionDayItemsReorderArgs,
  type AiActionItemCreateArgs,
  type AiActionItemTimeUpdateArgs,
  type AiActionLedgerExpenseDraftArgs,
  type AiActionPlanV1,
  type AiActionRoutePreviewArgs,
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
  '生成',
  '新增',
  '添加',
  '记录',
  '记一笔',
  '创建',
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

  const itemCreate = parseDeterministicItemCreate(normalized)
  if (itemCreate) {
    steps.push({
      actionId: 'item.create@1',
      args: itemCreate,
      dependsOn: [],
      id: 'create-item',
    })
  }

  const dayReorder = itemCreate ? null : parseDeterministicDayReorder(normalized)
  if (dayReorder) {
    steps.push({
      actionId: 'day.items.reorder@1',
      args: dayReorder,
      dependsOn: [],
      id: 'reorder-day-items',
    })
  }

  const timeUpdate = itemCreate ? null : parseDeterministicTimeUpdate(normalized)
  if (timeUpdate) {
    steps.push({
      actionId: 'item.time.update@1',
      args: timeUpdate,
      dependsOn: [],
      id: 'update-item-time',
    })
  }

  const tripRepair = isTripRepairCommand(normalized)
  const routePreview = tripRepair ? null : parseDeterministicRoutePreview(normalized)
  if (routePreview) {
    steps.push({
      actionId: 'route.preview@1',
      args: routePreview,
      dependsOn: [],
      id: 'generate-route-preview',
    })
  }

  const expenseDraft = itemCreate ? null : parseDeterministicExpenseDraft(normalized)
  if (expenseDraft) {
    steps.push({
      actionId: 'ledger.expense.draft@1',
      args: expenseDraft,
      dependsOn: [],
      id: 'create-expense-draft',
    })
  }

  if (tripRepair) {
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
    ['票', '地点', '地址', '坐标', '行程', '行程点', '站', '顺序', '前面', '后面', '路线', '问题', '建议', '资料', '文档', '账本', '账单', '费用', '消费', '餐', '车费', '住宿', '酒店', '保险', '购物', '地图', '设置', '时间', '开始', '结束']
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

function parseDeterministicItemCreate(command: string): AiActionItemCreateArgs | null {
  if (isHypotheticalCommand(command)) return null
  const verb = command.match(/新增|添加|加入|插入|加一个/)
  const day = findPlannerDayTarget(command)
  if (!verb || verb.index === undefined || !day) return null

  const prefix = command.slice(0, verb.index)
  const explicitSubject = prefix.match(/(?:把|将)\s*(.+)$/)?.[1]?.trim()
  const rawTitle = explicitSubject
    ? explicitSubject
    : day.index < verb.index
      ? command.slice(verb.index + verb[0].length)
      : command.slice(verb.index + verb[0].length, day.index)
  const quoted = rawTitle.match(/[「“"]([^」”"]{1,100})[」”"]/)
  const timeRange = extractTrailingPlannerTimeRange(rawTitle)
  const titleSource = quoted?.[1] ?? rawTitle.slice(0, timeRange?.index ?? rawTitle.length)
  const title = cleanItemCreateTitle(titleSource, day.text)
  if (!title || title.length > 100 || /(?:以及|并且|、|和).+(?:新增|添加|加入|插入)/.test(title)) return null

  return {
    day: day.target,
    ...(timeRange?.endTime ? { endTime: timeRange.endTime } : {}),
    ...(timeRange?.startTime ? { startTime: timeRange.startTime } : {}),
    title,
  }
}

function parseDeterministicDayReorder(command: string): AiActionDayItemsReorderArgs | null {
  if (isHypotheticalCommand(command)) return null
  const verb = command.match(/移动到|移到|挪到|排到|调整到/)
  if (!verb || verb.index === undefined) return null
  const day = findPlannerDayTarget(command)
  const target = cleanSemanticSelector(command.slice(0, verb.index), day?.text)
  if (!target || target.length > 160) return null

  const destination = cleanSemanticSelector(
    command.slice(verb.index + verb[0].length),
    day?.text,
    false,
  )
  if (!destination) return null
  if (/^(?:最前面|最前|第一位|开头)$/.test(destination)) {
    return { ...(day ? { day: day.target } : {}), position: 'first', target }
  }
  if (/^(?:最后面|最后|末尾)$/.test(destination)) {
    return { ...(day ? { day: day.target } : {}), position: 'last', target }
  }
  const relative = destination.match(/^(.{1,160}?)(前面|之前|后面|之后)$/)
  if (!relative) return null
  const anchor = cleanSemanticSelector(relative[1])
  if (!anchor || normalizePlannerSelector(anchor) === normalizePlannerSelector(target)) return null
  return {
    anchor,
    ...(day ? { day: day.target } : {}),
    position: relative[2] === '前面' || relative[2] === '之前' ? 'before' : 'after',
    target,
  }
}

function findPlannerDayTarget(command: string) {
  const current = command.match(/今天|当天|当前日|这一天/)
  if (current?.index !== undefined) {
    return { index: current.index, target: 'current_day', text: current[0] }
  }
  const first = command.match(/第一天|首日/)
  if (first?.index !== undefined) {
    return { index: first.index, target: 'first_day', text: first[0] }
  }
  const ordinal = command.match(/第\s*(\d{1,2})\s*天/)
  if (ordinal?.index !== undefined) {
    return { index: ordinal.index, target: `day:${Number(ordinal[1])}`, text: ordinal[0] }
  }
  return null
}

function extractTrailingPlannerTimeRange(value: string) {
  const match = value.match(
    /[，,\s](?:在|于)?\s*([0-2]?\d(?:[:：][0-5]\d|[点时](?:[0-5]?\d分?)?))(?:\s*(?:-|—|–|至|到)\s*([0-2]?\d(?:[:：][0-5]\d|[点时](?:[0-5]?\d分?)?)?))?\s*$/,
  )
  if (!match || match.index === undefined) return null
  const startTime = normalizePlannerTime(match[1])
  const endTime = match[2] ? normalizePlannerTime(match[2]) : undefined
  if (!startTime || (match[2] && !endTime)) return null
  return { ...(endTime ? { endTime } : {}), index: match.index, startTime }
}

function cleanItemCreateTitle(value: string, dayText: string) {
  return value
    .replace(dayText, ' ')
    .replace(/[「」“”"]/g, '')
    .replace(/^(?:请|麻烦|帮我|给我|替我|在|把|将|\s)+/g, '')
    .replace(/^(?:一个|一处|行程点|站点)\s*/g, '')
    .replace(/(?:到|进|加入)?(?:当天|当日|这一天)?(?:的)?行程\s*$/g, '')
    .replace(/[，,。；;：:\s]+/g, ' ')
    .trim()
}

function cleanSemanticSelector(value: string, dayText?: string, stripSubjectPrefix = true) {
  let normalized = value
  if (dayText) normalized = normalized.replace(dayText, ' ')
  normalized = normalized
    .replace(/^(?:请|麻烦|帮我|给我|\s)+/g, '')
    .replace(/^(?:在|于)\s*/g, '')
    .replace(/^(?:当天|当日|这一天|当前日)(?:的|里|中)?\s*/g, '')
  if (stripSubjectPrefix) normalized = normalized.replace(/^(?:把|将)\s*/g, '')
  return normalized
    .replace(/^[「“"]|[」”"]$/g, '')
    .replace(/[，,。；;：:\s]+$/g, '')
    .trim()
}

function normalizePlannerSelector(value: string) {
  return value.toLocaleLowerCase().replace(/\s+/g, '')
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

function parseDeterministicRoutePreview(command: string): AiActionRoutePreviewArgs | null {
  if (isHypotheticalCommand(command)) return null
  const routeAction = ['生成', '创建', '准备', '补上', '补全'].some((value) => command.includes(value))
  if (!command.includes('路线') || !routeAction || ['重新', '刷新'].some((value) => command.includes(value))) {
    return null
  }
  if (['今天', '当天', '当前日', '这一日', '这一天'].some((value) => command.includes(value))) {
    return { scope: 'day', target: 'current_day' }
  }
  if (['第一天', '首日'].some((value) => command.includes(value))) {
    return { scope: 'day', target: 'first_day' }
  }
  const ordinal = command.match(/第\s*(\d{1,2})\s*天/)
  if (ordinal) return { scope: 'day', target: `day:${Number(ordinal[1])}` }
  const quoted = command.match(/[「“"]([^」”"]{1,80})[」”"]/)
  if (quoted?.[1]?.trim()) return { scope: 'day', target: quoted[1].trim() }
  return { scope: 'trip' }
}

function parseDeterministicExpenseDraft(command: string): AiActionLedgerExpenseDraftArgs | null {
  if (isHypotheticalCommand(command) || /\d{1,2}月\d{1,2}日/.test(command)) return null
  const actionMatch = command.match(/(?:记(?:录)?|新增|添加|创建)\s*(?:一笔|笔)?/)
  if (!actionMatch) return null
  const hasExpenseNoun = ['一笔', '费用', '消费', '账单', '餐', '车费', '门票', '住宿', '酒店', '保险', '购物']
    .some((value) => command.includes(value))
  if (!hasExpenseNoun) return null

  const dateMatch = command.match(/\b\d{4}-\d{2}-\d{2}\b/)
  const commandWithoutDate = dateMatch ? command.replace(dateMatch[0], ' ') : command
  const amountToken = findExpenseAmountToken(commandWithoutDate)
  if (!amountToken) return null
  const amount = amountToken.match(/\d{1,12}(?:\.\d{1,4})?/)?.[0]
  if (!amount || Number(amount) <= 0) return null

  const title = commandWithoutDate
    .replace(amountToken, ' ')
    .replace(/^(?:请|麻烦|帮我|给我|替我|\s)*(?:记(?:录)?|新增|添加|创建)\s*(?:一笔|笔)?\s*/, '')
    .replace(/(?:费用|消费|账单|草稿)\s*$/g, '')
    .replace(/[，,。；;：:\s]+/g, ' ')
    .trim()
  if (!title || title.length > 100) return null
  const currency = inferExpenseCurrency(amountToken) ?? inferExpenseCurrency(command)
  return {
    amount,
    category: inferExpenseCategory(title),
    ...(currency ? { currency } : {}),
    ...(dateMatch ? { date: dateMatch[0] } : {}),
    title,
  }
}

function findExpenseAmountToken(command: string) {
  const matches = [...command.matchAll(
    /(?:(?:CNY|RMB|人民币|JPY|日元|GBP|英镑|USD|美元|EUR|欧元|HKD|港币|[£$€¥￥])\s*)?\d{1,12}(?:\.\d{1,4})?(?:\s*(?:CNY|RMB|人民币|元|JPY|日元|GBP|英镑|USD|美元|EUR|欧元|HKD|港币))?/gi,
  )].map((match) => match[0])
  const currencyMatches = matches.filter((match) => inferExpenseCurrency(match))
  if (currencyMatches.length === 1) return currencyMatches[0]
  if (currencyMatches.length > 1 || matches.length !== 1) return null
  return matches[0]
}

function isHypotheticalCommand(command: string) {
  return ['如果', '假如', '模拟', '会怎样'].some((value) => command.includes(value)) ||
    /\bwhat\s*if\b/i.test(command)
}

function inferExpenseCurrency(value: string) {
  if (/GBP|英镑|£/i.test(value)) return 'GBP'
  if (/USD|美元|\$/i.test(value)) return 'USD'
  if (/EUR|欧元|€/i.test(value)) return 'EUR'
  if (/JPY|日元/i.test(value)) return 'JPY'
  if (/HKD|港币/i.test(value)) return 'HKD'
  if (/CNY|RMB|人民币|元|¥|￥/i.test(value)) return 'CNY'
  return undefined
}

function inferExpenseCategory(value: string): NonNullable<AiActionLedgerExpenseDraftArgs['category']> {
  if (['酒店', '住宿', '民宿'].some((keyword) => value.includes(keyword))) return 'lodging'
  if (['打车', '出租', '地铁', '公交', '火车', '机票', '交通', '车费'].some((keyword) => value.includes(keyword))) return 'transport'
  if (['门票', '入场', '展览'].some((keyword) => value.includes(keyword))) return 'admission'
  if (['早餐', '午餐', '晚餐', '餐', '咖啡', '饮料'].some((keyword) => value.includes(keyword))) return 'food'
  if (['购物', '纪念品'].some((keyword) => value.includes(keyword))) return 'shopping'
  if (value.includes('保险')) return 'insurance'
  if (['SIM', '流量', '电话卡', '通信'].some((keyword) => value.toUpperCase().includes(keyword.toUpperCase()))) return 'connectivity'
  return 'other'
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
    actionIds.has('item.create@1') ? '新增行程点' : '',
    actionIds.has('day.items.reorder@1') ? '调整当天顺序' : '',
    actionIds.has('item.time.update@1') ? '调整行程时间' : '',
    actionIds.has('route.preview@1') ? '生成路线预览' : '',
    actionIds.has('ledger.expense.draft@1') ? '创建费用草稿' : '',
    actionIds.has('place.enrich@1') ? '补全地点' : '',
    actionIds.has('trip.repair@1') ? '智能修复行程' : '',
  ].filter(Boolean)
  return labels.join('并') || '处理旅行任务'
}
