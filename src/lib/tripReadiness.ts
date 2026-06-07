import type { TripDailyTravelTipModel } from './ai/tripDailyTravelTip'
import type { CloudSyncQueueSummary } from './cloudSyncQueueSummary'
import type { TripRoutePreparation } from './routePreparation'
import type { TripCheckResult } from './tripCheck'
import type { Day, ItineraryItem, TicketBlobSyncState, TicketMeta, Trip } from '../types'

export type TripReadinessIssueType =
  | 'missing_coordinate'
  | 'missing_route'
  | 'missing_ticket'
  | 'ticket_unsynced'
  | 'missing_content'
  | 'route_long_distance'
  | 'time_conflict'
  | 'daily_tip_missing'
  | 'cloud_sync_pending'

export type TripReadinessSeverity = 'low' | 'medium' | 'high'

export type TripReadinessActionKind =
  | 'navigate_item'
  | 'navigate_tickets'
  | 'generate_routes'
  | 'retry_ticket_upload'
  | 'generate_content_preview'
  | 'generate_daily_tip_preview'
  | 'open_sync'
  | 'open_route_panel'

export type TripReadinessIssue = {
  actionKind: TripReadinessActionKind
  actionLabel: string
  canBatchFix: boolean
  dayId?: string
  defaultSelected: boolean
  evidence: string[]
  id: string
  itemId?: string
  message: string
  requiresPreview: boolean
  severity: TripReadinessSeverity
  ticketId?: string
  title: string
  type: TripReadinessIssueType
}

export type TripReadinessStatus = 'ready' | 'needs_attention' | 'high_risk'

export type TripReadinessSummary = {
  fixableCount: number
  highRiskCount: number
  message: string
  selectedCount: number
  status: TripReadinessStatus
  statusLabel: string
  totalCount: number
}

export type TripReadinessModel = {
  issues: TripReadinessIssue[]
  summary: TripReadinessSummary
}

export type TripReadinessRepairPreview = {
  contentItemIds: string[]
  dailyTipRequested: boolean
  excludedIssueIds: string[]
  issueIds: string[]
  requestCounts: {
    contentPreviewTargets: number
    dailyTipPreview: number
    routeGeneration: number
    ticketUploadRetry: number
    totalProviderRequests: number
  }
  routeDayIds: string[]
  ticketIds: string[]
}

export type TripReadinessRepairPreviewMode = 'batch' | 'single'

export type BuildTripReadinessInput = {
  allItems: ItineraryItem[]
  cloudSummary?: CloudSyncQueueSummary | null
  dailyTipModel?: TripDailyTravelTipModel | null
  days: Day[]
  itemsByDay: Record<string, ItineraryItem[]>
  routePreparation?: TripRoutePreparation | null
  ticketBlobSyncStates?: TicketBlobSyncState[]
  tickets: TicketMeta[]
  trip: Trip
  tripCheck?: TripCheckResult | null
}

const DAILY_TIP_MARKER_PREFIX = '## 今日旅行提示 · '
const MEDIUM_ROUTE_DISTANCE_METERS = 25_000
const HIGH_ROUTE_DISTANCE_METERS = 60_000
const ROUGH_TRAVEL_SPEED_KMH = 35

