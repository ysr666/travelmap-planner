import { sortItineraryItems } from './itinerary'
import { hasValidCoordinates } from './mapLinks'
import {
  buildFallbackStraightRoute,
  fetchDayRoute,
  getItemLngLat,
  getOrderedMappableItems,
  isRoutingConfigured,
  mapTransportModeToRoutingProfile,
  type DayRouteResult,
  type LngLat,
  type RoutingConfig,
} from './routing'
import {
  buildRouteCacheSignature,
  loadRouteCache,
  ROUTING_VERSION,
  saveRouteCache,
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
const tripPreviewRouteRequests = new Map<string, Promise<TripPreviewRouteResult>>()

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
  itemsByDay,
  signal,
  tripId,
  fetcher,
}: {
  config: RoutingConfig
  days: Day[]
  fetcher?: typeof fetch
  itemsByDay: Record<string, ItineraryItem[]>
  signal?: AbortSignal
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

  if (!isPersistentRouteProvider(config.provider) || !isRoutingConfigured(config)) {
    return {
      cacheKey: 'trip-preview::straight',
      lineStrings: buildStraightPreviewLineStrings(itemGroups),
      provider: 'none',
      source: 'straight',
      status: 'straight',
      warnings: ['路线服务未配置，地图预览已按每天行程顺序显示直线连接。'],
    }
  }

  const provider = config.provider
  const identity = buildTripPreviewRouteCacheIdentity({
    days: orderedDays,
    itemsByDay,
    provider,
    tripId,
  })
  const cached = await loadRouteCache(identity.signature)
  if (
    cached &&
    cached.scope === TRIP_PREVIEW_CACHE_SCOPE &&
    cached.provider === provider
  ) {
    return {
      cacheKey: identity.signature,
      lineStrings: cached.lineStrings,
      provider: cached.provider,
      source: 'cache',
      status: cached.status ?? 'road',
      warnings: cached.warnings,
    }
  }

  const pending = tripPreviewRouteRequests.get(identity.signature)
  if (pending) {
    return pending
  }

  const request = generateAndCacheTripPreviewRoute({
    config,
    fetcher,
    identity,
    itemGroups,
    provider,
    signal,
    tripId,
  })
  tripPreviewRouteRequests.set(identity.signature, request)

  try {
    return await request
  } finally {
    if (tripPreviewRouteRequests.get(identity.signature) === request) {
      tripPreviewRouteRequests.delete(identity.signature)
    }
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

async function generateAndCacheTripPreviewRoute({
  config,
  fetcher,
  identity,
  itemGroups,
  provider,
  signal,
  tripId,
}: {
  config: RoutingConfig
  fetcher?: typeof fetch
  identity: ReturnType<typeof buildTripPreviewRouteCacheIdentity>
  itemGroups: ItineraryItem[][]
  provider: PersistentRouteCacheProvider
  signal?: AbortSignal
  tripId: string
}): Promise<TripPreviewRouteResult> {
  const results = await Promise.all(
    itemGroups.map((items) => fetchDayRoute(items, config, { fetcher, signal })),
  )
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('aborted')
  }

  const segments = results.flatMap((result) => result.segments)
  const lineStrings = results.flatMap((result) => result.lineStrings)
  const warnings = uniqueMessages(results.flatMap((result) => result.warnings))
  const status = getPreviewRouteStatus(results)
  const hasRoadGeometry = segments.some((segment) => segment.kind === 'road')
  if (hasRoadGeometry) {
    const expiresAt = provider === 'google'
      ? new Date(Date.now() + GOOGLE_TRIP_PREVIEW_CACHE_TTL_MS).toISOString()
      : undefined
    await saveRouteCache({
      tripId,
      dayId: TRIP_PREVIEW_CACHE_DAY_ID,
      scope: TRIP_PREVIEW_CACHE_SCOPE,
      provider,
      signature: identity.signature,
      coordinateKey: identity.coordinateKey,
      modeKey: identity.modeKey,
      lineStrings,
      warnings,
      status,
      distanceMeters: sumOptional(segments.map((segment) => segment.distanceMeters)),
      durationSeconds: sumOptional(segments.map((segment) => segment.durationSeconds)),
      expiresAt,
    })
  }

  return {
    cacheKey: identity.signature,
    lineStrings,
    provider,
    source: 'generated',
    status,
    warnings,
  }
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

function sumOptional(values: Array<number | undefined>) {
  const present = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return present.length ? present.reduce((sum, value) => sum + value, 0) : undefined
}

function buildStraightPreviewLineStrings(itemGroups: ItineraryItem[][]) {
  return itemGroups.flatMap((items) => buildFallbackStraightRoute(items).lineStrings)
}

function getPreviewRouteStatus(results: DayRouteResult[]): 'road' | 'mixed' | 'straight' {
  const statuses = results.map((result) => result.status)
  if (statuses.some((status) => status === 'road') && statuses.every((status) => status === 'road')) {
    return 'road'
  }
  if (statuses.some((status) => status === 'road' || status === 'mixed')) {
    return 'mixed'
  }
  return 'straight'
}

function uniqueMessages(messages: string[]) {
  return Array.from(new Set(messages.filter(Boolean)))
}
