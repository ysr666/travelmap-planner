import { formatShortDateWithWeekday } from '../dates'
import { sortItineraryItems } from '../itinerary'
import {
  getZonedPlainDate,
  resolveDayTimeZone,
  resolveItemTimeRange,
} from '../timeZone'
import { recordTripWriteForSync } from '../tripSyncQueue'
import { db } from '../../db/database'
import {
  PROVIDER_PROXY_TRAVEL_SEARCH_OPERATION,
  PROVIDER_PROXY_TRIP_DAILY_TIP_OPERATION,
  type ProviderProxyTravelSearchResult,
  type ProviderProxyTravelSearchSuccessResponse,
  type ProviderProxyTravelSearchType,
  type ProviderProxyTripContentEnrichmentSourceSummary,
  type ProviderProxyTripDailyTipRequest,
  type ProviderProxyTripDailyTipSuccessResponse,
} from './providerProxyContract'
import {
  fetchProviderProxyTravelSearch,
  fetchProviderProxyTripDailyTip,
} from '../providerProxyClient'
import type { RoutePreparationDay, TripRoutePreparation } from '../routePreparation'
import type { TripCheckCard, TripCheckResult } from '../tripCheck'
import type {
  ContentEnrichmentConfidence,
  ContentEnrichmentFactSection,
  ContentEnrichmentSource,
  ContentEnrichmentSourceType,
  Day,
  ItineraryItem,
  Trip,
} from '../../types'

export type TripDailyTravelTipMode = 'pre_trip' | 'today' | 'tomorrow' | 'completed'
export type TripDailyTravelTipSectionKey = 'opening_hours' | 'ticket_price' | 'notices' | 'route_risk'

export type TripDailyTravelTipLine = {
  id: string
  itemId?: string
  sourceIds?: string[]
  severity?: 'info' | 'warning' | 'critical'
  text: string
  title: string
}

export type TripDailyTravelTipSection = {
  emptyText: string
  key: TripDailyTravelTipSectionKey
  lines: TripDailyTravelTipLine[]
  title: string
}

export type TripDailyTravelTipModel = {
  localSourceSummaries: ProviderProxyTripContentEnrichmentSourceSummary[]
  mode: TripDailyTravelTipMode
  routeStatus?: RoutePreparationDay['status']
  searchTargets: TripDailyTravelTipSearchTarget[]
  sections: TripDailyTravelTipSection[]
  subtitle: string
  targetDate?: string
  targetDay?: Day
  targetItems: ItineraryItem[]
  title: string
  warnings: string[]
}

export type TripDailyTravelTipSearchTarget = {
  itemId: string
  itemTitle: string
  query: string
  reason: string
  searchType: ProviderProxyTravelSearchType
}

export type TripDailyTravelTipEnhancedPreview = {
  baselineFingerprint: string
  generatedAt: string
  requestCounts: {
    aiSynthesis: number
    total: number
    travelSearch: number
  }
  response: ProviderProxyTripDailyTipSuccessResponse
  sources: ProviderProxyTripContentEnrichmentSourceSummary[]
  targetDate?: string
  targetTitle: string
  warnings: string[]
}

export type TripDailyTravelTipProviderClients = {
  travelSearch?: typeof fetchProviderProxyTravelSearch
  tripDailyTip?: typeof fetchProviderProxyTripDailyTip
}

export type TripDailyTravelTipSaveResult =
  | { ok: true }
  | { errors: string[]; ok: false }

const MAX_SECTION_LINES = 3
const MAX_SEARCH_TARGETS = 3
const HOTEL_END_PATTERN = /回酒店|返回酒店|入住|住宿|酒店|hotel|check[-\s]?in/i

