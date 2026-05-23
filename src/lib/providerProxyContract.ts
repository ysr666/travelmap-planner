import type { RoutingMode, RoutingProfile, LngLat } from './routing'

export const PROVIDER_PROXY_ROUTE_PREVIEW_OPERATION = 'route_preview' as const
export const PROVIDER_PROXY_MAX_COORDINATES = 25
export const PROVIDER_PROXY_MAX_SEGMENTS = PROVIDER_PROXY_MAX_COORDINATES - 1
export const PROVIDER_PROXY_MAX_DAYS_PER_BATCH = 7

export type ProviderProxyOperation = typeof PROVIDER_PROXY_ROUTE_PREVIEW_OPERATION
export type ProviderProxyConcreteProvider = 'google' | 'openrouteservice'
export type ProviderProxyProvider = ProviderProxyConcreteProvider | 'auto'
export type ProviderProxyErrorCode =
  | 'provider_unavailable'
  | 'quota_exceeded'
  | 'invalid_request'
  | 'provider_error'
  | 'network_error'
  | 'unsupported'

export type ProviderProxyRoutePreviewSegmentRequest = {
  fromCoordinateIndex: number
  fromItemId?: string
  mode: RoutingMode
  profile: RoutingProfile
  segmentIndex: number
  toCoordinateIndex: number
  toItemId?: string
}

export type ProviderProxyRoutePreviewRequest = {
  cacheIdentity?: {
    coordinateKey?: string
    modeKey?: string
    routingVersion?: number
    signature?: string
  }
  coordinates: LngLat[]
  dayId?: string
  operation: ProviderProxyOperation
  provider: ProviderProxyProvider
  quotaSessionId?: string
  requestId?: string
  segments: ProviderProxyRoutePreviewSegmentRequest[]
  tripId?: string
}

export type ProviderProxyRouteSegment = {
  coordinates: LngLat[]
  distanceMeters?: number
  durationSeconds?: number
  fromItemId?: string
  kind: 'road'
  segmentIndex: number
  toItemId?: string
}

export type ProviderProxyRoutePreviewSuccessResponse = {
  ok: true
  operation: ProviderProxyOperation
  provider: ProviderProxyConcreteProvider
  requestId?: string
  route: {
    distanceMeters?: number
    durationSeconds?: number
    lineStrings: LngLat[][]
    segments: ProviderProxyRouteSegment[]
    status: 'road' | 'mixed' | 'straight' | 'failed'
    warnings: string[]
  }
}

export type ProviderProxyErrorResponse = {
  code: ProviderProxyErrorCode
  details?: string
  message: string
  ok: false
  operation?: ProviderProxyOperation
  provider?: ProviderProxyConcreteProvider
  requestId?: string
}

export type ProviderProxyRoutePreviewResponse =
  | ProviderProxyRoutePreviewSuccessResponse
  | ProviderProxyErrorResponse

export type ProviderProxyValidationResult =
  | { ok: true; request: ProviderProxyRoutePreviewRequest }
  | { error: ProviderProxyErrorResponse; ok: false }

const VALID_PROVIDERS = new Set<ProviderProxyProvider>(['auto', 'google', 'openrouteservice'])
const VALID_MODES = new Set<RoutingMode>([
  'bus',
  'car',
  'cycling',
  'flight',
  'other',
  'subway',
  'train',
  'transit',
  'unknown',
  'walk',
])
const VALID_PROFILES = new Set<RoutingProfile>(['cycling-regular', 'driving-car', 'foot-walking'])

