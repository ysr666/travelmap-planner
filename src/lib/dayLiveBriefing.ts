import { parseTimeMinutes } from './dates'
import { describeItemTime, sortItineraryItems } from './itinerary'
import { hasValidCoordinates } from './mapLinks'
import {
  formatZonedTimeLabel,
  getZonedPlainDate,
  resolveDayTimeZone,
  resolveItemTimeRange,
} from './timeZone'
import { isTicketLikeItem } from './tripCheck'
import type { RoutePreparationDay } from './routePreparation'
import type { ContentEnrichmentFactSection, Day, ItineraryItem, Trip } from '../types'

export type DayLiveBriefingStatus =
  | 'not_started'
  | 'in_progress'
  | 'next_up'
  | 'late'
  | 'completed'
  | 'empty_day'

export type DayLiveBriefingTone = 'info' | 'warning' | 'critical'

export type DayLiveBriefingLine = {
  id: string
  label: string
  text: string
  tone?: DayLiveBriefingTone
}

export type DayLiveBriefingModel = {
  currentItem?: ItineraryItem
  currentTimeLabel: string
  locationLine: DayLiveBriefingLine
  nextItem?: ItineraryItem
  noticeLines: DayLiveBriefingLine[]
  openingHoursLine: DayLiveBriefingLine
  previousItem?: ItineraryItem
  routeRiskLines: DayLiveBriefingLine[]
  status: DayLiveBriefingStatus
  subtitle: string
  targetItem?: ItineraryItem
  ticketLine: DayLiveBriefingLine
  ticketPriceLine: DayLiveBriefingLine
  timeLine: DayLiveBriefingLine
  title: string
}

const LATE_GRACE_MINUTES = 10
const SHORT_BUFFER_MINUTES = 30
const TRANSPORT_BUFFER_MINUTES = 15

export function buildDayLiveBriefing({
  day,
  items,
  now = new Date(),
  routeDay,
  trip,
}: {
  day: Day
  items: ItineraryItem[]
  now?: Date
  routeDay?: RoutePreparationDay | null
  trip: Trip
}): DayLiveBriefingModel {
  const orderedItems = sortItineraryItems(items)
  const dayTimeZone = resolveDayTimeZone(trip, day)
  const currentTimeLabel = formatZonedTimeLabel(now, dayTimeZone)
  const baseSubtitle = '基于本地行程信息，不包含实时交通或实时开闭园。'

  if (orderedItems.length === 0) {
    return buildTerminalModel({
      currentTimeLabel,
      status: 'empty_day',
      subtitle: baseSubtitle,
      timeText: '这一天还没有行程点。',
      title: '今天暂无行程点',
    })
  }

  const today = getZonedPlainDate(now, dayTimeZone)
  const selection = selectLiveTarget(orderedItems, now, day, trip)
  if (day.date < today) {
    if (selection.status === 'in_progress' && selection.targetItem) {
      return buildItemModel({
        currentItem: selection.currentItem,
        currentTimeLabel,
        day,
        items: orderedItems,
        nextItem: selection.nextItem,
        now,
        previousItem: selection.previousItem,
        routeDay,
        status: selection.status,
        subtitle: baseSubtitle,
        targetItem: selection.targetItem,
        timeText: selection.timeText,
        title: buildLiveTitle(selection.status, selection.targetItem),
        trip,
      })
    }
    return buildTerminalModel({
      currentTimeLabel,
      status: 'completed',
      subtitle: baseSubtitle,
      timeText: '今日行程已结束，可以查看明日安排或回到旅行总览。',
      title: '今日行程已结束',
    })
  }

  const firstItem = orderedItems[0]
  if (day.date > today) {
    return buildItemModel({
      currentTimeLabel,
      day,
      items: orderedItems,
      now,
      routeDay,
      status: 'not_started',
      subtitle: baseSubtitle,
      targetItem: firstItem,
      timeText: `${day.date} 尚未开始，首站 ${describeItemTime(firstItem)}。`,
      title: `下一站：${firstItem.title}`,
      trip,
    })
  }

  if (selection.status === 'completed' || !selection.targetItem) {
    return buildTerminalModel({
      currentTimeLabel,
      status: 'completed',
      subtitle: baseSubtitle,
      timeText: '今日行程已结束，可以查看明日安排或回到旅行总览。',
      title: '今日行程已结束',
    })
  }

  return buildItemModel({
    currentItem: selection.currentItem,
    currentTimeLabel,
    day,
    items: orderedItems,
    nextItem: selection.nextItem,
    now,
    previousItem: selection.previousItem,
    routeDay,
    status: selection.status,
    subtitle: baseSubtitle,
    targetItem: selection.targetItem,
    timeText: selection.timeText,
    title: buildLiveTitle(selection.status, selection.targetItem),
    trip,
  })
}

