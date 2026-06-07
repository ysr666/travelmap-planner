import {
  buildCurrentRouteCacheIdentity,
  saveRouteCache,
  type PersistentRouteCacheProvider,
  type RouteCacheEntry,
} from './routeCache'
import {
  GOOGLE_TRIP_PREVIEW_CACHE_TTL_MS,
  TRIP_PREVIEW_CACHE_DAY_ID,
  TRIP_PREVIEW_CACHE_SCOPE,
  buildTripPreviewRouteCacheIdentity,
} from './tripMapPreview'
import {
  fetchDayRoute,
  getOrderedMappableItems,
  type DayRouteResult,
  type RoutingConfig,
} from './routing'
import {
  getPersistentRouteProvider,
  loadTripRoutePreparation,
  type RoutePreparationDay,
} from './routePreparation'
import type { Day, ItineraryItem } from '../types'

export type RouteGenerationDayOutcome = {
  cacheEntry?: RouteCacheEntry
  day: Day
  lineStrings: DayRouteResult['lineStrings']
  message: string
  provider: PersistentRouteCacheProvider
  result?: DayRouteResult
  saved: boolean
  status: 'cached' | 'generated' | 'failed' | 'skipped'
  warnings: string[]
}

export type RouteGenerationBatchResult = {
  generatedCount: number
  failedCount: number
  outcomes: RouteGenerationDayOutcome[]
  previewCacheSaved: boolean
  provider: PersistentRouteCacheProvider | null
  skippedCount: number
}

export async function generateAndCacheDayRoutePreview({
  config,
  day,
  fetcher,
  forceRefresh = true,
  items,
  signal,
  tripId,
}: {
  config: RoutingConfig
  day: Day
  fetcher?: typeof fetch
  forceRefresh?: boolean
  items: ItineraryItem[]
  signal?: AbortSignal
  tripId: string
}): Promise<RouteGenerationDayOutcome> {
  const provider = getPersistentRouteProvider(config)
  if (!provider) {
    throw new Error('当前路线服务不可用。')
  }

  const mappableItems = getOrderedMappableItems(items)
  if (mappableItems.length < 2) {
    return {
      day,
      lineStrings: [],
      message: '至少需要两个有坐标的行程点。',
      provider,
      saved: false,
      status: 'skipped',
      warnings: ['至少需要两个有坐标的行程点。'],
    }
  }

  const identity = buildCurrentRouteCacheIdentity({
    dayId: day.id,
    items,
    provider,
    tripId,
  })
  const result = await fetchDayRoute(items, config, {
    fetcher,
    forceRefresh,
    signal,
  })
  const warnings = [...result.warnings]
  if (!hasRoadSegments(result)) {
    return {
      day,
      lineStrings: result.lineStrings,
      message: result.warnings[0] ?? '路线服务没有生成可缓存的路线预览。',
      provider,
      result,
      saved: false,
      status: 'failed',
      warnings: uniqueMessages([...warnings, '路线服务没有生成可缓存的路线预览。']),
    }
  }

  const saveResult = await saveRouteCache({
    coordinateKey: identity.coordinateKey,
    dayId: day.id,
    distanceMeters: sumOptional(result.segments.map((segment) => segment.distanceMeters)),
    durationSeconds: sumOptional(result.segments.map((segment) => segment.durationSeconds)),
    lineStrings: result.lineStrings,
    modeKey: identity.modeKey,
    provider,
    signature: identity.signature,
    status: result.status === 'mixed' ? 'mixed' : 'road',
    tripId,
    warnings: result.warnings,
  })
  if (!saveResult.saved) {
    warnings.push(saveResult.warning)
  }

  return {
    cacheEntry: saveResult.saved ? saveResult.entry : undefined,
    day,
    lineStrings: result.lineStrings,
    message: saveResult.saved ? '路线预览已生成。' : saveResult.warning,
    provider,
    result,
    saved: saveResult.saved,
    status: 'generated',
    warnings: uniqueMessages(warnings),
  }
}