export function buildTripReadinessModel({
  allItems,
  cloudSummary,
  dailyTipModel,
  days,
  itemsByDay,
  routePreparation,
  ticketBlobSyncStates = [],
  tickets,
  trip,
  tripCheck,
}: BuildTripReadinessInput): TripReadinessModel {
  const dayById = new Map(days.map((day) => [day.id, day]))
  const itemById = new Map(allItems.map((item) => [item.id, item]))
  const ticketById = new Map(tickets.map((ticket) => [ticket.id, ticket]))
  const evidenceById = new Map((tripCheck?.evidence ?? []).map((evidence) => [evidence.id, evidence]))
  const issues: TripReadinessIssue[] = []
  const seenIssueIds = new Set<string>()

  function addIssue(issue: TripReadinessIssue) {
    if (seenIssueIds.has(issue.id)) {
      return
    }
    seenIssueIds.add(issue.id)
    issues.push(issue)
  }

  for (const finding of [...tripCheck?.warnings ?? [], ...tripCheck?.suggestions ?? []]) {
    const evidence = finding.evidenceIds
      .map((id) => evidenceById.get(id)?.message)
      .filter((message): message is string => Boolean(message))
    const itemId = finding.affectedItemIds[0]
    const item = itemId ? itemById.get(itemId) : undefined
    const dayId = finding.affectedDayIds[0] ?? item?.dayId

    if (finding.ruleId === 'missing_coordinate' || finding.ruleId === 'invalid_coordinate') {
      addIssue({
        actionKind: 'navigate_item',
        actionLabel: '补全地点',
        canBatchFix: false,
        dayId,
        defaultSelected: false,
        evidence: nonEmptyEvidence(evidence, item?.title ? [`${item.title} 缺少可用于地图和导航的坐标。`] : []),
        id: `readiness-missing-coordinate-${itemId ?? finding.id}`,
        itemId,
        message: finding.message,
        requiresPreview: false,
        severity: 'medium',
        title: finding.title,
        type: 'missing_coordinate',
      })
      continue
    }

    if (finding.ruleId === 'missing_ticket') {
      addIssue({
        actionKind: 'navigate_tickets',
        actionLabel: '打开票据',
        canBatchFix: false,
        dayId,
        defaultSelected: false,
        evidence: nonEmptyEvidence(evidence, item?.title ? [`${item.title} 当前没有绑定票据。`] : []),
        id: `readiness-missing-ticket-${itemId ?? finding.id}`,
        itemId,
        message: finding.message,
        requiresPreview: false,
        severity: 'medium',
        title: finding.title,
        type: 'missing_ticket',
      })
      continue
    }

    if (
      finding.ruleId === 'overlap_time' ||
      finding.ruleId === 'short_gap' ||
      finding.ruleId === 'missing_transport_duration'
    ) {
      const isHigh = finding.severity === 'critical'
      addIssue({
        actionKind: 'navigate_item',
        actionLabel: finding.ruleId === 'missing_transport_duration' ? '补充交通耗时' : '调整时间冲突',
        canBatchFix: false,
        dayId,
        defaultSelected: false,
        evidence: nonEmptyEvidence(evidence, [finding.message]),
        id: `readiness-time-conflict-${finding.id}`,
        itemId,
        message: finding.message,
        requiresPreview: isHigh,
        severity: isHigh ? 'high' : 'medium',
        title: finding.title,
        type: 'time_conflict',
      })
    }
  }

  if (routePreparation) {
    for (const routeDay of routePreparation.days) {
      const day = routeDay.day
      const isGeneratable = routeDay.status === 'ready_to_generate' || routeDay.status === 'stale_if_cache_key_changed'
      if (!isGeneratable && routeDay.status !== 'not_enough_points') {
        continue
      }
      if (!routeDay.eligible) {
        continue
      }

      if (!routePreparation.providerConfigured) {
        addIssue({
          actionKind: 'open_route_panel',
          actionLabel: '生成路线',
          canBatchFix: false,
          dayId: day.id,
          defaultSelected: false,
          evidence: [`${day.title} 有 ${routeDay.coordinateCount} 个坐标点，但当前路线服务不可用。`],
          id: `readiness-missing-route-provider-${day.id}`,
          message: '配置路线服务后可以生成并缓存当天路线。',
          requiresPreview: false,
          severity: 'medium',
          title: '路线服务未配置',
          type: 'missing_route',
        })
        continue
      }

      if (isGeneratable) {
        addIssue({
          actionKind: 'generate_routes',
          actionLabel: '生成路线',
          canBatchFix: true,
          dayId: day.id,
          defaultSelected: true,
          evidence: [`${day.title} 可生成路线预览，坐标点 ${routeDay.coordinateCount} 个。`],
          id: `readiness-missing-route-${day.id}`,
          message: routeDay.status === 'stale_if_cache_key_changed'
            ? '这一天已有路线缓存，但行程坐标已变化，建议重新生成。'
            : '这一天还没有路线缓存，出发前建议生成路线预览。',
          requiresPreview: true,
          severity: 'low',
          title: routeDay.status === 'stale_if_cache_key_changed' ? '路线缓存可能过期' : '缺少路线预览',
          type: 'missing_route',
        })
      }
    }
  }

  for (const issue of buildLongDistanceIssues(days, itemsByDay)) {
    addIssue(issue)
  }

  for (const item of allItems) {
    const missingParts = getMissingContentParts(item)
    if (missingParts.length === 0) {
      continue
    }
    addIssue({
      actionKind: 'generate_content_preview',
      actionLabel: '补充景点内容',
      canBatchFix: true,
      dayId: item.dayId,
      defaultSelected: true,
      evidence: [`缺少${missingParts.join('、')}。`],
      id: `readiness-missing-content-${item.id}`,
      itemId: item.id,
      message: '可生成带来源的景点内容预览，确认后再写入行程点。',
      requiresPreview: true,
      severity: 'low',
      title: `${item.title} 缺少出行信息`,
      type: 'missing_content',
    })
  }

  for (const state of ticketBlobSyncStates) {
    const ticket = ticketById.get(state.ticketId)
    const title = ticket?.title || ticket?.fileName || state.fileName || state.ticketId
    if (state.uploadStatus === 'synced') {
      continue
    }
    if (state.uploadStatus === 'pending') {
      addIssue({
        actionKind: 'retry_ticket_upload',
        actionLabel: '重新同步票据',
        canBatchFix: true,
        defaultSelected: true,
        evidence: [`${title} 等待上传到云端。`],
        id: `readiness-ticket-unsynced-${state.ticketId}`,
        itemId: ticket?.itemId,
        message: '票据文件还在本地队列中，确认后可重新置为待上传。',
        requiresPreview: true,
        severity: 'low',
        ticketId: state.ticketId,
        title: '票据等待同步',
        type: 'ticket_unsynced',
      })
      continue
    }
    if (state.uploadStatus === 'uploading') {
      addIssue({
        actionKind: 'open_sync',
        actionLabel: '查看同步状态',
        canBatchFix: false,
        defaultSelected: false,
        evidence: [`${title} 正在上传。`],
        id: `readiness-ticket-uploading-${state.ticketId}`,
        itemId: ticket?.itemId,
        message: '票据正在同步中，出发前建议确认完成状态。',
        requiresPreview: false,
        severity: 'low',
        ticketId: state.ticketId,
        title: '票据正在同步',
        type: 'ticket_unsynced',
      })
      continue
    }

    const isMissingOrDeleted = state.uploadStatus === 'missing' || state.uploadStatus === 'deleted'
    addIssue({
      actionKind: isMissingOrDeleted ? 'open_sync' : 'retry_ticket_upload',
      actionLabel: isMissingOrDeleted ? '查看同步问题' : '重新同步票据',
      canBatchFix: false,
      defaultSelected: false,
      evidence: [state.lastError ? `${title}：${state.lastError}` : `${title} 同步状态为 ${state.uploadStatus}。`],
      id: `readiness-ticket-${state.uploadStatus}-${state.ticketId}`,
      itemId: ticket?.itemId,
      message: isMissingOrDeleted ? '票据本地文件或云端引用需要人工核对。' : '票据上传失败，需要确认后重试。',
      requiresPreview: true,
      severity: 'high',
      ticketId: state.ticketId,
      title: isMissingOrDeleted ? '票据文件缺失' : '票据同步失败',
      type: 'ticket_unsynced',
    })
  }

  if (cloudSummary && cloudSummary.syncItemCount > 0) {
    const isHigh = cloudSummary.conflictCount > 0 ||
      cloudSummary.errorObjectCount > 0 ||
      cloudSummary.ticketDeletedCount > 0 ||
      cloudSummary.ticketErrorCount > 0
    addIssue({
      actionKind: 'open_sync',
      actionLabel: '查看同步与归档',
      canBatchFix: false,
      defaultSelected: false,
      evidence: buildCloudSyncEvidence(cloudSummary),
      id: `readiness-cloud-sync-${trip.id}`,
      message: isHigh ? '云同步存在失败或冲突，建议出发前处理。' : '仍有本地修改或票据上传在同步队列中。',
      requiresPreview: isHigh,
      severity: isHigh ? 'high' : 'low',
      title: isHigh ? '云同步存在风险' : '云同步尚未完成',
      type: 'cloud_sync_pending',
    })
  }

  if (dailyTipModel?.targetDate && !hasSavedDailyTravelTipForDate(trip.notes, dailyTipModel.targetDate)) {
    addIssue({
      actionKind: 'generate_daily_tip_preview',
      actionLabel: '生成每日提示',
      canBatchFix: true,
      dayId: dailyTipModel.targetDay?.id,
      defaultSelected: true,
      evidence: [`旅行备注中没有 ${DAILY_TIP_MARKER_PREFIX}${dailyTipModel.targetDate}。`],
      id: `readiness-daily-tip-${dailyTipModel.targetDate}`,
      message: '可先生成增强提示预览，确认后再保存到旅行备注。',
      requiresPreview: true,
      severity: 'low',
      title: '缺少每日旅行提示',
      type: 'daily_tip_missing',
    })
  }

  const sortedIssues = sortReadinessIssues(issues, dayById)
  return {
    issues: sortedIssues,
    summary: buildReadinessSummary(sortedIssues),
  }
}

