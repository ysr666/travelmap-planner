import { hasValidCoordinates } from './mapLinks'
import { sortItineraryItems } from './itinerary'
import {
  fetchProviderProxyRoutePreview,
  getProviderProxyConfig,
  type ProviderProxyClientOptions,
} from './providerProxyClient'
import type { ProviderProxyRoutePreviewRequest } from './ai/providerProxyContract'
import type { ItineraryItem, TransportMode } from '../types'

export type RoutingProvider = 'none' | 'openrouteservice' | 'google'
export type RoutingProfile = 'foot-walking' | 'driving-car' | 'cycling-regular'
export type RoutingMode = TransportMode | 'cycling' | 'subway' | 'unknown'
export type LngLat = [number, number]

export type RoutingConfig = {
  provider: RoutingProvider
  apiKey: string | null
  googleMapsKey: string | null
  routeProxyUrl?: string | null
  configured: boolean
  source: 'local' | 'env' | 'proxy' | 'none'
}

export type RouteSegmentRequest = {
  from: LngLat
  to: LngLat
  mode: RoutingMode
  profile: RoutingProfile
  segmentIndex: number
  fromItemId: string
  toItemId: string
}

export type RouteSegmentResult = {
  coordinates: LngLat[]
  distanceMeters?: number
  durationSeconds?: number
  provider: RoutingProvider
  kind: 'road' | 'straight'
  warning?: string
  segmentIndex: number
  fromItemId: string
  toItemId: string
}

export type DayRouteResult = {
  segments: RouteSegmentResult[]
  lineStrings: LngLat[][]
  warnings: string[]
  provider: RoutingProvider
  status: 'straight' | 'road' | 'mixed' | 'failed'
  cacheKey: string
}

export type FetchDayRouteOptions = {
  signal?: AbortSignal
  timeoutMs?: number
  forceRefresh?: boolean
  fetcher?: typeof fetch
}

export const ROUTING_PROVIDER_STORAGE_KEY = 'tripmap:routing:provider'
export const ROUTING_API_KEY_STORAGE_KEY = 'tripmap:routing:openrouteservice-api-key'
export const ROUTING_CONFIG_CHANGED_EVENT = 'tripmap:routing-config-changed'
export const BUS_APPROXIMATION_WARNING = '公交段使用道路路线近似，不包含公交站点、班次、换乘和实时交通。实际出行请以 Apple Maps / Google Maps 等导航为准。'

const ROUTE_CACHE_LIMIT = 20
const routeCache = new Map<string, DayRouteResult>()

export function getRoutingConfig(
  options: {
    env?: Partial<ImportMetaEnv>
    storage?: Storage | null
  } = {},
): RoutingConfig {
  const storage = options.storage ?? getBrowserStorage()
  const env = options.env ?? readRoutingEnv()
  const rawLocalProvider = storage?.getItem(ROUTING_PROVIDER_STORAGE_KEY)
  const localGoogleKey = storage?.getItem('tripmap:google-maps-api-key')?.trim() || ''
  const envGoogleKey = env.VITE_GOOGLE_MAPS_API_KEY?.trim() || ''
  const googleMapsKey = localGoogleKey || envGoogleKey || null
  const proxyConfig = getProviderProxyConfig({ env, storage })

  if (proxyConfig.configured && proxyConfig.provider && proxyConfig.proxyUrl) {
    return {
      provider: proxyConfig.provider,
      apiKey: null,
      googleMapsKey,
      routeProxyUrl: proxyConfig.proxyUrl,
      configured: true,
      source: 'proxy',
    }
  }

  if (rawLocalProvider === 'none') {
    return { provider: 'none', apiKey: null, googleMapsKey, configured: false, source: 'none' }
  }

  return { provider: 'none', apiKey: null, googleMapsKey, configured: false, source: 'none' }
}

function readRoutingEnv(): Pick<ImportMetaEnv, 'VITE_GOOGLE_MAPS_API_KEY' | 'VITE_ROUTE_PROXY_PROVIDER' | 'VITE_ROUTE_PROXY_URL'> {
  return {
    VITE_GOOGLE_MAPS_API_KEY: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    VITE_ROUTE_PROXY_PROVIDER: import.meta.env.VITE_ROUTE_PROXY_PROVIDER,
    VITE_ROUTE_PROXY_URL: import.meta.env.VITE_ROUTE_PROXY_URL,
  }
}

export function isRoutingConfigured(config = getRoutingConfig()) {
  return isProxyRoutingConfig(config)
}

