import type { TripDailyTravelTipModel } from './ai/tripDailyTravelTip'
import type { CloudSyncQueueSummary } from './cloudSyncQueueSummary'
import { getZonedMinuteOfDay, getZonedPlainDate, resolveTripTimeZone } from './timeZone'
import type { TripReadinessIssue, TripReadinessIssueType, TripReadinessModel, TripReadinessSeverity } from './tripReadiness'
import { getTicketDisplayTitle, getTicketStorageMode } from './tickets'
import type { TripRoutePreparation } from './routePreparation'
import type { Day, ItineraryItem, TicketBlobSyncState, TicketMeta, Trip } from '../types'

export type TripOperationsPhase =
  | 'pre_trip'
  | 'travel_morning'
  | 'traveling'
  | 'travel_evening'
  | 'post_trip'

export type TripOperationsActionKind =
  | 'clear_ticket_cache'
  | 'generate_content_preview'
  | 'generate_daily_tip_preview'
  | 'generate_routes'
  | 'open_content_enrichment'
  | 'open_day'
  | 'open_inbox'
  | 'open_item'
  | 'open_readiness'
  | 'open_route_panel'
  | 'open_sync'
  | 'open_tickets'
  | 'retry_ticket_upload'
  | 'review_tomorrow'

export type TripOperationsRecommendationType =
  | TripReadinessIssueType
  | 'inbox_needs_attention'
  | 'synced_ticket_cache'
  | 'tomorrow_review'

export type TripOperationsRecommendation = {
  actionKind: TripOperationsActionKind
  actionLabel: string
  canBatch: boolean
  dayId?: string
  detail: string
  evidence: string[]
  id: string
  itemId?: string
  message: string
  phaseWeight: number
  priority: number
  readinessIssueIds: string[]
  requiresConfirm: boolean
  requiresPreview: boolean
  severity: TripReadinessSeverity
  ticketIds: string[]
  title: string
  type: TripOperationsRecommendationType
}

export type TripOperationsInboxSummary = {
  accountErrorCount: number
  accountNeedsAssignmentCount: number
  accountPreviewCount: number
  errorEntryCount: number
  readyEntryCount: number
  selectedPreviewDiffCount: number
}

export type TripOperationsModel = {
  allRecommendations: TripOperationsRecommendation[]
  batchableCount: number
  phase: TripOperationsPhase
  phaseLabel: string
  recommendations: TripOperationsRecommendation[]
  summary: {
    highRiskCount: number
    message: string
    totalCount: number
  }
}

export type BuildTripOperationsModelInput = {
  allItems: ItineraryItem[]
  cloudSummary?: CloudSyncQueueSummary | null
  dailyTipModel?: TripDailyTravelTipModel | null
  days: Day[]
  inboxSummary?: TripOperationsInboxSummary | null
  itemsByDay: Record<string, ItineraryItem[]>
  now?: Date
  readinessModel?: TripReadinessModel | null
  routePreparation?: TripRoutePreparation | null
  ticketBlobSyncStates?: TicketBlobSyncState[]
  tickets: TicketMeta[]
  trip: Trip
}

type RecommendationDraft = Omit<TripOperationsRecommendation, 'phaseWeight' | 'priority'>

const MAX_VISIBLE_RECOMMENDATIONS = 5
const MORNING_END_MINUTE = 10 * 60
const EVENING_START_MINUTE = 18 * 60