export function buildTripReadinessRepairPreview(
  model: TripReadinessModel,
  selectedIssueIds: string[],
  mode: TripReadinessRepairPreviewMode = 'batch',
): TripReadinessRepairPreview {
  const selected = new Set(selectedIssueIds)
  const issueIds: string[] = []
  const excludedIssueIds: string[] = []
  const routeDayIds = new Set<string>()
  const ticketIds = new Set<string>()
  const contentItemIds = new Set<string>()
  let dailyTipRequested = false

  for (const issue of model.issues) {
    if (!selected.has(issue.id)) {
      continue
    }
    if (!canIncludeIssueInRepairPreview(issue, mode)) {
      excludedIssueIds.push(issue.id)
      continue
    }
    issueIds.push(issue.id)
    if (issue.actionKind === 'generate_routes' && issue.dayId) {
      routeDayIds.add(issue.dayId)
    }
    if (issue.actionKind === 'retry_ticket_upload' && issue.ticketId) {
      ticketIds.add(issue.ticketId)
    }
    if (issue.actionKind === 'generate_content_preview' && issue.itemId) {
      contentItemIds.add(issue.itemId)
    }
    if (issue.actionKind === 'generate_daily_tip_preview') {
      dailyTipRequested = true
    }
  }

  const routeDayIdList = [...routeDayIds]
  const ticketIdList = [...ticketIds]
  const contentItemIdList = [...contentItemIds]

  return {
    contentItemIds: contentItemIdList,
    dailyTipRequested,
    excludedIssueIds,
    issueIds,
    requestCounts: {
      contentPreviewTargets: contentItemIdList.length,
      dailyTipPreview: dailyTipRequested ? 1 : 0,
      routeGeneration: routeDayIdList.length,
      ticketUploadRetry: ticketIdList.length,
      totalProviderRequests: routeDayIdList.length + contentItemIdList.length + (dailyTipRequested ? 1 : 0),
    },
    routeDayIds: routeDayIdList,
    ticketIds: ticketIdList,
  }
}

