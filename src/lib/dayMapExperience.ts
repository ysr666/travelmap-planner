import type { ItineraryItem, TransportMode } from '../types'
import { sortItineraryItemsByPlanOrder } from './itinerary'
import { buildGoogleMapsNavigationUrl, hasValidCoordinates } from './mapLinks'
import type { ActiveRouteLineKind, RouteLineKind } from './mapEngine'
import type { LngLat, RoutingProvider } from './routing'

export type DayMapRouteInput = {
  distanceMeters?: number
  durationSeconds?: number
  lineStrings: LngLat[][]
  provider: RoutingProvider
  status: 'failed' | 'mixed' | 'road' | 'straight'
  warnings?: string[]
}

export type DayMapRoutePresentation = {
  activeLineKind: ActiveRouteLineKind
  activeLineStrings: LngLat[][]
  activeSegmentIndex: number | null
  canRefresh: boolean
  detail: string
  geometryKind: 'estimate' | 'mixed' | 'road' | 'unavailable'
  label: string
  lineKind: RouteLineKind
  lineStrings: LngLat[][]
  sourceLabel: string | null
}

export type DayMapStopPresentation = {
  item: ItineraryItem
  navigationHref: string
  sequence: number
  ticketCount: number
  transportLabel: string | null
}

export type DayMapExperience = {
  route: DayMapRoutePresentation
  selectedStop: DayMapStopPresentation | null
  stops: DayMapStopPresentation[]
}

export function buildDayMapExperience({
  items,
  providerConfigured,
  route,
  selectedItemId,
}: {
  items: ItineraryItem[]
  providerConfigured: boolean
  route?: DayMapRouteInput | null
  selectedItemId?: string | null
}): DayMapExperience {
  const orderedItems = sortItineraryItemsByPlanOrder(items)
  const mappedItems = orderedItems.filter(hasValidCoordinates)
  const stops = mappedItems.map((item, index) => buildStopPresentation(item, index))
  const selectedStop = stops.find((stop) => stop.item.id === selectedItemId) ?? null
  const selectedIndex = selectedStop ? stops.indexOf(selectedStop) : 0
  const routePresentation = buildRoutePresentation({
    mappedItems,
    providerConfigured,
    route,
    selectedIndex,
  })

  return {
    route: routePresentation,
    selectedStop,
    stops,
  }
}

function buildStopPresentation(item: ItineraryItem, index: number): DayMapStopPresentation {
  return {
    item,
    navigationHref: buildGoogleMapsNavigationUrl(item, item.previousTransportMode),
    sequence: index + 1,
    ticketCount: item.ticketIds.length,
    transportLabel: buildTransportLabel(item.previousTransportMode, item.previousTransportDurationMinutes),
  }
}

function buildRoutePresentation({
  mappedItems,
  providerConfigured,
  route,
  selectedIndex,
}: {
  mappedItems: ItineraryItem[]
  providerConfigured: boolean
  route?: DayMapRouteInput | null
  selectedIndex: number
}): DayMapRoutePresentation {
  const canRefresh = providerConfigured && mappedItems.length >= 2
  const lineStrings = normalizeLineStrings(route?.lineStrings)
  const hasRoadGeometry = route?.status === 'road' && lineStrings.length > 0
  const hasMixedGeometry = route?.status === 'mixed' && lineStrings.length > 0
  const activeSegmentIndex = getActiveSegmentIndex(
    hasRoadGeometry || hasMixedGeometry ? lineStrings.length : Math.max(0, mappedItems.length - 1),
    selectedIndex,
  )
  const activeLineStrings = activeSegmentIndex === null
    ? []
    : hasRoadGeometry || hasMixedGeometry
      ? [lineStrings[activeSegmentIndex]].filter((line): line is LngLat[] => Boolean(line))
      : buildEstimatedSegment(mappedItems, activeSegmentIndex)
  const activeDestination = activeSegmentIndex === null
    ? null
    : mappedItems[Math.min(mappedItems.length - 1, activeSegmentIndex + 1)]

  if (hasRoadGeometry) {
    return {
      activeLineKind: mapActiveRouteLineKind(activeDestination?.previousTransportMode),
      activeLineStrings,
      activeSegmentIndex,
      canRefresh,
      detail: formatRouteMetric(route),
      geometryKind: 'road',
      label: '道路路线',
      lineKind: 'road',
      lineStrings,
      sourceLabel: route ? getRouteSourceLabel(route.provider) : null,
    }
  }

  if (hasMixedGeometry) {
    return {
      activeLineKind: 'estimate',
      activeLineStrings,
      activeSegmentIndex,
      canRefresh,
      detail: '部分路段仅表示地点顺序',
      geometryKind: 'mixed',
      label: '部分路段估算',
      lineKind: 'sequence',
      lineStrings,
      sourceLabel: route ? getRouteSourceLabel(route.provider) : null,
    }
  }

  if (mappedItems.length >= 2) {
    return {
      activeLineKind: 'estimate',
      activeLineStrings,
      activeSegmentIndex,
      canRefresh,
      detail: '虚线仅表示地点顺序',
      geometryKind: 'estimate',
      label: '路线为估算',
      lineKind: 'sequence',
      lineStrings: [],
      sourceLabel: null,
    }
  }

  return {
    activeLineKind: 'estimate',
    activeLineStrings: [],
    activeSegmentIndex: null,
    canRefresh: false,
    detail: mappedItems.length === 1 ? '需要至少两个坐标' : '暂无可用坐标',
    geometryKind: 'unavailable',
    label: '路线不可用',
    lineKind: 'sequence',
    lineStrings: [],
    sourceLabel: null,
  }
}

