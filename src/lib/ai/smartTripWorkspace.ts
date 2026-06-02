import { markTripAutoSnapshotDirty } from '../autoSnapshotBackup'
import { emitTravelDataChanged } from '../dataEvents'
import { sortItineraryItems } from '../itinerary'
import { hasValidCoordinates } from '../mapLinks'
import { db } from '../../db/database'
import { buildAiTripEditLocalStateFingerprint } from './aiTripEditApply'
import type {
  ProviderProxyPlaceLookupResult,
  ProviderProxyRouteOrderSuggestionItem,
  ProviderProxyRouteOrderSuggestionSuccessResponse,
  ProviderProxyTravelSearchResult,
  ProviderProxyTravelSearchSourceType,
  ProviderProxyTravelSearchType,
} from './providerProxyContract'
import type { Day, ItineraryItem, Trip } from '../../types'

export const SMART_TRIP_WORKSPACE_MAX_PLACE_LOOKUPS = 8
export const SMART_TRIP_WORKSPACE_MAX_ROUTE_ORDER_DAYS = 5
export const SMART_TRIP_WORKSPACE_MAX_SEARCHES = 8

export type SmartTripWorkspaceDiffType =
  | 'place_calibration'
  | 'route_order'
  | 'item_note_append'
  | 'trip_note_append'

export type SmartTripWorkspaceDiffBase = {
  affectedDayIds: string[]
  affectedItemIds: string[]
  checkedByDefault: boolean
  detailLines: string[]
  hasWrite: boolean
  id: string
  routeMayBeStale?: boolean
  sourceMeta: SmartTripWorkspaceSourceMeta
  summary: string
  title: string
  type: SmartTripWorkspaceDiffType
  warnings?: string[]
}

export type SmartTripWorkspaceSourceConfidence = 'high' | 'medium' | 'low' | 'unknown'

export type SmartTripWorkspaceSourceType =
  | ProviderProxyTravelSearchSourceType
  | 'official_map'
  | 'official_route'
  | 'provider_route'
  | 'local_rule'

export type SmartTripWorkspaceSourceMeta = {
  confidence: SmartTripWorkspaceSourceConfidence
  label: string
  reason: string
  retrievedAt?: string
  sourceType: SmartTripWorkspaceSourceType
}

export type SmartTripWorkspacePlaceCalibrationDiff = SmartTripWorkspaceDiffBase & {
  type: 'place_calibration'
  itemId: string
  nextAddress: string
  nextLat: number
  nextLng: number
  nextLocationName: string
  sourceUrl?: string
}

export type SmartTripWorkspaceRouteOrderPatch = {
  id: string
  sortOrder: number
}

export type SmartTripWorkspaceRouteOrderDiff = SmartTripWorkspaceDiffBase & {
  type: 'route_order'
  dayId: string
  orderedItemIds: string[]
  patches: SmartTripWorkspaceRouteOrderPatch[]
  provider: ProviderProxyRouteOrderSuggestionSuccessResponse['provider']
  retrievedAt: string
}

export type SmartTripWorkspaceItemNoteAppendDiff = SmartTripWorkspaceDiffBase & {
  type: 'item_note_append'
  itemId: string
  noteText: string
  sources: SmartTripWorkspaceSourceSummary[]
}

export type SmartTripWorkspaceTripNoteAppendDiff = SmartTripWorkspaceDiffBase & {
  type: 'trip_note_append'
  noteText: string
}

export type SmartTripWorkspaceDiffItem =
  | SmartTripWorkspacePlaceCalibrationDiff
  | SmartTripWorkspaceRouteOrderDiff
  | SmartTripWorkspaceItemNoteAppendDiff
  | SmartTripWorkspaceTripNoteAppendDiff

export type SmartTripWorkspaceSourceSummary = {
  confidence: SmartTripWorkspaceSourceConfidence
  displayUrl: string
  domain: string
  label: string
  retrievedAt: string
  snippet: string
  sourceType: SmartTripWorkspaceSourceType
  title: string
  url: string
}

