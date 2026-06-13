import { describeItemTime, sortItineraryItems } from './itinerary'
import { hasValidCoordinates } from './mapLinks'
import type { RoutePreparationDay } from './routePreparation'
import { isTicketLikeItem } from './tripCheck'
import type { TripOperationsRecommendation } from './tripOperationsAgent'
import {
  formatZonedTimeLabel,
  getZonedMinuteOfDay,
  getZonedPlainDate,
  resolveDayTimeZone,
  resolveItemTimeRange,
} from './timeZone'
import type { Day, ItineraryItem, TicketMeta, Trip } from '../types'

export type TripLiveStage = 'not_started' | 'en_route' | 'visiting' | 'next_due' | 'day_finished'
export type TripLiveRiskSeverity = 'info' | 'warning' | 'critical'

export type TripLiveRisk = {
  detail: string
  id: string
  kind: 'late' | 'opening_hours' | 'operations' | 'route' | 'ticket'
  recommendation?: TripOperationsRecommendation
  severity: TripLiveRiskSeverity
  title: string
}

export type TripLiveOperationsContext = {
  recommendations: TripOperationsRecommendation[]
}

export type TripLiveTravelEstimate = {
  arrivalLabel: string
  lateByMinutes: number
  minutes: number
  source: 'item' | 'route_cache'
}

export type TripLiveOpeningHours = {
  detail: string
  state: 'all_day' | 'closed' | 'closing_soon' | 'not_open' | 'open' | 'unknown'
}

export type TripLiveModel = {
  completedItems: ItineraryItem[]
  counts: {
    completed: number
    pending: number
    skipped: number
    total: number
  }
  currentItem?: ItineraryItem
  currentTimeLabel: string
  nextItem?: ItineraryItem
  openingHours: TripLiveOpeningHours
  operationsRecommendations: TripOperationsRecommendation[]
  previousItem?: ItineraryItem
  risks: TripLiveRisk[]
  skippedItems: ItineraryItem[]
  stage: TripLiveStage
  stageLabel: string
  subtitle: string
  targetItem?: ItineraryItem
  ticketIds: string[]
  ticketTitles: string[]
  title: string
  travelEstimate?: TripLiveTravelEstimate
}

export type BuildTripLiveModelInput = {
  day: Day
  items: ItineraryItem[]
  now?: Date
  operations?: TripLiveOperationsContext | null
  routeDay?: RoutePreparationDay | null
  tickets?: TicketMeta[]
  trip: Trip
}

const LATE_CRITICAL_MINUTES = 10
const OPENING_SOON_MINUTES = 30

export function buildTripLiveModel({
  day,
  items,
  now = new Date(),
  operations,
  routeDay,
  tickets = [],
  trip,
}: BuildTripLiveModelInput): TripLiveModel {
  const orderedItems = sortItineraryItems(items)
  const completedItems = orderedItems.filter((item) => item.executionState?.status === 'completed')
  const skippedItems = orderedItems.filter((item) => item.executionState?.status === 'skipped')
  const pendingItems = orderedItems.filter((item) => !item.executionState)
  const timeZone = resolveDayTimeZone(trip, day)
  const today = getZonedPlainDate(now, timeZone)
  const currentTimeLabel = formatZonedTimeLabel(now, timeZone)
  const counts = {
    completed: completedItems.length,
    pending: pendingItems.length,
    skipped: skippedItems.length,
    total: orderedItems.length,
  }

  if (orderedItems.length === 0 || pendingItems.length === 0 || day.date < today) {
    return terminalModel({ completedItems, counts, currentTimeLabel, skippedItems })
  }

  const selection = selectLiveTarget({ day, now, orderedItems, pendingItems, routeDay, trip })
  if (!selection.targetItem) {
    return terminalModel({ completedItems, counts, currentTimeLabel, skippedItems })
  }

  const targetItem = selection.targetItem
  const travelEstimate = buildTravelEstimate({
    day,
    now,
    orderedItems,
    routeDay,
    targetItem,
    trip,
  })
  const openingHours = buildOpeningHours({ day, item: targetItem, now, travelEstimate, trip })
  const operationsRecommendations = selectOperationsRecommendations({
    context: operations,
    day,
    itemIds: [selection.currentItem?.id, targetItem.id, selection.nextItem?.id].filter((id): id is string => Boolean(id)),
  })
  const ticketIds = [...targetItem.ticketIds]
  const ticketById = new Map(tickets.map((ticket) => [ticket.id, ticket]))
  const ticketTitles = ticketIds.map((ticketId) => {
    const ticket = ticketById.get(ticketId)
    return ticket?.title || ticket?.fileName || '票据'
  })
  const risks = buildRisks({
    openingHours,
    operationsRecommendations,
    routeDay,
    targetItem,
    travelEstimate,
  })

  return {
    completedItems,
    counts,
    currentItem: selection.currentItem,
    currentTimeLabel,
    nextItem: selection.nextItem,
    openingHours,
    operationsRecommendations,
    previousItem: selection.previousItem,
    risks,
    skippedItems,
    stage: day.date > today ? 'not_started' : selection.stage,
    stageLabel: stageLabel(day.date > today ? 'not_started' : selection.stage),
    subtitle: buildSubtitle(day.date > today ? 'not_started' : selection.stage, targetItem, travelEstimate),
    targetItem,
    ticketIds,
    ticketTitles,
    title: buildTitle(day.date > today ? 'not_started' : selection.stage, targetItem),
    travelEstimate,
  }
}