export function buildTripDailyTravelTip({
  days,
  itemsByDay,
  now = new Date(),
  routePreparation,
  trip,
  tripCheck,
}: {
  days: Day[]
  itemsByDay: Record<string, ItineraryItem[]>
  now?: Date
  routePreparation?: TripRoutePreparation | null
  trip: Trip
  tripCheck?: TripCheckResult | null
}): TripDailyTravelTipModel {
  const sortedDays = sortDays(days)
  const selection = selectTripDailyTravelTipTarget({ days: sortedDays, itemsByDay, now, trip })
  if (selection.mode === 'completed' || !selection.targetDay) {
    return {
      localSourceSummaries: [],
      mode: 'completed',
      searchTargets: [],
      sections: buildEmptyCompletedSections(),
      subtitle: '这趟旅行已经结束，已保存的内容仍可在行程点详情中查看。',
      targetItems: [],
      title: '旅行已结束',
      warnings: [],
    }
  }

  const targetItems = sortItineraryItems(itemsByDay[selection.targetDay.id] ?? [])
  const routeDay = routePreparation?.days.find((day) => day.day.id === selection.targetDay?.id)
  const scopedFindings = getScopedTripCheckFindings(tripCheck, selection.targetDay.id, targetItems)
  const localSourceSummaries = buildLocalSourceSummaries(targetItems)
  const sections = [
    buildOpeningHoursSection(targetItems),
    buildTicketPriceSection(targetItems),
    buildNoticeSection(targetItems),
    buildRouteRiskSection({ findings: scopedFindings, routeDay }),
  ]
  const modeLabel = selection.mode === 'pre_trip'
    ? '行前提示'
    : selection.mode === 'tomorrow'
      ? '明日提示'
      : '当日提示'
  const targetDateLabel = formatShortDateWithWeekday(selection.targetDay.date)
  const searchTargets = buildSearchTargets({
    routeDay,
    targetItems,
    trip,
  })

  return {
    localSourceSummaries,
    mode: selection.mode,
    routeStatus: routeDay?.status,
    searchTargets,
    sections,
    subtitle: `${targetDateLabel} · ${selection.targetDay.title}`,
    targetDate: selection.targetDay.date,
    targetDay: selection.targetDay,
    targetItems,
    title: modeLabel,
    warnings: selection.warning ? [selection.warning] : [],
  }
}

export function selectTripDailyTravelTipTarget({
  days,
  itemsByDay,
  now,
  trip,
}: {
  days: Day[]
  itemsByDay: Record<string, ItineraryItem[]>
  now: Date
  trip: Trip
}): { mode: TripDailyTravelTipMode; targetDay?: Day; warning?: string } {
  const sortedDays = sortDays(days)
  if (sortedDays.length === 0) {
    return { mode: 'completed' }
  }
  const todayIndex = sortedDays.findIndex((day) => day.date === getZonedPlainDate(now, resolveDayTimeZone(trip, day)))
  if (todayIndex < 0) {
    const futureDay = sortedDays.find((day) => day.date > getZonedPlainDate(now, resolveDayTimeZone(trip, day)))
    if (!futureDay) {
      return { mode: 'completed' }
    }
    return futureDay.id === sortedDays[0].id
      ? { mode: 'pre_trip', targetDay: futureDay }
      : { mode: 'tomorrow', targetDay: futureDay }
  }

  const todayDay = sortedDays[todayIndex]
  const tomorrowDay = sortedDays[todayIndex + 1]
  const todayItems = sortItineraryItems(itemsByDay[todayDay.id] ?? [])
  if (tomorrowDay && shouldSwitchToTomorrow(todayItems, now, todayDay, trip)) {
    return {
      mode: 'tomorrow',
      targetDay: tomorrowDay,
      warning: '今天的末段行程已结束，已切换到明日提示。',
    }
  }
  return { mode: 'today', targetDay: todayDay }
}

export function buildTripDailyTipBaselineFingerprint({
  targetDate,
  trip,
}: {
  targetDate?: string
  trip: Trip
}) {
  return JSON.stringify({
    endDate: trip.endDate,
    notes: trip.notes ?? '',
    startDate: trip.startDate,
    targetDate: targetDate ?? '',
    timeZone: trip.timeZone ?? '',
    title: trip.title,
    updatedAt: trip.updatedAt,
  })
}