export type SmartTripWorkspaceApplyResult =
  | { appliedDiffCount: number; ok: true }
  | { errors: string[]; ok: false }

type SmartTripWorkspaceVirtualCoordinate = {
  lat: number
  lng: number
}

const NOTE_SOURCE_LIMIT = 3
const NOTE_SNIPPET_LIMIT = 180
const NOTE_TEXT_LIMIT = 1200
const ROUTE_STALE_WARNING = '地点或顺序修改可能让已有路线缓存过期；本次不会清除路线缓存。'
export const SMART_TRIP_WORKSPACE_DIFF_CATEGORY_ORDER: SmartTripWorkspaceDiffType[] = [
  'place_calibration',
  'route_order',
  'item_note_append',
  'trip_note_append',
]

export function getSmartTripWorkspaceDiffCategoryLabel(type: SmartTripWorkspaceDiffType) {
  if (type === 'place_calibration') return '地点校准'
  if (type === 'route_order') return '路线顺序'
  if (type === 'item_note_append') return '景点提示'
  return '每日提示'
}

export function formatSmartTripWorkspaceSourceConfidence(confidence: SmartTripWorkspaceSourceConfidence) {
  if (confidence === 'high') return '高'
  if (confidence === 'medium') return '中'
  if (confidence === 'low') return '低'
  return '未标注'
}

export function formatSmartTripWorkspaceSourceDate(value: string | undefined) {
  if (!value) return '本地'
  return formatDateStamp(value)
}

export function getSmartTripWorkspacePlaceTargets(items: ItineraryItem[]) {
  return sortItineraryItems(items)
    .filter((item) => !hasValidCoordinates(item))
    .slice(0, SMART_TRIP_WORKSPACE_MAX_PLACE_LOOKUPS)
}

export function getSmartTripWorkspaceSearchTargets(items: ItineraryItem[]) {
  return sortItineraryItems(items)
    .filter((item) => item.title.trim().length > 0)
    .slice(0, SMART_TRIP_WORKSPACE_MAX_SEARCHES)
}

export function getSmartTripWorkspaceRouteOrderCandidateDays({
  days,
  itemsByDay,
  placeDiffs = [],
}: {
  days: Day[]
  itemsByDay: Record<string, ItineraryItem[]>
  placeDiffs?: SmartTripWorkspacePlaceCalibrationDiff[]
}) {
  const orderedDays = [...days].sort((first, second) => first.sortOrder - second.sortOrder)
  return orderedDays
    .filter((day) => isSmartTripWorkspaceRouteOrderCandidate(itemsByDay[day.id] ?? [], placeDiffs))
    .slice(0, SMART_TRIP_WORKSPACE_MAX_ROUTE_ORDER_DAYS)
}

export function buildSmartTripWorkspacePlaceLookupQuery(item: ItineraryItem, trip: Trip) {
  return clampText(dedupeText([
    item.locationName,
    item.address,
    item.title,
    trip.destination,
  ]).join(' '), 200)
}

export function buildSmartTripWorkspaceSearchQuery(item: ItineraryItem, trip: Trip) {
  return clampText(dedupeText([
    item.locationName,
    item.address,
    item.title,
    trip.destination,
    '开放时间 票价 官网',
  ]).join(' '), 300)
}

export function buildSmartTripWorkspaceSearchType(): ProviderProxyTravelSearchType {
  return 'general'
}

export function selectBestSmartTripWorkspacePlaceResult(
  results: ProviderProxyPlaceLookupResult[],
  item?: ItineraryItem,
) {
  return [...results]
    .filter((result) => isValidPlaceLocation(result.location))
    .sort((first, second) => getPlaceResultPriority(second, item) - getPlaceResultPriority(first, item))[0]
}