export function buildTripOperationsModel({
  cloudSummary,
  dailyTipModel,
  days,
  inboxSummary,
  now = new Date(),
  readinessModel,
  ticketBlobSyncStates = [],
  tickets,
  trip,
}: BuildTripOperationsModelInput): TripOperationsModel {
  const phase = resolveTripOperationsPhase({ days, now, trip })
  const recommendations = [
    ...buildReadinessRecommendations(readinessModel?.issues ?? []),
    ...buildInboxRecommendations(inboxSummary),
    ...buildTicketCacheRecommendations(tickets, ticketBlobSyncStates),
    ...buildTomorrowRecommendations({ dailyTipModel, phase }),
    ...buildPostTripSyncRecommendation({ cloudSummary, phase }),
  ]
  const sorted = sortRecommendations(recommendations, phase)
  const visible = sorted.slice(0, MAX_VISIBLE_RECOMMENDATIONS)
  const highRiskCount = sorted.filter((recommendation) => recommendation.severity === 'high').length
  const batchableCount = visible.filter((recommendation) => recommendation.canBatch && recommendation.severity === 'low').length

  return {
    allRecommendations: sorted,
    batchableCount,
    phase,
    phaseLabel: getTripOperationsPhaseLabel(phase),
    recommendations: visible,
    summary: {
      highRiskCount,
      message: buildSummaryMessage(phase, visible, sorted.length),
      totalCount: sorted.length,
    },
  }
}

export function resolveTripOperationsPhase({
  days,
  now,
  trip,
}: {
  days: Day[]
  now: Date
  trip: Trip
}): TripOperationsPhase {
  const timeZone = resolveTripTimeZone(trip)
  const today = getZonedPlainDate(now, timeZone)
  const minute = getZonedMinuteOfDay(now, timeZone)
  const startDate = days[0]?.date ?? trip.startDate
  const endDate = days[days.length - 1]?.date ?? trip.endDate

  if (today < startDate) {
    return 'pre_trip'
  }
  if (today > endDate) {
    return 'post_trip'
  }
  if (minute < MORNING_END_MINUTE) {
    return 'travel_morning'
  }
  if (minute >= EVENING_START_MINUTE) {
    return 'travel_evening'
  }
  return 'traveling'
}

export function getTripOperationsPhaseLabel(phase: TripOperationsPhase) {
  if (phase === 'pre_trip') return '出发前'
  if (phase === 'travel_morning') return '当天早晨'
  if (phase === 'travel_evening') return '当天晚上'
  if (phase === 'post_trip') return '旅行结束后'
  return '旅行中'
}

function buildReadinessRecommendations(issues: TripReadinessIssue[]): TripOperationsRecommendation[] {
  const grouped = new Map<string, TripReadinessIssue[]>()
  for (const issue of issues) {
    const key = getReadinessGroupKey(issue)
    grouped.set(key, [...grouped.get(key) ?? [], issue])
  }

  return [...grouped.entries()].map(([key, group]) => buildReadinessRecommendation(key, group))
}