export async function generateEnhancedTripDailyTravelTip({
  clients = {},
  model,
  proxyUrl,
  trip,
}: {
  clients?: TripDailyTravelTipProviderClients
  model: TripDailyTravelTipModel
  proxyUrl: string
  trip: Trip
}): Promise<TripDailyTravelTipEnhancedPreview> {
  if (!model.targetDay) {
    throw new Error('当前没有可生成增强提示的目标日期。')
  }
  const travelSearch = clients.travelSearch ?? fetchProviderProxyTravelSearch
  const tripDailyTip = clients.tripDailyTip ?? fetchProviderProxyTripDailyTip
  const generatedAt = new Date().toISOString()
  const warnings: string[] = []
  const searchSources: ProviderProxyTripContentEnrichmentSourceSummary[] = []
  const searchTargets = model.searchTargets.slice(0, MAX_SEARCH_TARGETS)

  for (const target of searchTargets) {
    try {
      const response = await travelSearch({
        locale: 'zh-CN',
        maxResults: 3,
        operation: PROVIDER_PROXY_TRAVEL_SEARCH_OPERATION,
        query: target.query,
        searchType: target.searchType,
      }, proxyUrl)
      searchSources.push(...buildSourcesFromSearchResponse(target, response))
    } catch {
      warnings.push(`${target.itemTitle} 的${target.reason}搜索失败。`)
    }
  }

  const sources = dedupeDailyTipSources(sortDailyTipSources([
    ...model.localSourceSummaries,
    ...searchSources,
  ]))
  if (sources.length === 0) {
    throw new Error('没有可用来源，未生成事实性增强提示。')
  }
  const request = buildTripDailyTipRequest({
    generatedAt,
    model,
    sources,
    trip,
  })
  const response = await tripDailyTip(request, proxyUrl)
  return {
    baselineFingerprint: buildTripDailyTipBaselineFingerprint({ targetDate: model.targetDate, trip }),
    generatedAt,
    requestCounts: {
      aiSynthesis: 1,
      total: searchTargets.length + 1,
      travelSearch: searchTargets.length,
    },
    response,
    sources,
    targetDate: model.targetDate,
    targetTitle: model.subtitle,
    warnings: dedupeStrings([...warnings, ...(response.warnings ?? [])]),
  }
}

export async function saveTripDailyTravelTipPreviewToNotes({
  expectedBaselineFingerprint,
  preview,
  tripId,
  now = Date.now(),
}: {
  expectedBaselineFingerprint?: string
  now?: number
  preview: TripDailyTravelTipEnhancedPreview
  tripId: string
}): Promise<TripDailyTravelTipSaveResult> {
  try {
    const result = await db.transaction('rw', db.trips, async () => {
      const trip = await db.trips.get(tripId)
      if (!trip) {
        return { errors: ['旅行不存在。'], ok: false as const }
      }
      if (expectedBaselineFingerprint) {
        const freshFingerprint = buildTripDailyTipBaselineFingerprint({ targetDate: preview.targetDate, trip })
        if (freshFingerprint !== expectedBaselineFingerprint) {
          return { errors: ['本地行程已变化，请重新生成增强提示。'], ok: false as const }
        }
      }
      await db.trips.update(tripId, {
        notes: appendDailyTipNotes(trip.notes, preview),
        updatedAt: now,
      })
      return { ok: true as const }
    })
    if (!result.ok) {
      return result
    }
    recordTripWriteForSync(tripId, 'trip-daily-tip-saved')
    return { ok: true }
  } catch {
    return { errors: ['保存今日旅行提示失败，旅行备注未完成写入。'], ok: false }
  }
}

export function appendDailyTipNotes(
  existingNotes: string | undefined,
  preview: TripDailyTravelTipEnhancedPreview,
) {
  const lines = [
    `## 今日旅行提示 · ${preview.targetDate ?? '未定日期'}`,
    preview.response.summary.trim(),
    ...preview.response.sections.map((section) => `- ${section.title}：${section.text}`),
  ]
  if (preview.response.sourceIds.length > 0) {
    const sourceLabels = preview.response.sourceIds
      .map((sourceId) => preview.sources.find((source) => source.id === sourceId))
      .filter((source): source is ProviderProxyTripContentEnrichmentSourceSummary => Boolean(source))
      .map((source) => source.label || source.title)
    if (sourceLabels.length > 0) {
      lines.push(`来源：${dedupeStrings(sourceLabels).join('、')}`)
    }
  }
  const nextSection = lines.filter(Boolean).join('\n')
  const current = existingNotes?.trim()
  return current ? `${current}\n\n${nextSection}` : nextSection
}

function buildTripDailyTipRequest({
  generatedAt,
  model,
  sources,
  trip,
}: {
  generatedAt: string
  model: TripDailyTravelTipModel
  sources: ProviderProxyTripContentEnrichmentSourceSummary[]
  trip: Trip
}): ProviderProxyTripDailyTipRequest {
  return {
    dayTitle: model.targetDay?.title,
    destination: trip.destination,
    generatedAt,
    items: model.targetItems.map((item) => ({
      endTime: clampText(item.endTime ?? '', 20) || undefined,
      itemId: item.id,
      locationName: clampText(item.locationName ?? item.address ?? '', 160) || undefined,
      startTime: clampText(item.startTime ?? '', 20) || undefined,
      title: clampText(item.title, 160),
    })),
    localSections: model.sections.map((section) => ({
      items: section.lines.map((line) => ({
        sourceIds: line.sourceIds,
        text: line.text,
        title: line.title,
      })),
      key: section.key,
      title: section.title,
    })),
    mode: model.mode,
    operation: PROVIDER_PROXY_TRIP_DAILY_TIP_OPERATION,
    routeStatus: model.routeStatus,
    sources,
    targetDate: model.targetDate,
    tripTitle: trip.title,
  }
}