export async function generateRoutePreviewsForTrip({
  config,
  days,
  fetcher,
  itemsByDay,
  signal,
  targetDayIds,
  tripId,
}: {
  config: RoutingConfig
  days: Day[]
  fetcher?: typeof fetch
  itemsByDay: Record<string, ItineraryItem[]>
  signal?: AbortSignal
  targetDayIds?: string[]
  tripId: string
}): Promise<RouteGenerationBatchResult> {
  const provider = getPersistentRouteProvider(config)
  if (!provider) {
    return {
      failedCount: 0,
      generatedCount: 0,
      outcomes: [],
      previewCacheSaved: false,
      provider: null,
      skippedCount: 0,
    }
  }

  const preparation = await loadTripRoutePreparation({
    days,
    itemsByDay,
    provider,
    tripId,
  })
  const outcomes: RouteGenerationDayOutcome[] = []
  const targetDayIdSet = targetDayIds ? new Set(targetDayIds) : null

  for (const routeDay of preparation.days) {
    if (signal?.aborted) {
      break
    }

    if (targetDayIdSet && !targetDayIdSet.has(routeDay.day.id)) {
      continue
    }

    if (routeDay.status === 'cached' && routeDay.cacheEntry) {
      outcomes.push(buildCachedOutcome(routeDay, provider))
      continue
    }

    if (routeDay.status !== 'ready_to_generate' && routeDay.status !== 'stale_if_cache_key_changed') {
      continue
    }

    try {
      outcomes.push(await generateAndCacheDayRoutePreview({
        config,
        day: routeDay.day,
        fetcher,
        items: itemsByDay[routeDay.day.id] ?? [],
        signal,
        tripId,
      }))
    } catch (caught) {
      outcomes.push({
        day: routeDay.day,
        lineStrings: [],
        message: caught instanceof Error ? caught.message : '路线预览生成失败。',
        provider,
        saved: false,
        status: 'failed',
        warnings: [caught instanceof Error ? caught.message : '路线预览生成失败。'],
      })
    }
  }

  const previewCacheSaved = targetDayIdSet ? false : await saveTripPreviewCacheFromOutcomes({
    days,
    itemsByDay,
    outcomes,
    provider,
    tripId,
  })

  return {
    failedCount: outcomes.filter((outcome) => outcome.status === 'failed').length,
    generatedCount: outcomes.filter((outcome) => outcome.status === 'generated' && outcome.saved).length,
    outcomes,
    previewCacheSaved,
    provider,
    skippedCount: outcomes.filter((outcome) => outcome.status === 'skipped').length,
  }
}

async function saveTripPreviewCacheFromOutcomes({
  days,
  itemsByDay,
  outcomes,
  provider,
  tripId,
}: {
  days: Day[]
  itemsByDay: Record<string, ItineraryItem[]>
  outcomes: RouteGenerationDayOutcome[]
  provider: PersistentRouteCacheProvider
  tripId: string
}) {
  const usableOutcomes = outcomes.filter((outcome) =>
    (outcome.status === 'cached' || outcome.status === 'generated') &&
    outcome.lineStrings.length > 0,
  )
  if (usableOutcomes.length === 0) {
    return false
  }

  const identity = buildTripPreviewRouteCacheIdentity({
    days,
    itemsByDay,
    provider,
    tripId,
  })
  const result = await saveRouteCache({
    coordinateKey: identity.coordinateKey,
    dayId: TRIP_PREVIEW_CACHE_DAY_ID,
    distanceMeters: sumOptional(usableOutcomes.map((outcome) =>
      outcome.result
        ? sumOptional(outcome.result.segments.map((segment) => segment.distanceMeters))
        : outcome.cacheEntry?.distanceMeters,
    )),
    durationSeconds: sumOptional(usableOutcomes.map((outcome) =>
      outcome.result
        ? sumOptional(outcome.result.segments.map((segment) => segment.durationSeconds))
        : outcome.cacheEntry?.durationSeconds,
    )),
    expiresAt: provider === 'google'
      ? new Date(Date.now() + GOOGLE_TRIP_PREVIEW_CACHE_TTL_MS).toISOString()
      : undefined,
    lineStrings: usableOutcomes.flatMap((outcome) => outcome.lineStrings),
    modeKey: identity.modeKey,
    provider,
    scope: TRIP_PREVIEW_CACHE_SCOPE,
    signature: identity.signature,
    status: getPreviewRouteStatus(usableOutcomes),
    tripId,
    warnings: uniqueMessages(usableOutcomes.flatMap((outcome) => outcome.warnings)),
  })

  return result.saved
}

function buildCachedOutcome(
  routeDay: RoutePreparationDay,
  provider: PersistentRouteCacheProvider,
): RouteGenerationDayOutcome {
  const cacheEntry = routeDay.cacheEntry as RouteCacheEntry
  return {
    cacheEntry,
    day: routeDay.day,
    lineStrings: cacheEntry.lineStrings,
    message: '已使用本地路线缓存。',
    provider,
    saved: true,
    status: 'cached',
    warnings: cacheEntry.warnings,
  }
}

function hasRoadSegments(result: DayRouteResult) {
  return result.segments.some((segment) => segment.kind === 'road')
}

function getPreviewRouteStatus(outcomes: RouteGenerationDayOutcome[]): 'road' | 'mixed' | 'straight' {
  const statuses = outcomes.map((outcome) => outcome.result?.status ?? outcome.cacheEntry?.status ?? 'road')
  if (statuses.some((status) => status === 'road') && statuses.every((status) => status === 'road')) {
    return 'road'
  }
  if (statuses.some((status) => status === 'road' || status === 'mixed')) {
    return 'mixed'
  }
  return 'straight'
}

function sumOptional(values: Array<number | undefined>) {
  const present = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return present.length ? present.reduce((sum, value) => sum + value, 0) : undefined
}

function uniqueMessages(messages: string[]) {
  return Array.from(new Set(messages.filter(Boolean)))
}
