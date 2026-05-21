import Dexie, { type Table } from 'dexie'
import { getOrderedMappableItems, mapTransportModeToRoutingProfile, type LngLat, type RoutingProvider } from './routing'
import type { ItineraryItem } from '../types'

export type RouteCacheScope = 'day-map' | 'trip-preview'

export type PersistentRouteCacheProvider = Extract<RoutingProvider, 'openrouteservice' | 'google'>

export type RouteCacheEntry = {
  id: string
  tripId: string
  dayId: string
  scope?: RouteCacheScope
  provider: PersistentRouteCacheProvider
  routingVersion: 1
  signature: string
  coordinateKey: string
  modeKey: string
  lineStrings: LngLat[][]
  warnings: string[]
  status?: 'road' | 'mixed' | 'straight'
  distanceMeters?: number
  durationSeconds?: number
  sizeBytes: number
  createdAt: string
  updatedAt: string
  lastUsedAt: string
  expiresAt?: string
}

export type SaveRouteCacheInput = {
  tripId: string
  dayId: string
  scope?: RouteCacheScope
  provider: PersistentRouteCacheProvider
  signature: string
  coordinateKey: string
  modeKey: string
  lineStrings: LngLat[][]
  warnings?: string[]
  status?: 'road' | 'mixed' | 'straight'
  distanceMeters?: number
  durationSeconds?: number
  expiresAt?: string
}

export type RouteCacheStats = {
  count: number
  totalSizeBytes: number
  maxBytes: number
}

export const ROUTE_CACHE_DB_NAME = 'TripMapRouteCacheDB'
export const ROUTE_CACHE_CHANGED_EVENT = 'tripmap:route-cache-changed'
export const ROUTE_CACHE_MAX_BYTES_STORAGE_KEY = 'tripmap:routing:cache-max-bytes'
export const DEFAULT_ROUTE_CACHE_MAX_BYTES = 20 * 1024 * 1024
export const ROUTING_VERSION = 1 as const

const MAX_BYTES_OPTIONS = [5, 20, 50, 100].map((value) => value * 1024 * 1024)
let memoryRouteCacheMaxBytes = DEFAULT_ROUTE_CACHE_MAX_BYTES

class TripMapRouteCacheDatabase extends Dexie {
  routeCaches!: Table<RouteCacheEntry, string>

  constructor() {
    super(ROUTE_CACHE_DB_NAME)
    this.version(1).stores({
      routeCaches: 'id, signature, [tripId+dayId], lastUsedAt, updatedAt',
    })
  }
}

const routeCacheDb = new TripMapRouteCacheDatabase()

export function buildRouteCoordinateKey(items: ItineraryItem[]) {
  return getOrderedMappableItems(items)
    .map((item) =>
      [
        item.id,
        item.lat,
        item.lng,
        item.sortOrder,
        item.startTime ?? '',
      ].join(':'),
    )
    .join('|')
}

export function buildRouteModeKey(items: ItineraryItem[]) {
  const orderedItems = getOrderedMappableItems(items)
  return orderedItems.slice(1).map((item, index) => {
    const mode = item.previousTransportMode ?? item.transportMode ?? 'unknown'
    const profile = mapTransportModeToRoutingProfile(mode).profile ?? 'straight-fallback'
    return [
      orderedItems[index].id,
      item.id,
      mode,
      profile,
    ].join(':')
  }).join('|')
}

export function buildRouteCacheSignature({
  tripId,
  dayId,
  provider,
  scope = 'day-map',
  coordinateKey,
  modeKey,
  routingVersion = ROUTING_VERSION,
}: {
  tripId: string
  dayId: string
  provider: PersistentRouteCacheProvider
  scope?: RouteCacheScope
  coordinateKey: string
  modeKey: string
  routingVersion?: number
}) {
  return [
    'route-cache',
    routingVersion,
    scope,
    provider,
    tripId,
    dayId,
    coordinateKey,
    modeKey,
  ].join('::')
}

export function buildCurrentRouteCacheIdentity({
  tripId,
  dayId,
  items,
  provider = 'openrouteservice',
  scope = 'day-map',
}: {
  tripId: string
  dayId: string
  items: ItineraryItem[]
  provider?: PersistentRouteCacheProvider
  scope?: RouteCacheScope
}) {
  const coordinateKey = buildRouteCoordinateKey(items)
  const modeKey = buildRouteModeKey(items)
  const signature = buildRouteCacheSignature({
    tripId,
    dayId,
    provider,
    scope,
    coordinateKey,
    modeKey,
    routingVersion: ROUTING_VERSION,
  })

  return {
    provider,
    scope,
    routingVersion: ROUTING_VERSION,
    coordinateKey,
    modeKey,
    signature,
  }
}

export async function loadRouteCache(signature: string) {
  const entry = await routeCacheDb.routeCaches.get(signature)
  if (!entry) {
    return null
  }

  if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= Date.now()) {
    await routeCacheDb.routeCaches.delete(entry.id)
    dispatchRouteCacheChanged()
    return null
  }

  const now = new Date().toISOString()
  await routeCacheDb.routeCaches.update(entry.id, {
    lastUsedAt: now,
    updatedAt: now,
  })

  return {
    ...entry,
    lastUsedAt: now,
    updatedAt: now,
  }
}