function buildOpeningHoursSection(items: ItineraryItem[]): TripDailyTravelTipSection {
  const lines = items
    .map((item) => buildFactLine(item, item.contentEnrichment?.openingHours, '开放时间'))
    .filter((line): line is TripDailyTravelTipLine => Boolean(line))
    .slice(0, MAX_SECTION_LINES)
  return {
    emptyText: '待核对开放时间',
    key: 'opening_hours',
    lines,
    title: '开放时间',
  }
}

function buildTicketPriceSection(items: ItineraryItem[]): TripDailyTravelTipSection {
  const lines = items
    .map((item) => buildFactLine(item, item.contentEnrichment?.ticketPrice, '票价'))
    .filter((line): line is TripDailyTravelTipLine => Boolean(line))
    .slice(0, MAX_SECTION_LINES)
  return {
    emptyText: '待补充票价来源',
    key: 'ticket_price',
    lines,
    title: '票价',
  }
}

function buildNoticeSection(items: ItineraryItem[]): TripDailyTravelTipSection {
  const lines = items.flatMap((item) =>
    (item.contentEnrichment?.notices ?? []).map((notice, index) => ({
      id: `notice:${item.id}:${index}`,
      itemId: item.id,
      sourceIds: notice.sourceIds,
      text: notice.text,
      title: item.title,
    })),
  ).slice(0, MAX_SECTION_LINES)
  return {
    emptyText: '暂无已保存注意事项',
    key: 'notices',
    lines,
    title: '注意事项',
  }
}

function buildRouteRiskSection({
  findings,
  routeDay,
}: {
  findings: TripCheckCard[]
  routeDay?: RoutePreparationDay
}): TripDailyTravelTipSection {
  const routeLine = routeDay ? buildRouteStatusLine(routeDay) : null
  const findingLines = findings.map((finding) => ({
    id: `finding:${finding.id}`,
    severity: finding.severity,
    text: finding.message,
    title: finding.title,
  }))
  return {
    emptyText: '暂无明显路线风险',
    key: 'route_risk',
    lines: [routeLine, ...findingLines].filter((line): line is TripDailyTravelTipLine => Boolean(line)).slice(0, MAX_SECTION_LINES),
    title: '路线风险',
  }
}

function buildRouteStatusLine(routeDay: RoutePreparationDay): TripDailyTravelTipLine | null {
  if (routeDay.status === 'cached') {
    return {
      id: `route:${routeDay.day.id}`,
      severity: 'info',
      text: '当天路线预览已有缓存，可出发前再核对一次。',
      title: '路线已缓存',
    }
  }
  if (routeDay.status === 'ready_to_generate') {
    return {
      id: `route:${routeDay.day.id}`,
      severity: 'warning',
      text: `当天有 ${routeDay.coordinateCount} 个可用坐标点，尚未生成路线预览。`,
      title: '可生成路线',
    }
  }
  if (routeDay.status === 'stale_if_cache_key_changed') {
    return {
      id: `route:${routeDay.day.id}`,
      severity: 'warning',
      text: '当天已有路线缓存，但行程点或交通方式变化后建议重新生成。',
      title: '路线可能过期',
    }
  }
  if (routeDay.status === 'no_coordinates') {
    return {
      id: `route:${routeDay.day.id}`,
      severity: 'warning',
      text: '当天行程点缺少可用坐标，路线预览暂不可生成。',
      title: '缺少坐标',
    }
  }
  return {
    id: `route:${routeDay.day.id}`,
    severity: 'info',
    text: '当天可用于路线预览的坐标点不足 2 个。',
    title: '路线点不足',
  }
}

function buildFactLine(
  item: ItineraryItem,
  fact: ContentEnrichmentFactSection | undefined,
  label: string,
): TripDailyTravelTipLine | null {
  if (!fact?.text.trim() || fact.sourceIds.length === 0) {
    return null
  }
  return {
    id: `${label}:${item.id}`,
    itemId: item.id,
    sourceIds: fact.sourceIds,
    text: fact.text,
    title: item.title,
  }
}

