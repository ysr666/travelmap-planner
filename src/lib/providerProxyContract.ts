import type { RoutingMode, RoutingProfile, LngLat } from './routing'
import type { AiTripDraft } from './aiTripDraft'
import { validateAiTripDraft } from './aiTripDraft'
import { generateMockAiTripDraft } from './aiTripDraftMock'
import type { AiTripEditContext } from './aiTripEditContext'
import { validateAiTripEditContext } from './aiTripEditContext'
import type { AiTripEditPatchPlan } from './aiTripEditPatch'
import { isValidPlainDate, listPlainDateRangeInclusive } from './plainDate'
import type { TravelPace, TravelTransportPreference } from './travelProfile'
import { isTravelPace, isTravelTransportPreference } from './travelProfile'

export const PROVIDER_PROXY_ROUTE_PREVIEW_OPERATION = 'route_preview' as const
export const PROVIDER_PROXY_AI_TRIP_DRAFT_OPERATION = 'ai_trip_draft' as const
export const PROVIDER_PROXY_AI_TRIP_DRAFT_REPAIR_OPERATION = 'ai_trip_draft_repair' as const
export const PROVIDER_PROXY_AI_TRIP_EDIT_PLAN_OPERATION = 'ai_trip_edit_plan' as const
export const PROVIDER_PROXY_TRAVEL_SEARCH_OPERATION = 'travel_search' as const
export const PROVIDER_PROXY_MAX_COORDINATES = 25
export const PROVIDER_PROXY_MAX_SEGMENTS = PROVIDER_PROXY_MAX_COORDINATES - 1
export const PROVIDER_PROXY_MAX_DAYS_PER_BATCH = 7
export const PROVIDER_PROXY_MAX_AI_DRAFT_REQUESTS_PER_WINDOW = 10
export const PROVIDER_PROXY_MAX_AI_DRAFT_REPAIR_REQUESTS_PER_WINDOW = 5
export const PROVIDER_PROXY_MAX_AI_TRIP_EDIT_REQUESTS_PER_WINDOW = 10
export const PROVIDER_PROXY_MAX_TRAVEL_SEARCH_REQUESTS_PER_WINDOW = 20

export type ProviderProxyOperation = typeof PROVIDER_PROXY_ROUTE_PREVIEW_OPERATION | typeof PROVIDER_PROXY_AI_TRIP_DRAFT_OPERATION | typeof PROVIDER_PROXY_AI_TRIP_DRAFT_REPAIR_OPERATION | typeof PROVIDER_PROXY_AI_TRIP_EDIT_PLAN_OPERATION | typeof PROVIDER_PROXY_TRAVEL_SEARCH_OPERATION
export type ProviderProxyConcreteProvider = 'google' | 'openrouteservice'
export type ProviderProxyProvider = ProviderProxyConcreteProvider | 'auto'
export type ProviderProxyErrorCode =
  | 'provider_unavailable'
  | 'quota_exceeded'
  | 'invalid_request'
  | 'provider_error'
  | 'network_error'
  | 'unsupported'
  | 'invalid_response'

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

export type ProviderProxyAiTripDraftRequest = {
  destination: string
  endDate: string
  mealTimeProtection?: boolean
  mustVisitText?: string
  avoidText?: string
  freeTextRequirement?: string
  operation: typeof PROVIDER_PROXY_AI_TRIP_DRAFT_OPERATION
  pace?: TravelPace
  preferTransport?: TravelTransportPreference
  quotaSessionId?: string
  requestId?: string
  startDate: string
}

export type ProviderProxyAiTripDraftSuccessResponse = {
  draft: AiTripDraft
  ok: true
  operation: typeof PROVIDER_PROXY_AI_TRIP_DRAFT_OPERATION
  requestId?: string
  source: 'mock' | 'future_ai'
  warnings?: string[]
}

export type ProviderProxyAiTripDraftResponse =
  | ProviderProxyAiTripDraftSuccessResponse
  | ProviderProxyErrorResponse

export type ProviderProxyAiTripDraftValidationResult =
  | { ok: true; request: ProviderProxyAiTripDraftRequest }
  | { error: ProviderProxyErrorResponse; ok: false }