function selectLiveTarget({
  day,
  now,
  orderedItems,
  pendingItems,
  routeDay,
  trip,
}: {
  day: Day
  now: Date
  orderedItems: ItineraryItem[]
  pendingItems: ItineraryItem[]
  routeDay?: RoutePreparationDay | null
  trip: Trip
}) {
  const nowEpochMs = now.getTime()
  const currentItem = pendingItems.find((item) => {
    const range = resolveItemTimeRange({ day, item, trip })
    return range.startEpochMs !== undefined
      && range.endEpochMs !== undefined
      && range.startEpochMs <= nowEpochMs
      && nowEpochMs <= range.endEpochMs
  })

  if (currentItem) {
    const pendingIndex = pendingItems.findIndex((item) => item.id === currentItem.id)
    return {
      currentItem,
      nextItem: pendingItems[pendingIndex + 1],
      previousItem: previousOrderedItem(orderedItems, currentItem),
      stage: 'visiting' as const,
      targetItem: currentItem,
    }
  }

  const eligiblePendingItems = pendingItems.filter((item) => {
    const range = resolveItemTimeRange({ day, item, trip })
    return range.endEpochMs === undefined || range.endEpochMs >= nowEpochMs
  })
  const targetItem = eligiblePendingItems[0]
  if (!targetItem) {
    return { stage: 'day_finished' as const, targetItem: undefined }
  }
  const previousItem = previousOrderedItem(orderedItems, targetItem)
  const range = resolveItemTimeRange({ day, item: targetItem, trip })
  const estimate = buildTravelEstimate({ day, now, orderedItems, routeDay, targetItem, trip })
  const departureDeadline = range.startEpochMs !== undefined && estimate
    ? range.startEpochMs - estimate.minutes * 60_000
    : range.startEpochMs
  const hasProcessedPrevious = orderedItems
    .slice(0, orderedItems.findIndex((item) => item.id === targetItem.id))
    .some((item) => Boolean(item.executionState))
  const stage: TripLiveStage = range.startEpochMs !== undefined && nowEpochMs >= range.startEpochMs
    ? 'next_due'
    : departureDeadline !== undefined && nowEpochMs >= departureDeadline
      ? 'next_due'
      : hasProcessedPrevious
        ? 'en_route'
        : 'not_started'

  return { nextItem: eligiblePendingItems[1], previousItem, stage, targetItem }
}

function buildTravelEstimate({
  day,
  now,
  orderedItems,
  routeDay,
  targetItem,
  trip,
}: {
  day: Day
  now: Date
  orderedItems: ItineraryItem[]
  routeDay?: RoutePreparationDay | null
  targetItem: ItineraryItem
  trip: Trip
}): TripLiveTravelEstimate | undefined {
  let minutes = targetItem.previousTransportDurationMinutes
  let source: TripLiveTravelEstimate['source'] = 'item'
  const mappableCount = orderedItems.filter(hasValidCoordinates).length
  if (minutes === undefined && mappableCount === 2 && routeDay?.status === 'cached' && routeDay.cacheEntry?.durationSeconds) {
    minutes = Math.max(1, Math.ceil(routeDay.cacheEntry.durationSeconds / 60))
    source = 'route_cache'
  }
  if (minutes === undefined) return undefined
  const arrival = new Date(now.getTime() + minutes * 60_000)
  const startEpochMs = resolveItemTimeRange({ day, item: targetItem, trip }).startEpochMs
  const lateByMinutes = startEpochMs === undefined
    ? 0
    : Math.max(0, Math.ceil((arrival.getTime() - startEpochMs) / 60_000))
  return {
    arrivalLabel: formatZonedTimeLabel(arrival, resolveDayTimeZone(trip, day)),
    lateByMinutes,
    minutes,
    source,
  }
}