function selectLiveTarget(items: ItineraryItem[], now: Date, day: Day, trip: Trip): {
  currentItem?: ItineraryItem
  nextItem?: ItineraryItem
  previousItem?: ItineraryItem
  status: DayLiveBriefingStatus
  targetItem?: ItineraryItem
  timeText: string
} {
  const nowEpochMs = now.getTime()

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    const range = resolveItemTimeRange({ day, item, trip })
    const start = range.startEpochMs
    const end = range.endEpochMs
    const previousItem = index > 0 ? items[index - 1] : undefined
    const nextItem = items[index + 1]

    if (start !== undefined && end !== undefined && start <= nowEpochMs && nowEpochMs <= end) {
      return {
        currentItem: item,
        nextItem,
        previousItem,
        status: 'in_progress',
        targetItem: item,
        timeText: `进行中，预计还有 ${formatMinutes(epochMinutesUntil(end, nowEpochMs))} 结束。`,
      }
    }

    if (start !== undefined && nowEpochMs < start) {
      return {
        nextItem: item,
        previousItem,
        status: index === 0 ? 'not_started' : 'next_up',
        targetItem: item,
        timeText: `距离计划开始还有 ${formatMinutes(epochMinutesUntil(start, nowEpochMs))}。`,
      }
    }

    if (start !== undefined && end === undefined) {
      const nextTimedStart = getNextTimedStartEpoch(items, index + 1, day, trip)
      if (nowEpochMs >= start && (nextTimedStart === undefined || nowEpochMs < nextTimedStart)) {
        const lateMinutes = Math.max(0, Math.floor((nowEpochMs - start) / 60_000))
        return {
          nextItem: item,
          previousItem,
          status: lateMinutes > LATE_GRACE_MINUTES ? 'late' : 'next_up',
          targetItem: item,
          timeText: lateMinutes > LATE_GRACE_MINUTES
            ? `已晚于计划开始约 ${formatMinutes(lateMinutes)}。`
            : '接近计划开始时间。',
        }
      }
    }
  }

  const untimedItem = items.find((item) => parseTimeMinutes(item.startTime) === null && parseTimeMinutes(item.endTime) === null)
  if (untimedItem) {
    const index = items.findIndex((item) => item.id === untimedItem.id)
    return {
      nextItem: untimedItem,
      previousItem: index > 0 ? items[index - 1] : undefined,
      status: index === 0 ? 'not_started' : 'next_up',
      targetItem: untimedItem,
      timeText: '下一站时间未定，请按现场节奏安排。',
    }
  }

  return {
    status: 'completed',
    timeText: '今日行程已结束，可以查看明日安排或回到旅行总览。',
  }
}

function getNextTimedStartEpoch(items: ItineraryItem[], startIndex: number, day: Day, trip: Trip) {
  for (let index = startIndex; index < items.length; index += 1) {
    const start = resolveItemTimeRange({ day, item: items[index], trip }).startEpochMs
    if (start !== undefined) {
      return start
    }
  }
  return undefined
}

function buildItemModel({
  currentItem,
  currentTimeLabel,
  day,
  items,
  nextItem,
  now,
  previousItem,
  routeDay,
  status,
  subtitle,
  targetItem,
  timeText,
  title,
  trip,
}: {
  currentItem?: ItineraryItem
  currentTimeLabel: string
  day: Day
  items: ItineraryItem[]
  nextItem?: ItineraryItem
  now: Date
  previousItem?: ItineraryItem
  routeDay?: RoutePreparationDay | null
  status: DayLiveBriefingStatus
  subtitle: string
  targetItem: ItineraryItem
  timeText: string
  title: string
  trip: Trip
}): DayLiveBriefingModel {
  return {
    currentItem,
    currentTimeLabel,
    locationLine: buildLocationLine(targetItem),
    nextItem,
    noticeLines: buildNoticeLines(targetItem),
    openingHoursLine: buildFactLine({
      emptyText: '待核对开放时间',
      id: 'opening-hours',
      label: '开放时间',
      section: targetItem.contentEnrichment?.openingHours,
      sources: targetItem.contentEnrichment?.sources ?? [],
    }),
    previousItem,
    routeRiskLines: buildRouteRiskLines({
      day,
      items,
      now,
      previousItem,
      routeDay,
      targetItem,
      trip,
    }),
    status,
    subtitle,
    targetItem,
    ticketLine: buildTicketLine(targetItem),
    ticketPriceLine: buildFactLine({
      emptyText: '待核对票价',
      id: 'ticket-price',
      label: '票价',
      section: targetItem.contentEnrichment?.ticketPrice,
      sources: targetItem.contentEnrichment?.sources ?? [],
    }),
    timeLine: { id: 'time', label: '时间', text: timeText, tone: status === 'late' ? 'warning' : 'info' },
    title,
  }
}

