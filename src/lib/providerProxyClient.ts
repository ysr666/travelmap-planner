import {
  buildProviderProxyErrorResponse,
  defaultProviderProxyErrorMessage,
  isProviderProxyConcreteProvider,
  validateProviderProxyRoutePreviewRequest,
  validateProviderProxyAiTripDraftRequest,
  type ProviderProxyAiTripDraftRequest,
  type ProviderProxyAiTripDraftResponse,
  type ProviderProxyAiTripDraftSuccessResponse,
  type ProviderProxyConcreteProvider,
  type ProviderProxyErrorCode,
  type ProviderProxyErrorResponse,
  type ProviderProxyRoutePreviewRequest,
  type ProviderProxyRoutePreviewResponse,
  type ProviderProxyRoutePreviewSuccessResponse,
} from './providerProxyContract'

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
