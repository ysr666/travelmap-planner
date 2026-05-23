import {
  buildCurrentRouteCacheIdentity,
  listRouteCachesForDay,
  type PersistentRouteCacheProvider,
  type RouteCacheEntry,
} from './routeCache'
import { getOrderedMappableItems, isRoutingConfigured, type RoutingConfig } from './routing'
import type { Day, ItineraryItem } from '../types'

export type RoutePreparationStatus =
  | 'no_coordinates'
  | 'not_enough_points'
  | 'ready_to_generate'
  | 'cached'
  | 'stale_if_cache_key_changed'

export type RouteCacheIdentity = ReturnType<typeof buildCurrentRouteCacheIdentity>

export type RoutePreparationDay = {
  cacheEntry: RouteCacheEntry | null
  coordinateCount: number
  day: Day
  eligible: boolean
  identity: RouteCacheIdentity | null
  provider: PersistentRouteCacheProvider | null
  staleCacheEntries: RouteCacheEntry[]
  status: RoutePreparationStatus
}

export type TripRoutePreparation = {
  cachedDayCount: number
  canGenerate: boolean
  days: RoutePreparationDay[]
  eligibleDayCount: number
  noCoordinateDayCount: number
  notEnoughPointDayCount: number
  provider: PersistentRouteCacheProvider | null
  providerConfigured: boolean
  readyDayCount: number
  staleDayCount: number
  targetDayIds: string[]
}

export function getPersistentRouteProvider(config: RoutingConfig): PersistentRouteCacheProvider | null {
  if (!isRoutingConfigured(config)) {
    return null
  }

  if (config.provider === 'openrouteservice' || config.provider === 'google') {
    return config.provider
  }

  return null
}

export function evaluateTripRoutePreparation({
  cachesByDay,
  days,
  itemsByDay,
  provider,
  tripId,
}: {
  cachesByDay?: Record<string, RouteCacheEntry[]>
  days: Day[]
  itemsByDay: Record<string, ItineraryItem[]>
  provider: PersistentRouteCacheProvider | null
  tripId: string
}): TripRoutePreparation {
  const routeDays = [...days]
    .sort((first, second) => first.sortOrder - second.sortOrder)
    .map((day) =>
      evaluateRoutePreparationDay({
        cacheEntries: cachesByDay?.[day.id] ?? [],
        day,
        items: itemsByDay[day.id] ?? [],
        provider,
        tripId,
      }),
    )
  const targetDayIds = routeDays
    .filter((day) => day.status === 'ready_to_generate' || day.status === 'stale_if_cache_key_changed')
    .map((day) => day.day.id)

  return {
    cachedDayCount: routeDays.filter((day) => day.status === 'cached').length,
    canGenerate: Boolean(provider && targetDayIds.length > 0),
    days: routeDays,
    eligibleDayCount: routeDays.filter((day) => day.eligible).length,
    noCoordinateDayCount: routeDays.filter((day) => day.status === 'no_coordinates').length,
    notEnoughPointDayCount: routeDays.filter((day) => day.status === 'not_enough_points').length,
    provider,
    providerConfigured: Boolean(provider),
    readyDayCount: routeDays.filter((day) => day.status === 'ready_to_generate').length,
    staleDayCount: routeDays.filter((day) => day.status === 'stale_if_cache_key_changed').length,
    targetDayIds: provider ? targetDayIds : [],
  }
}

export function evaluateRoutePreparationDay({
  cacheEntries = [],
  day,
  items,
  provider,
  tripId,
}: {
  cacheEntries?: RouteCacheEntry[]
  day: Day
  items: ItineraryItem[]
  provider: PersistentRouteCacheProvider | null
  tripId: string
}): RoutePreparationDay {
  const coordinateCount = getOrderedMappableItems(items).length
  if (coordinateCount === 0) {
    return buildPreparationDay({ cacheEntry: null, coordinateCount, day, identity: null, provider, staleCacheEntries: [], status: 'no_coordinates' })
  }
  if (coordinateCount < 2) {
    return buildPreparationDay({ cacheEntry: null, coordinateCount, day, identity: null, provider, staleCacheEntries: [], status: 'not_enough_points' })
  }

  const candidates = provider ? [provider] : (['openrouteservice', 'google'] as PersistentRouteCacheProvider[])
  const identities = candidates.map((candidate) =>
    buildCurrentRouteCacheIdentity({
      dayId: day.id,
      items,
      provider: candidate,
      tripId,
    }),
  )
  const currentIdentity = provider ? identities[0] : null
  const currentSignatures = new Set(identities.map((identity) => identity.signature))
  const dayMapEntries = cacheEntries.filter(isDayMapRouteCache)
  const exactEntry = dayMapEntries.find((entry) =>
    currentSignatures.has(entry.signature) &&
    (!provider || entry.provider === provider),
  ) ?? null
  const staleEntries = dayMapEntries.filter((entry) => {
    if (provider && entry.provider !== provider) {
      return false
    }
    return !currentSignatures.has(entry.signature)
  })

  if (exactEntry) {
    return buildPreparationDay({
      cacheEntry: exactEntry,
      coordinateCount,
      day,
      identity: currentIdentity,
      provider: exactEntry.provider,
      staleCacheEntries: staleEntries,
      status: 'cached',
    })
  }

  if (staleEntries.length > 0) {
    return buildPreparationDay({
      cacheEntry: null,
      coordinateCount,
      day,
      identity: currentIdentity,
      provider,
      staleCacheEntries: staleEntries,
      status: 'stale_if_cache_key_changed',
    })
  }

  return buildPreparationDay({
    cacheEntry: null,
    coordinateCount,
    day,
    identity: currentIdentity,
    provider,
    staleCacheEntries: [],
    status: 'ready_to_generate',
  })
}

export async function loadTripRoutePreparation({
  days,
  itemsByDay,
  provider,
  tripId,
}: {
  days: Day[]
  itemsByDay: Record<string, ItineraryItem[]>
  provider: PersistentRouteCacheProvider | null
  tripId: string
}) {
  const entries = await Promise.all(
    days.map(async (day) => [day.id, await listRouteCachesForDay(tripId, day.id)] as const),
  )

  return evaluateTripRoutePreparation({
    cachesByDay: Object.fromEntries(entries),
    days,
    itemsByDay,
    provider,
    tripId,
  })
}

function buildPreparationDay(input: Omit<RoutePreparationDay, 'eligible'>): RoutePreparationDay {
  return {
    ...input,
    eligible: input.coordinateCount >= 2,
  }
}

function isDayMapRouteCache(entry: RouteCacheEntry) {
  return (entry.scope ?? 'day-map') === 'day-map'
}
