import type { AiTripDraft, AiTripDraftDay, AiTripDraftItem } from './aiTripDraft'
import type { ProviderProxyPlaceLookupResult } from './providerProxyContract'
import { getDistanceMeters, isValidLngLat } from '../dayMapViewport'
import type { LngLat } from '../routing'

export type AiTripDraftMapWarningType =
  | 'backtracking'
  | 'insufficient_coordinates'
  | 'long_jump'
  | 'missing_coordinates'

export type AiTripDraftMapWarning = {
  itemIndexes: number[]
  message: string
  type: AiTripDraftMapWarningType
}

export type AiTripDraftMapPreviewItem = {
  coordinateLabel: string
  hasValidCoordinate: boolean
  itemIndex: number
  locationLabel: string
  number: number
  participatesInPath: boolean
  timeLabel: string
  title: string
}

export type AiTripDraftMapPreviewPoint = {
  itemIndex: number
  lat: number
  lng: number
  locationLabel: string
  number: number
  title: string
  x: number
  y: number
}

export type AiTripDraftMapPreviewSegment = {
  distanceMeters: number
  fromItemIndex: number
  fromNumber: number
  fromTitle: string
  toItemIndex: number
  toNumber: number
  toTitle: string
  warning: boolean
  x1: number
  x2: number
  y1: number
  y2: number
}

export type AiTripDraftMapPreviewDay = {
  coordinateCount: number
  date: string
  dayIndex: number
  itemCount: number
  items: AiTripDraftMapPreviewItem[]
  missingCoordinateCount: number
  points: AiTripDraftMapPreviewPoint[]
  segments: AiTripDraftMapPreviewSegment[]
  title?: string
  totalDistanceMeters: number
  warnings: AiTripDraftMapWarning[]
}

export type AiTripDraftMapOrderAdjustmentResult = {
  afterDistanceMeters: number
  beforeDistanceMeters: number
  changed: boolean
  nextItems: AiTripDraftItem[]
  reason: string
}

export type AiTripDraftMissingCoordinateLookupItem = {
  itemIndex: number
  lookupKey: string
  locationLabel: string
  number: number
  query: string
  timeLabel: string
  title: string
}

export type AiTripDraftPlaceLookupApplyResult =
  | { draft: AiTripDraft; ok: true }
  | { error: string; ok: false }

const CANVAS_MIN = 8
const CANVAS_MAX = 92
const LONG_JUMP_MIN_METERS = 15_000
const LONG_JUMP_MEDIAN_FACTOR = 2
const BACKTRACKING_DIRECT_RATIO = 0.45
const PLACE_LOOKUP_QUERY_MAX_LENGTH = 200

export function buildAiTripDraftMapPreviews(draft: AiTripDraft): AiTripDraftMapPreviewDay[] {
  return draft.days.map((day, dayIndex) => buildAiTripDraftMapPreviewDay(day, dayIndex))
}

export function formatAiTripDraftMapDistance(distanceMeters: number): string {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return '0 m'
  if (distanceMeters < 1000) return `${Math.round(distanceMeters)} m`
  return `${(distanceMeters / 1000).toFixed(distanceMeters >= 10_000 ? 0 : 1)} km`
}

export function buildAiTripDraftMapOrderAdjustment(day: AiTripDraftDay): AiTripDraftMapOrderAdjustmentResult {
  const coordinateRecords = day.items.reduce<Array<{
    coordinate: LngLat
    item: AiTripDraftItem
    itemIndex: number
  }>>((records, item, itemIndex) => {
    const coordinate = getDraftItemLngLat(item)
    if (coordinate) {
      records.push({ coordinate, item, itemIndex })
    }
    return records
  }, [])
  const missingCoordinateItems = day.items.filter((item) => getDraftItemLngLat(item) === null)
  const beforeDistanceMeters = calculateCoordinateRecordDistance(coordinateRecords)

  if (coordinateRecords.length < 2) {
    return {
      afterDistanceMeters: beforeDistanceMeters,
      beforeDistanceMeters,
      changed: false,
      nextItems: [...day.items],
      reason: '有效坐标点不足 2 个，无法按地图直线顺序重排。',
    }
  }

  const orderedCoordinateRecords = buildNearestNeighborOrder(coordinateRecords)
  const nextItems = [
    ...orderedCoordinateRecords.map((record) => record.item),
    ...missingCoordinateItems,
  ]
  const afterDistanceMeters = calculateCoordinateRecordDistance(orderedCoordinateRecords)
  const changed = !hasSameItemOrder(day.items, nextItems)

  return {
    afterDistanceMeters,
    beforeDistanceMeters,
    changed,
    nextItems,
    reason: changed
      ? '已按地图直线顺序重排本日行程。'
      : '当前顺序已经接近按地图直线距离排序。',
  }
}