function buildReadinessRecommendation(key: string, issues: TripReadinessIssue[]): TripOperationsRecommendation {
  const first = issues[0]
  const severity = maxSeverity(issues.map((issue) => issue.severity))
  const dayIds = uniqueStrings(issues.map((issue) => issue.dayId))
  const itemIds = uniqueStrings(issues.map((issue) => issue.itemId))
  const ticketIds = uniqueStrings(issues.map((issue) => issue.ticketId))
  const evidence = issues.flatMap((issue) => issue.evidence).slice(0, 3)
  const count = issues.length

  if (first.type === 'missing_route' && first.actionKind === 'generate_routes') {
    return buildRecommendation({
      actionKind: 'generate_routes',
      actionLabel: '生成路线',
      canBatch: true,
      dayId: dayIds[0],
      detail: evidence[0] ?? '路线缓存可提前生成，便于现场快速查看。',
      evidence,
      id: 'ops-missing-route',
      message: count > 1 ? `${count} 天缺少路线预览或缓存已过期。` : first.message,
      readinessIssueIds: issues.map((issue) => issue.id),
      requiresConfirm: true,
      requiresPreview: true,
      severity,
      ticketIds,
      title: count > 1 ? `${count} 天缺路线` : first.title,
      type: first.type,
    })
  }

  if (first.type === 'missing_content') {
    return buildRecommendation({
      actionKind: 'generate_content_preview',
      actionLabel: '生成预览',
      canBatch: true,
      dayId: dayIds[0],
      detail: evidence[0] ?? '可补充开放时间、票价和注意事项，确认后才写入。',
      evidence,
      id: 'ops-missing-content',
      itemId: itemIds[0],
      message: count > 1 ? `${count} 个行程点缺少开放时间或票价。` : first.message,
      readinessIssueIds: issues.map((issue) => issue.id),
      requiresConfirm: true,
      requiresPreview: true,
      severity,
      ticketIds,
      title: count > 1 ? `${count} 个地点缺出行信息` : first.title,
      type: first.type,
    })
  }

  if (first.type === 'ticket_unsynced' && first.actionKind === 'retry_ticket_upload') {
    return buildRecommendation({
      actionKind: 'retry_ticket_upload',
      actionLabel: severity === 'high' ? '确认重试' : '重新同步',
      canBatch: severity === 'low',
      dayId: dayIds[0],
      detail: evidence[0] ?? '票据文件需要同步到账号，确认后才会重试。',
      evidence,
      id: severity === 'high' ? 'ops-ticket-upload-error' : 'ops-ticket-upload-pending',
      itemId: itemIds[0],
      message: count > 1 ? `${count} 张票据需要处理上传状态。` : first.message,
      readinessIssueIds: issues.map((issue) => issue.id),
      requiresConfirm: true,
      requiresPreview: true,
      severity,
      ticketIds,
      title: severity === 'high' ? '票据同步失败' : count > 1 ? `${count} 张票据待同步` : first.title,
      type: first.type,
    })
  }

  if (first.type === 'daily_tip_missing') {
    return buildRecommendation({
      actionKind: 'generate_daily_tip_preview',
      actionLabel: '生成提示',
      canBatch: true,
      dayId: dayIds[0],
      detail: evidence[0] ?? '每日提示会先生成预览，确认后才保存。',
      evidence,
      id: 'ops-daily-tip',
      message: first.message,
      readinessIssueIds: issues.map((issue) => issue.id),
      requiresConfirm: true,
      requiresPreview: true,
      severity,
      ticketIds,
      title: first.title,
      type: first.type,
    })
  }

  if (first.type === 'missing_coordinate') {
    return buildRecommendation({
      actionKind: 'open_item',
      actionLabel: '补全地点',
      canBatch: false,
      dayId: dayIds[0],
      detail: evidence[0] ?? '缺坐标会影响地图、路线和导航。',
      evidence,
      id: 'ops-missing-coordinate',
      itemId: itemIds[0],
      message: count > 1 ? `${count} 个行程点缺少可用坐标。` : first.message,
      readinessIssueIds: issues.map((issue) => issue.id),
      requiresConfirm: false,
      requiresPreview: false,
      severity,
      ticketIds,
      title: count > 1 ? `${count} 个地点缺坐标` : first.title,
      type: first.type,
    })
  }

  if (first.type === 'missing_ticket') {
    return buildRecommendation({
      actionKind: 'open_tickets',
      actionLabel: '绑定票据',
      canBatch: false,
      dayId: dayIds[0],
      detail: evidence[0] ?? '疑似需要凭证的行程点还没有绑定票据。',
      evidence,
      id: 'ops-missing-ticket',
      itemId: itemIds[0],
      message: count > 1 ? `${count} 个行程点可能缺少票据。` : first.message,
      readinessIssueIds: issues.map((issue) => issue.id),
      requiresConfirm: false,
      requiresPreview: false,
      severity,
      ticketIds,
      title: count > 1 ? `${count} 个地点可绑定票据` : first.title,
      type: first.type,
    })
  }

  if (first.type === 'route_long_distance') {
    return buildRecommendation({
      actionKind: 'open_day',
      actionLabel: '检查当天',
      canBatch: false,
      dayId: dayIds[0],
      detail: evidence[0] ?? '相邻地点距离偏远，建议人工核对顺序和时间。',
      evidence,
      id: 'ops-route-risk',
      itemId: itemIds[0],
      message: count > 1 ? `${count} 段路线距离或时间存在风险。` : first.message,
      readinessIssueIds: issues.map((issue) => issue.id),
      requiresConfirm: severity === 'high',
      requiresPreview: false,
      severity,
      ticketIds,
      title: severity === 'high' ? '今天路线可能过远' : '路线距离偏远',
      type: first.type,
    })
  }

  if (first.type === 'cloud_sync_pending' || first.actionKind === 'open_sync') {
    return buildRecommendation({
      actionKind: 'open_sync',
      actionLabel: '查看同步',
      canBatch: false,
      dayId: dayIds[0],
      detail: evidence[0] ?? '仍有本地修改、票据上传或冲突需要查看。',
      evidence,
      id: 'ops-cloud-sync',
      itemId: itemIds[0],
      message: first.message,
      readinessIssueIds: issues.map((issue) => issue.id),
      requiresConfirm: severity === 'high',
      requiresPreview: false,
      severity,
      ticketIds,
      title: first.title,
      type: first.type,
    })
  }

  return buildRecommendation({
    actionKind: first.actionKind === 'open_route_panel' ? 'open_route_panel' : 'open_readiness',
    actionLabel: first.actionLabel,
    canBatch: false,
    dayId: dayIds[0],
    detail: evidence[0] ?? first.message,
    evidence,
    id: `ops-${key}`,
    itemId: itemIds[0],
    message: count > 1 ? `${count} 项需要处理。` : first.message,
    readinessIssueIds: issues.map((issue) => issue.id),
    requiresConfirm: severity === 'high',
    requiresPreview: first.requiresPreview,
    severity,
    ticketIds,
    title: count > 1 ? first.title : first.title,
    type: first.type,
  })
}