function buildSearchTargets({
  routeDay,
  targetItems,
  trip,
}: {
  routeDay?: RoutePreparationDay
  targetItems: ItineraryItem[]
  trip: Trip
}): TripDailyTravelTipSearchTarget[] {
  const targets: TripDailyTravelTipSearchTarget[] = []
  for (const item of targetItems) {
    if (!item.contentEnrichment?.openingHours && targets.length < MAX_SEARCH_TARGETS) {
      targets.push(buildSearchTarget(item, trip, 'opening_hours', '开放时间'))
    }
    if (!item.contentEnrichment?.ticketPrice && targets.length < MAX_SEARCH_TARGETS) {
      targets.push(buildSearchTarget(item, trip, 'ticket_price', '票价来源'))
    }
  }
  if (routeDay && routeDay.status !== 'cached' && routeDay.status !== 'not_enough_points' && targets.length < MAX_SEARCH_TARGETS) {
    const firstItem = targetItems[0]
    if (firstItem) {
      targets.push(buildSearchTarget(firstItem, trip, 'transport', '路线风险'))
    }
  }
  return targets.slice(0, MAX_SEARCH_TARGETS)
}

function buildSearchTarget(
  item: ItineraryItem,
  trip: Trip,
  searchType: ProviderProxyTravelSearchType,
  reason: string,
): TripDailyTravelTipSearchTarget {
  const suffix = searchType === 'ticket_price'
    ? '门票 票价 官网'
    : searchType === 'opening_hours'
      ? '开放时间 官网'
      : '交通 到达 提示'
  return {
    itemId: item.id,
    itemTitle: item.title,
    query: clampText(dedupeStrings([
      item.locationName,
      item.address,
      item.title,
      trip.destination,
      suffix,
    ]).join(' '), 300),
    reason,
    searchType,
  }
}

function buildLocalSourceSummaries(items: ItineraryItem[]): ProviderProxyTripContentEnrichmentSourceSummary[] {
  const sourcesById = new Map<string, ProviderProxyTripContentEnrichmentSourceSummary>()
  for (const item of items) {
    const enrichment = item.contentEnrichment
    if (!enrichment) {
      continue
    }
    for (const source of enrichment.sources) {
      if (!sourcesById.has(source.id)) {
        sourcesById.set(source.id, toSourceSummary(source, `已保存来源 · ${item.title}`))
      }
    }
  }
  return sortDailyTipSources([...sourcesById.values()]).slice(0, 12)
}

function buildSourcesFromSearchResponse(
  target: TripDailyTravelTipSearchTarget,
  response: ProviderProxyTravelSearchSuccessResponse,
): ProviderProxyTripContentEnrichmentSourceSummary[] {
  return response.results
    .filter((result) => result.snippet?.trim() || result.url)
    .map((result, index) => ({
      confidence: mapSearchConfidence(result.confidence),
      displayUrl: result.displayUrl,
      domain: result.domain,
      id: `daily-search:${target.itemId}:${stableHash(`${result.url}:${result.title}:${index}`)}`,
      label: formatSearchSourceLabel(result.sourceType),
      retrievedAt: result.retrievedAt,
      snippet: result.snippet,
      sourceType: mapSearchSourceType(result.sourceType),
      title: result.title,
      url: result.url,
    }))
}

function toSourceSummary(
  source: ContentEnrichmentSource,
  fallbackLabel: string,
): ProviderProxyTripContentEnrichmentSourceSummary {
  return {
    confidence: source.confidence,
    displayUrl: source.displayUrl,
    domain: source.domain,
    id: source.id,
    label: source.label || fallbackLabel,
    retrievedAt: source.retrievedAt,
    snippet: source.snippet,
    sourceType: source.sourceType,
    title: source.title,
    url: source.url,
  }
}

function getScopedTripCheckFindings(
  tripCheck: TripCheckResult | null | undefined,
  dayId: string,
  items: ItineraryItem[],
) {
  if (!tripCheck) {
    return []
  }
  const itemIds = new Set(items.map((item) => item.id))
  const warnings = Array.isArray(tripCheck.warnings) ? tripCheck.warnings : []
  const suggestions = Array.isArray(tripCheck.suggestions) ? tripCheck.suggestions : []
  return [...warnings, ...suggestions]
    .filter((finding) =>
      finding.affectedDayIds.includes(dayId) ||
      finding.affectedItemIds.some((itemId) => itemIds.has(itemId)),
    )
    .sort((first, second) => severityRank(second.severity) - severityRank(first.severity))
    .slice(0, MAX_SECTION_LINES)
}