export function saveLocalOpenRouteServiceApiKey(_apiKey: string, storage = getBrowserStorage()) {
  if (!storage) {
    return
  }

  storage.removeItem(ROUTING_PROVIDER_STORAGE_KEY)
  storage.removeItem(ROUTING_API_KEY_STORAGE_KEY)
  dispatchRoutingConfigChanged()
}

export function clearLocalOpenRouteServiceApiKey(storage = getBrowserStorage()) {
  storage?.removeItem(ROUTING_PROVIDER_STORAGE_KEY)
  storage?.removeItem(ROUTING_API_KEY_STORAGE_KEY)
  dispatchRoutingConfigChanged()
}

export function getLocalOpenRouteServiceApiKey(storage = getBrowserStorage()) {
  storage?.removeItem(ROUTING_API_KEY_STORAGE_KEY)
  return ''
}

export function mapTransportModeToRoutingProfile(mode?: RoutingMode): {
  profile: RoutingProfile | null
  warning?: string
} {
  if (mode === 'walk') {
    return { profile: 'foot-walking' }
  }

  if (mode === 'car') {
    return { profile: 'driving-car' }
  }

  if (mode === 'bus') {
    return {
      profile: 'driving-car',
      warning: BUS_APPROXIMATION_WARNING,
    }
  }

  if (mode === 'cycling') {
    return { profile: 'cycling-regular' }
  }

  if (mode === 'train' || mode === 'transit' || mode === 'subway' || mode === 'flight') {
    return {
      profile: null,
      warning: `${transportModeName(mode)} 段暂不使用道路路线，已显示直线连接。`,
    }
  }

  return {
    profile: 'driving-car',
    warning: '交通方式未明确，已按驾车路线尝试生成，仅供参考。',
  }
}

export function buildFallbackStraightRoute(items: ItineraryItem[], warning?: string): DayRouteResult {
  const segments = buildStraightSegments(items, 'none', warning)
  const lineStrings = segments.map((segment) => segment.coordinates)

  return {
    segments,
    lineStrings,
    warnings: warning ? [warning] : [],
    provider: 'none',
    status: 'straight',
    cacheKey: buildRouteCacheKey(items, { provider: 'none', apiKey: null, googleMapsKey: null, configured: false, source: 'none' }),
  }
}

function buildRouteCacheKey(items: ItineraryItem[], config: RoutingConfig) {
  const orderedItems = getOrderedMappableItems(items)
  const coordinatePart = orderedItems
    .map((item) =>
      [
        item.id,
        item.lng,
        item.lat,
        item.sortOrder,
        item.startTime ?? '',
        item.previousTransportMode ?? '',
        item.transportMode ?? '',
      ].join(':'),
    )
    .join('|')

  return [
    'v1',
    config.provider,
    config.source,
    hashString(config.apiKey ?? ''),
    coordinatePart,
  ].join('::')
}

export async function fetchDayRoute(
  items: ItineraryItem[],
  config: RoutingConfig,
  options: FetchDayRouteOptions = {},
): Promise<DayRouteResult> {
  const cacheKey = buildRouteCacheKey(items, config)
  const cached = routeCache.get(cacheKey)
  if (cached && !options.forceRefresh) {
    return cached
  }

  const orderedItems = getOrderedMappableItems(items)
  if (orderedItems.length < 2) {
    return cacheDayRoute(cacheKey, {
      segments: [],
      lineStrings: [],
      warnings: ['至少需要 2 个带坐标的行程点才能生成路线。'],
      provider: config.provider,
      status: 'straight',
      cacheKey,
    })
  }

  if (!isProxyRoutingConfig(config)) {
    return cacheDayRoute(cacheKey, buildFallbackStraightRoute(items, '路线服务未配置，已显示直线连接。'))
  }

  return fetchDayRouteViaProxy(items, config, options, cacheKey)
}