function buildInboxRecommendations(inboxSummary: TripOperationsInboxSummary | null | undefined): TripOperationsRecommendation[] {
  if (!inboxSummary) {
    return []
  }
  const recommendations: TripOperationsRecommendation[] = []
  if (inboxSummary.selectedPreviewDiffCount > 0 || inboxSummary.accountPreviewCount > 0) {
    const count = inboxSummary.selectedPreviewDiffCount || inboxSummary.accountPreviewCount
    recommendations.push(buildRecommendation({
      actionKind: 'open_inbox',
      actionLabel: '查看预览',
      canBatch: false,
      detail: '收件箱已整理出待确认的写入建议。',
      evidence: [`${count} 项整理建议等待确认。`],
      id: 'ops-inbox-preview',
      message: '进入收件箱预览，确认后才会写入行程或绑定票据。',
      readinessIssueIds: [],
      requiresConfirm: false,
      requiresPreview: true,
      severity: 'medium',
      ticketIds: [],
      title: `${count} 项收件箱建议待应用`,
      type: 'inbox_needs_attention',
    }))
  } else if (inboxSummary.readyEntryCount > 0) {
    recommendations.push(buildRecommendation({
      actionKind: 'open_inbox',
      actionLabel: '整理材料',
      canBatch: false,
      detail: '已有材料完成本地提取，等待整理成行程或票据建议。',
      evidence: [`${inboxSummary.readyEntryCount} 条收件材料待整理。`],
      id: 'ops-inbox-ready',
      message: '打开旅行收件箱，生成可确认的整理预览。',
      readinessIssueIds: [],
      requiresConfirm: false,
      requiresPreview: true,
      severity: 'low',
      ticketIds: [],
      title: `${inboxSummary.readyEntryCount} 条收件可整理`,
      type: 'inbox_needs_attention',
    }))
  }

  if (inboxSummary.accountNeedsAssignmentCount > 0 || inboxSummary.accountErrorCount > 0 || inboxSummary.errorEntryCount > 0) {
    const count = inboxSummary.accountNeedsAssignmentCount + inboxSummary.accountErrorCount + inboxSummary.errorEntryCount
    recommendations.push(buildRecommendation({
      actionKind: 'open_inbox',
      actionLabel: '处理收件箱',
      canBatch: false,
      detail: '有来源需要选择旅行、重试或人工处理。',
      evidence: [`${count} 条收件箱来源需要处理。`],
      id: 'ops-inbox-attention',
      message: '打开旅行收件箱处理待分配或失败来源。',
      readinessIssueIds: [],
      requiresConfirm: false,
      requiresPreview: false,
      severity: inboxSummary.accountErrorCount + inboxSummary.errorEntryCount > 0 ? 'medium' : 'low',
      ticketIds: [],
      title: `${count} 条收件箱来源需处理`,
      type: 'inbox_needs_attention',
    }))
  }

  return recommendations
}