const VALID_REASONING_MODES = new Set(['off', 'auto', 'high'])
const MAX_REPAIR_INSTRUCTION_LENGTH = 1000
const MAX_AI_TRIP_EDIT_COMMAND_LENGTH = 1000

export type SanitizedQualityFinding = {
  ruleId: string
  severity: string
  title: string
  message: string
  dayDate?: string
}

export type ProviderProxyAiTripDraftRepairRequest = {
  operation: typeof PROVIDER_PROXY_AI_TRIP_DRAFT_REPAIR_OPERATION
  requestId?: string
  quotaSessionId?: string
  draft: AiTripDraft
  qualityFindings: SanitizedQualityFinding[]
  repairInstruction?: string
  reasoningMode?: 'off' | 'auto' | 'high'
}

export type ProviderProxyAiTripDraftRepairSuccessResponse = {
  draft: AiTripDraft
  ok: true
  operation: typeof PROVIDER_PROXY_AI_TRIP_DRAFT_REPAIR_OPERATION
  requestId?: string
  source: 'mock' | 'future_ai'
  warnings?: string[]
}

export type ProviderProxyAiTripDraftRepairResponse =
  | ProviderProxyAiTripDraftRepairSuccessResponse
  | ProviderProxyErrorResponse

export type ProviderProxyAiTripDraftRepairValidationResult =
  | { ok: true; request: ProviderProxyAiTripDraftRepairRequest }
  | { error: ProviderProxyErrorResponse; ok: false }

export type ProviderProxyAiTripEditPlanRequest = {
  operation: typeof PROVIDER_PROXY_AI_TRIP_EDIT_PLAN_OPERATION
  requestId?: string
  quotaSessionId?: string
  command: string
  context: AiTripEditContext
}

export type ProviderProxyAiTripEditPlanSuccessResponse = {
  ok: true
  operation: typeof PROVIDER_PROXY_AI_TRIP_EDIT_PLAN_OPERATION
  requestId?: string
  source: 'mock' | 'future_ai'
  patchPlan: AiTripEditPatchPlan
  warnings?: string[]
}

export type ProviderProxyAiTripEditPlanResponse =
  | ProviderProxyAiTripEditPlanSuccessResponse
  | ProviderProxyErrorResponse

export type ProviderProxyAiTripEditPlanValidationResult =
  | { ok: true; request: ProviderProxyAiTripEditPlanRequest }
  | { error: ProviderProxyErrorResponse; ok: false }

export type ProviderProxyTravelSearchLocale = 'zh-CN' | 'en-US'
export type ProviderProxyTravelSearchType = 'general' | 'place' | 'opening_hours' | 'tickets' | 'transport' | 'reviews'
export type ProviderProxyTravelSearchConfidence = 'low' | 'medium' | 'high'

export type ProviderProxyTravelSearchRequest = {
  operation: typeof PROVIDER_PROXY_TRAVEL_SEARCH_OPERATION
  requestId?: string
  quotaSessionId?: string
  query: string
  locale?: ProviderProxyTravelSearchLocale
  region?: string
  searchType?: ProviderProxyTravelSearchType
  maxResults?: number
}

export type ProviderProxyValidatedTravelSearchRequest = ProviderProxyTravelSearchRequest & {
  searchType: ProviderProxyTravelSearchType
  maxResults: number
}

export type ProviderProxyTravelSearchResult = {
  id: string
  title: string
  url: string
  sourceDomain: string
  snippet: string
  retrievedAt: string
  confidence: ProviderProxyTravelSearchConfidence
}

export type ProviderProxyTravelSearchSuccessResponse = {
  ok: true
  operation: typeof PROVIDER_PROXY_TRAVEL_SEARCH_OPERATION
  requestId?: string
  source: 'mock' | 'future_search'
  query: string
  results: ProviderProxyTravelSearchResult[]
  warnings?: string[]
}

export type ProviderProxyTravelSearchResponse =
  | ProviderProxyTravelSearchSuccessResponse
  | ProviderProxyErrorResponse