function buildTerminalModel({
  currentTimeLabel,
  status,
  subtitle,
  timeText,
  title,
}: {
  currentTimeLabel: string
  status: Extract<DayLiveBriefingStatus, 'completed' | 'empty_day'>
  subtitle: string
  timeText: string
  title: string
}): DayLiveBriefingModel {
  return {
    currentTimeLabel,
    locationLine: { id: 'location', label: '地点', text: '暂无下一站地点。' },
    noticeLines: [{ id: 'notice-empty', label: '注意事项', text: '暂无下一站注意事项。' }],
    openingHoursLine: { id: 'opening-hours', label: '开放时间', text: '暂无下一站开放时间。' },
    routeRiskLines: [{ id: 'route-completed', label: '路线风险', text: '暂无下一站路线风险。' }],
    status,
    subtitle,
    ticketLine: { id: 'tickets', label: '票据', text: '暂无下一站票据。' },
    ticketPriceLine: { id: 'ticket-price', label: '票价', text: '暂无下一站票价。' },
    timeLine: { id: 'time', label: '时间', text: timeText },
    title,
  }
}

function buildLiveTitle(status: DayLiveBriefingStatus, item: ItineraryItem) {
  if (status === 'in_progress') {
    return `正在进行：${item.title}`
  }
  if (status === 'late') {
    return `可能已经迟到：${item.title}`
  }
  return `下一站：${item.title}`
}

function buildLocationLine(item: ItineraryItem): DayLiveBriefingLine {
  const place = item.locationName || item.address || '地点未填写'
  if (hasValidCoordinates(item)) {
    return { id: 'location', label: '地点', text: `${place} · 坐标已填写` }
  }
  return { id: 'location', label: '地点', text: `${place} · 坐标待核对`, tone: 'warning' }
}

function buildTicketLine(item: ItineraryItem): DayLiveBriefingLine {
  const ticketCount = item.ticketIds.length
  if (ticketCount > 0) {
    return { id: 'tickets', label: '票据', text: `已绑定 ${ticketCount} 张票据` }
  }
  if (isTicketLikeItem(item)) {
    return { id: 'tickets', label: '票据', text: '标题像需要门票或预约，当前未绑定票据。', tone: 'warning' }
  }
  return { id: 'tickets', label: '票据', text: '无绑定票据需求迹象。' }
}

function buildFactLine({
  emptyText,
  id,
  label,
  section,
  sources,
}: {
  emptyText: string
  id: string
  label: string
  section?: ContentEnrichmentFactSection
  sources: { id: string }[]
}): DayLiveBriefingLine {
  const text = getSourceBackedText(section, sources)
  return { id, label, text: text ?? emptyText, tone: text ? 'info' : 'warning' }
}

function buildNoticeLines(item: ItineraryItem): DayLiveBriefingLine[] {
  const sources = item.contentEnrichment?.sources ?? []
  const notices = (item.contentEnrichment?.notices ?? [])
    .map((notice) => getSourceBackedText(notice, sources))
    .filter((text): text is string => Boolean(text))
    .slice(0, 2)

  if (notices.length === 0) {
    return [{ id: 'notice-empty', label: '注意事项', text: '待核对注意事项', tone: 'warning' }]
  }

  return notices.map((text, index) => ({
    id: `notice-${index + 1}`,
    label: index === 0 ? '注意事项' : '注意事项',
    text,
  }))
}

function buildRouteRiskLines({
  day,
  items,
  now,
  previousItem,
  routeDay,
  targetItem,
  trip,
}: {
  day: Day
  items: ItineraryItem[]
  now: Date
  previousItem?: ItineraryItem
  routeDay?: RoutePreparationDay | null
  targetItem: ItineraryItem
  trip: Trip
}): DayLiveBriefingLine[] {
  const lines: DayLiveBriefingLine[] = []

  if (!hasValidCoordinates(targetItem)) {
    lines.push({
      id: 'missing-target-coordinate',
      label: '路线风险',
      text: '下一站缺少坐标，地图和外部导航可能不完整。',
      tone: 'warning',
    })
  }

  if (previousItem) {
    if (!hasValidCoordinates(previousItem) || !hasValidCoordinates(targetItem)) {
      lines.push({
        id: 'missing-segment-coordinate',
        label: '路线风险',
        text: '上一站或下一站缺坐标，无法完整判断路段。',
        tone: 'warning',
      })
    }
    if (targetItem.previousTransportDurationMinutes === undefined) {
      lines.push({
        id: 'missing-transport-duration',
        label: '路线风险',
        text: '上一段交通耗时未填写，请现场预留机动时间。',
        tone: 'warning',
      })
    }
    const bufferLine = buildBufferRiskLine(previousItem, targetItem)
    if (bufferLine) {
      lines.push(bufferLine)
    }
  }

  const routeStatusLine = buildRouteStatusLine({ day, items, now, routeDay, trip })
  if (routeStatusLine) {
    lines.push(routeStatusLine)
  }

  if (lines.length === 0) {
    return [{ id: 'route-ok', label: '路线风险', text: '未发现明显本地路线风险。' }]
  }

  return dedupeLines(lines).slice(0, 3)
}