export function sortSmartTripWorkspaceTravelSearchResults(results: ProviderProxyTravelSearchResult[]) {
  return [...results].sort((first, second) => getSearchResultPriority(second) - getSearchResultPriority(first))
}

export function buildSmartTripWorkspacePlaceDiff({
  day,
  item,
  result,
}: {
  day?: Day
  item: ItineraryItem
  result: ProviderProxyPlaceLookupResult
}): SmartTripWorkspacePlaceCalibrationDiff | null {
  if (!isValidPlaceLocation(result.location)) {
    return null
  }

  const nextLocationName = result.displayName.trim()
  const nextAddress = result.formattedAddress.trim()
  if (!nextLocationName || !nextAddress) {
    return null
  }

  const detailLines = [
    `地点：${item.locationName || item.title} -> ${nextLocationName}`,
    `地址：${item.address || '空'} -> ${nextAddress}`,
    `坐标：${formatCoordinate(item.lat, item.lng)} -> ${result.location.lat.toFixed(5)}, ${result.location.lng.toFixed(5)}`,
  ]

  return {
    affectedDayIds: day ? [day.id] : [item.dayId],
    affectedItemIds: [item.id],
    checkedByDefault: true,
    detailLines,
    hasWrite: true,
    id: `place:${item.id}`,
    itemId: item.id,
    nextAddress,
    nextLat: result.location.lat,
    nextLng: result.location.lng,
    nextLocationName,
    routeMayBeStale: true,
    sourceUrl: result.googleMapsUri,
    sourceMeta: buildPlaceSourceMeta(result),
    summary: `${item.title} 将校准到 ${nextLocationName}`,
    title: `地点校准：${item.title}`,
    type: 'place_calibration',
    warnings: [ROUTE_STALE_WARNING],
  }
}

export function buildSmartTripWorkspaceRouteOrderRequestItems(
  items: ItineraryItem[],
  placeDiffs: SmartTripWorkspacePlaceCalibrationDiff[] = [],
): ProviderProxyRouteOrderSuggestionItem[] {
  const coordinateByItemId = buildVirtualCoordinateMap(placeDiffs)
  return sortItineraryItems(items).map((item) => {
    const coordinate = getItemCoordinate(item, coordinateByItemId)
    return {
      address: item.address,
      coordinate,
      id: item.id,
      locationName: item.locationName,
      title: item.title,
    }
  })
}

export function buildSmartTripWorkspaceRouteOrderDiff({
  day,
  items,
  placeDiffs = [],
  result,
}: {
  day: Day
  items: ItineraryItem[]
  placeDiffs?: SmartTripWorkspacePlaceCalibrationDiff[]
  result: ProviderProxyRouteOrderSuggestionSuccessResponse
}): SmartTripWorkspaceRouteOrderDiff | null {
  const patches = buildSmartTripWorkspaceRouteOrderSortPatches(items, result.suggestedItemIds, placeDiffs)
  const titleById = new Map(items.map((item) => [item.id, item.title]))
  const orderedNames = result.suggestedItemIds.map((itemId) => titleById.get(itemId) ?? itemId)
  const virtualItemIds = new Set(placeDiffs.map((diff) => diff.itemId))
  const usesVirtualCoordinates = result.suggestedItemIds.some((itemId) => virtualItemIds.has(itemId))
  const warnings = [
    ...result.warnings,
    ROUTE_STALE_WARNING,
    usesVirtualCoordinates ? '本顺序建议使用了待确认的地点校准坐标。' : '',
  ].filter((warning): warning is string => Boolean(warning))

  return {
    affectedDayIds: [day.id],
    affectedItemIds: patches.map((patch) => patch.id),
    checkedByDefault: patches.length > 0,
    dayId: day.id,
    detailLines: [
      `建议顺序：${orderedNames.join(' -> ')}`,
      result.summary,
    ],
    hasWrite: patches.length > 0,
    id: `route:${day.id}`,
    orderedItemIds: result.suggestedItemIds,
    patches,
    provider: result.provider,
    retrievedAt: result.retrievedAt,
    routeMayBeStale: patches.length > 0,
    sourceMeta: buildRouteSourceMeta(result, {
      changesCount: patches.length,
      usesVirtualCoordinates,
    }),
    summary: patches.length > 0
      ? `${day.title} 将调整 ${patches.length} 个行程点的排序`
      : `${day.title} 当前顺序已接近建议`,
    title: `路线顺序：${day.title}`,
    type: 'route_order',
    warnings,
  }
}

