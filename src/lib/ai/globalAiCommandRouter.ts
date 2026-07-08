import {
  getDay,
  getItineraryItem,
  getTrip,
  listDaysByTrip,
  listItemsByTrip,
  listLedgerExpenses,
  listTicketsByTrip,
} from '../../db'
import { buildTripReplanPreview } from '../adaptiveReplanning'
import { sortItineraryItems } from '../itinerary'
import { formatLedgerMoney } from '../ledger'
import type {
  Day,
  ItineraryItem,
  ItineraryReplanPreference,
  LedgerExpense,
  ReplanFlexibility,
  ReplanMobilitySuitability,
  ReplanPriority,
  ReplanWeatherSuitability,
  RouteId,
  TicketMeta,
  Trip,
  TripDisruptionEvent,
  TripDisruptionKind,
  TripReplanRecord,
} from '../../types'

export type GlobalAiCommandIntent =
  | { kind: 'ai_trip_edit' }
  | { kind: 'consultation' }
  | { kind: 'ledger_query' }
  | { kind: 'new_trip' }
  | { kind: 'preference_update'; preference: ItineraryReplanPreference }
  | { kind: 'replan'; delayMinutes?: number; disruptionKind: TripDisruptionKind; hypothetical: boolean }
  | { kind: 'smart_workspace' }

export type GlobalAiCommandContext = {
  activeRoute: RouteId
  currentDay?: Day
  currentItem?: ItineraryItem
  days: Day[]
  hash: string
  items: ItineraryItem[]
  ledgerExpenses: LedgerExpense[]
  params: URLSearchParams
  tickets: TicketMeta[]
  trip?: Trip
}

export type GlobalAiNavigationResult = {
  actionLabel: string
  intent: GlobalAiCommandIntent
  kind: 'navigation'
  message: string
  params?: Record<string, string>
  route: RouteId
  scrollTargetId?: string
  title: string
}

export type GlobalAiPreferencePreviewResult = {
  intent: Extract<GlobalAiCommandIntent, { kind: 'preference_update' }>
  item: ItineraryItem
  kind: 'preference_preview'
  message: string
  nextPreference: ItineraryReplanPreference
  title: string
}

export type GlobalAiReplanPreviewResult = {
  eventDraft: Omit<TripDisruptionEvent, 'createdAt' | 'id' | 'updatedAt'>
  hypothetical: boolean
  intent: Extract<GlobalAiCommandIntent, { kind: 'replan' }>
  kind: 'replan_preview'
  record: TripReplanRecord
  targetItem?: ItineraryItem
  title: string
  warnings: string[]
}

export type GlobalAiLedgerSummaryResult = {
  actionLabel: string
  intent: Extract<GlobalAiCommandIntent, { kind: 'ledger_query' }>
  kind: 'ledger_summary'
  lines: string[]
  params: Record<string, string>
  title: string
}

export type GlobalAiTripEditResult = {
  intent: Extract<GlobalAiCommandIntent, { kind: 'ai_trip_edit' }>
  kind: 'ai_trip_edit'
  message: string
  title: string
}

export type GlobalAiConsultationResult = {
  intent: Extract<GlobalAiCommandIntent, { kind: 'consultation' }>
  kind: 'consultation'
  lines: string[]
  title: string
  warnings: string[]
}

export type GlobalAiCommandResult =
  | GlobalAiConsultationResult
  | GlobalAiLedgerSummaryResult
  | GlobalAiNavigationResult
  | GlobalAiPreferencePreviewResult
  | GlobalAiReplanPreviewResult
  | GlobalAiTripEditResult