export type ProviderProxyTravelSearchValidationResult =
  | { ok: true; request: ProviderProxyValidatedTravelSearchRequest }
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
const VALID_TRAVEL_SEARCH_LOCALES = new Set<ProviderProxyTravelSearchLocale>(['zh-CN', 'en-US'])
const VALID_TRAVEL_SEARCH_TYPES = new Set<ProviderProxyTravelSearchType>(['general', 'place', 'opening_hours', 'tickets', 'transport', 'reviews'])
const FORBIDDEN_TRAVEL_SEARCH_FIELDS = new Set([
  'apiKey',
  'providerKey',
  'token',
  'cloudToken',
  'ticketBlobs',
  'ticketMetas',
  'routeCache',
  'localDb',
  'fullTrip',
  'Authorization',
  'headers',
])
const FORBIDDEN_AI_TRIP_EDIT_FIELDS = new Set([
  'apiKey',
  'providerKey',
  'token',
  'cloudToken',
  'ticketBlobs',
  'ticketMetas',
  'routeCache',
  'localDb',
  'fullTrip',
  'Authorization',
  'headers',
  'lat',
  'lng',
  'coordinates',
  'externalUrl',
  'url',
])
const MAX_TRAVEL_SEARCH_QUERY_LENGTH = 300
const MAX_TRAVEL_SEARCH_REGION_LENGTH = 80
const DEFAULT_TRAVEL_SEARCH_MAX_RESULTS = 5

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
    message: message ?? defaultProviderProxyErrorMessage(code, operation),
    ok: false,
    operation,
    provider,
    requestId,
  }
}