export function buildSmartTripWorkspaceItemNoteDiff({
  day,
  item,
  retrievedAt,
  searchResults,
}: {
  day?: Day
  item: ItineraryItem
  retrievedAt: string
  searchResults: ProviderProxyTravelSearchResult[]
}): SmartTripWorkspaceItemNoteAppendDiff | null {
  const sources = summarizeSmartTripWorkspaceSources(searchResults)
  if (sources.length === 0) {
    return null
  }
  const bestSource = sources[0]

  const lines = [
    `智能整理提示（${formatDateStamp(retrievedAt)}）`,
    '开放时间、票价和入场规则请以官方或购票来源为准；以下仅保留本次搜索来源摘要：',
    ...sources.map((source) => `- ${source.title}：${source.snippet}（${source.label}；${source.domain || source.displayUrl}）`),
  ]
  const localTips = buildLocalItemTips(item)
  if (localTips.length > 0) {
    lines.push('本地提醒：')
    lines.push(...localTips.map((tip) => `- ${tip}`))
  }

  const noteText = clampText(lines.join('\n'), NOTE_TEXT_LIMIT)
  return {
    affectedDayIds: day ? [day.id] : [item.dayId],
    affectedItemIds: [item.id],
    checkedByDefault: true,
    detailLines: [
      `将追加 ${sources.length} 条来源摘要到备注。`,
      ...sources.map((source) => `${source.label} · ${formatConfidenceLabel(source.confidence)} · ${formatDateStamp(source.retrievedAt)} · ${source.title} · ${source.domain || source.displayUrl}`),
    ],
    hasWrite: true,
    id: `item-note:${item.id}`,
    itemId: item.id,
    noteText,
    sources,
    sourceMeta: {
      confidence: bestSource.confidence,
      label: bestSource.label,
      reason: `优先采用 ${bestSource.label} 中可信度最高且带来源的摘要；无来源结果不会写入事实性提示。`,
      retrievedAt: bestSource.retrievedAt,
      sourceType: bestSource.sourceType,
    },
    summary: `${item.title} 将追加开放时间/票价/景点提示来源摘要`,
    title: `景点提示：${item.title}`,
    type: 'item_note_append',
  }
}

export function buildSmartTripWorkspaceTripNoteDiff({
  days,
  itemsByDay,
  retrievedAt,
  trip,
}: {
  days: Day[]
  itemsByDay: Record<string, ItineraryItem[]>
  retrievedAt: string
  trip: Trip
}): SmartTripWorkspaceTripNoteAppendDiff | null {
  const orderedDays = [...days].sort((first, second) => first.sortOrder - second.sortOrder)
  if (orderedDays.length === 0) {
    return null
  }

  const dayLines = orderedDays.map((day, index) => {
    const items = sortItineraryItems(itemsByDay[day.id] ?? [])
    const tips = buildLocalDayTips(day, items)
    return [
      `Day ${index + 1} ${day.title || day.date}`,
      ...tips.map((tip) => `- ${tip}`),
    ].join('\n')
  })

  const noteText = clampText([
    `智能整理每日提示（${formatDateStamp(retrievedAt)}）`,
    `行程：${trip.title}`,
    ...dayLines,
  ].join('\n\n'), NOTE_TEXT_LIMIT)

  return {
    affectedDayIds: orderedDays.map((day) => day.id),
    affectedItemIds: [],
    checkedByDefault: true,
    detailLines: orderedDays.map((day, index) => {
      const items = itemsByDay[day.id] ?? []
      return `Day ${index + 1}：${day.title || day.date} · ${items.length} 个行程点`
    }),
    hasWrite: true,
    id: 'trip-note:daily-tips',
    noteText,
    sourceMeta: {
      confidence: 'medium',
      label: '本地规则',
      reason: '根据每日行程点数量、时间完整度和坐标完整度生成，不依赖外部事实来源。',
      retrievedAt,
      sourceType: 'local_rule',
    },
    summary: '将在旅行备注中追加按天分组的整理提示',
    title: '每日提示',
    type: 'trip_note_append',
  }
}