export async function saveRouteCache(input: SaveRouteCacheInput) {
  const normalizedLineStrings = normalizeRouteGeometry(input.lineStrings)
  const maxBytes = getRouteCacheMaxBytes()
  const now = new Date().toISOString()
  const draft = {
    tripId: input.tripId,
    dayId: input.dayId,
    scope: input.scope ?? 'day-map',
    provider: input.provider,
    routingVersion: ROUTING_VERSION,
    signature: input.signature,
    coordinateKey: input.coordinateKey,
    modeKey: input.modeKey,
    lineStrings: normalizedLineStrings,
    warnings: input.warnings ?? [],
    status: input.status,
    distanceMeters: input.distanceMeters,
    durationSeconds: input.durationSeconds,
    expiresAt: input.expiresAt,
  }
  const sizeBytes = estimateRouteCacheSize(draft)
  if (sizeBytes > maxBytes) {
    return {
      saved: false as const,
      warning: '单条道路路线超过当前缓存上限，已显示但未写入本地缓存。',
      sizeBytes,
    }
  }

  const entry: RouteCacheEntry = {
    ...draft,
    id: input.signature,
    sizeBytes,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: now,
  }

  const existing = await routeCacheDb.routeCaches.get(input.signature)
  if (existing) {
    entry.createdAt = existing.createdAt
  }

  await routeCacheDb.routeCaches.put(entry)
  await pruneStaleRouteCachesForDay(input.tripId, input.dayId, input.signature)
  await enforceRouteCacheLimit(maxBytes)
  dispatchRouteCacheChanged()
  return {
    saved: true as const,
    entry,
  }
}

export async function pruneStaleRouteCachesForDay(
  tripId: string,
  dayId: string,
  currentSignature: string,
) {
  const entries = await routeCacheDb.routeCaches
    .where('[tripId+dayId]')
    .equals([tripId, dayId])
    .toArray()
  const staleIds = entries
    .filter((entry) => entry.signature !== currentSignature)
    .map((entry) => entry.id)

  if (staleIds.length > 0) {
    await routeCacheDb.routeCaches.bulkDelete(staleIds)
    dispatchRouteCacheChanged()
  }

  return staleIds.length
}

export async function enforceRouteCacheLimit(maxBytes = getRouteCacheMaxBytes()) {
  const entries = await routeCacheDb.routeCaches.orderBy('lastUsedAt').toArray()
  const totalSizeBytes = entries.reduce((sum, entry) => sum + entry.sizeBytes, 0)
  if (totalSizeBytes <= maxBytes) {
    return 0
  }

  const targetSize = Math.floor(maxBytes * 0.9)
  const deleteIds: string[] = []
  let nextSize = totalSizeBytes
  for (const entry of entries) {
    if (nextSize <= targetSize) {
      break
    }
    deleteIds.push(entry.id)
    nextSize -= entry.sizeBytes
  }

  if (deleteIds.length > 0) {
    await routeCacheDb.routeCaches.bulkDelete(deleteIds)
    dispatchRouteCacheChanged()
  }
  return deleteIds.length
}

export async function clearRouteCache() {
  await routeCacheDb.routeCaches.clear()
  dispatchRouteCacheChanged()
}

export async function getRouteCacheStats(): Promise<RouteCacheStats> {
  const entries = await routeCacheDb.routeCaches.toArray()
  return {
    count: entries.length,
    totalSizeBytes: entries.reduce((sum, entry) => sum + entry.sizeBytes, 0),
    maxBytes: getRouteCacheMaxBytes(),
  }
}

export function getRouteCacheMaxBytes(storage = getBrowserStorage()) {
  const value = Number(storage?.getItem(ROUTE_CACHE_MAX_BYTES_STORAGE_KEY))
  if (Number.isFinite(value) && value > 0) {
    return value
  }
  return memoryRouteCacheMaxBytes
}

export async function setRouteCacheMaxBytes(bytes: number, storage = getBrowserStorage()) {
  const normalized = Number.isFinite(bytes) && bytes > 0 ? bytes : DEFAULT_ROUTE_CACHE_MAX_BYTES
  memoryRouteCacheMaxBytes = normalized
  storage?.setItem(ROUTE_CACHE_MAX_BYTES_STORAGE_KEY, String(normalized))
  await enforceRouteCacheLimit(normalized)
  dispatchRouteCacheChanged()
  return normalized
}

export function getRouteCacheMaxByteOptions() {
  return MAX_BYTES_OPTIONS
}

export function normalizeRouteGeometry(lineStrings: LngLat[][]) {
  if (!Array.isArray(lineStrings)) {
    throw new Error('路线缓存 geometry 格式无效。')
  }

  const normalized = lineStrings.map((lineString) => {
    if (!Array.isArray(lineString) || lineString.length < 2) {
      throw new Error('路线缓存至少需要每段 2 个坐标。')
    }
    return lineString.map((coordinate) => {
      if (!Array.isArray(coordinate) || coordinate.length !== 2) {
        throw new Error('路线缓存坐标必须是 [lng, lat]。')
      }
      const [lng, lat] = coordinate
      if (
        typeof lng !== 'number' ||
        typeof lat !== 'number' ||
        !Number.isFinite(lng) ||
        !Number.isFinite(lat) ||
        lng < -180 ||
        lng > 180 ||
        lat < -90 ||
        lat > 90
      ) {
        throw new Error('路线缓存坐标超出合法范围。')
      }
      return [lng, lat] as LngLat
    })
  })

  if (normalized.length === 0) {
    throw new Error('路线缓存不能为空。')
  }

  return normalized
}

export function estimateRouteCacheSize(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function getBrowserStorage() {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    return window.localStorage
  } catch {
    return null
  }
}

function dispatchRouteCacheChanged() {
  if (typeof window === 'undefined') {
    return
  }
  window.dispatchEvent(new Event(ROUTE_CACHE_CHANGED_EVENT))
}
