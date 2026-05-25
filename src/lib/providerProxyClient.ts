import {
  buildProviderProxyErrorResponse,
  defaultProviderProxyErrorMessage,
  isProviderProxyConcreteProvider,
  validateProviderProxyRoutePreviewRequest,
  validateProviderProxyAiTripDraftRequest,
  validateProviderProxyAiTripDraftRepairRequest,
  validateProviderProxyAiTripEditPlanRequest,
  type ProviderProxyAiTripDraftRequest,
  type ProviderProxyAiTripDraftRepairRequest,
  type ProviderProxyAiTripDraftRepairResponse,
  type ProviderProxyAiTripDraftRepairSuccessResponse,
  type ProviderProxyAiTripDraftResponse,
  type ProviderProxyAiTripDraftSuccessResponse,
  type ProviderProxyAiTripEditPlanRequest,
  type ProviderProxyAiTripEditPlanResponse,
  type ProviderProxyAiTripEditPlanSuccessResponse,
  type ProviderProxyConcreteProvider,
  type ProviderProxyErrorCode,
  type ProviderProxyErrorResponse,
  type ProviderProxyRoutePreviewRequest,
  type ProviderProxyRoutePreviewResponse,
  type ProviderProxyRoutePreviewSuccessResponse,
  validateProviderProxyTravelSearchRequest,
  type ProviderProxyTravelSearchRequest,
  type ProviderProxyTravelSearchResponse,
  type ProviderProxyTravelSearchSourceType,
  type ProviderProxyTravelSearchSuccessResponse,
} from './providerProxyContract'
import { validateAiTripEditPatchPlan } from './aiTripEditPatch'

export type ProviderProxyRuntimeConfig = {
  configured: boolean
  provider: ProviderProxyConcreteProvider | null
  proxyUrl: string | null
  source: 'proxy' | 'none'
}

export type ProviderProxyClientOptions = {
  fetcher?: typeof fetch
  signal?: AbortSignal
  storage?: Storage | null
}

export const PROVIDER_PROXY_SESSION_STORAGE_KEY = 'tripmap:provider-proxy:session-id'
export const PROVIDER_PROXY_DEV_URL_STORAGE_KEY = 'tripmap:dev:route-proxy-url'
export const PROVIDER_PROXY_DEV_PROVIDER_STORAGE_KEY = 'tripmap:dev:route-proxy-provider'

let memoryProviderProxySessionId: string | null = null

export function getProviderProxyConfig(
  options: {
    env?: Partial<ImportMetaEnv>
    storage?: Storage | null
  } = {},
): ProviderProxyRuntimeConfig {
  const env = options.env ?? import.meta.env
  const storage = options.storage ?? getBrowserStorage()
  const proxyUrl = normalizeProxyUrl(
    readStorageValue(storage, PROVIDER_PROXY_DEV_URL_STORAGE_KEY) ?? env.VITE_ROUTE_PROXY_URL,
  )
  const provider = normalizeProxyProvider(
    readStorageValue(storage, PROVIDER_PROXY_DEV_PROVIDER_STORAGE_KEY) ?? env.VITE_ROUTE_PROXY_PROVIDER,
  )

  return {
    configured: Boolean(proxyUrl && provider),
    provider,
    proxyUrl,
    source: proxyUrl && provider ? 'proxy' : 'none',
  }
}

export async function fetchProviderProxyRoutePreview(
  request: ProviderProxyRoutePreviewRequest,
  proxyUrl: string,
  options: ProviderProxyClientOptions = {},
): Promise<ProviderProxyRoutePreviewSuccessResponse> {
  const requestWithSession = {
    ...request,
    quotaSessionId: request.quotaSessionId ?? getProviderProxySessionId(options.storage),
  }
  const validation = validateProviderProxyRoutePreviewRequest(requestWithSession)
  if (!validation.ok) {
    throw new ProviderProxyClientError(validation.error)
  }

  const fetcher = options.fetcher ?? fetch
  let response: Response
  try {
    response = await fetcher(proxyUrl, {
      body: JSON.stringify(validation.request),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: options.signal,
    })
  } catch {
    throw new ProviderProxyClientError(buildProviderProxyErrorResponse({ code: 'network_error' }))
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ProviderProxyClientError(buildProviderProxyErrorResponse({ code: 'network_error' }), response.status)
  }

  const parsed = parseProviderProxyResponse(body)
  if (!parsed.ok) {
    throw new ProviderProxyClientError(parsed, response.status)
  }
  return parsed
}