export async function loadGlobalAiCommandContext(activeRoute: RouteId, hash = window.location.hash): Promise<GlobalAiCommandContext> {
  const params = new URLSearchParams(hash.replace(/^#\/?/, '').split('?')[1] ?? '')
  const tripId = params.get('tripId')
  const emptyContext: GlobalAiCommandContext = {
    activeRoute,
    days: [],
    hash,
    items: [],
    ledgerExpenses: [],
    params,
    tickets: [],
  }
  if (!tripId) return emptyContext

  const trip = await getTrip(tripId)
  if (!trip) return emptyContext

  const [days, items, tickets, ledgerExpenses] = await Promise.all([
    listDaysByTrip(trip.id),
    listItemsByTrip(trip.id),
    listTicketsByTrip(trip.id),
    listLedgerExpenses(trip.id),
  ])
  const currentItem = await resolveCurrentItem(params, items)
  const currentDay = await resolveCurrentDay(params, days, currentItem)

  return {
    ...emptyContext,
    currentDay,
    currentItem,
    days,
    items,
    ledgerExpenses,
    tickets,
    trip,
  }
}

export async function resolveGlobalAiCommand(command: string, context: GlobalAiCommandContext): Promise<GlobalAiCommandResult> {
  const intent = parseGlobalAiCommandIntent(command)
  if (intent.kind === 'new_trip') {
    return {
      actionLabel: '打开 AI 生成',
      intent,
      kind: 'navigation',
      message: '我会打开 AI 行程草稿页，先生成草案再确认导入。',
      route: 'ai-draft',
      title: '生成新旅行',
    }
  }

  if (intent.kind === 'smart_workspace') {
    if (!context.trip) return missingTripNavigation(intent)
    return {
      actionLabel: '打开智能整理',
      intent,
      kind: 'navigation',
      message: '地点、路线、开放时间和提示仍会进入可勾选预览，不会直接写入。',
      params: { tripId: context.trip.id },
      route: 'trip',
      scrollTargetId: 'smart-trip-workspace-panel',
      title: '智能整理此行程',
    }
  }

  if (intent.kind === 'ledger_query') {
    if (!context.trip) return missingTripNavigation(intent)
    return buildLedgerSummary(intent, context)
  }

  if (intent.kind === 'preference_update') {
    if (!context.trip) return missingTripNavigation(intent)
    const item = selectCommandTargetItem(command, context)
    if (!item) {
      return {
        actionLabel: '回到行程',
        intent,
        kind: 'navigation',
        message: '请先打开具体行程点，或在指令里写清楚地点名称，例如“浅草寺不能动”。',
        params: { tripId: context.trip.id },
        route: 'trip',
        title: '需要明确行程点',
      }
    }
    const nextPreference = normalizePreference({
      ...item.replanPreference,
      ...intent.preference,
    })
    return {
      intent,
      item,
      kind: 'preference_preview',
      message: summarizePreference(nextPreference),
      nextPreference,
      title: `更新「${item.title}」重排偏好`,
    }
  }

  if (intent.kind === 'replan') {
    if (!context.trip) return missingTripNavigation(intent)
    if (context.days.length === 0) {
      return {
        actionLabel: '回到行程',
        intent,
        kind: 'navigation',
        message: '当前旅行还没有日期，先补充日期后才能做当天重排。',
        params: { tripId: context.trip.id },
        route: 'trip',
        title: '还不能重排',
      }
    }
    return buildReplanPreview(command, intent, context)
  }

  if (intent.kind === 'consultation') {
    return buildConsultation(command, intent, context)
  }

  if (!context.trip) {
    return {
      actionLabel: '生成新旅行',
      intent: { kind: 'new_trip' },
      kind: 'navigation',
      message: '当前没有打开具体旅行。要创建新行程可以从 AI 草稿开始。',
      route: 'ai-draft',
      title: '没有旅行上下文',
    }
  }
  return {
    intent,
    kind: 'ai_trip_edit',
    message: '将复用现有 AI 行程修改能力，发送前会再次确认；返回结果只进入预览。',
    title: '生成 AI 修改预览',
  }
}

export function parseGlobalAiCommandIntent(command: string): GlobalAiCommandIntent {
  const normalized = normalizeCommand(command)
  const preference = parsePreferenceIntent(command)
  if (preference) return { kind: 'preference_update', preference }

  if (isNewTripCommand(normalized)) return { kind: 'new_trip' }
  if (isLedgerCommand(normalized)) return { kind: 'ledger_query' }
  if (isSmartWorkspaceCommand(normalized)) return { kind: 'smart_workspace' }

  const replan = parseReplanIntent(command, normalized)
  if (replan) return replan

  if (isTripEditCommand(command, normalized)) return { kind: 'ai_trip_edit' }

  return { kind: 'consultation' }
}

function buildReplanPreview(
  command: string,
  intent: Extract<GlobalAiCommandIntent, { kind: 'replan' }>,
  context: GlobalAiCommandContext,
): GlobalAiReplanPreviewResult {
  const now = Date.now()
  const targetItem = selectCommandTargetItem(command, context)
  const targetDay = context.currentDay
    ?? (targetItem ? context.days.find((day) => day.id === targetItem.dayId) : undefined)
    ?? context.days[0]
  const eventDraft: Omit<TripDisruptionEvent, 'createdAt' | 'id' | 'updatedAt'> = {
    dayId: targetDay?.id,
    delayMinutes: intent.delayMinutes,
    evidence: [],
    itemId: targetItem?.id,
    kind: intent.disruptionKind,
    notes: command.trim(),
    occurredAt: new Date(now).toISOString(),
    reportedByRole: 'owner',
    status: 'reported',
    tripId: context.trip!.id,
  }
  const syntheticEvent: TripDisruptionEvent = {
    ...eventDraft,
    createdAt: now,
    id: `global_ai_replan_preview:${now}`,
    updatedAt: now,
  }
  const preview = buildTripReplanPreview({
    days: context.days,
    event: syntheticEvent,
    items: context.items,
    ledgerExpenses: context.ledgerExpenses,
    tickets: context.tickets,
    trip: context.trip!,
  })
  const record: TripReplanRecord = {
    ...preview,
    createdAt: now,
    id: `global_ai_replan_record_preview:${now}`,
    updatedAt: now,
  }
  return {
    eventDraft,
    hypothetical: intent.hypothetical,
    intent,
    kind: 'replan_preview',
    record,
    targetItem,
    title: intent.hypothetical ? 'What-if 重排预览' : '突发情况重排预览',
    warnings: [
      intent.hypothetical ? '这是模拟预览，确认应用前不会创建事件或同步云端。' : '确认应用前不会创建事件、重排记录或同步云端。',
      '当前全局输入框只使用本地行程数据生成预览；没有来源时不会声明实时事实。',
      ...record.options.flatMap((option) => option.diff.warnings).slice(0, 4),
    ],
  }
}

function buildLedgerSummary(
  intent: Extract<GlobalAiCommandIntent, { kind: 'ledger_query' }>,
  context: GlobalAiCommandContext,
): GlobalAiLedgerSummaryResult {
  const expenses = context.ledgerExpenses
  const currency = pickLedgerCurrency(expenses)
  const confirmedMinor = sumExpenseMinor(expenses.filter((expense) => expense.status === 'confirmed'), currency)
  const draftCount = expenses.filter((expense) => expense.status === 'draft').length
  const reviewCount = expenses.filter((expense) =>
    expense.reviewStatus === 'needs_review' || expense.paymentStatus === 'partially_refunded' || expense.paymentStatus === 'refunded',
  ).length
  const cancelledCount = expenses.filter((expense) => expense.status === 'void' || expense.orderStatus === 'cancelled').length
  const lines = [
    `已确认费用约 ${formatLedgerMoney(confirmedMinor, currency)}。`,
    draftCount > 0 ? `${draftCount} 笔费用仍待确认。` : '没有待确认费用。',
    reviewCount + cancelledCount > 0
      ? `${reviewCount + cancelledCount} 笔可能需要退款、作废或来源复核。`
      : '暂未发现明显退款或作废复核项。',
  ]
  return {
    actionLabel: '打开账本',
    intent,
    kind: 'ledger_summary',
    lines,
    params: { tripId: context.trip!.id },
    title: '轻量账本摘要',
  }
}

function buildConsultation(
  command: string,
  intent: Extract<GlobalAiCommandIntent, { kind: 'consultation' }>,
  context: GlobalAiCommandContext,
): GlobalAiConsultationResult {
  if (!context.trip) {
    return {
      intent,
      kind: 'consultation',
      lines: [
        '我现在没有具体旅行上下文，只能做通用判断。',
        '如果要生成新旅行，可以输入“新建行程”；如果要问某趟旅行，请先打开对应旅行。',
      ],
      title: '只读咨询',
      warnings: ['本次不会发送外部 AI、搜索或地图请求，也不会写入本地数据。'],
    }
  }

  const day = pickConsultationDay(context)
  const dayItems = day ? sortItineraryItems(context.items.filter((item) => item.dayId === day.id)) : []
  const upcomingItems = dayItems
    .filter((item) => item.executionState?.status !== 'completed' && item.executionState?.status !== 'skipped')
    .slice(0, 3)
  const questionKind = classifyConsultation(command)
  const lines = [
    `我只基于「${context.trip.title}」的本地行程数据回答：${context.days.length} 天、${context.items.length} 个行程点、${context.tickets.length} 张票据、${context.ledgerExpenses.length} 笔账本记录。`,
  ]

  if (questionKind === 'food') {
    lines.push('本地没有餐厅实时来源时，我不会编营业时间、评分或排队情况；可以先看当前日期空档，再手动确认餐厅来源。')
    if (day) lines.push(formatDayWindowLine(day, dayItems))
  } else if (questionKind === 'readiness') {
    const missingTimeCount = context.items.filter((item) => !item.startTime && !item.endTime).length
    const missingPlaceCount = context.items.filter((item) => !item.locationName && !item.address).length
    const ticketBoundCount = context.items.filter((item) => item.ticketIds.length > 0).length
    lines.push(`建议先确认 ${missingTimeCount} 个未定时间、${missingPlaceCount} 个未定地点，以及 ${ticketBoundCount} 个绑定票据的项目。`)
    if (day) lines.push(formatDayWindowLine(day, dayItems))
  } else if (questionKind === 'next') {
    if (upcomingItems.length > 0) {
      lines.push(`当前优先看 ${day?.title ?? day?.date ?? '当前日期'} 的后续安排：${upcomingItems.map(formatItemInline).join('；')}。`)
    } else {
      lines.push('当前日期没有明显的待执行项目，可以回到 Trip Home 看跨天概览和待确认事项。')
    }
  } else {
    if (day) lines.push(formatDayWindowLine(day, dayItems))
    if (upcomingItems.length > 0) lines.push(`可先关注：${upcomingItems.map(formatItemInline).join('；')}。`)
  }

  lines.push('如果你要我实际改行程，请使用“把某地点改到…”“新增…”“删除…”这类明确修改指令；那会进入 AI 修改预览和二次确认。')

  return {
    intent,
    kind: 'consultation',
    lines,
    title: '只读旅行咨询',
    warnings: ['本次没有调用外部 AI、搜索、路线或地图 provider，也不会写入 IndexedDB。'],
  }
}

function missingTripNavigation(intent: GlobalAiCommandIntent): GlobalAiNavigationResult {
  return {
    actionLabel: '回到首页',
    intent,
    kind: 'navigation',
    message: '这个指令需要先打开一个具体旅行。',
    route: 'home',
    title: '缺少旅行上下文',
  }
}

async function resolveCurrentItem(params: URLSearchParams, items: ItineraryItem[]) {
  const itemId = params.get('itemId')
  if (!itemId) return undefined
  return items.find((item) => item.id === itemId) ?? await getItineraryItem(itemId) ?? undefined
}

async function resolveCurrentDay(params: URLSearchParams, days: Day[], item?: ItineraryItem) {
  const dayId = params.get('dayId') ?? item?.dayId
  if (!dayId) return undefined
  return days.find((day) => day.id === dayId) ?? await getDay(dayId) ?? undefined
}

function selectCommandTargetItem(command: string, context: GlobalAiCommandContext) {
  if (context.currentItem) return context.currentItem
  const matched = context.items.find((item) =>
    [item.title, item.locationName, item.address]
      .filter((value): value is string => Boolean(value?.trim()))
      .some((value) => command.includes(value)),
  )
  if (matched) return matched
  if (context.currentDay) {
    return sortItineraryItems(context.items.filter((item) => item.dayId === context.currentDay?.id))
      .find((item) => item.executionState?.status !== 'completed' && item.executionState?.status !== 'skipped')
  }
  return undefined
}

function parsePreferenceIntent(command: string): ItineraryReplanPreference | null {
  const preference: ItineraryReplanPreference = {}
  if (containsAny(command, ['不能动', '不可动', '固定', '预约不能改', '不能改时间', '必须按原计划'])) {
    preference.flexibility = 'fixed'
    preference.priority = 'must_keep'
  } else if (containsAny(command, ['可以挪', '可移动', '能移动', '可以调整时间'])) {
    preference.flexibility = 'movable'
  } else if (containsAny(command, ['可舍弃', '可以舍弃', '不重要', '可以删', '可以取消', '可以跳过'])) {
    preference.flexibility = 'optional'
    preference.priority = 'low'
  }

  if (containsAny(command, ['必须保留', '一定要去', '必去', '最高优先级'])) preference.priority = 'must_keep'
  else if (containsAny(command, ['高优先级', '尽量保留', '很想去'])) preference.priority = 'high'
  else if (containsAny(command, ['低优先级', '不太重要'])) preference.priority = 'low'

  if (containsAny(command, ['雨天不适合', '下雨不去', '下雨别去', '怕下雨'])) {
    preference.weatherSuitability = 'avoid_rain'
  } else if (containsAny(command, ['室内优先', '适合下雨', '雨天可去'])) {
    preference.weatherSuitability = 'indoor_preferred'
  } else if (containsAny(command, ['全天候', '下雨也行'])) {
    preference.weatherSuitability = 'any_weather'
  }

  if (containsAny(command, ['老人', '小孩', '孩子', '少走路', '轻松一点', '体力弱'])) {
    preference.mobilitySuitability = 'easy'
  } else if (containsAny(command, ['徒步', '爬山', '体力挑战', '比较累'])) {
    preference.mobilitySuitability = 'demanding'
  }

  const bufferMinutes = extractMinutesAfter(command, ['缓冲', '间隔', '预留'])
  if (bufferMinutes != null) preference.bufferMinutes = bufferMinutes
  const minimumStayMinutes = extractMinutesAfter(command, ['停留', '玩', '参观'])
  if (minimumStayMinutes != null) preference.minimumStayMinutes = minimumStayMinutes

  return Object.keys(preference).length > 0 ? preference : null
}

function parseReplanIntent(command: string, normalized: string): Extract<GlobalAiCommandIntent, { kind: 'replan' }> | null {
  const hypothetical = containsAny(command, ['如果', '假如', '模拟', '试试', '会怎样']) || /\bwhat\s*if\b/.test(normalized)
  const delayMinutes = extractDelayMinutes(command)
  if (containsAny(command, ['迟到', '晚到', '来晚']) || /\blate\b/.test(normalized)) {
    return { delayMinutes: delayMinutes ?? 30, disruptionKind: 'late', hypothetical, kind: 'replan' }
  }
  if (containsAny(command, ['延误', '晚点']) || /\bdelay(?:ed|s)?\b/.test(normalized)) {
    return { delayMinutes: delayMinutes ?? 30, disruptionKind: 'delay', hypothetical, kind: 'replan' }
  }
  if (containsAny(command, ['关闭', '闭馆', '不开门', '关门', '歇业']) || /\bclosed?\b/.test(normalized)) {
    return { disruptionKind: 'closure', hypothetical, kind: 'replan' }
  }
  if (containsAny(command, ['下雨', '暴雨', '天气', '太热', '太冷', '台风', '户外少一点']) || /\bweather|rain|storm\b/.test(normalized)) {
    return { disruptionKind: 'weather_unsuitable', hypothetical, kind: 'replan' }
  }
  if (containsAny(command, ['取消']) || /\bcancel\b/.test(normalized)) {
    return { disruptionKind: 'cancelled', hypothetical, kind: 'replan' }
  }
  if (containsAny(command, ['跳过', '不去了', 'skip']) || /\bskip\b/.test(normalized)) {
    return { disruptionKind: 'skip', hypothetical, kind: 'replan' }
  }
  return hypothetical ? { disruptionKind: 'late', hypothetical, kind: 'replan' } : null
}

function isNewTripCommand(normalized: string) {
  return containsAny(normalized, ['生成新行程', '新建行程', '新旅行', 'ai 生成行程', 'ai生成行程']) ||
    (containsAny(normalized, ['新建', '创建', '生成']) && containsAny(normalized, ['行程', '旅行'])) ||
    /\bnew\s+trip\b/.test(normalized)
}

function isLedgerCommand(normalized: string) {
  return containsAny(normalized, ['账本', '费用', '花了', '预算', '退款', '分摊', '多少钱', '消费']) ||
    /\b(?:ledger|expense|budget|refund|cost)\b/.test(normalized)
}

function isSmartWorkspaceCommand(normalized: string) {
  return containsAny(normalized, ['智能整理', '整理行程', '校准地点', '补全开放时间', '补全票价', '路线顺序', '每日提示']) ||
    /\borganize\b|\bcalibrate\b/.test(normalized)
}

function isTripEditCommand(command: string, normalized: string) {
  return containsAny(command, [
    '帮我改',
    '修改行程',
    '调整行程',
    '调整一下',
    '改行程',
    '改一下',
    '改为',
    '重新安排',
    '重新排',
    '重排',
    '帮我把',
    '帮我安排',
    '改到',
    '改成',
    '挪到',
    '移动',
    '移到',
    '添加',
    '新增',
    '加一个',
    '加入',
    '插入',
    '删掉',
    '删除',
    '取消掉',
    '取消这个',
    '替换',
    '换成',
    '安排到',
    '补到',
    '延后',
    '提前',
  ]) || /\b(?:add|change|delete|move|remove|replace|reschedule|update)\b/.test(normalized)
}

function classifyConsultation(command: string): 'food' | 'generic' | 'next' | 'readiness' {
  if (containsAny(command, ['吃', '餐厅', '早饭', '午饭', '晚饭', '咖啡', '喝什么', '吃什么'])) return 'food'
  if (containsAny(command, ['确认什么', '检查什么', '注意什么', '准备什么', '漏了什么', '风险', '待办'])) return 'readiness'
  if (containsAny(command, ['接下来', '下一步', '现在', '先做什么', '先去哪', '今天怎么走'])) return 'next'
  return 'generic'
}

function pickConsultationDay(context: GlobalAiCommandContext) {
  return context.currentDay ?? context.days[0]
}

function formatDayWindowLine(day: Day, items: ItineraryItem[]) {
  if (items.length === 0) return `${day.title ?? day.date} 还没有行程点。`
  const first = items[0]
  const last = items[items.length - 1]
  const windowLabel = [first.startTime, last.endTime ?? last.startTime].filter(Boolean).join('-') || '时间未定'
  return `${day.title ?? day.date} 有 ${items.length} 个行程点，时间窗约 ${windowLabel}。`
}

function formatItemInline(item: ItineraryItem) {
  const time = [item.startTime, item.endTime].filter(Boolean).join('-') || '时间未定'
  return `${time} ${item.title}`
}

function extractDelayMinutes(command: string) {
  if (command.includes('半小时')) return 30
  if (command.includes('一小时') || command.includes('1小时')) return 60
  const match = command.match(/(\d{1,3})\s*(?:分钟|分|mins?|minutes?)/i)
  if (!match) return undefined
  const value = Number(match[1])
  return Number.isFinite(value) ? Math.max(0, Math.min(240, value)) : undefined
}

function extractMinutesAfter(command: string, anchors: string[]) {
  for (const anchor of anchors) {
    const index = command.indexOf(anchor)
    if (index < 0) continue
    const slice = command.slice(Math.max(0, index - 8), index + anchor.length + 12)
    const minutes = extractDelayMinutes(slice)
    if (minutes != null) return minutes
  }
  return undefined
}

function normalizePreference(preference: ItineraryReplanPreference): ItineraryReplanPreference {
  const next: ItineraryReplanPreference = {}
  if (isFlexibility(preference.flexibility)) next.flexibility = preference.flexibility
  if (isPriority(preference.priority)) next.priority = preference.priority
  if (isPositiveMinutes(preference.bufferMinutes)) next.bufferMinutes = Math.min(240, Math.round(preference.bufferMinutes))
  if (isPositiveMinutes(preference.minimumStayMinutes)) next.minimumStayMinutes = Math.min(720, Math.round(preference.minimumStayMinutes))
  if (isMobility(preference.mobilitySuitability)) next.mobilitySuitability = preference.mobilitySuitability
  if (isWeather(preference.weatherSuitability)) next.weatherSuitability = preference.weatherSuitability
  return next
}

function summarizePreference(preference: ItineraryReplanPreference) {
  const parts = [
    preference.flexibility ? `移动性：${formatFlexibility(preference.flexibility)}` : '',
    preference.priority ? `优先级：${formatPriority(preference.priority)}` : '',
    preference.minimumStayMinutes ? `最短停留 ${preference.minimumStayMinutes} 分钟` : '',
    preference.bufferMinutes ? `缓冲 ${preference.bufferMinutes} 分钟` : '',
    preference.weatherSuitability ? formatWeather(preference.weatherSuitability) : '',
    preference.mobilitySuitability ? formatMobility(preference.mobilitySuitability) : '',
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : '清空重排偏好。'
}

function sumExpenseMinor(expenses: LedgerExpense[], currency: string) {
  return expenses.reduce((total, expense) => (
    expense.currency === currency && Number.isSafeInteger(expense.amountMinor)
      ? total + (expense.amountMinor ?? 0)
      : total
  ), 0)
}

function pickLedgerCurrency(expenses: LedgerExpense[]) {
  return expenses.find((expense) => expense.currency)?.currency ?? 'CNY'
}

function normalizeCommand(command: string) {
  return command.toLocaleLowerCase().replace(/\s+/g, ' ').trim()
}

function containsAny(text: string, patterns: string[]) {
  return patterns.some((pattern) => text.includes(pattern))
}

function isFlexibility(value: unknown): value is ReplanFlexibility {
  return value === 'fixed' || value === 'movable' || value === 'optional'
}

function isPriority(value: unknown): value is ReplanPriority {
  return value === 'must_keep' || value === 'high' || value === 'normal' || value === 'low'
}

function isWeather(value: unknown): value is ReplanWeatherSuitability {
  return value === 'any_weather' || value === 'avoid_rain' || value === 'indoor_preferred'
}

function isMobility(value: unknown): value is ReplanMobilitySuitability {
  return value === 'normal' || value === 'easy' || value === 'demanding'
}

function isPositiveMinutes(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export function formatFlexibility(value: ReplanFlexibility) {
  if (value === 'fixed') return '不可动'
  if (value === 'optional') return '可舍弃'
  return '可移动'
}

export function formatPriority(value: ReplanPriority) {
  if (value === 'must_keep') return '必须保留'
  if (value === 'high') return '高'
  if (value === 'low') return '低'
  return '普通'
}

export function formatWeather(value: ReplanWeatherSuitability) {
  if (value === 'avoid_rain') return '雨天尽量避开'
  if (value === 'indoor_preferred') return '雨天友好'
  return '全天候'
}

export function formatMobility(value: ReplanMobilitySuitability) {
  if (value === 'easy') return '老人小孩友好'
  if (value === 'demanding') return '体力要求高'
  return '普通体力'
}