function buildBufferRiskLine(previousItem: ItineraryItem, targetItem: ItineraryItem): DayLiveBriefingLine | null {
  const previousEnd = parseTimeMinutes(previousItem.endTime)
  const targetStart = parseTimeMinutes(targetItem.startTime)
  if (previousEnd === null || targetStart === null) {
    return null
  }

  const gap = targetStart - previousEnd
  if (gap < 0) {
    return {
      id: 'overlap-time',
      label: '路线风险',
      text: '上一项结束时间晚于下一站开始时间，请核对安排。',
      tone: 'critical',
    }
  }

  const transportDuration = targetItem.previousTransportDurationMinutes
  if (transportDuration !== undefined && gap < transportDuration + TRANSPORT_BUFFER_MINUTES) {
    return {
      id: 'short-transport-buffer',
      label: '路线风险',
      text: `两站间隔 ${gap} 分钟，已填写交通约 ${transportDuration} 分钟，缓冲偏短。`,
      tone: 'warning',
    }
  }

  if (transportDuration === undefined && gap < SHORT_BUFFER_MINUTES) {
    return {
      id: 'short-buffer',
      label: '路线风险',
      text: `两站间隔仅 ${gap} 分钟，建议核对交通和排队时间。`,
      tone: 'warning',
    }
  }

  return null
}

function buildRouteStatusLine({
  day,
  items,
  now,
  routeDay,
  trip,
}: {
  day: Day
  items: ItineraryItem[]
  now: Date
  routeDay?: RoutePreparationDay | null
  trip: Trip
}): DayLiveBriefingLine | null {
  if (!routeDay) {
    return null
  }

  const dayIsRelevant = trip.id === day.tripId &&
    getZonedPlainDate(now, resolveDayTimeZone(trip, day)) <= day.date &&
    items.length > 0
  if (!dayIsRelevant) {
    return null
  }

  if (routeDay.status === 'cached') {
    return { id: 'route-cached', label: '路线风险', text: '当天已有路线预览缓存。' }
  }
  if (routeDay.status === 'stale_if_cache_key_changed') {
    return {
      id: 'route-stale',
      label: '路线风险',
      text: '当天路线预览可能已过期，建议在总览中重新生成。',
      tone: 'warning',
    }
  }
  if (routeDay.status === 'ready_to_generate') {
    return {
      id: 'route-ready',
      label: '路线风险',
      text: '当天可生成路线预览，但尚未生成。',
      tone: 'warning',
    }
  }
  if (routeDay.status === 'no_coordinates') {
    return {
      id: 'route-no-coordinates',
      label: '路线风险',
      text: '当天缺少可用于路线预览的坐标。',
      tone: 'warning',
    }
  }
  if (routeDay.status === 'not_enough_points') {
    return {
      id: 'route-not-enough-points',
      label: '路线风险',
      text: '当天至少需要两个坐标点才能生成路线预览。',
      tone: 'warning',
    }
  }

  return null
}

function getSourceBackedText(section: ContentEnrichmentFactSection | undefined, sources: { id: string }[]) {
  if (!section) {
    return null
  }
  const text = section.text.trim()
  if (!text) {
    return null
  }
  const sourceIds = new Set(sources.map((source) => source.id))
  if (!section.sourceIds.some((sourceId) => sourceIds.has(sourceId))) {
    return null
  }
  return text
}

function dedupeLines(lines: DayLiveBriefingLine[]) {
  const seen = new Set<string>()
  return lines.filter((line) => {
    if (seen.has(line.id)) {
      return false
    }
    seen.add(line.id)
    return true
  })
}

function formatMinutes(minutes: number) {
  if (minutes < 60) {
    return `${minutes} 分钟`
  }
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest > 0 ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`
}

function epochMinutesUntil(targetEpochMs: number, nowEpochMs: number) {
  return Math.max(0, Math.ceil((targetEpochMs - nowEpochMs) / 60_000))
}
