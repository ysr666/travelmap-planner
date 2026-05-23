import { sortItineraryItems } from './itinerary'
import { hasValidCoordinates } from './mapLinks'
import {
  buildFallbackStraightRoute,
  getItemLngLat,
  getOrderedMappableItems,
  mapTransportModeToRoutingProfile,
  type DayRouteResult,
  type LngLat,
  type RoutingConfig,
} from './routing'
import {
  buildRouteCacheSignature,
  listRouteCachesForDay,
  ROUTING_VERSION,
  type RouteCacheEntry,
  type PersistentRouteCacheProvider,
} from './routeCache'
import type { Day, ItineraryItem } from '../types'

export type TripMapPreviewEngine = 'google' | 'maplibre'
export type TripMapPreviewRouteSource = 'cache' | 'generated' | 'straight'

export type TripMapPreviewRecord = {
  coordinate: LngLat
  day: Day
  item: ItineraryItem
}

export type TripMapPreviewData = {
  coordinateCount: number
  dayCount: number
  records: TripMapPreviewRecord[]
  targetDay: Day | null
}

export type TripPreviewRouteResult = {
  cacheKey: string
  lineStrings: LngLat[][]
  provider: 'none' | PersistentRouteCacheProvider
  source: TripMapPreviewRouteSource
  status: DayRouteResult['status']
  warnings: string[]
}

export const TRIP_PREVIEW_CACHE_DAY_ID = '__trip_preview__'
export const TRIP_PREVIEW_CACHE_SCOPE = 'trip-preview'
export const GOOGLE_TRIP_PREVIEW_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000

export function buildTripMapPreviewData({
  days,
  itemsByDay,
  selectedDay,
}: {
  days: Day[]
  itemsByDay: Record<string, ItineraryItem[]>
  selectedDay: Day | null
}): TripMapPreviewData {
  const orderedDays = [...days].sort((first, second) => first.sortOrder - second.sortOrder)
  const records = getTripPreviewRecords(orderedDays, itemsByDay)
  const targetDay = chooseTripPreviewTargetDay({ days: orderedDays, itemsByDay, selectedDay })
  const coordinateDayIds = new Set(records.map((record) => record.day.id))

  return {
    coordinateCount: records.length,
    dayCount: coordinateDayIds.size,
    records,
    targetDay,
  }
}

export function selectTripPreviewRoutingConfig(
  engine: TripMapPreviewEngine,
  config: RoutingConfig,
): RoutingConfig {
  if (config.source === 'proxy' && config.configured) {
    return config
  }

  if (engine === 'google' && config.googleMapsKey) {
    return {
      provider: 'google',
      apiKey: null,
      googleMapsKey: config.googleMapsKey,
      configured: true,
      source: config.source,
    }
  }

  if (engine === 'maplibre' && config.provider === 'openrouteservice' && config.configured && config.apiKey) {
    return config
  }

  return {
    provider: 'none',
    apiKey: null,
    googleMapsKey: config.googleMapsKey,
    configured: false,
    source: 'none',
  }
}

export function buildTripPreviewRouteCacheIdentity({
  days,
  itemsByDay,
  provider,
  tripId,
}: {
  days: Day[]
  itemsByDay: Record<string, ItineraryItem[]>
  provider: PersistentRouteCacheProvider
  tripId: string
}) {
  const orderedDays = [...days].sort((first, second) => first.sortOrder - second.sortOrder)
  const records = getTripPreviewRecords(orderedDays, itemsByDay)
  const coordinateKey = buildTripPreviewCoordinateKey(records)
  const modeKey = buildTripPreviewModeKey(records)
  const signature = buildRouteCacheSignature({
    tripId,
    dayId: TRIP_PREVIEW_CACHE_DAY_ID,
    provider,
    scope: TRIP_PREVIEW_CACHE_SCOPE,
    coordinateKey,
    modeKey,
    routingVersion: ROUTING_VERSION,
  })

  return {
    coordinateKey,
    dayId: TRIP_PREVIEW_CACHE_DAY_ID,
    modeKey,
    provider,
    routingVersion: ROUTING_VERSION,
    scope: TRIP_PREVIEW_CACHE_SCOPE,
    signature,
  }
}

export async function fetchTripPreviewRoute({
  config,
  days,
  tripId,
  itemsByDay,
}: {
  config: RoutingConfig
  days: Day[]
  itemsByDay: Record<string, ItineraryItem[]>
  tripId: string
}): Promise<TripPreviewRouteResult> {
  const orderedDays = [...days].sort((first, second) => first.sortOrder - second.sortOrder)
  const itemGroups = getTripPreviewItemGroups(orderedDays, itemsByDay)
  const orderedItems = itemGroups.flat()

  if (orderedItems.length < 2) {
    return {
      cacheKey: 'trip-preview::empty',
      lineStrings: [],
      provider: 'none',
      source: 'straight',
      status: 'straight',
      warnings: ['至少需要 2 个带坐标的行程点才能生成地图预览路线。'],
    }
  }

  const cached = await findCachedTripPreviewRoute({
    days: orderedDays,
    itemsByDay,
    provider: isPersistentRouteProvider(config.provider) ? config.provider : null,
    tripId,
  })
  if (cached) {
    return {
      cacheKey: cached.signature,
      lineStrings: cached.lineStrings,
      provider: cached.provider,
      source: 'cache',
      status: cached.status ?? 'road',
      warnings: cached.warnings,
    }
  }

  return {
    cacheKey: 'trip-preview::straight',
    lineStrings: buildStraightPreviewLineStrings(itemGroups),
    provider: 'none',
    source: 'straight',
    status: 'straight',
    warnings: [
      isPersistentRouteProvider(config.provider)
        ? '尚未生成路线预览，已按每天行程顺序显示直线连接。'
        : '路线服务未配置，地图预览已按每天行程顺序显示直线连接。',
    ],
  }
}