function buildOpeningHours({
  day,
  item,
  now,
  travelEstimate,
  trip,
}: {
  day: Day
  item: ItineraryItem
  now: Date
  travelEstimate?: TripLiveTravelEstimate
  trip: Trip
}): TripLiveOpeningHours {
  const section = item.contentEnrichment?.openingHours
  const sourceIds = new Set(item.contentEnrichment?.sources.map((source) => source.id) ?? [])
  if (!section?.text.trim() || !section.sourceIds.some((sourceId) => sourceIds.has(sourceId))) {
    return { detail: '开放时间缺少可核对来源。', state: 'unknown' }
  }

  const text = section.text.trim()
  if (/^(?:每日|每天|周一至周日)?\s*全天开放[。.]?$/.test(text)) {
    return { detail: `${text.replace(/[。.]$/, '')}（来源已保存）`, state: 'all_day' }
  }

  const match = /^(?:每日|每天|周一至周日)?\s*([01]\d|2[0-3]):([0-5]\d)\s*[-–—至]\s*([01]\d|2[0-3]):([0-5]\d)[。.]?$/.exec(text)
  if (!match) {
    return { detail: `${text} · 格式较复杂，请人工核对。`, state: 'unknown' }
  }
  const openMinute = Number(match[1]) * 60 + Number(match[2])
  const closeMinute = Number(match[3]) * 60 + Number(match[4])
  if (closeMinute <= openMinute) {
    return { detail: `${text} · 跨日时段请人工核对。`, state: 'unknown' }
  }
  const nowMinute = getZonedMinuteOfDay(now, resolveDayTimeZone(trip, day))
  const arrivalMinute = travelEstimate ? nowMinute + travelEstimate.minutes : nowMinute
  if (arrivalMinute < openMinute) {
    return { detail: `${text} · 预计到达时尚未开放。`, state: 'not_open' }
  }
  if (arrivalMinute >= closeMinute) {
    return { detail: `${text} · 预计到达时可能已经关闭。`, state: 'closed' }
  }
  if (closeMinute - arrivalMinute <= OPENING_SOON_MINUTES) {
    return { detail: `${text} · 预计到达后距离关闭不足 ${OPENING_SOON_MINUTES} 分钟。`, state: 'closing_soon' }
  }
  return { detail: `${text} · 预计到达时处于开放时段。`, state: 'open' }
}