export function validateProviderProxyRoutePreviewRequest(input: unknown): ProviderProxyValidationResult {
  const record = readRecord(input)
  const requestId = readOptionalString(record.requestId, 128)

  if (record.operation !== PROVIDER_PROXY_ROUTE_PREVIEW_OPERATION) {
    return invalidRequest('不支持的 provider proxy 操作。', requestId)
  }

  const provider = record.provider
  if (!isProviderProxyProvider(provider)) {
    return invalidRequest('路线服务 provider 无效。', requestId)
  }

  const rawCoordinates = record.coordinates
  if (!Array.isArray(rawCoordinates)) {
    return invalidRequest('路线请求缺少坐标。', requestId)
  }
  if (rawCoordinates.length < 2) {
    return invalidRequest('路线请求至少需要两个坐标。', requestId)
  }
  if (rawCoordinates.length > PROVIDER_PROXY_MAX_COORDINATES) {
    return invalidRequest(`单次路线请求最多支持 ${PROVIDER_PROXY_MAX_COORDINATES} 个坐标。`, requestId)
  }

  const coordinates: LngLat[] = []
  for (const coordinate of rawCoordinates) {
    const normalized = normalizeLngLat(coordinate)
    if (!normalized) {
      return invalidRequest('路线请求坐标无效。', requestId)
    }
    coordinates.push(normalized)
  }

  const rawSegments = record.segments
  if (!Array.isArray(rawSegments) || rawSegments.length === 0) {
    return invalidRequest('路线请求缺少路线段。', requestId)
  }
  if (rawSegments.length > PROVIDER_PROXY_MAX_SEGMENTS) {
    return invalidRequest(`单次路线请求最多支持 ${PROVIDER_PROXY_MAX_SEGMENTS} 段路线。`, requestId)
  }

  const segments: ProviderProxyRoutePreviewSegmentRequest[] = []
  for (const rawSegment of rawSegments) {
    const segmentRecord = readRecord(rawSegment)
    const fromCoordinateIndex = Number(segmentRecord.fromCoordinateIndex)
    const toCoordinateIndex = Number(segmentRecord.toCoordinateIndex)
    const segmentIndex = Number(segmentRecord.segmentIndex)
    const mode = segmentRecord.mode
    const profile = segmentRecord.profile

    if (!isSafeIndex(fromCoordinateIndex, coordinates.length) || !isSafeIndex(toCoordinateIndex, coordinates.length)) {
      return invalidRequest('路线段坐标索引无效。', requestId)
    }
    if (fromCoordinateIndex === toCoordinateIndex) {
      return invalidRequest('路线段起终点不能相同。', requestId)
    }
    if (!Number.isInteger(segmentIndex) || segmentIndex < 0 || segmentIndex > 999) {
      return invalidRequest('路线段序号无效。', requestId)
    }
    if (!isRoutingMode(mode)) {
      return invalidRequest('路线段交通方式无效。', requestId)
    }
    if (!isRoutingProfile(profile)) {
      return invalidRequest('路线段 profile 无效。', requestId)
    }

    segments.push({
      fromCoordinateIndex,
      fromItemId: readOptionalString(segmentRecord.fromItemId, 128),
      mode,
      profile,
      segmentIndex,
      toCoordinateIndex,
      toItemId: readOptionalString(segmentRecord.toItemId, 128),
    })
  }

  return {
    ok: true,
    request: {
      cacheIdentity: normalizeCacheIdentity(record.cacheIdentity),
      coordinates,
      dayId: readOptionalString(record.dayId, 128),
      operation: PROVIDER_PROXY_ROUTE_PREVIEW_OPERATION,
      provider,
      quotaSessionId: readOptionalString(record.quotaSessionId, 160),
      requestId,
      segments,
      tripId: readOptionalString(record.tripId, 128),
    },
  }
}

export function buildProviderProxyErrorResponse({
  code,
  details,
  message,
  operation,
  provider,
  requestId,
}: {
  code: ProviderProxyErrorCode
  details?: string
  message?: string
  operation?: ProviderProxyOperation
  provider?: ProviderProxyConcreteProvider
  requestId?: string
}): ProviderProxyErrorResponse {
  return {
    code,
    details,
    message: message ?? defaultProviderProxyErrorMessage(code),
    ok: false,
    operation,
    provider,
    requestId,
  }
}

export function defaultProviderProxyErrorMessage(code: ProviderProxyErrorCode) {
  if (code === 'quota_exceeded') return '今日路线生成次数已达上限。'
  if (code === 'invalid_request') return '路线请求无效。'
  if (code === 'provider_error') return '路线服务请求失败。'
  if (code === 'network_error') return '网络异常或请求超时。'
  if (code === 'unsupported') return '当前路线请求暂不支持。'
  return '路线服务暂不可用。'
}

export function isProviderProxyConcreteProvider(value: unknown): value is ProviderProxyConcreteProvider {
  return value === 'google' || value === 'openrouteservice'
}

export function isProviderProxyProvider(value: unknown): value is ProviderProxyProvider {
  return typeof value === 'string' && VALID_PROVIDERS.has(value as ProviderProxyProvider)
}

function invalidRequest(message: string, requestId?: string): ProviderProxyValidationResult {
  return {
    error: buildProviderProxyErrorResponse({
      code: 'invalid_request',
      message,
      operation: PROVIDER_PROXY_ROUTE_PREVIEW_OPERATION,
      requestId,
    }),
    ok: false,
  }
}

function normalizeLngLat(input: unknown): LngLat | null {
  if (!Array.isArray(input) || input.length !== 2) {
    return null
  }
  const lng = Number(input[0])
  const lat = Number(input[1])
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return null
  }
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
    return null
  }
  return [lng, lat]
}

function normalizeCacheIdentity(input: unknown): ProviderProxyRoutePreviewRequest['cacheIdentity'] {
  const record = readRecord(input)
  const cacheIdentity = {
    coordinateKey: readOptionalString(record.coordinateKey, 2048),
    modeKey: readOptionalString(record.modeKey, 2048),
    routingVersion: typeof record.routingVersion === 'number' && Number.isFinite(record.routingVersion)
      ? record.routingVersion
      : undefined,
    signature: readOptionalString(record.signature, 4096),
  }
  return Object.values(cacheIdentity).some((value) => value !== undefined) ? cacheIdentity : undefined
}

function readOptionalString(value: unknown, maxLength: number) {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, maxLength) : undefined
}

function readRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? input as Record<string, unknown> : {}
}

function isSafeIndex(value: number, length: number) {
  return Number.isInteger(value) && value >= 0 && value < length
}

function isRoutingMode(value: unknown): value is RoutingMode {
  return typeof value === 'string' && VALID_MODES.has(value as RoutingMode)
}

function isRoutingProfile(value: unknown): value is RoutingProfile {
  return typeof value === 'string' && VALID_PROFILES.has(value as RoutingProfile)
}