function buildTransportLabel(mode?: TransportMode, durationMinutes?: number) {
  const modeLabel = mode ? TRANSPORT_LABELS[mode] : null
  const durationLabel = Number.isFinite(durationMinutes) && (durationMinutes ?? 0) > 0
    ? `${Math.round(durationMinutes as number)} 分钟`
    : null
  if (modeLabel && durationLabel) return `${modeLabel} ${durationLabel}`
  return modeLabel ?? durationLabel
}

function getActiveSegmentIndex(segmentCount: number, selectedIndex: number) {
  if (segmentCount <= 0) return null
  if (selectedIndex <= 0) return 0
  return Math.min(segmentCount - 1, selectedIndex - 1)
}

function buildEstimatedSegment(items: ItineraryItem[], segmentIndex: number): LngLat[][] {
  const from = items[segmentIndex]
  const to = items[segmentIndex + 1]
  if (!from || !to || !hasValidCoordinates(from) || !hasValidCoordinates(to)) return []
  return [[[from.lng as number, from.lat as number], [to.lng as number, to.lat as number]]]
}

function normalizeLineStrings(lineStrings?: LngLat[][]) {
  return (lineStrings ?? [])
    .map((line) => line.filter(isValidLngLat))
    .filter((line) => line.length >= 2)
}

function isValidLngLat(value: LngLat) {
  return Number.isFinite(value[0])
    && Number.isFinite(value[1])
    && value[0] >= -180
    && value[0] <= 180
    && value[1] >= -90
    && value[1] <= 90
}

function mapActiveRouteLineKind(mode?: TransportMode): ActiveRouteLineKind {
  if (mode === 'walk') return 'walk'
  if (mode === 'car') return 'drive'
  if (mode === 'bus' || mode === 'train' || mode === 'transit') return 'transit'
  return 'other'
}

function formatRouteMetric(route?: DayMapRouteInput | null) {
  const parts: string[] = []
  if (route?.durationSeconds && route.durationSeconds > 0) {
    parts.push(`约 ${Math.max(1, Math.round(route.durationSeconds / 60))} 分钟`)
  }
  if (route?.distanceMeters && route.distanceMeters > 0) {
    parts.push(route.distanceMeters >= 1000
      ? `${(route.distanceMeters / 1000).toFixed(route.distanceMeters >= 10_000 ? 0 : 1)} 公里`
      : `${Math.round(route.distanceMeters)} 米`)
  }
  return parts.join(' · ') || '沿道路显示'
}

function getRouteSourceLabel(provider: RoutingProvider) {
  return provider === 'none' ? null : '路线服务'
}

const TRANSPORT_LABELS: Record<TransportMode, string> = {
  bus: '公交',
  car: '驾车',
  flight: '飞行',
  other: '交通',
  train: '火车',
  transit: '公共交通',
  walk: '步行',
}