function buildRisks({
  openingHours,
  operationsRecommendations,
  routeDay,
  targetItem,
  travelEstimate,
}: {
  openingHours: TripLiveOpeningHours
  operationsRecommendations: TripOperationsRecommendation[]
  routeDay?: RoutePreparationDay | null
  targetItem: ItineraryItem
  travelEstimate?: TripLiveTravelEstimate
}) {
  const risks: TripLiveRisk[] = []
  if (travelEstimate?.lateByMinutes) {
    risks.push({
      detail: `按当前本地估算，预计晚到约 ${travelEstimate.lateByMinutes} 分钟。`,
      id: 'late-arrival',
      kind: 'late',
      severity: travelEstimate.lateByMinutes > LATE_CRITICAL_MINUTES ? 'critical' : 'warning',
      title: travelEstimate.lateByMinutes > LATE_CRITICAL_MINUTES ? '时间明显不够' : '可能小幅迟到',
    })
  }
  if (openingHours.state === 'closed' || openingHours.state === 'closing_soon' || openingHours.state === 'not_open') {
    risks.push({
      detail: openingHours.detail,
      id: `opening-${openingHours.state}`,
      kind: 'opening_hours',
      severity: openingHours.state === 'closed' ? 'critical' : 'warning',
      title: openingHours.state === 'closed' ? '开放时间可能冲突' : '开放时间需要留意',
    })
  }
  if (!hasValidCoordinates(targetItem)) {
    risks.push({ detail: '下一站缺少坐标，内部地图和外部路线可能不完整。', id: 'missing-coordinate', kind: 'route', severity: 'warning', title: '路线信息不完整' })
  } else if (routeDay?.status === 'stale_if_cache_key_changed') {
    risks.push({ detail: '当天路线缓存与当前行程不一致，请重新生成后再依赖路线。', id: 'stale-route', kind: 'route', severity: 'warning', title: '路线缓存可能过期' })
  } else if (targetItem.previousTransportDurationMinutes === undefined && routeDay?.status !== 'cached') {
    risks.push({ detail: '没有可用的单段路程估算，请现场预留机动时间。', id: 'missing-duration', kind: 'route', severity: 'warning', title: '路程耗时待核对' })
  }
  if (isTicketLikeItem(targetItem) && targetItem.ticketIds.length === 0) {
    risks.push({ detail: '该行程点可能需要门票或预约，但当前没有绑定票据。', id: 'missing-ticket', kind: 'ticket', severity: 'warning', title: '票据尚未绑定' })
  }
  for (const recommendation of operationsRecommendations) {
    risks.push({
      detail: recommendation.message,
      id: `operation-${recommendation.fingerprint}`,
      kind: 'operations',
      recommendation,
      severity: recommendation.severity === 'high' ? 'critical' : recommendation.severity === 'medium' ? 'warning' : 'info',
      title: recommendation.title,
    })
  }
  return risks.slice(0, 5)
}

function selectOperationsRecommendations({
  context,
  day,
  itemIds,
}: {
  context?: TripLiveOperationsContext | null
  day: Day
  itemIds: string[]
}) {
  if (!context) return []
  const itemIdSet = new Set(itemIds)
  return context.recommendations.filter((recommendation) =>
    recommendation.dayId === day.id
    || recommendation.affectedDayIds.includes(day.id)
    || Boolean(recommendation.itemId && itemIdSet.has(recommendation.itemId))
    || recommendation.affectedItemIds.some((itemId) => itemIdSet.has(itemId)),
  ).slice(0, 2)
}

function terminalModel({
  completedItems,
  counts,
  currentTimeLabel,
  skippedItems,
}: Pick<TripLiveModel, 'completedItems' | 'counts' | 'currentTimeLabel' | 'skippedItems'>): TripLiveModel {
  return {
    completedItems,
    counts,
    currentTimeLabel,
    openingHours: { detail: '暂无下一站开放时间。', state: 'unknown' },
    operationsRecommendations: [],
    risks: [],
    skippedItems,
    stage: 'day_finished',
    stageLabel: stageLabel('day_finished'),
    subtitle: '可以查看明日安排，或恢复已完成、已跳过的行程点。',
    ticketIds: [],
    ticketTitles: [],
    title: counts.total === 0 ? '今天暂无行程点' : '今日行程已结束',
  }
}

function previousOrderedItem(items: ItineraryItem[], item: ItineraryItem) {
  const index = items.findIndex((candidate) => candidate.id === item.id)
  return index > 0 ? items[index - 1] : undefined
}

function stageLabel(stage: TripLiveStage) {
  if (stage === 'not_started') return '未出发'
  if (stage === 'en_route') return '前往下一站'
  if (stage === 'visiting') return '正在游览'
  if (stage === 'next_due') return '该去下一站'
  return '今日已结束'
}

function buildTitle(stage: TripLiveStage, item: ItineraryItem) {
  if (stage === 'visiting') return `正在游览：${item.title}`
  if (stage === 'en_route') return `前往：${item.title}`
  if (stage === 'next_due') return `现在该去：${item.title}`
  return `首站：${item.title}`
}

function buildSubtitle(stage: TripLiveStage, item: ItineraryItem, estimate?: TripLiveTravelEstimate) {
  const time = describeItemTime(item)
  if (stage === 'visiting') return `${time} · 完成后可直接推进到下一站。`
  if (estimate) return `${time} · 预计路程 ${estimate.minutes} 分钟，约 ${estimate.arrivalLabel} 到达。`
  return `${time} · 暂无可靠路程耗时，请人工预留交通时间。`
}