export function getSmartTripWorkspaceDefaultCheckedIds(diffs: SmartTripWorkspaceDiffItem[]) {
  return diffs.filter((diff) => diff.checkedByDefault && diff.hasWrite).map((diff) => diff.id)
}

export async function applySmartTripWorkspaceDiffsToDb(
  tripId: string,
  diffs: SmartTripWorkspaceDiffItem[],
  checkedDiffIds: string[],
  options: { expectedBaselineFingerprint?: string; now?: number } = {},
): Promise<SmartTripWorkspaceApplyResult> {
  const checkedIdSet = new Set(checkedDiffIds)
  const selectedDiffs = diffs.filter((diff) => checkedIdSet.has(diff.id) && diff.hasWrite)
  if (selectedDiffs.length === 0) {
    return { appliedDiffCount: 0, ok: true }
  }

  try {
    const now = options.now ?? Date.now()
    const result = await db.transaction('rw', db.trips, db.days, db.itineraryItems, async () => {
      const [trip, days, items] = await Promise.all([
        db.trips.get(tripId),
        db.days.where('tripId').equals(tripId).toArray(),
        db.itineraryItems.where('tripId').equals(tripId).toArray(),
      ])

      if (!trip) {
        return { errors: ['旅行不存在。'], ok: false as const }
      }

      if (options.expectedBaselineFingerprint) {
        const freshFingerprint = buildAiTripEditLocalStateFingerprint({ days, items, trip })
        if (freshFingerprint !== options.expectedBaselineFingerprint) {
          return { errors: ['本地行程已变化，请重新生成。'], ok: false as const }
        }
      }

      const itemMap = new Map(items.map((item) => [item.id, { ...item }]))
      const dayIds = new Set(days.map((day) => day.id))
      const changedItems = new Map<string, ItineraryItem>()
      let nextTripNotes = trip.notes ?? ''

      for (const diff of selectedDiffs) {
        if (diff.type === 'place_calibration') {
          const item = itemMap.get(diff.itemId)
          if (!item) {
            return { errors: [`行程点不存在：${diff.itemId}`], ok: false as const }
          }
          const updated = {
            ...item,
            address: diff.nextAddress,
            lat: diff.nextLat,
            lng: diff.nextLng,
            locationName: diff.nextLocationName,
            updatedAt: now,
          }
          itemMap.set(item.id, updated)
          changedItems.set(item.id, updated)
          continue
        }

        if (diff.type === 'route_order') {
          if (!dayIds.has(diff.dayId)) {
            return { errors: [`日期不存在：${diff.dayId}`], ok: false as const }
          }
          for (const patch of diff.patches) {
            const item = itemMap.get(patch.id)
            if (!item || item.dayId !== diff.dayId) {
              return { errors: [`路线顺序包含无效行程点：${patch.id}`], ok: false as const }
            }
            const updated = { ...item, sortOrder: patch.sortOrder, updatedAt: now }
            itemMap.set(item.id, updated)
            changedItems.set(item.id, updated)
          }
          continue
        }

        if (diff.type === 'item_note_append') {
          const item = itemMap.get(diff.itemId)
          if (!item) {
            return { errors: [`行程点不存在：${diff.itemId}`], ok: false as const }
          }
          const notes = appendNoteSection(item.notes, diff.noteText)
          if (notes === (item.notes ?? '')) {
            continue
          }
          const updated = { ...item, notes, updatedAt: now }
          itemMap.set(item.id, updated)
          changedItems.set(item.id, updated)
          continue
        }

        nextTripNotes = appendNoteSection(nextTripNotes, diff.noteText)
      }

      const tripPatch: Partial<Trip> = {}
      if (nextTripNotes !== (trip.notes ?? '')) {
        tripPatch.notes = nextTripNotes
      }

      if (changedItems.size > 0) {
        await db.itineraryItems.bulkPut(Array.from(changedItems.values()))
      }
      if (Object.keys(tripPatch).length > 0 || changedItems.size > 0) {
        await db.trips.update(tripId, { ...tripPatch, updatedAt: now })
      }

      return {
        appliedDiffCount: selectedDiffs.length,
        changed: changedItems.size > 0 || Object.keys(tripPatch).length > 0,
        ok: true as const,
      }
    })

    if (!result.ok) {
      return result
    }
    if (result.changed) {
      markTripAutoSnapshotDirty(tripId, 'smart-trip-workspace-applied')
      emitTravelDataChanged()
    }
    return { appliedDiffCount: result.appliedDiffCount, ok: true }
  } catch {
    return { errors: ['应用智能整理修改失败，旅行未完成写入。'], ok: false }
  }
}