function canIncludeIssueInRepairPreview(issue: TripReadinessIssue, mode: TripReadinessRepairPreviewMode) {
  if (mode === 'batch') {
    return issue.canBatchFix && issue.severity === 'low'
  }
  return issue.requiresPreview && (
    issue.actionKind === 'generate_routes' ||
    issue.actionKind === 'retry_ticket_upload' ||
    issue.actionKind === 'generate_content_preview' ||
    issue.actionKind === 'generate_daily_tip_preview'
  )
}

export function hasSavedDailyTravelTipForDate(notes: string | undefined, targetDate: string) {
  return Boolean(notes?.includes(`${DAILY_TIP_MARKER_PREFIX}${targetDate}`))
}

function buildLongDistanceIssues(days: Day[], itemsByDay: Record<string, ItineraryItem[]>): TripReadinessIssue[] {
  const issues: TripReadinessIssue[] = []
  for (const day of sortDays(days)) {
    const items = sortItems(itemsByDay[day.id] ?? [])
    for (let index = 1; index < items.length; index += 1) {
      const previous = items[index - 1]
      const current = items[index]
      if (!hasValidCoordinate(previous) || !hasValidCoordinate(current)) {
        continue
      }
      const distanceMeters = getDistanceMeters(previous.lat, previous.lng, current.lat, current.lng)
      if (distanceMeters <= MEDIUM_ROUTE_DISTANCE_METERS) {
        continue
      }
      const scheduleConflict = hasObviousDistanceTimeConflict(previous, current, distanceMeters)
      const severity: TripReadinessSeverity = distanceMeters > HIGH_ROUTE_DISTANCE_METERS || scheduleConflict ? 'high' : 'medium'
      issues.push({
        actionKind: 'navigate_item',
        actionLabel: '检查路线顺序',
        canBatchFix: false,
        dayId: day.id,
        defaultSelected: false,
        evidence: [buildDistanceEvidence(previous, current, distanceMeters, scheduleConflict)],
        id: `readiness-route-long-distance-${previous.id}-${current.id}`,
        itemId: current.id,
        message: severity === 'high'
          ? '相邻地点距离很远或与时间间隔明显冲突，需要人工确认。'
          : '相邻地点距离较远，建议确认路线和交通方式。',
        requiresPreview: severity === 'high',
        severity,
        title: severity === 'high' ? '路线距离高风险' : '路线距离偏远',
        type: 'route_long_distance',
      })
    }
  }
  return issues
}