export async function fetchProviderProxyAiTripDraft(
  request: ProviderProxyAiTripDraftRequest,
  proxyUrl: string,
  options: ProviderProxyClientOptions = {},
): Promise<ProviderProxyAiTripDraftSuccessResponse> {
  const requestWithSession = {
    ...request,
    quotaSessionId: request.quotaSessionId ?? getProviderProxySessionId(options.storage),
  }
  const validation = validateProviderProxyAiTripDraftRequest(requestWithSession)
  if (!validation.ok) {
    throw new ProviderProxyClientError(validation.error)
  }

  const fetcher = options.fetcher ?? fetch
  let response: Response
  try {
    response = await fetcher(proxyUrl, {
      body: JSON.stringify(validation.request),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: options.signal,
    })
  } catch {
    throw new ProviderProxyClientError(buildProviderProxyErrorResponse({ code: 'network_error', operation: 'ai_trip_draft' }))
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ProviderProxyClientError(buildProviderProxyErrorResponse({ code: 'network_error', operation: 'ai_trip_draft' }), response.status)
  }

  const parsed = parseProviderProxyAiTripDraftResponse(body)
  if (!parsed.ok) {
    throw new ProviderProxyClientError(parsed, response.status)
  }
  return parsed
}

export async function fetchProviderProxyAiTripDraftRepair(
  request: ProviderProxyAiTripDraftRepairRequest,
  proxyUrl: string,
  options: ProviderProxyClientOptions = {},
): Promise<ProviderProxyAiTripDraftRepairSuccessResponse> {
  const requestWithSession = {
    ...request,
    quotaSessionId: request.quotaSessionId ?? getProviderProxySessionId(options.storage),
  }
  const validation = validateProviderProxyAiTripDraftRepairRequest(requestWithSession)
  if (!validation.ok) {
    throw new ProviderProxyClientError(validation.error)
  }

  const fetcher = options.fetcher ?? fetch
  let response: Response
  try {
    response = await fetcher(proxyUrl, {
      body: JSON.stringify(validation.request),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: options.signal,
    })
  } catch {
    throw new ProviderProxyClientError(buildProviderProxyErrorResponse({ code: 'network_error', operation: 'ai_trip_draft_repair' }))
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ProviderProxyClientError(buildProviderProxyErrorResponse({ code: 'network_error', operation: 'ai_trip_draft_repair' }), response.status)
  }

  const parsed = parseProviderProxyAiTripDraftRepairResponse(body)
  if (!parsed.ok) {
    throw new ProviderProxyClientError(parsed, response.status)
  }
  return parsed
}

export async function fetchProviderProxyAiTripEditPlan(
  request: ProviderProxyAiTripEditPlanRequest,
  proxyUrl: string,
  options: ProviderProxyClientOptions = {},
): Promise<ProviderProxyAiTripEditPlanSuccessResponse> {
  const requestWithSession = {
    ...request,
    quotaSessionId: request.quotaSessionId ?? getProviderProxySessionId(options.storage),
  }
  const validation = validateProviderProxyAiTripEditPlanRequest(requestWithSession)
  if (!validation.ok) {
    throw new ProviderProxyClientError(validation.error)
  }

  const fetcher = options.fetcher ?? fetch
  let response: Response
  try {
    response = await fetcher(proxyUrl, {
      body: JSON.stringify(validation.request),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: options.signal,
    })
  } catch {
    throw new ProviderProxyClientError(buildProviderProxyErrorResponse({ code: 'network_error', operation: 'ai_trip_edit_plan' }))
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ProviderProxyClientError(buildProviderProxyErrorResponse({ code: 'network_error', operation: 'ai_trip_edit_plan' }), response.status)
  }

  const parsed = parseProviderProxyAiTripEditPlanResponse(body, validation.request)
  if (!parsed.ok) {
    throw new ProviderProxyClientError(parsed, response.status)
  }
  return parsed
}

export async function fetchProviderProxyTravelSearch(
  request: ProviderProxyTravelSearchRequest,
  proxyUrl: string,
  options: ProviderProxyClientOptions = {},
): Promise<ProviderProxyTravelSearchSuccessResponse> {
  const requestWithSession = {
    ...request,
    quotaSessionId: request.quotaSessionId ?? getProviderProxySessionId(options.storage),
  }
  const validation = validateProviderProxyTravelSearchRequest(requestWithSession)
  if (!validation.ok) {
    throw new ProviderProxyClientError(validation.error)
  }

  const fetcher = options.fetcher ?? fetch
  let response: Response
  try {
    response = await fetcher(proxyUrl, {
      body: JSON.stringify(validation.request),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: options.signal,
    })
  } catch {
    throw new ProviderProxyClientError(buildProviderProxyErrorResponse({ code: 'network_error', operation: 'travel_search' }))
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ProviderProxyClientError(buildProviderProxyErrorResponse({ code: 'network_error', operation: 'travel_search' }), response.status)
  }

  const parsed = parseProviderProxyTravelSearchResponse(body)
  if (!parsed.ok) {
    throw new ProviderProxyClientError(parsed, response.status)
  }
  return parsed
}