async function fetchDayRouteViaProxy(
  items: ItineraryItem[],
  config: RoutingConfig & { provider: Exclude<RoutingProvider, 'none'>; routeProxyUrl: string; source: 'proxy' },
  options: FetchDayRouteOptions,
  cacheKey: string,
): Promise<DayRouteResult> {
  const orderedItems = getOrderedMappableItems(items)
  const warnings: string[] = []
  const segmentResults = new Map<number, RouteSegmentResult>()
  const coordinates: LngLat[] = []
  const coordinateIndexes = new Map<string, number>()
  const proxySegments: ProviderProxyRoutePreviewRequest['segments'] = []
  const roadSegmentItems = new Map<number, { fromItem: ItineraryItem; toItem: ItineraryItem; warning?: string }>()

  function getCoordinateIndex(item: ItineraryItem, coordinate: LngLat) {
    const key = `${item.id}:${coordinate[0]},${coordinate[1]}`
    const existing = coordinateIndexes.get(key)
    if (existing !== undefined) {
      return existing
    }
    const nextIndex = coordinates.length
    coordinates.push(coordinate)
    coordinateIndexes.set(key, nextIndex)
    return nextIndex
  }

  for (let index = 1; index < orderedItems.length; index += 1) {
    const fromItem = orderedItems[index - 1]
    const toItem = orderedItems[index]
    const from = getItemLngLat(fromItem)
    const to = getItemLngLat(toItem)
    if (!from || !to) {
      continue
    }

    const mode = toItem.previousTransportMode ?? toItem.transportMode ?? 'unknown'
    const mappedMode = mapTransportModeToRoutingProfile(mode)
    if (!mappedMode.profile) {
      if (mappedMode.warning) {
        warnings.push(mappedMode.warning)
      }
      segmentResults.set(index - 1, createStraightSegment(fromItem, toItem, index - 1, config.provider, mappedMode.warning))
      continue
    }

    if (mappedMode.warning) {
      warnings.push(mappedMode.warning)
    }

    proxySegments.push({
      fromCoordinateIndex: getCoordinateIndex(fromItem, from),
      fromItemId: fromItem.id,
      mode,
      profile: mappedMode.profile,
      segmentIndex: index - 1,
      toCoordinateIndex: getCoordinateIndex(toItem, to),
      toItemId: toItem.id,
    })
    roadSegmentItems.set(index - 1, { fromItem, toItem, warning: mappedMode.warning })
  }

  if (proxySegments.length > 0) {
    try {
      const response = await fetchProviderProxyRoutePreview({
        coordinates,
        dayId: orderedItems[0]?.dayId,
        operation: 'route_preview',
        provider: config.provider,
        requestId: createRouteRequestId(),
        segments: proxySegments,
        tripId: orderedItems[0]?.tripId,
      }, config.routeProxyUrl, toProviderProxyClientOptions(options))

      if (response.provider !== config.provider) {
        throw new Error('路线服务请求失败。')
      }

      for (const proxySegment of response.route.segments) {
        const segmentItems = roadSegmentItems.get(proxySegment.segmentIndex)
        if (!segmentItems) {
          continue
        }
        segmentResults.set(proxySegment.segmentIndex, {
          coordinates: proxySegment.coordinates,
          distanceMeters: proxySegment.distanceMeters,
          durationSeconds: proxySegment.durationSeconds,
          fromItemId: proxySegment.fromItemId ?? segmentItems.fromItem.id,
          kind: 'road',
          provider: response.provider,
          segmentIndex: proxySegment.segmentIndex,
          toItemId: proxySegment.toItemId ?? segmentItems.toItem.id,
        })
      }
      warnings.push(...response.route.warnings)
    } catch (caught) {
      const message = normalizeRoutingError(caught)
      warnings.push(message)
    }
  }

  let failedRoadSegmentCount = 0
  for (const [segmentIndex, segmentItems] of roadSegmentItems) {
    if (!segmentResults.has(segmentIndex)) {
      failedRoadSegmentCount += 1
      segmentResults.set(
        segmentIndex,
        createStraightSegment(segmentItems.fromItem, segmentItems.toItem, segmentIndex, config.provider, '路线服务暂不可用。'),
      )
    }
  }

  const segments = Array.from(segmentResults.values()).sort((first, second) => first.segmentIndex - second.segmentIndex)
  const roadSegmentCount = segments.filter((segment) => segment.kind === 'road').length
  const status = getRouteStatus(segments, roadSegmentCount, failedRoadSegmentCount)

  return cacheDayRoute(cacheKey, {
    segments,
    lineStrings: segments.map((segment) => segment.coordinates),
    warnings: uniqueMessages(warnings),
    provider: config.provider,
    status,
    cacheKey,
  })
}

function isProxyRoutingConfig(config: RoutingConfig): config is RoutingConfig & {
  provider: Exclude<RoutingProvider, 'none'>
  routeProxyUrl: string
  source: 'proxy'
} {
  return (
    config.source === 'proxy' &&
    (config.provider === 'google' || config.provider === 'openrouteservice') &&
    Boolean(config.routeProxyUrl)
  )
}