function isSmartTripWorkspaceRouteOrderCandidate(
  items: ItineraryItem[],
  placeDiffs: SmartTripWorkspacePlaceCalibrationDiff[],
) {
  const orderedItems = sortItineraryItems(items)
  const coordinateByItemId = buildVirtualCoordinateMap(placeDiffs)
  const coordinateCount = orderedItems.filter((item) => Boolean(getItemCoordinate(item, coordinateByItemId))).length
  return orderedItems.length >= 2 && orderedItems.length <= 10 && coordinateCount >= 2 && coordinateCount <= 10
}

function buildSmartTripWorkspaceRouteOrderSortPatches(
  items: ItineraryItem[],
  suggestedItemIds: string[],
  placeDiffs: SmartTripWorkspacePlaceCalibrationDiff[],
): SmartTripWorkspaceRouteOrderPatch[] {
  const orderedItems = sortItineraryItems(items)
  const coordinateByItemId = buildVirtualCoordinateMap(placeDiffs)
  const coordinateItems = orderedItems.filter((item) => Boolean(getItemCoordinate(item, coordinateByItemId)))
  if (!hasSameStringSet(suggestedItemIds, coordinateItems.map((item) => item.id))) {
    throw new Error('路线顺序建议与当前行程点不匹配。')
  }

  const itemById = new Map(orderedItems.map((item) => [item.id, item]))
  const suggestedQueue = suggestedItemIds.map((itemId) => {
    const item = itemById.get(itemId)
    if (!item) {
      throw new Error('路线顺序建议包含未知行程点。')
    }
    return item
  })
  const nextItems = orderedItems.map((item) => (
    getItemCoordinate(item, coordinateByItemId) ? suggestedQueue.shift() as ItineraryItem : item
  ))

  return nextItems.flatMap((item, index) => {
    const nextSortOrder = index + 1
    return item.sortOrder === nextSortOrder ? [] : [{ id: item.id, sortOrder: nextSortOrder }]
  })
}

function buildVirtualCoordinateMap(placeDiffs: SmartTripWorkspacePlaceCalibrationDiff[]) {
  return new Map<string, SmartTripWorkspaceVirtualCoordinate>(
    placeDiffs.map((diff) => [diff.itemId, { lat: diff.nextLat, lng: diff.nextLng }]),
  )
}

