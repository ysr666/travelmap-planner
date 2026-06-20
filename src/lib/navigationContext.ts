import { getRouteParams, routeFromHash } from './routes'
import type { RouteId } from '../types'

export type TripNavigationContext = {
  dayId?: string
  tripId: string
  updatedAt: number
  version: 1
}

type NavigationContextTarget = Pick<TripNavigationContext, 'dayId' | 'tripId'>

const STORAGE_KEY = 'tripmap.navigation-context.v1'
const MAX_ID_LENGTH = 256
const TRIP_SCOPED_ROUTES = new Set<RouteId>([
  'day',
  'documents',
  'item',
  'item/edit',
  'item/new',
  'ledger',
  'ledger/expense',
  'shared-trip',
  'tickets',
  'trip',
  'trip/edit',
])

export function getTripNavigationTarget(hash = window.location.hash): NavigationContextTarget | null {
  if (!TRIP_SCOPED_ROUTES.has(routeFromHash(hash))) return null

  const params = getRouteParams(hash)
  const tripId = normalizeId(params.get('tripId'))
  if (!tripId) return null

  const dayId = normalizeId(params.get('dayId'))
  return dayId ? { dayId, tripId } : { tripId }
}

export function readTripNavigationContext(storage = getDefaultStorage()): TripNavigationContext | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return null
    return parseTripNavigationContext(JSON.parse(raw))
  } catch {
    return null
  }
}

export function recordTripNavigationContext(
  target: NavigationContextTarget,
  options: { now?: number; storage?: Storage | null } = {},
): TripNavigationContext | null {
  const storage = options.storage ?? getDefaultStorage()
  const tripId = normalizeId(target.tripId)
  if (!storage || !tripId) return null

  const previous = readTripNavigationContext(storage)
  const explicitDayId = normalizeId(target.dayId)
  const dayId = explicitDayId ?? (previous?.tripId === tripId ? previous.dayId : undefined)
  const context: TripNavigationContext = {
    ...(dayId ? { dayId } : {}),
    tripId,
    updatedAt: options.now ?? Date.now(),
    version: 1,
  }

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(context))
    return context
  } catch {
    return null
  }
}

export function clearTripNavigationContext(storage = getDefaultStorage()) {
  if (!storage) return
  try {
    storage.removeItem(STORAGE_KEY)
  } catch {
    // Browser storage can be unavailable in private or restricted contexts.
  }
}

function parseTripNavigationContext(input: unknown): TripNavigationContext | null {
  if (!input || typeof input !== 'object') return null
  const record = input as Record<string, unknown>
  const tripId = normalizeId(record.tripId)
  if (record.version !== 1 || !tripId || !isFiniteTimestamp(record.updatedAt)) return null

  const dayId = normalizeId(record.dayId)
  return {
    ...(dayId ? { dayId } : {}),
    tripId,
    updatedAt: record.updatedAt as number,
    version: 1,
  }
}

function normalizeId(value: unknown) {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (!normalized || normalized.length > MAX_ID_LENGTH) return undefined
  return normalized
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function getDefaultStorage() {
  return typeof window === 'undefined' ? null : window.localStorage
}