export function buildAiTripDraftMissingCoordinateLookupItems(
  day: AiTripDraftDay,
  destination?: string,
): AiTripDraftMissingCoordinateLookupItem[] {
  return day.items.reduce<AiTripDraftMissingCoordinateLookupItem[]>((items, item, itemIndex) => {
    if (getDraftItemLngLat(item)) return items
    items.push({
      itemIndex,
      lookupKey: buildAiTripDraftPlaceLookupTargetKey(day.date, itemIndex, item.title),
      locationLabel: getDraftItemLocationLabel(item),
      number: itemIndex + 1,
      query: buildAiTripDraftPlaceLookupQuery(item, destination),
      timeLabel: formatDraftItemTime(item),
      title: item.title || `行程点 ${itemIndex + 1}`,
    })
    return items
  }, [])
}

export function buildAiTripDraftPlaceLookupQuery(item: AiTripDraftItem, destination?: string): string {
  const seen = new Set<string>()
  const parts = [item.locationName, item.address, item.title, destination]
    .map((value) => normalizePlaceLookupQueryPart(value))
    .filter((value): value is string => {
      if (!value) return false
      const key = value.toLocaleLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

  return parts.join(' ').slice(0, PLACE_LOOKUP_QUERY_MAX_LENGTH).trim()
}

export function buildAiTripDraftPlaceLookupTargetKey(
  dayDate: string,
  itemIndex: number,
  title: string,
): string {
  return `${dayDate}:${itemIndex}:${normalizePlaceLookupQueryPart(title) ?? ''}`
}

export function applyAiTripDraftPlaceLookupCandidateIfFresh({
  baselineFingerprint,
  candidate,
  currentDraft,
  currentFingerprint,
  dayDate,
  dayIndex,
  itemIndex,
}: {
  baselineFingerprint: string
  candidate: ProviderProxyPlaceLookupResult
  currentDraft: AiTripDraft
  currentFingerprint: string
  dayDate: string
  dayIndex: number
  itemIndex: number
}): AiTripDraftPlaceLookupApplyResult {
  if (currentFingerprint !== baselineFingerprint) {
    return { error: '草案已变化，请重新查找。', ok: false }
  }

  const day = currentDraft.days[dayIndex]
  if (!day || day.date !== dayDate) {
    return { error: '当前日期已变化，请重新查找。', ok: false }
  }

  const item = day.items[itemIndex]
  if (!item) {
    return { error: '行程点已变化，请重新查找。', ok: false }
  }

  if (!isValidPlaceLookupLocation(candidate.location)) {
    return { error: '候选地点缺少有效坐标，不能填入草案。', ok: false }
  }
  const location = candidate.location

  return {
    draft: {
      ...currentDraft,
      days: currentDraft.days.map((draftDay, index) => index === dayIndex
        ? {
            ...draftDay,
            items: draftDay.items.map((draftItem, draftItemIndex) => draftItemIndex === itemIndex
              ? {
                  ...draftItem,
                  address: candidate.formattedAddress,
                  lat: location.lat,
                  lng: location.lng,
                  locationName: candidate.displayName,
                }
              : draftItem),
          }
        : draftDay),
    },
    ok: true,
  }
}

function buildAiTripDraftMapPreviewDay(
  day: AiTripDraftDay,
  dayIndex: number,
): AiTripDraftMapPreviewDay {
  const coordinateItems = day.items.reduce<Array<{
    coordinate: LngLat
    item: AiTripDraftItem
    itemIndex: number
  }>>((items, item, itemIndex) => {
    const coordinate = getDraftItemLngLat(item)
    if (coordinate) {
      items.push({ coordinate, item, itemIndex })
    }
    return items
  }, [])

  const points = projectDraftMapPoints(coordinateItems)
  const coordinateItemIndexes = new Set(points.map((point) => point.itemIndex))
  const segments = buildDraftMapSegments(points)
  const longJumpItemIndexes = findLongJumpItemIndexes(segments)
  const warnings = buildDraftMapWarnings({
    day,
    longJumpItemIndexes,
    points,
    segments,
  })

  return {
    coordinateCount: points.length,
    date: day.date,
    dayIndex,
    itemCount: day.items.length,
    items: day.items.map((item, itemIndex) => buildDraftMapPreviewItem(item, itemIndex, coordinateItemIndexes.has(itemIndex))),
    missingCoordinateCount: day.items.length - points.length,
    points,
    segments: segments.map((segment) => ({
      ...segment,
      warning: longJumpItemIndexes.has(segment.fromItemIndex) && longJumpItemIndexes.has(segment.toItemIndex),
    })),
    title: day.title,
    totalDistanceMeters: segments.reduce((sum, segment) => sum + segment.distanceMeters, 0),
    warnings,
  }
}

function buildDraftMapPreviewItem(
  item: AiTripDraftItem,
  itemIndex: number,
  participatesInPath: boolean,
): AiTripDraftMapPreviewItem {
  const coordinate = getDraftItemLngLat(item)
  const locationLabel = getDraftItemLocationLabel(item)

  return {
    coordinateLabel: coordinate ? `${coordinate[1].toFixed(5)}, ${coordinate[0].toFixed(5)}` : '缺少坐标，未参与地图线段',
    hasValidCoordinate: Boolean(coordinate),
    itemIndex,
    locationLabel,
    number: itemIndex + 1,
    participatesInPath,
    timeLabel: formatDraftItemTime(item),
    title: item.title || `行程点 ${itemIndex + 1}`,
  }
}

function projectDraftMapPoints(
  coordinateItems: Array<{
    coordinate: LngLat
    item: AiTripDraftItem
    itemIndex: number
  }>,
): AiTripDraftMapPreviewPoint[] {
  if (coordinateItems.length === 0) return []

  const lngValues = coordinateItems.map(({ coordinate }) => coordinate[0])
  const latValues = coordinateItems.map(({ coordinate }) => coordinate[1])
  const minLng = Math.min(...lngValues)
  const maxLng = Math.max(...lngValues)
  const minLat = Math.min(...latValues)
  const maxLat = Math.max(...latValues)
  const lngSpan = maxLng - minLng
  const latSpan = maxLat - minLat
  const innerSize = CANVAS_MAX - CANVAS_MIN

  return coordinateItems.map(({ coordinate, item, itemIndex }) => {
    const [lng, lat] = coordinate
    const x = lngSpan === 0
      ? 50
      : CANVAS_MIN + ((lng - minLng) / lngSpan) * innerSize
    const y = latSpan === 0
      ? 50
      : CANVAS_MIN + ((maxLat - lat) / latSpan) * innerSize

    return {
      itemIndex,
      lat,
      lng,
      locationLabel: getDraftItemLocationLabel(item),
      number: itemIndex + 1,
      title: item.title || `行程点 ${itemIndex + 1}`,
      x: clampCanvasValue(x),
      y: clampCanvasValue(y),
    }
  })
}

function buildDraftMapSegments(points: AiTripDraftMapPreviewPoint[]): AiTripDraftMapPreviewSegment[] {
  const segments: AiTripDraftMapPreviewSegment[] = []
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]
    const to = points[index]
    segments.push({
      distanceMeters: getDistanceMeters([from.lng, from.lat], [to.lng, to.lat]),
      fromItemIndex: from.itemIndex,
      fromNumber: from.number,
      fromTitle: from.title,
      toItemIndex: to.itemIndex,
      toNumber: to.number,
      toTitle: to.title,
      warning: false,
      x1: from.x,
      x2: to.x,
      y1: from.y,
      y2: to.y,
    })
  }
  return segments
}