function getItemCoordinate(
  item: ItineraryItem,
  coordinateByItemId: Map<string, SmartTripWorkspaceVirtualCoordinate>,
) {
  const virtualCoordinate = coordinateByItemId.get(item.id)
  if (virtualCoordinate) {
    return virtualCoordinate
  }
  if (!hasValidCoordinates(item)) {
    return undefined
  }
  return { lat: item.lat as number, lng: item.lng as number }
}

function buildPlaceSourceMeta(result: ProviderProxyPlaceLookupResult): SmartTripWorkspaceSourceMeta {
  return {
    confidence: result.googleMapsUri ? 'high' : 'medium',
    label: '官方地图',
    reason: result.googleMapsUri
      ? 'Google Places 返回了可核验地图链接、地址和有效坐标，适合校准缺失地点。'
      : 'Google Places 返回了地址和有效坐标，适合校准缺失地点。',
    retrievedAt: result.retrievedAt,
    sourceType: 'official_map',
  }
}

function buildRouteSourceMeta(
  result: ProviderProxyRouteOrderSuggestionSuccessResponse,
  context: { changesCount: number; usesVirtualCoordinates: boolean },
): SmartTripWorkspaceSourceMeta {
  const isOfficialRoute = result.provider === 'google'
  const usesVirtualText = context.usesVirtualCoordinates ? '，并纳入待确认地点校准坐标' : ''
  return {
    confidence: isOfficialRoute ? 'high' : 'medium',
    label: isOfficialRoute ? '官方路线' : '路线建议',
    reason: context.changesCount > 0
      ? `按可用坐标${usesVirtualText}生成顺序，可减少回头路；应用后不会清除路线缓存。`
      : `当前顺序已接近 provider 建议${usesVirtualText}，无需写入排序变化。`,
    retrievedAt: result.retrievedAt,
    sourceType: isOfficialRoute ? 'official_route' : 'provider_route',
  }
}

function getPlaceResultPriority(result: ProviderProxyPlaceLookupResult, item?: ItineraryItem) {
  let score = 0
  if (isValidPlaceLocation(result.location)) score += 100
  if (result.provider === 'google_places') score += 50
  if (result.googleMapsUri) score += 25
  if (result.formattedAddress.trim()) score += 10
  if (item) {
    const candidateText = `${result.displayName} ${result.formattedAddress}`.toLowerCase()
    const title = item.title.trim().toLowerCase()
    const locationName = item.locationName?.trim().toLowerCase()
    if (title && candidateText.includes(title)) score += 8
    if (locationName && candidateText.includes(locationName)) score += 8
  }
  return score
}

function getSearchResultPriority(result: ProviderProxyTravelSearchResult) {
  const sourceTypeScore: Record<ProviderProxyTravelSearchSourceType, number> = {
    official: 100,
    map: 90,
    ticketing: 78,
    travel_site: 58,
    unknown: 20,
  }
  const confidenceScore: Record<SmartTripWorkspaceSourceConfidence, number> = {
    high: 30,
    medium: 18,
    low: 4,
    unknown: 10,
  }
  const sourceType = result.sourceType ?? 'unknown'
  const confidence = normalizeSourceConfidence(result.confidence)
  return sourceTypeScore[sourceType] + confidenceScore[confidence]
}

function summarizeSmartTripWorkspaceSources(results: ProviderProxyTravelSearchResult[]): SmartTripWorkspaceSourceSummary[] {
  return sortSmartTripWorkspaceTravelSearchResults(results).slice(0, NOTE_SOURCE_LIMIT).map((result) => ({
    confidence: normalizeSourceConfidence(result.confidence),
    displayUrl: result.displayUrl,
    domain: result.domain,
    label: getTravelSearchSourceLabel(result.sourceType, result.confidence),
    retrievedAt: result.retrievedAt,
    snippet: clampText(result.snippet, NOTE_SNIPPET_LIMIT),
    sourceType: result.sourceType ?? 'unknown',
    title: clampText(result.title, 120),
    url: result.url,
  })).filter((source) => source.title && source.url && source.snippet)
}