export function parseOpenRouteServiceGeoJson(input: unknown): {
  coordinates: LngLat[]
  distanceMeters?: number
  durationSeconds?: number
} {
  const features = readRecord(input).features
  const feature = Array.isArray(features) ? features[0] : null
  const geometry = readRecord(feature).geometry
  const coordinates = readRecord(geometry).coordinates
  if (!Array.isArray(coordinates)) {
    throw new Error('路线服务返回的数据格式不正确。')
  }

  const parsedCoordinates = coordinates.flatMap((coordinate) => {
    if (!Array.isArray(coordinate) || coordinate.length < 2) {
      return []
    }
    const lng = Number(coordinate[0])
    const lat = Number(coordinate[1])
    if (!isValidLngLat([lng, lat])) {
      return []
    }
    return [[lng, lat] as LngLat]
  })

  if (parsedCoordinates.length < 2) {
    throw new Error('路线服务没有返回可用路线。')
  }

  const summary = readRecord(readRecord(feature).properties).summary
  const distance = Number(readRecord(summary).distance)
  const duration = Number(readRecord(summary).duration)

  return {
    coordinates: parsedCoordinates,
    distanceMeters: Number.isFinite(distance) ? distance : undefined,
    durationSeconds: Number.isFinite(duration) ? duration : undefined,
  }
}

export function getItemLngLat(item?: ItineraryItem): LngLat | null {
  if (!item || !hasValidCoordinates(item)) {
    return null
  }

  return [item.lng as number, item.lat as number]
}

export function getOrderedMappableItems(items: ItineraryItem[]) {
  return sortItineraryItems(items).filter((item) => getItemLngLat(item) !== null)
}

function buildStraightSegments(items: ItineraryItem[], provider: RoutingProvider, warning?: string) {
  const orderedItems = getOrderedMappableItems(items)
  const segments: RouteSegmentResult[] = []
  for (let index = 1; index < orderedItems.length; index += 1) {
    segments.push(createStraightSegment(orderedItems[index - 1], orderedItems[index], index - 1, provider, warning))
  }
  return segments
}

function createStraightSegment(
  fromItem: ItineraryItem,
  toItem: ItineraryItem,
  segmentIndex: number,
  provider: RoutingProvider,
  warning?: string,
): RouteSegmentResult {
  const from = getItemLngLat(fromItem)
  const to = getItemLngLat(toItem)
  return {
    coordinates: from && to ? [from, to] : [],
    provider,
    kind: 'straight',
    warning,
    segmentIndex,
    fromItemId: fromItem.id,
    toItemId: toItem.id,
  }
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

function dispatchRoutingConfigChanged() {
  if (typeof window === 'undefined') {
    return
  }
  window.dispatchEvent(new Event(ROUTING_CONFIG_CHANGED_EVENT))
}

function toProviderProxyClientOptions(options: FetchDayRouteOptions): ProviderProxyClientOptions {
  return {
    fetcher: options.fetcher,
    signal: options.signal,
    storage: getBrowserStorage(),
  }
}

function createRouteRequestId() {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `route_${random}`
}

function normalizeRoutingError(caught: unknown) {
  if (caught instanceof Error) {
    if (caught.name === 'AbortError' || caught.message === 'timeout' || caught.message === 'aborted') {
      return '网络异常或请求超时。'
    }
    return caught.message
  }
  return '网络异常或请求超时。'
}

function readRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? input as Record<string, unknown> : {}
}

function isValidLngLat(coordinate: LngLat) {
  const [lng, lat] = coordinate
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lng >= -180 &&
    lng <= 180 &&
    lat >= -90 &&
    lat <= 90
  )
}

function getRouteStatus(
  segments: RouteSegmentResult[],
  roadSegmentCount: number,
  failedRoadSegmentCount: number,
): DayRouteResult['status'] {
  if (segments.length === 0) {
    return 'straight'
  }
  if (roadSegmentCount === 0) {
    return failedRoadSegmentCount > 0 ? 'failed' : 'straight'
  }
  if (segments.some((segment) => segment.kind === 'straight')) {
    return 'mixed'
  }
  return 'road'
}

function cacheDayRoute(cacheKey: string, result: DayRouteResult) {
  const cachedResult = { ...result, cacheKey }
  routeCache.delete(cacheKey)
  routeCache.set(cacheKey, cachedResult)
  while (routeCache.size > ROUTE_CACHE_LIMIT) {
    const firstKey = routeCache.keys().next().value
    if (!firstKey) {
      break
    }
    routeCache.delete(firstKey)
  }
  return cachedResult
}

function uniqueMessages(messages: string[]) {
  return Array.from(new Set(messages.filter(Boolean)))
}

function transportModeName(mode: RoutingMode) {
  const names: Record<RoutingMode, string> = {
    walk: '步行',
    transit: '公共交通',
    bus: '公交',
    car: '驾车',
    train: '火车',
    flight: '飞行',
    other: '其他交通',
    cycling: '骑行',
    subway: '地铁',
    unknown: '交通方式未定',
  }
  return names[mode]
}

function hashString(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash.toString(36)
}