export function getProviderProxySessionId(storage = getBrowserStorage()) {
  const existing = readStorageValue(storage, PROVIDER_PROXY_SESSION_STORAGE_KEY)
  if (existing) {
    return existing
  }

  const next = createSessionId()
  memoryProviderProxySessionId = next
  try {
    storage?.setItem(PROVIDER_PROXY_SESSION_STORAGE_KEY, next)
  } catch {
    // In private or restricted storage contexts, keep an in-memory session id.
  }
  return next
}

export class ProviderProxyClientError extends Error {
  readonly code: ProviderProxyErrorCode
  readonly details?: string
  readonly provider?: ProviderProxyConcreteProvider
  readonly status?: number

  constructor(error: ProviderProxyErrorResponse, status?: number) {
    super(error.message || defaultProviderProxyErrorMessage(error.code))
    this.name = 'ProviderProxyClientError'
    this.code = error.code
    this.details = error.details
    this.provider = error.provider
    this.status = status
  }
}

function parseProviderProxyResponse(input: unknown): ProviderProxyRoutePreviewResponse {
  const record = readRecord(input)
  if (record.ok === true) {
    const validation = validateProviderProxyRoutePreviewResponse(record)
    if (validation) {
      return validation
    }
  }

  if (record.ok === false && typeof record.code === 'string') {
    const code = normalizeErrorCode(record.code)
    return buildProviderProxyErrorResponse({
      code,
      details: typeof record.details === 'string' ? record.details : undefined,
      message: typeof record.message === 'string' ? record.message : defaultProviderProxyErrorMessage(code),
      provider: isProviderProxyConcreteProvider(record.provider) ? record.provider : undefined,
      requestId: typeof record.requestId === 'string' ? record.requestId : undefined,
    })
  }

  return buildProviderProxyErrorResponse({ code: 'network_error' })
}

function parseProviderProxyAiTripDraftResponse(input: unknown): ProviderProxyAiTripDraftResponse {
  const record = readRecord(input)
  if (record.ok === true) {
    const validation = validateProviderProxyAiTripDraftSuccessResponse(record)
    if (validation) {
      return validation
    }
  }

  if (record.ok === false && typeof record.code === 'string') {
    const code = normalizeErrorCode(record.code)
    return buildProviderProxyErrorResponse({
      code,
      details: typeof record.details === 'string' ? record.details : undefined,
      message: typeof record.message === 'string' ? record.message : defaultProviderProxyErrorMessage(code, 'ai_trip_draft'),
      operation: 'ai_trip_draft',
      requestId: typeof record.requestId === 'string' ? record.requestId : undefined,
    })
  }

  return buildProviderProxyErrorResponse({ code: 'network_error', operation: 'ai_trip_draft' })
}

function parseProviderProxyAiTripDraftRepairResponse(input: unknown): ProviderProxyAiTripDraftRepairResponse {
  const record = readRecord(input)
  if (record.ok === true) {
    const validation = validateProviderProxyAiTripDraftRepairSuccessResponse(record)
    if (validation) {
      return validation
    }
  }

  if (record.ok === false && typeof record.code === 'string') {
    const code = normalizeErrorCode(record.code)
    return buildProviderProxyErrorResponse({
      code,
      details: typeof record.details === 'string' ? record.details : undefined,
      message: typeof record.message === 'string' ? record.message : defaultProviderProxyErrorMessage(code, 'ai_trip_draft_repair'),
      operation: 'ai_trip_draft_repair',
      requestId: typeof record.requestId === 'string' ? record.requestId : undefined,
    })
  }

  return buildProviderProxyErrorResponse({ code: 'network_error', operation: 'ai_trip_draft_repair' })
}