export function defaultProviderProxyErrorMessage(code: ProviderProxyErrorCode, operation?: ProviderProxyOperation) {
  if (operation === PROVIDER_PROXY_AI_TRIP_DRAFT_OPERATION) {
    if (code === 'quota_exceeded') return '今日 AI 草稿生成次数已达上限。'
    if (code === 'invalid_request') return 'AI 草稿请求无效。'
    if (code === 'provider_error') return 'AI 草稿服务请求失败。'
    if (code === 'network_error') return '网络异常或请求超时。'
    if (code === 'unsupported') return '当前 AI 草稿请求暂不支持。'
    if (code === 'invalid_response') return 'AI 草稿服务返回的内容无法解析。'
    return 'AI 草稿服务暂不可用。'
  }
  if (operation === PROVIDER_PROXY_AI_TRIP_DRAFT_REPAIR_OPERATION) {
    if (code === 'quota_exceeded') return '今日 AI 草稿修复次数已达上限。'
    if (code === 'invalid_request') return 'AI 草稿修复请求无效。'
    if (code === 'provider_error') return 'AI 草稿修复服务请求失败。'
    if (code === 'network_error') return '网络异常或请求超时。'
    if (code === 'unsupported') return '当前 AI 草稿修复请求暂不支持。'
    if (code === 'invalid_response') return 'AI 草稿修复服务返回的内容无法解析。'
    return 'AI 草稿修复服务暂不可用。'
  }
  if (operation === PROVIDER_PROXY_AI_TRIP_EDIT_PLAN_OPERATION) {
    if (code === 'quota_exceeded') return '今日 AI 修改建议次数已达上限。'
    if (code === 'invalid_request') return 'AI 修改建议请求无效。'
    if (code === 'provider_error') return 'AI 修改建议服务请求失败。'
    if (code === 'network_error') return '网络异常或请求超时。'
    if (code === 'unsupported') return '当前 AI 修改建议请求暂不支持。'
    if (code === 'invalid_response') return 'AI 修改建议服务返回的内容无法解析。'
    return 'AI 修改建议服务暂不可用。'
  }
  if (operation === PROVIDER_PROXY_TRAVEL_SEARCH_OPERATION) {
    if (code === 'quota_exceeded') return '今日搜索请求次数已达上限。'
    if (code === 'invalid_request') return '搜索请求无效。'
    if (code === 'provider_error') return '搜索服务请求失败。'
    if (code === 'network_error') return '网络异常或请求超时。'
    if (code === 'unsupported') return '当前搜索请求暂不支持。'
    if (code === 'invalid_response') return '搜索服务返回的内容无法解析。'
    return '搜索服务暂不可用。'
  }
  if (code === 'quota_exceeded') return '今日路线生成次数已达上限。'
  if (code === 'invalid_request') return '路线请求无效。'
  if (code === 'provider_error') return '路线服务请求失败。'
  if (code === 'network_error') return '网络异常或请求超时。'
  if (code === 'unsupported') return '当前路线请求暂不支持。'
  if (code === 'invalid_response') return '服务返回的内容无法解析。'
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

const MAX_AI_DESTINATION_LENGTH = 200
export const MAX_AI_FREE_TEXT_LENGTH = 2000
const MAX_AI_DAYS = 120

export function validateProviderProxyAiTripDraftRequest(input: unknown): ProviderProxyAiTripDraftValidationResult {
  const record = readRecord(input)
  const requestId = readOptionalString(record.requestId, 128)

  if (record.operation !== PROVIDER_PROXY_AI_TRIP_DRAFT_OPERATION) {
    return aiDraftInvalidRequest('不支持的 provider proxy 操作。', requestId)
  }

  const destination = typeof record.destination === 'string' ? record.destination.trim() : ''
  if (!destination) {
    return aiDraftInvalidRequest('请输入目的地。', requestId)
  }
  if (destination.length > MAX_AI_DESTINATION_LENGTH) {
    return aiDraftInvalidRequest(`目的地不能超过 ${MAX_AI_DESTINATION_LENGTH} 个字符。`, requestId)
  }

  const startDate = typeof record.startDate === 'string' ? record.startDate.trim() : ''
  if (!startDate) {
    return aiDraftInvalidRequest('请输入开始日期。', requestId)
  }
  if (!isValidPlainDate(startDate)) {
    return aiDraftInvalidRequest('开始日期格式无效，请使用 YYYY-MM-DD。', requestId)
  }

  const endDate = typeof record.endDate === 'string' ? record.endDate.trim() : ''
  if (!endDate) {
    return aiDraftInvalidRequest('请输入结束日期。', requestId)
  }
  if (!isValidPlainDate(endDate)) {
    return aiDraftInvalidRequest('结束日期格式无效，请使用 YYYY-MM-DD。', requestId)
  }

  if (endDate < startDate) {
    return aiDraftInvalidRequest('结束日期不能早于开始日期。', requestId)
  }

  const dates = listPlainDateRangeInclusive(startDate, endDate)
  if (dates.length > MAX_AI_DAYS) {
    return aiDraftInvalidRequest(`行程天数不能超过 ${MAX_AI_DAYS} 天。`, requestId)
  }

  const pace = record.pace
  if (pace !== undefined && !isTravelPace(pace)) {
    return aiDraftInvalidRequest('无效的旅行节奏。', requestId)
  }

  const preferTransport = record.preferTransport
  if (preferTransport !== undefined && !isTravelTransportPreference(preferTransport)) {
    return aiDraftInvalidRequest('无效的交通偏好。', requestId)
  }

  const rawMustVisit = typeof record.mustVisitText === 'string' ? record.mustVisitText.trim() : undefined
  if (rawMustVisit && rawMustVisit.length > MAX_AI_FREE_TEXT_LENGTH) {
    return aiDraftInvalidRequest(`"想去的地方"不能超过 ${MAX_AI_FREE_TEXT_LENGTH} 个字符。`, requestId)
  }

  const rawAvoid = typeof record.avoidText === 'string' ? record.avoidText.trim() : undefined
  if (rawAvoid && rawAvoid.length > MAX_AI_FREE_TEXT_LENGTH) {
    return aiDraftInvalidRequest(`"不想要的安排"不能超过 ${MAX_AI_FREE_TEXT_LENGTH} 个字符。`, requestId)
  }

  const rawFreeText = typeof record.freeTextRequirement === 'string' ? record.freeTextRequirement.trim() : undefined
  if (rawFreeText && rawFreeText.length > MAX_AI_FREE_TEXT_LENGTH) {
    return aiDraftInvalidRequest(`"补充要求"不能超过 ${MAX_AI_FREE_TEXT_LENGTH} 个字符。`, requestId)
  }

  const mustVisitText = rawMustVisit || undefined
  const avoidText = rawAvoid || undefined
  const freeTextRequirement = rawFreeText || undefined

  return {
    ok: true,
    request: {
      destination,
      endDate,
      freeTextRequirement,
      mealTimeProtection: typeof record.mealTimeProtection === 'boolean' ? record.mealTimeProtection : undefined,
      mustVisitText,
      avoidText,
      operation: PROVIDER_PROXY_AI_TRIP_DRAFT_OPERATION,
      pace: isTravelPace(pace) ? pace : undefined,
      preferTransport: isTravelTransportPreference(preferTransport) ? preferTransport : undefined,
      quotaSessionId: readOptionalString(record.quotaSessionId, 160),
      requestId,
      startDate,
    },
  }
}

export function buildMockAiTripDraftProxyResponse(
  request: ProviderProxyAiTripDraftRequest,
): ProviderProxyAiTripDraftSuccessResponse {
  const draft = generateMockAiTripDraft({
    destination: request.destination,
    endDate: request.endDate,
    freeTextRequirement: request.freeTextRequirement,
    mealTimeProtection: request.mealTimeProtection,
    mustVisitText: request.mustVisitText,
    avoidText: request.avoidText,
    pace: request.pace,
    preferTransport: request.preferTransport,
    startDate: request.startDate,
  })

  return {
    draft,
    ok: true,
    operation: PROVIDER_PROXY_AI_TRIP_DRAFT_OPERATION,
    requestId: request.requestId,
    source: 'mock',
    warnings: ['当前为本地示例草稿，非真实 AI 生成。'],
  }
}

function aiDraftInvalidRequest(message: string, requestId?: string): ProviderProxyAiTripDraftValidationResult {
  return {
    error: buildProviderProxyErrorResponse({
      code: 'invalid_request',
      message,
      operation: PROVIDER_PROXY_AI_TRIP_DRAFT_OPERATION,
      requestId,
    }),
    ok: false,
  }
}

function aiDraftRepairInvalidRequest(message: string, requestId?: string): ProviderProxyAiTripDraftRepairValidationResult {
  return {
    error: buildProviderProxyErrorResponse({
      code: 'invalid_request',
      message,
      operation: PROVIDER_PROXY_AI_TRIP_DRAFT_REPAIR_OPERATION,
      requestId,
    }),
    ok: false,
  }
}

function aiTripEditPlanInvalidRequest(message: string, requestId?: string): ProviderProxyAiTripEditPlanValidationResult {
  return {
    error: buildProviderProxyErrorResponse({
      code: 'invalid_request',
      message,
      operation: PROVIDER_PROXY_AI_TRIP_EDIT_PLAN_OPERATION,
      requestId,
    }),
    ok: false,
  }
}

function travelSearchInvalidRequest(message: string, requestId?: string): ProviderProxyTravelSearchValidationResult {
  return {
    error: buildProviderProxyErrorResponse({
      code: 'invalid_request',
      message,
      operation: PROVIDER_PROXY_TRAVEL_SEARCH_OPERATION,
      requestId,
    }),
    ok: false,
  }
}

export function validateProviderProxyAiTripDraftRepairRequest(input: unknown): ProviderProxyAiTripDraftRepairValidationResult {
  const record = readRecord(input)
  const requestId = readOptionalString(record.requestId, 128)

  if (record.operation !== PROVIDER_PROXY_AI_TRIP_DRAFT_REPAIR_OPERATION) {
    return aiDraftRepairInvalidRequest('不支持的 provider proxy 操作。', requestId)
  }

  if (record.draft === undefined || record.draft === null) {
    return aiDraftRepairInvalidRequest('缺少 draft 参数。', requestId)
  }

  const draftValidation = validateAiTripDraft(record.draft)
  if (!draftValidation.valid) {
    return aiDraftRepairInvalidRequest('draft 未通过 schema 校验。', requestId)
  }

  if (!Array.isArray(record.qualityFindings)) {
    return aiDraftRepairInvalidRequest('qualityFindings 必须是数组。', requestId)
  }

  for (let i = 0; i < record.qualityFindings.length; i++) {
    const f = record.qualityFindings[i]
    if (!f || typeof f !== 'object') {
      return aiDraftRepairInvalidRequest(`qualityFindings[${i}] 格式无效。`, requestId)
    }
    if (typeof f.ruleId !== 'string' || !f.ruleId.trim()) {
      return aiDraftRepairInvalidRequest(`qualityFindings[${i}].ruleId 无效。`, requestId)
    }
    if (typeof f.severity !== 'string' || !f.severity.trim()) {
      return aiDraftRepairInvalidRequest(`qualityFindings[${i}].severity 无效。`, requestId)
    }
    if (typeof f.title !== 'string' || !f.title.trim()) {
      return aiDraftRepairInvalidRequest(`qualityFindings[${i}].title 无效。`, requestId)
    }
    if (typeof f.message !== 'string' || !f.message.trim()) {
      return aiDraftRepairInvalidRequest(`qualityFindings[${i}].message 无效。`, requestId)
    }
  }

  const repairInstruction = readOptionalString(record.repairInstruction, MAX_REPAIR_INSTRUCTION_LENGTH)
  if (record.repairInstruction !== undefined && typeof record.repairInstruction !== 'string') {
    return aiDraftRepairInvalidRequest('repairInstruction 必须是字符串。', requestId)
  }
  if (typeof record.repairInstruction === 'string' && record.repairInstruction.length > MAX_REPAIR_INSTRUCTION_LENGTH) {
    return aiDraftRepairInvalidRequest(`repairInstruction 不能超过 ${MAX_REPAIR_INSTRUCTION_LENGTH} 个字符。`, requestId)
  }

  const reasoningMode = record.reasoningMode
  if (reasoningMode !== undefined && (typeof reasoningMode !== 'string' || !VALID_REASONING_MODES.has(reasoningMode))) {
    return aiDraftRepairInvalidRequest('reasoningMode 必须是 off、auto 或 high。', requestId)
  }

  const quotaSessionId = readOptionalString(record.quotaSessionId, 128)

  return {
    ok: true,
    request: {
      draft: draftValidation.draft!,
      operation: PROVIDER_PROXY_AI_TRIP_DRAFT_REPAIR_OPERATION,
      qualityFindings: record.qualityFindings as SanitizedQualityFinding[],
      quotaSessionId: quotaSessionId ?? undefined,
      reasoningMode: (reasoningMode as 'off' | 'auto' | 'high') ?? undefined,
      repairInstruction: repairInstruction ?? undefined,
      requestId: requestId ?? undefined,
    },
  }
}

export function validateProviderProxyAiTripEditPlanRequest(input: unknown): ProviderProxyAiTripEditPlanValidationResult {
  const record = readRecord(input)
  const requestId = readOptionalString(record.requestId, 128)

  if (record.operation !== PROVIDER_PROXY_AI_TRIP_EDIT_PLAN_OPERATION) {
    return aiTripEditPlanInvalidRequest('不支持的 provider proxy 操作。', requestId)
  }

  const forbiddenFieldPath = findForbiddenRequestFieldPath(record, FORBIDDEN_AI_TRIP_EDIT_FIELDS)
  if (forbiddenFieldPath) {
    return aiTripEditPlanInvalidRequest('AI 修改建议请求包含不允许的敏感字段。', requestId)
  }

  const command = typeof record.command === 'string' ? record.command.trim() : ''
  if (!command) {
    return aiTripEditPlanInvalidRequest('请输入修改指令。', requestId)
  }
  if (command.length > MAX_AI_TRIP_EDIT_COMMAND_LENGTH) {
    return aiTripEditPlanInvalidRequest(`修改指令不能超过 ${MAX_AI_TRIP_EDIT_COMMAND_LENGTH} 个字符。`, requestId)
  }

  const contextValidation = validateAiTripEditContext(record.context)
  if (!contextValidation.ok) {
    return aiTripEditPlanInvalidRequest('AI 修改上下文无效。', requestId)
  }

  return {
    ok: true,
    request: {
      command,
      context: contextValidation.context,
      operation: PROVIDER_PROXY_AI_TRIP_EDIT_PLAN_OPERATION,
      quotaSessionId: readOptionalString(record.quotaSessionId, 160),
      requestId,
    },
  }
}

export function validateProviderProxyTravelSearchRequest(input: unknown): ProviderProxyTravelSearchValidationResult {
  const record = readRecord(input)
  const requestId = readOptionalString(record.requestId, 128)

  if (record.operation !== PROVIDER_PROXY_TRAVEL_SEARCH_OPERATION) {
    return travelSearchInvalidRequest('不支持的 provider proxy 操作。', requestId)
  }

  for (const key of FORBIDDEN_TRAVEL_SEARCH_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return travelSearchInvalidRequest('搜索请求包含不允许的敏感字段。', requestId)
    }
  }

  const query = typeof record.query === 'string' ? record.query.trim() : ''
  if (!query) {
    return travelSearchInvalidRequest('请输入搜索关键词。', requestId)
  }
  if (query.length > MAX_TRAVEL_SEARCH_QUERY_LENGTH) {
    return travelSearchInvalidRequest(`搜索关键词不能超过 ${MAX_TRAVEL_SEARCH_QUERY_LENGTH} 个字符。`, requestId)
  }

  const locale = record.locale
  if (locale !== undefined && !isTravelSearchLocale(locale)) {
    return travelSearchInvalidRequest('搜索语言设置无效。', requestId)
  }

  const region = typeof record.region === 'string' ? record.region.trim() : undefined
  if (record.region !== undefined && typeof record.region !== 'string') {
    return travelSearchInvalidRequest('搜索地区必须是字符串。', requestId)
  }
  if (region && region.length > MAX_TRAVEL_SEARCH_REGION_LENGTH) {
    return travelSearchInvalidRequest(`搜索地区不能超过 ${MAX_TRAVEL_SEARCH_REGION_LENGTH} 个字符。`, requestId)
  }

  const searchType = record.searchType ?? 'general'
  if (!isTravelSearchType(searchType)) {
    return travelSearchInvalidRequest('搜索类型无效。', requestId)
  }

  const maxResults = record.maxResults ?? DEFAULT_TRAVEL_SEARCH_MAX_RESULTS
  if (typeof maxResults !== 'number' || !Number.isInteger(maxResults) || maxResults < 1 || maxResults > 10) {
    return travelSearchInvalidRequest('搜索结果数量必须是 1 到 10 之间的整数。', requestId)
  }

  return {
    ok: true,
    request: {
      locale: isTravelSearchLocale(locale) ? locale : undefined,
      maxResults,
      operation: PROVIDER_PROXY_TRAVEL_SEARCH_OPERATION,
      query,
      quotaSessionId: readOptionalString(record.quotaSessionId, 160),
      region: region || undefined,
      requestId,
      searchType,
    },
  }
}

function isTravelSearchLocale(value: unknown): value is ProviderProxyTravelSearchLocale {
  return typeof value === 'string' && VALID_TRAVEL_SEARCH_LOCALES.has(value as ProviderProxyTravelSearchLocale)
}

function isTravelSearchType(value: unknown): value is ProviderProxyTravelSearchType {
  return typeof value === 'string' && VALID_TRAVEL_SEARCH_TYPES.has(value as ProviderProxyTravelSearchType)
}

function findForbiddenRequestFieldPath(
  input: unknown,
  forbiddenFields: Set<string>,
  path = '$',
): string | null {
  if (!input || typeof input !== 'object') {
    return null
  }
  if (Array.isArray(input)) {
    for (const [index, value] of input.entries()) {
      const nested = findForbiddenRequestFieldPath(value, forbiddenFields, `${path}[${index}]`)
      if (nested) return nested
    }
    return null
  }
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (forbiddenFields.has(key)) {
      return `${path}.${key}`
    }
    const nested = findForbiddenRequestFieldPath(value, forbiddenFields, `${path}.${key}`)
    if (nested) return nested
  }
  return null
}