function getTravelSearchSourceLabel(
  sourceType: ProviderProxyTravelSearchSourceType | undefined,
  confidence: ProviderProxyTravelSearchResult['confidence'],
) {
  if (sourceType === 'official') return '官网'
  if (sourceType === 'map') return '官方地图'
  if (sourceType === 'ticketing') return '购票来源'
  if (sourceType === 'travel_site') return confidence === 'high' ? '高可信旅行来源' : '旅行来源'
  if (confidence === 'high') return '高可信来源'
  return '来源未标注'
}

function normalizeSourceConfidence(confidence: ProviderProxyTravelSearchResult['confidence']): SmartTripWorkspaceSourceConfidence {
  return confidence ?? 'unknown'
}

function formatConfidenceLabel(confidence: SmartTripWorkspaceSourceConfidence) {
  return `${formatSmartTripWorkspaceSourceConfidence(confidence)}可信`
}

function buildLocalItemTips(item: ItineraryItem) {
  const tips: string[] = []
  if (!item.startTime) {
    tips.push('当前没有开始时间，建议确认到达或预约时段。')
  }
  if (!hasValidCoordinates(item)) {
    tips.push('当前没有可用坐标，建议先确认地点。')
  }
  if (/门票|预约|ticket|reservation|booking|入场|凭证/i.test(item.title) && item.ticketIds.length === 0) {
    tips.push('标题看起来涉及门票或预约，但当前没有绑定票据。')
  }
  return tips
}

function buildLocalDayTips(day: Day, items: ItineraryItem[]) {
  if (items.length === 0) {
    return [`${day.date} 暂无行程点，可确认是否作为休息或转场日。`]
  }

  const tips: string[] = []
  const missingTimeCount = items.filter((item) => !item.startTime).length
  const missingCoordinateCount = items.filter((item) => !hasValidCoordinates(item)).length
  if (items.length >= 5) {
    tips.push(`当天有 ${items.length} 个行程点，建议预留体力和机动时间。`)
  } else {
    tips.push(`当天有 ${items.length} 个行程点，可按天气和体力微调顺序。`)
  }
  if (missingTimeCount > 0) {
    tips.push(`${missingTimeCount} 个行程点缺少开始时间，建议出发前补齐关键预约时段。`)
  }
  if (missingCoordinateCount > 0) {
    tips.push(`${missingCoordinateCount} 个行程点缺少可用坐标，地图和路线预览可能不完整。`)
  }
  return tips
}

function appendNoteSection(existing: string | undefined, section: string) {
  const trimmedSection = section.trim()
  if (!trimmedSection) {
    return existing ?? ''
  }
  const current = existing?.trim() ?? ''
  if (current.includes(trimmedSection)) {
    return current
  }
  return current ? `${current}\n\n${trimmedSection}` : trimmedSection
}

function isValidPlaceLocation(location: ProviderProxyPlaceLookupResult['location'] | undefined): location is { lat: number; lng: number } {
  return Boolean(
    location &&
    Number.isFinite(location.lat) &&
    Number.isFinite(location.lng) &&
    location.lat >= -90 &&
    location.lat <= 90 &&
    location.lng >= -180 &&
    location.lng <= 180,
  )
}

function hasSameStringSet(first: string[], second: string[]) {
  if (first.length !== second.length || new Set(first).size !== first.length) {
    return false
  }
  const secondSet = new Set(second)
  return first.every((value) => secondSet.has(value))
}

function formatCoordinate(lat: number | undefined, lng: number | undefined) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return '空'
  }
  return `${(lat as number).toFixed(5)}, ${(lng as number).toFixed(5)}`
}

function formatDateStamp(value: string) {
  if (!value) return '本次'
  return value.slice(0, 10)
}

function dedupeText(values: Array<string | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))))
}

function clampText(value: string, maxLength: number) {
  const trimmed = value.trim()
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed
}