function buildTicketCacheRecommendations(
  tickets: TicketMeta[],
  states: TicketBlobSyncState[],
): TripOperationsRecommendation[] {
  const ticketById = new Map(tickets.map((ticket) => [ticket.id, ticket]))
  const cleanupTargets = states
    .filter((state) => state.uploadStatus === 'synced' && state.cacheStatus === 'cached' && Boolean(state.cloudStoragePath))
    .map((state) => ticketById.get(state.ticketId))
    .filter((ticket): ticket is TicketMeta => {
      if (!ticket) {
        return false
      }
      return getTicketStorageMode(ticket) === 'copy'
    })

  if (cleanupTargets.length === 0) {
    return []
  }

  return [buildRecommendation({
    actionKind: 'clear_ticket_cache',
    actionLabel: '清理缓存',
    canBatch: true,
    detail: cleanupTargets.slice(0, 2).map(getTicketDisplayTitle).join('、'),
    evidence: [`${cleanupTargets.length} 张票据已同步到账号，可清理此设备离线缓存。`],
    id: 'ops-ticket-cache-cleanup',
    message: '只会删除此设备离线文件，账号中的票据文件仍保留。',
    readinessIssueIds: [],
    requiresConfirm: true,
    requiresPreview: false,
    severity: 'low',
    ticketIds: cleanupTargets.map((ticket) => ticket.id),
    title: `${cleanupTargets.length} 张已同步票据可清理缓存`,
    type: 'synced_ticket_cache',
  })]
}

function buildTomorrowRecommendations({
  dailyTipModel,
  phase,
}: {
  dailyTipModel?: TripDailyTravelTipModel | null
  phase: TripOperationsPhase
}): TripOperationsRecommendation[] {
  if (phase !== 'travel_evening' || dailyTipModel?.mode !== 'tomorrow' || !dailyTipModel.targetDay) {
    return []
  }
  const itemCount = dailyTipModel.targetItems.length
  return [buildRecommendation({
    actionKind: 'review_tomorrow',
    actionLabel: '检查明日',
    canBatch: false,
    dayId: dailyTipModel.targetDay.id,
    detail: `${dailyTipModel.subtitle}${itemCount > 0 ? ` · ${itemCount} 个行程点` : ''}`,
    evidence: dailyTipModel.warnings,
    id: `ops-tomorrow-review-${dailyTipModel.targetDay.id}`,
    message: '今天结束后，优先确认明日首站、票据、路线和开放时间。',
    readinessIssueIds: [],
    requiresConfirm: false,
    requiresPreview: false,
    severity: 'low',
    ticketIds: [],
    title: '检查明日行程',
    type: 'tomorrow_review',
  })]
}

function buildPostTripSyncRecommendation({
  cloudSummary,
  phase,
}: {
  cloudSummary?: CloudSyncQueueSummary | null
  phase: TripOperationsPhase
}) {
  if (phase !== 'post_trip' || !cloudSummary || cloudSummary.syncItemCount === 0) {
    return []
  }
  return [buildRecommendation({
    actionKind: 'open_sync',
    actionLabel: '查看同步',
    canBatch: false,
    detail: '旅行结束后建议确认云同步队列已经清空。',
    evidence: [`${cloudSummary.syncItemCount} 项同步状态待确认。`],
    id: 'ops-post-trip-sync',
    message: '处理同步队列后，再清理本机离线缓存更稳妥。',
    readinessIssueIds: [],
    requiresConfirm: cloudSummary.conflictCount > 0 || cloudSummary.errorObjectCount > 0,
    requiresPreview: false,
    severity: cloudSummary.conflictCount > 0 || cloudSummary.errorObjectCount > 0 ? 'high' : 'low',
    ticketIds: [],
    title: '结束后确认同步状态',
    type: 'cloud_sync_pending',
  })]
}