export function getTripPreviewOptimizationDay({
  days,
  itemsByDay,
  selectedDay,
}: {
  days: Day[]
  itemsByDay: Record<string, ItineraryItem[]>
  selectedDay: Day | null
}) {
  const orderedDays = [...days].sort((first, second) => first.sortOrder - second.sortOrder)
  const candidates = orderedDays.filter((day) => {
    const count = getOrderedMappableItems(itemsByDay[day.id] ?? []).length
    return count >= 4 && count <= 10
  })

  if (selectedDay && candidates.some((day) => day.id === selectedDay.id)) {
    return selectedDay
  }

  return candidates[0] ?? null
}

function getTripPreviewRecords(days: Day[], itemsByDay: Record<string, ItineraryItem[]>): TripMapPreviewRecord[] {
  return days.flatMap((day) =>
    sortItineraryItems(itemsByDay[day.id] ?? [])
      .filter(hasValidCoordinates)
      .flatMap((item) => {
        const coordinate = getItemLngLat(item)
        return coordinate ? [{ coordinate, day, item }] : []
      }),
  )
}

function getTripPreviewItemGroups(days: Day[], itemsByDay: Record<string, ItineraryItem[]>): ItineraryItem[][] {
  return days
    .map((day) => getOrderedMappableItems(itemsByDay[day.id] ?? []))
    .filter((items) => items.length >= 2)
}

function buildTripPreviewCoordinateKey(records: TripMapPreviewRecord[]) {
  return records
    .map(({ day, item }) =>
      [
        day.id,
        day.sortOrder,
        item.id,
        item.lat,
        item.lng,
        item.sortOrder,
        item.startTime ?? '',
      ].join(':'),
    )
    .join('|')
}

function buildTripPreviewModeKey(records: TripMapPreviewRecord[]) {
  return records.flatMap(({ day, item }, index) => {
    const previous = records[index - 1]
    if (!previous || previous.day.id !== day.id) {
      return []
    }
    const mode = item.previousTransportMode ?? item.transportMode ?? 'unknown'
    const profile = mapTransportModeToRoutingProfile(mode).profile ?? 'straight-fallback'
    return [[
      previous.day.id,
      previous.item.id,
      day.id,
      item.id,
      mode,
      profile,
    ].join(':')]
  }).join('|')
}

function chooseTripPreviewTargetDay({
  days,
  itemsByDay,
  selectedDay,
}: {
  days: Day[]
  itemsByDay: Record<string, ItineraryItem[]>
  selectedDay: Day | null
}) {
  if (selectedDay && hasAnyValidCoordinate(itemsByDay[selectedDay.id] ?? [])) {
    return selectedDay
  }

  const firstDayWithCoordinates = days.find((day) => hasAnyValidCoordinate(itemsByDay[day.id] ?? []))
  return firstDayWithCoordinates ?? selectedDay ?? days[0] ?? null
}

function hasAnyValidCoordinate(items: ItineraryItem[]) {
  return items.some(hasValidCoordinates)
}

function isPersistentRouteProvider(provider: RoutingConfig['provider']): provider is PersistentRouteCacheProvider {
  return provider === 'openrouteservice' || provider === 'google'
}

function buildStraightPreviewLineStrings(itemGroups: ItineraryItem[][]) {
  return itemGroups.flatMap((items) => buildFallbackStraightRoute(items).lineStrings)
}

async function findCachedTripPreviewRoute({
  days,
  itemsByDay,
  provider,
  tripId,
}: {
  days: Day[]
  itemsByDay: Record<string, ItineraryItem[]>
  provider: PersistentRouteCacheProvider | null
  tripId: string
}): Promise<RouteCacheEntry | null> {
  const providers = provider ? [provider] : (['openrouteservice', 'google'] as PersistentRouteCacheProvider[])
  const identities = providers.map((candidate) =>
    buildTripPreviewRouteCacheIdentity({
      days,
      itemsByDay,
      provider: candidate,
      tripId,
    }),
  )
  const entries = await listRouteCachesForDay(tripId, TRIP_PREVIEW_CACHE_DAY_ID)
  return entries.find((entry) =>
    entry.scope === TRIP_PREVIEW_CACHE_SCOPE &&
    identities.some((identity) => identity.signature === entry.signature && identity.provider === entry.provider),
  ) ?? null
}