function getMissingContentParts(item: ItineraryItem) {
  if (!shouldCheckContent(item)) {
    return []
  }
  const parts: string[] = []
  if (!item.contentEnrichment?.openingHours) {
    parts.push('开放时间')
  }
  if (!item.contentEnrichment?.ticketPrice) {
    parts.push('票价')
  }
  return parts
}

function shouldCheckContent(item: ItineraryItem) {
  const text = [item.title, item.locationName, item.address].filter(Boolean).join(' ')
  if (!text.trim() && !hasValidCoordinate(item)) {
    return false
  }
  if (/酒店|hotel|机场|火车|高铁|车站|餐厅|饭店|reservation|booking/i.test(text)) {
    return false
  }
  return Boolean(item.locationName || item.address || hasValidCoordinate(item))
}

function buildCloudSyncEvidence(summary: CloudSyncQueueSummary) {
  const evidence: string[] = []
  if (summary.conflictCount > 0) evidence.push(`${summary.conflictCount} 个对象冲突`)
  if (summary.errorObjectCount > 0) evidence.push(`${summary.errorObjectCount} 个对象同步失败`)
  if (summary.pendingObjectCount > 0) evidence.push(`${summary.pendingObjectCount} 个对象等待同步`)
  if (summary.syncingObjectCount > 0) evidence.push(`${summary.syncingObjectCount} 个对象同步中`)
  if (summary.ticketPendingCount > 0) evidence.push(`${summary.ticketPendingCount} 张票据等待上传`)
  if (summary.ticketUploadingCount > 0) evidence.push(`${summary.ticketUploadingCount} 张票据上传中`)
  if (summary.ticketErrorCount > 0) evidence.push(`${summary.ticketErrorCount} 张票据上传失败`)
  if (summary.ticketDeletedCount > 0) evidence.push(`${summary.ticketDeletedCount} 张票据等待删除云端引用`)
  if (summary.dirtyTripCount > 0) evidence.push(`${summary.dirtyTripCount} 趟旅行有本地修改`)
  return evidence.length > 0 ? evidence : ['云同步队列尚未清空。']
}

function buildReadinessSummary(issues: TripReadinessIssue[]): TripReadinessSummary {
  const totalCount = issues.length
  const highRiskCount = issues.filter((issue) => issue.severity === 'high').length
  const selectedCount = issues.filter((issue) => issue.defaultSelected).length
  const fixableCount = issues.filter((issue) => issue.canBatchFix && issue.severity === 'low').length
  const status: TripReadinessStatus = highRiskCount > 0 ? 'high_risk' : totalCount > 0 ? 'needs_attention' : 'ready'
  return {
    fixableCount,
    highRiskCount,
    message: status === 'ready'
      ? '未发现明显阻塞项，仍建议人工核对关键预订信息。'
      : highRiskCount > 0
        ? `发现 ${totalCount} 项准备问题，其中 ${highRiskCount} 个高风险问题需要优先处理。`
        : `发现 ${totalCount} 项可处理内容，可先批量修复低风险项。`,
    selectedCount,
    status,
    statusLabel: status === 'ready'
      ? '可出行'
      : highRiskCount > 0
        ? `有 ${highRiskCount} 个高风险问题`
        : `需要处理 ${totalCount} 项`,
    totalCount,
  }
}