function buildDraftMapWarnings({
  day,
  longJumpItemIndexes,
  points,
  segments,
}: {
  day: AiTripDraftDay
  longJumpItemIndexes: Set<number>
  points: AiTripDraftMapPreviewPoint[]
  segments: AiTripDraftMapPreviewSegment[]
}): AiTripDraftMapWarning[] {
  const warnings: AiTripDraftMapWarning[] = []
  const missingIndexes = day.items
    .map((item, index) => ({ index, item }))
    .filter(({ item }) => getDraftItemLngLat(item) === null)
    .map(({ index }) => index)

  if (points.length < 2) {
    warnings.push({
      itemIndexes: points.map((point) => point.itemIndex),
      message: '坐标点不足 2 个，只能查看地点分布，暂不能连成顺序线。',
      type: 'insufficient_coordinates',
    })
  }

  if (missingIndexes.length > 0) {
    warnings.push({
      itemIndexes: missingIndexes,
      message: `${missingIndexes.length} 个行程点缺少有效坐标，未参与地图线段。`,
      type: 'missing_coordinates',
    })
  }

  for (const segment of segments) {
    if (!longJumpItemIndexes.has(segment.fromItemIndex) || !longJumpItemIndexes.has(segment.toItemIndex)) {
      continue
    }
    warnings.push({
      itemIndexes: [segment.fromItemIndex, segment.toItemIndex],
      message: `${segment.fromTitle} 到 ${segment.toTitle} 的直线距离约 ${formatAiTripDraftMapDistance(segment.distanceMeters)}，可能需要检查顺序。`,
      type: 'long_jump',
    })
  }

  warnings.push(...buildBacktrackingWarnings(points))
  return warnings
}