function parseProviderProxyAiTripEditPlanResponse(
  input: unknown,
  request: ProviderProxyAiTripEditPlanRequest,
): ProviderProxyAiTripEditPlanResponse {
  const record = readRecord(input)
  if (record.ok === true) {
    const validation = validateProviderProxyAiTripEditPlanSuccessResponse(record, request)
    if (validation) {
      return validation
    }
  }

  if (record.ok === false && typeof record.code === 'string') {
    const code = normalizeErrorCode(record.code)
    return buildProviderProxyErrorResponse({
      code,
      details: typeof record.details === 'string' ? record.details : undefined,
      message: typeof record.message === 'string' ? record.message : defaultProviderProxyErrorMessage(code, 'ai_trip_edit_plan'),
      operation: 'ai_trip_edit_plan',
      requestId: typeof record.requestId === 'string' ? record.requestId : undefined,
    })
  }

  return buildProviderProxyErrorResponse({ code: 'network_error', operation: 'ai_trip_edit_plan' })
}

function parseProviderProxyTravelSearchResponse(input: unknown): ProviderProxyTravelSearchResponse {
  const record = readRecord(input)
  if (record.ok === true) {
    const validation = validateProviderProxyTravelSearchSuccessResponse(record)
    if (validation) {
      return validation
    }
    return buildProviderProxyErrorResponse({ code: 'invalid_response', operation: 'travel_search' })
  }

  if (record.ok === false && typeof record.code === 'string') {
    const code = normalizeErrorCode(record.code)
    return buildProviderProxyErrorResponse({
      code,
      message: defaultProviderProxyErrorMessage(code, 'travel_search'),
      operation: 'travel_search',
      requestId: typeof record.requestId === 'string' ? record.requestId : undefined,
    })
  }

  return buildProviderProxyErrorResponse({ code: 'network_error', operation: 'travel_search' })
}

function validateProviderProxyAiTripEditPlanSuccessResponse(
  record: Record<string, unknown>,
  request: ProviderProxyAiTripEditPlanRequest,
): ProviderProxyAiTripEditPlanSuccessResponse | null {
  if (record.operation !== 'ai_trip_edit_plan') {
    return null
  }
  if (record.source !== 'mock' && record.source !== 'future_ai') {
    return null
  }
  const patchValidation = validateAiTripEditPatchPlan(record.patchPlan, request.context)
  if (!patchValidation.ok) {
    return null
  }

  return {
    ok: true,
    operation: 'ai_trip_edit_plan',
    patchPlan: patchValidation.plan,
    requestId: typeof record.requestId === 'string' ? record.requestId : undefined,
    source: record.source,
    warnings: Array.isArray(record.warnings)
      ? record.warnings.filter((w): w is string => typeof w === 'string')
      : patchValidation.warnings,
  }
}