function shouldSwitchToTomorrow(items: ItineraryItem[], now: Date, day: Day, trip: Trip) {
  const lastTimedItem = [...items].reverse().find((item) => item.endTime || item.startTime)
  if (!lastTimedItem) {
    return false
  }
  const range = resolveItemTimeRange({ day, item: lastTimedItem, trip })
  const finishEpochMs = range.endEpochMs ?? range.startEpochMs
  if (finishEpochMs === undefined || now.getTime() <= finishEpochMs) {
    return false
  }
  const lastItem = items[items.length - 1]
  if (lastItem && lastItem.id === lastTimedItem.id && isHotelEndItem(lastItem)) {
    return true
  }
  return lastTimedItem.id === lastItem?.id
}

function isHotelEndItem(item: ItineraryItem) {
  return HOTEL_END_PATTERN.test([
    item.title,
    item.locationName,
    item.address,
    item.notes,
  ].filter(Boolean).join(' '))
}


function sortDays(days: Day[]) {
  return [...days].sort((first, second) => first.sortOrder - second.sortOrder || first.date.localeCompare(second.date))
}

function buildEmptyCompletedSections(): TripDailyTravelTipSection[] {
  return [
    { emptyText: '旅行已结束', key: 'opening_hours', lines: [], title: '开放时间' },
    { emptyText: '旅行已结束', key: 'ticket_price', lines: [], title: '票价' },
    { emptyText: '旅行已结束', key: 'notices', lines: [], title: '注意事项' },
    { emptyText: '旅行已结束', key: 'route_risk', lines: [], title: '路线风险' },
  ]
}

function sortDailyTipSources(sources: ProviderProxyTripContentEnrichmentSourceSummary[]) {
  return [...sources].sort((first, second) => sourcePriority(second) - sourcePriority(first))
}

function sourcePriority(source: ProviderProxyTripContentEnrichmentSourceSummary) {
  const typeScore: Record<ContentEnrichmentSourceType, number> = {
    ai_estimate: 0,
    google_places: 90,
    map: 70,
    official: 100,
    ticketing: 95,
    travel_site: 45,
    unknown: 10,
  }
  const confidenceScore: Record<ContentEnrichmentConfidence, number> = {
    high: 30,
    low: 5,
    medium: 15,
    unknown: 0,
  }
  return typeScore[source.sourceType] + confidenceScore[source.confidence] + (source.url ? 2 : 0)
}

function dedupeDailyTipSources(sources: ProviderProxyTripContentEnrichmentSourceSummary[]) {
  const seen = new Set<string>()
  return sources.filter((source) => {
    const key = source.url ?? source.id
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  }).slice(0, 12)
}

function formatSearchSourceLabel(sourceType: ProviderProxyTravelSearchResult['sourceType']) {
  if (sourceType === 'official') return '官网'
  if (sourceType === 'map') return '地图来源'
  if (sourceType === 'ticketing') return '购票来源'
  if (sourceType === 'travel_site') return '旅行网站'
  return '网页来源'
}

function mapSearchSourceType(sourceType: ProviderProxyTravelSearchResult['sourceType']): ContentEnrichmentSourceType {
  if (sourceType === 'official') return 'official'
  if (sourceType === 'map') return 'map'
  if (sourceType === 'ticketing') return 'ticketing'
  if (sourceType === 'travel_site') return 'travel_site'
  return 'unknown'
}

function mapSearchConfidence(confidence: ProviderProxyTravelSearchResult['confidence']): ContentEnrichmentConfidence {
  if (confidence === 'high' || confidence === 'medium' || confidence === 'low') return confidence
  return 'unknown'
}

function severityRank(severity: 'info' | 'warning' | 'critical') {
  if (severity === 'critical') return 3
  if (severity === 'warning') return 2
  return 1
}

function dedupeStrings(values: Array<string | undefined>) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const trimmed = value?.trim()
    if (!trimmed || seen.has(trimmed)) {
      continue
    }
    seen.add(trimmed)
    result.push(trimmed)
  }
  return result
}

function stableHash(input: string) {
  let hash = 0
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0
  }
  return hash.toString(36)
}

function clampText(value: string, maxLength: number) {
  const trimmed = value.trim().replace(/\s+/g, ' ')
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed
}