function buildBacktrackingWarnings(points: AiTripDraftMapPreviewPoint[]): AiTripDraftMapWarning[] {
  const warnings: AiTripDraftMapWarning[] = []
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1]
    const current = points[index]
    const next = points[index + 1]
    const firstLeg = getDistanceMeters([previous.lng, previous.lat], [current.lng, current.lat])
    const secondLeg = getDistanceMeters([current.lng, current.lat], [next.lng, next.lat])
    const direct = getDistanceMeters([previous.lng, previous.lat], [next.lng, next.lat])
    const twoLegDistance = firstLeg + secondLeg
    if (twoLegDistance > 0 && direct < twoLegDistance * BACKTRACKING_DIRECT_RATIO) {
      warnings.push({
        itemIndexes: [previous.itemIndex, current.itemIndex, next.itemIndex],
        message: `${current.title} 前后出现折返，可能存在绕路。`,
        type: 'backtracking',
      })
    }
  }
  return warnings
}

function findLongJumpItemIndexes(segments: AiTripDraftMapPreviewSegment[]): Set<number> {
  const indexes = new Set<number>()
  const nonZeroDistances = segments
    .map((segment) => segment.distanceMeters)
    .filter((distance) => distance > 0)
    .sort((a, b) => a - b)
  const median = getMedian(nonZeroDistances)
  if (!median) return indexes

  for (const segment of segments) {
    if (
      segment.distanceMeters > LONG_JUMP_MIN_METERS &&
      segment.distanceMeters > median * LONG_JUMP_MEDIAN_FACTOR
    ) {
      indexes.add(segment.fromItemIndex)
      indexes.add(segment.toItemIndex)
    }
  }
  return indexes
}

function buildNearestNeighborOrder<T extends {
  coordinate: LngLat
  itemIndex: number
}>(records: T[]): T[] {
  const ordered = [records[0]]
  const remaining = records.slice(1)

  while (remaining.length > 0) {
    const current = ordered[ordered.length - 1]
    let nextIndex = 0
    let nextDistance = Number.POSITIVE_INFINITY
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index]
      const distance = getDistanceMeters(current.coordinate, candidate.coordinate)
      if (
        distance < nextDistance ||
        (distance === nextDistance && candidate.itemIndex < remaining[nextIndex].itemIndex)
      ) {
        nextIndex = index
        nextDistance = distance
      }
    }
    const [next] = remaining.splice(nextIndex, 1)
    ordered.push(next)
  }

  return ordered
}

function calculateCoordinateRecordDistance(records: Array<{ coordinate: LngLat }>): number {
  let distance = 0
  for (let index = 1; index < records.length; index += 1) {
    distance += getDistanceMeters(records[index - 1].coordinate, records[index].coordinate)
  }
  return distance
}

function hasSameItemOrder(currentItems: AiTripDraftItem[], nextItems: AiTripDraftItem[]): boolean {
  if (currentItems.length !== nextItems.length) return false
  return currentItems.every((item, index) => item === nextItems[index])
}

function getDraftItemLngLat(item: AiTripDraftItem): LngLat | null {
  if (typeof item.lng !== 'number' || typeof item.lat !== 'number') return null
  const coordinate: LngLat = [item.lng, item.lat]
  return isValidLngLat(coordinate) ? coordinate : null
}

function getDraftItemLocationLabel(item: AiTripDraftItem): string {
  return item.locationName || item.address || item.title || '未命名地点'
}

function formatDraftItemTime(item: AiTripDraftItem): string {
  if (item.startTime && item.endTime) return `${item.startTime}-${item.endTime}`
  if (item.startTime) return item.startTime
  if (item.endTime) return `至 ${item.endTime}`
  return '未设时间'
}

function getMedian(values: number[]): number | null {
  if (values.length === 0) return null
  const middle = Math.floor(values.length / 2)
  if (values.length % 2 === 1) return values[middle]
  return (values[middle - 1] + values[middle]) / 2
}

function normalizePlaceLookupQueryPart(value: string | undefined): string | null {
  const normalized = value?.replace(/\s+/g, ' ').trim()
  return normalized || null
}

function isValidPlaceLookupLocation(location: ProviderProxyPlaceLookupResult['location']): location is {
  lat: number
  lng: number
} {
  if (!location) return false
  return isValidLngLat([location.lng, location.lat])
}

function clampCanvasValue(value: number): number {
  return Math.min(CANVAS_MAX, Math.max(CANVAS_MIN, Number(value.toFixed(2))))
}