function buildRecommendation(input: RecommendationDraft): TripOperationsRecommendation {
  return {
    ...input,
    phaseWeight: 0,
    priority: 0,
  }
}

function sortRecommendations(recommendations: TripOperationsRecommendation[], phase: TripOperationsPhase) {
  return recommendations
    .map((recommendation) => {
      const phaseWeight = getPhaseWeight(recommendation, phase)
      const priority = severityRank(recommendation.severity) * 100 + phaseWeight
      return { ...recommendation, phaseWeight, priority }
    })
    .sort((first, second) =>
      second.priority - first.priority ||
      first.title.localeCompare(second.title, 'zh-CN') ||
      first.id.localeCompare(second.id),
    )
}

function getPhaseWeight(recommendation: TripOperationsRecommendation, phase: TripOperationsPhase) {
  const type = recommendation.type
  if (phase === 'pre_trip') {
    if (type === 'missing_route' || type === 'missing_ticket' || type === 'missing_coordinate') return 35
    if (type === 'inbox_needs_attention') return 30
    if (type === 'missing_content' || type === 'daily_tip_missing') return 20
  }
  if (phase === 'travel_morning') {
    if (type === 'daily_tip_missing' || type === 'missing_route') return 35
    if (type === 'route_long_distance' || type === 'time_conflict') return 30
    if (type === 'missing_ticket') return 25
  }
  if (phase === 'traveling') {
    if (type === 'route_long_distance' || type === 'time_conflict') return 35
    if (type === 'missing_ticket' || type === 'ticket_unsynced') return 25
    if (type === 'inbox_needs_attention') return 15
  }
  if (phase === 'travel_evening') {
    if (type === 'tomorrow_review' || type === 'daily_tip_missing') return 35
    if (type === 'missing_route' || type === 'missing_content') return 30
    if (type === 'cloud_sync_pending' || type === 'ticket_unsynced') return 25
  }
  if (phase === 'post_trip') {
    if (type === 'cloud_sync_pending' || type === 'synced_ticket_cache') return 35
    if (type === 'inbox_needs_attention') return 25
  }
  return 10
}

function getReadinessGroupKey(issue: TripReadinessIssue) {
  if (issue.type === 'ticket_unsynced') {
    return `${issue.type}:${issue.severity}:${issue.actionKind}`
  }
  if (issue.type === 'route_long_distance' || issue.type === 'time_conflict') {
    return `${issue.type}:${issue.severity}:${issue.dayId ?? 'trip'}`
  }
  return `${issue.type}:${issue.actionKind}`
}

function buildSummaryMessage(phase: TripOperationsPhase, visible: TripOperationsRecommendation[], totalCount: number) {
  if (totalCount === 0) {
    return phase === 'post_trip'
      ? '这趟旅行已收尾，暂时没有需要优先处理的事项。'
      : '当前没有明显阻塞项，可以直接查看今天安排。'
  }
  const first = visible[0]
  return `${getTripOperationsPhaseLabel(phase)}优先处理：${first.title}${totalCount > visible.length ? `，另有 ${totalCount - visible.length} 项在详细检查中。` : '。'}`
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function maxSeverity(severities: TripReadinessSeverity[]): TripReadinessSeverity {
  return severities.sort((first, second) => severityRank(second) - severityRank(first))[0] ?? 'low'
}

function severityRank(severity: TripReadinessSeverity) {
  if (severity === 'high') return 3
  if (severity === 'medium') return 2
  return 1
}