function sortReadinessIssues(issues: TripReadinessIssue[], dayById: Map<string, Day>) {
  return [...issues].sort((first, second) => {
    const severityDelta = severityRank(second.severity) - severityRank(first.severity)
    if (severityDelta !== 0) return severityDelta
    const firstDayOrder = first.dayId ? dayById.get(first.dayId)?.sortOrder ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER
    const secondDayOrder = second.dayId ? dayById.get(second.dayId)?.sortOrder ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER
    if (firstDayOrder !== secondDayOrder) return firstDayOrder - secondDayOrder
    return first.title.localeCompare(second.title, 'zh-CN')
  })
}

function severityRank(severity: TripReadinessSeverity) {
  if (severity === 'high') return 3
  if (severity === 'medium') return 2
  return 1
}

function nonEmptyEvidence(primary: string[], fallback: string[]) {
  return primary.length > 0 ? primary : fallback
}

function hasValidCoordinate(item: Pick<ItineraryItem, 'lat' | 'lng'>): item is Pick<ItineraryItem, 'lat' | 'lng'> & { lat: number; lng: number } {
  return typeof item.lat === 'number' &&
    Number.isFinite(item.lat) &&
    item.lat >= -90 &&
    item.lat <= 90 &&
    typeof item.lng === 'number' &&
    Number.isFinite(item.lng) &&
    item.lng >= -180 &&
    item.lng <= 180
}

function getDistanceMeters(
  firstLat: number,
  firstLng: number,
  secondLat: number,
  secondLng: number,
) {
  const radiusMeters = 6_371_000
  const firstPhi = toRadians(firstLat)
  const secondPhi = toRadians(secondLat)
  const deltaPhi = toRadians(secondLat - firstLat)
  const deltaLambda = toRadians(secondLng - firstLng)
  const a = Math.sin(deltaPhi / 2) ** 2 +
    Math.cos(firstPhi) * Math.cos(secondPhi) * Math.sin(deltaLambda / 2) ** 2
  return radiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function hasObviousDistanceTimeConflict(previous: ItineraryItem, current: ItineraryItem, distanceMeters: number) {
  const previousEnd = parseTimeMinutes(previous.endTime)
  const currentStart = parseTimeMinutes(current.startTime)
  if (previousEnd === null || currentStart === null) {
    return false
  }
  const gapMinutes = currentStart - previousEnd
  if (gapMinutes < 0) {
    return true
  }
  const requiredMinutes = (distanceMeters / 1000 / ROUGH_TRAVEL_SPEED_KMH) * 60
  return requiredMinutes > gapMinutes + 20
}

function buildDistanceEvidence(previous: ItineraryItem, current: ItineraryItem, distanceMeters: number, scheduleConflict: boolean) {
  const gap = getGapMinutes(previous, current)
  const distanceText = distanceMeters >= 10_000
    ? `${Math.round(distanceMeters / 1000)}km`
    : `${(distanceMeters / 1000).toFixed(1)}km`
  const timeText = gap === null ? '' : `，间隔 ${gap} 分钟`
  return `「${previous.title}」到「${current.title}」直线距离约 ${distanceText}${timeText}${scheduleConflict ? '，与时间安排明显冲突' : ''}。`
}

function getGapMinutes(previous: ItineraryItem, current: ItineraryItem) {
  const previousEnd = parseTimeMinutes(previous.endTime)
  const currentStart = parseTimeMinutes(current.startTime)
  if (previousEnd === null || currentStart === null) {
    return null
  }
  return currentStart - previousEnd
}

function parseTimeMinutes(value: string | undefined) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value?.trim() ?? '')
  if (!match) {
    return null
  }
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) {
    return null
  }
  return hour * 60 + minute
}

function sortDays(days: Day[]) {
  return [...days].sort((first, second) => first.sortOrder - second.sortOrder || first.date.localeCompare(second.date))
}

function sortItems(items: ItineraryItem[]) {
  return [...items].sort((first, second) => first.sortOrder - second.sortOrder || first.createdAt - second.createdAt)
}

function toRadians(value: number) {
  return value * Math.PI / 180
}