function validateProviderProxyTravelSearchSuccessResponse(record: Record<string, unknown>): ProviderProxyTravelSearchSuccessResponse | null {
  if (record.operation !== 'travel_search') {
    return null
  }
  if (record.source !== 'mock' && record.source !== 'future_search') {
    return null
  }
  const query = typeof record.query === 'string' ? record.query : null
  const retrievedAt = typeof record.retrievedAt === 'string' ? record.retrievedAt : null
  if (!query || !retrievedAt || !isValidIsoLikeDate(retrievedAt) || !Array.isArray(record.results)) {
    return null
  }

  const results: ProviderProxyTravelSearchSuccessResponse['results'] = []
  for (const result of record.results) {
    const item = readRecord(result)
    const confidence = item.confidence
    const sourceType = item.sourceType
    if (
      !isNonEmptyString(item.title)
      || !isNonEmptyString(item.url)
      || !isSafeHttpUrl(item.url)
      || !isNonEmptyString(item.displayUrl)
      || !isNonEmptyString(item.domain)
      || !isNonEmptyString(item.snippet)
      || !isNonEmptyString(item.retrievedAt)
      || !isValidIsoLikeDate(item.retrievedAt)
      || (confidence !== undefined && confidence !== 'low' && confidence !== 'medium' && confidence !== 'high')
      || (sourceType !== undefined && !isTravelSearchSourceType(sourceType))
    ) {
      return null
    }
    results.push({
      confidence: confidence as ProviderProxyTravelSearchSuccessResponse['results'][number]['confidence'],
      displayUrl: item.displayUrl,
      domain: item.domain,
      retrievedAt: item.retrievedAt,
      snippet: item.snippet,
      sourceType: sourceType as ProviderProxyTravelSearchSourceType | undefined,
      title: item.title,
      url: item.url,
    })
  }

  return {
    ok: true,
    operation: 'travel_search',
    query,
    requestId: typeof record.requestId === 'string' ? record.requestId : undefined,
    results,
    retrievedAt,
    source: record.source,
    warnings: Array.isArray(record.warnings)
      ? record.warnings.filter((w): w is string => typeof w === 'string')
      : undefined,
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isSafeHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

function isValidIsoLikeDate(value: string): boolean {
  return Number.isFinite(Date.parse(value))
}

function isTravelSearchSourceType(value: unknown): value is ProviderProxyTravelSearchSourceType {
  return value === 'official' || value === 'map' || value === 'ticketing' || value === 'travel_site' || value === 'unknown'
}

function validateProviderProxyAiTripDraftRepairSuccessResponse(record: Record<string, unknown>): ProviderProxyAiTripDraftRepairSuccessResponse | null {
  if (record.operation !== 'ai_trip_draft_repair') {
    return null
  }
  if (typeof record.draft !== 'object' || record.draft === null || !Array.isArray((record.draft as Record<string, unknown>).days)) {
    return null
  }
  if (record.source !== 'mock' && record.source !== 'future_ai') {
    return null
  }
  return {
    draft: record.draft as ProviderProxyAiTripDraftRepairSuccessResponse['draft'],
    ok: true,
    operation: 'ai_trip_draft_repair',
    requestId: typeof record.requestId === 'string' ? record.requestId : undefined,
    source: record.source,
    warnings: Array.isArray(record.warnings) ? record.warnings.filter((w: unknown) => typeof w === 'string') : undefined,
  }
}

function validateProviderProxyRoutePreviewResponse(record: Record<string, unknown>): ProviderProxyRoutePreviewResponse | null {
  if (!isProviderProxyConcreteProvider(record.provider)) {
    return null
  }
  const route = readRecord(record.route)
  const lineStrings = Array.isArray(route.lineStrings) ? route.lineStrings : []
  const segments = Array.isArray(route.segments) ? route.segments : []
  if (lineStrings.length === 0 || segments.length === 0) {
    return null
  }
  return {
    ok: true,
    operation: 'route_preview',
    provider: record.provider,
    requestId: typeof record.requestId === 'string' ? record.requestId : undefined,
    route: {
      distanceMeters: typeof route.distanceMeters === 'number' ? route.distanceMeters : undefined,
      durationSeconds: typeof route.durationSeconds === 'number' ? route.durationSeconds : undefined,
      lineStrings: lineStrings as ProviderProxyRoutePreviewSuccessResponse['route']['lineStrings'],
      segments: segments as ProviderProxyRoutePreviewSuccessResponse['route']['segments'],
      status: route.status === 'mixed' || route.status === 'straight' || route.status === 'failed' ? route.status : 'road',
      warnings: Array.isArray(route.warnings)
        ? route.warnings.filter((warning): warning is string => typeof warning === 'string')
        : [],
    },
  }
}

function validateProviderProxyAiTripDraftSuccessResponse(record: Record<string, unknown>): ProviderProxyAiTripDraftSuccessResponse | null {
  if (record.operation !== 'ai_trip_draft') {
    return null
  }
  const draft = record.draft
  if (!draft || typeof draft !== 'object') {
    return null
  }
  const source = record.source
  if (source !== 'mock' && source !== 'future_ai') {
    return null
  }
  return {
    draft: draft as ProviderProxyAiTripDraftSuccessResponse['draft'],
    ok: true,
    operation: 'ai_trip_draft',
    requestId: typeof record.requestId === 'string' ? record.requestId : undefined,
    source,
    warnings: Array.isArray(record.warnings)
      ? record.warnings.filter((w): w is string => typeof w === 'string')
      : [],
  }
}

function normalizeProxyProvider(value?: string | null): ProviderProxyConcreteProvider | null {
  return isProviderProxyConcreteProvider(value) ? value : null
}

function normalizeProxyUrl(value?: string | null) {
  const trimmed = value?.trim()
  return trimmed || null
}

function normalizeErrorCode(value: string): ProviderProxyErrorCode {
  if (
    value === 'invalid_request' ||
    value === 'network_error' ||
    value === 'provider_error' ||
    value === 'provider_unavailable' ||
    value === 'quota_exceeded' ||
    value === 'unsupported' ||
    value === 'invalid_response'
  ) {
    return value
  }
  return 'provider_error'
}

function readStorageValue(storage: Storage | null | undefined, key: string) {
  try {
    return storage?.getItem(key) || null
  } catch {
    return null
  }
}

function getBrowserStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    return window.localStorage
  } catch {
    return null
  }
}

function createSessionId() {
  if (memoryProviderProxySessionId) {
    return memoryProviderProxySessionId
  }

  const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `pp_${randomId}`
}

function readRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? input as Record<string, unknown> : {}
}
