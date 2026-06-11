import {
  buildProviderProxyErrorResponse,
  defaultProviderProxyErrorMessage,
  isProviderProxyConcreteProvider,
  validateProviderProxyRoutePreviewRequest,
  validateProviderProxyAiTripDraftRequest,
  validateProviderProxyAiTripDraftRepairRequest,
  validateProviderProxyAiTripDraftRefineRequest,
  validateProviderProxyExistingTripImportRequest,
  validateProviderProxyTravelInboxClassifyRequest,
  validateTravelInboxClassification,
  validateProviderProxyAiTripEditPlanRequest,
  validateProviderProxyPlaceLookupRequest,
  validateProviderProxyPlaceDetailsRequest,
  type ProviderProxyAiTripDraftRequest,
  type ProviderProxyAiTripDraftRepairRequest,
  type ProviderProxyAiTripDraftRepairResponse,
  type ProviderProxyAiTripDraftRepairSuccessResponse,
  type ProviderProxyAiTripDraftRefineRequest,
  type ProviderProxyAiTripDraftRefineResponse,
  type ProviderProxyAiTripDraftRefineSuccessResponse,
  type ProviderProxyAiTripDraftResponse,
  type ProviderProxyAiTripDraftSuccessResponse,
  type ProviderProxyExistingTripImportRequest,
  type ProviderProxyExistingTripImportResponse,
  type ProviderProxyExistingTripImportSuccessResponse,
  type ProviderProxyTravelInboxClassifyRequest,
  type ProviderProxyTravelInboxClassifyResponse,
  type ProviderProxyTravelInboxClassifySuccessResponse,
  type ProviderProxyAiTripEditPlanRequest,
  type ProviderProxyAiTripEditPlanResponse,
  type ProviderProxyAiTripEditPlanSuccessResponse,
  type ProviderProxyConcreteProvider,
  type ProviderProxyErrorCode,
  type ProviderProxyErrorResponse,
  type ProviderProxyPlaceLookupRequest,
  type ProviderProxyPlaceLookupResponse,
  type ProviderProxyPlaceLookupSuccessResponse,
  type ProviderProxyPlaceDetailsRequest,
  type ProviderProxyPlaceDetailsResponse,
  type ProviderProxyPlaceDetailsSuccessResponse,
  type ProviderProxyRouteOrderSuggestionRequest,
  type ProviderProxyRouteOrderSuggestionResponse,
  type ProviderProxyRouteOrderSuggestionSuccessResponse,
  type ProviderProxyRoutePreviewRequest,
  type ProviderProxyRoutePreviewResponse,
  type ProviderProxyRoutePreviewSuccessResponse,
  validateProviderProxyTravelSearchRequest,
  validateProviderProxyTripContentEnrichmentRequest,
  validateProviderProxyTripDailyTipRequest,
  validateProviderProxyRouteOrderSuggestionRequest,
  type ProviderProxyTravelSearchRequest,
  type ProviderProxyTravelSearchResponse,
  type ProviderProxyTravelSearchSourceType,
  type ProviderProxyTravelSearchSuccessResponse,
  type ProviderProxyTripContentEnrichmentRequest,
  type ProviderProxyTripContentEnrichmentResponse,
  type ProviderProxyTripContentEnrichmentSuccessResponse,
  type ProviderProxyTripDailyTipRequest,
  type ProviderProxyTripDailyTipResponse,
  type ProviderProxyTripDailyTipSuccessResponse,
} from './ai/providerProxyContract'
import { validateAiTripEditPatchPlan } from './ai/aiTripEditPatch'
import { validateAiTripDraft } from './ai/aiTripDraft'

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
  const env = options.env ?? readProviderProxyEnv()
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

function readProviderProxyEnv(): Pick<ImportMetaEnv, 'VITE_ROUTE_PROXY_PROVIDER' | 'VITE_ROUTE_PROXY_URL'> {
  return {
    VITE_ROUTE_PROXY_PROVIDER: import.meta.env.VITE_ROUTE_PROXY_PROVIDER,
    VITE_ROUTE_PROXY_URL: import.meta.env.VITE_ROUTE_PROXY_URL,
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

export async function fetchProviderProxyRouteOrderSuggestion(
  request: ProviderProxyRouteOrderSuggestionRequest,
  proxyUrl: string,
  options: ProviderProxyClientOptions = {},
): Promise<ProviderProxyRouteOrderSuggestionSuccessResponse> {
  const requestWithSession = {
    ...request,
    quotaSessionId: request.quotaSessionId ?? getProviderProxySessionId(options.storage),
  }
  const validation = validateProviderProxyRouteOrderSuggestionRequest(requestWithSession)
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
    throw new ProviderProxyClientError(buildProviderProxyErrorResponse({ code: 'network_error', operation: 'route_order_suggestion' }))
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ProviderProxyClientError(buildProviderProxyErrorResponse({ code: 'network_error', operation: 'route_order_suggestion' }), response.status)
  }

  const parsed = parseProviderProxyRouteOrderSuggestionResponse(body, validation.request)
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

export async function fetchProviderProxyAiTripDraftRefine(
  request: ProviderProxyAiTripDraftRefineRequest,
  proxyUrl: string,
  options: ProviderProxyClientOptions = {},
): Promise<ProviderProxyAiTripDraftRefineSuccessResponse> {
  const requestWithSession = {
    ...request,
    quotaSessionId: request.quotaSessionId ?? getProviderProxySessionId(options.storage),
  }
  const validation = validateProviderProxyAiTripDraftRefineRequest(requestWithSession)
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
    throw new ProviderProxyClientError(buildProviderProxyErrorResponse({ code: 'network_error', operation: 'ai_trip_draft_refine' }))
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ProviderProxyClientError(buildProviderProxyErrorResponse({ code: 'network_error', operation: 'ai_trip_draft_refine' }), response.status)
  }

  const parsed = parseProviderProxyAiTripDraftRefineResponse(body)
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

export async function fetchProviderProxyPlaceLookup(
  request: ProviderProxyPlaceLookupRequest,
  proxyUrl: string,
  options: ProviderProxyClientOptions = {},
): Promise<ProviderProxyPlaceLookupSuccessResponse> {
  const requestWithSession = {
    ...request,
    quotaSessionId: request.quotaSessionId ?? getProviderProxySessionId(options.storage),
  }
  const validation = validateProviderProxyPlaceLookupRequest(requestWithSession)
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
    throw new ProviderProxyClientError(buildProviderProxyErrorResponse({ code: 'network_error', operation: 'place_lookup' }))
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ProviderProxyClientError(buildProviderProxyErrorResponse({ code: 'network_error', operation: 'place_lookup' }), response.status)
  }

  const parsed = parseProviderProxyPlaceLookupResponse(body)
  if (!parsed.ok) {
    throw new ProviderProxyClientError(parsed, response.status)
  }
  return parsed
}

export async function fetchProviderProxyPlaceDetails(
  request: ProviderProxyPlaceDetailsRequest,
  proxyUrl: string,
  options: ProviderProxyClientOptions = {},
): Promise<ProviderProxyPlaceDetailsSuccessResponse> {
  const requestWithSession = {
    ...request,
    quotaSessionId: request.quotaSessionId ?? getProviderProxySessionId(options.storage),
  }
  const validation = validateProviderProxyPlaceDetailsRequest(requestWithSession)
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
    throw new ProviderProxyClientError(buildProviderProxyErrorResponse({ code: 'network_error', operation: 'place_details' }))
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ProviderProxyClientError(buildProviderProxyErrorResponse({ code: 'network_error', operation: 'place_details' }), response.status)
  }

  const parsed = parseProviderProxyPlaceDetailsResponse(body)
  if (!parsed.ok) {
    throw new ProviderProxyClientError(parsed, response.status)
  }
  return parsed
}

export async function fetchProviderProxyTripContentEnrichment(
  request: ProviderProxyTripContentEnrichmentRequest,
  proxyUrl: string,
  options: ProviderProxyClientOptions = {},
): Promise<ProviderProxyTripContentEnrichmentSuccessResponse> {
  const requestWithSession = {
    ...request,
    quotaSessionId: request.quotaSessionId ?? getProviderProxySessionId(options.storage),
  }
  const validation = validateProviderProxyTripContentEnrichmentRequest(requestWithSession)
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
    throw new ProviderProxyClientError(buildProviderProxyErrorResponse({ code: 'network_error', operation: 'trip_content_enrichment' }))
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ProviderProxyClientError(buildProviderProxyErrorResponse({ code: 'network_error', operation: 'trip_content_enrichment' }), response.status)
  }

  const parsed = parseProviderProxyTripContentEnrichmentResponse(body, validation.request)
  if (!parsed.ok) {
    throw new ProviderProxyClientError(parsed, response.status)
  }
  return parsed
}

export async function fetchProviderProxyTripDailyTip(
  request: ProviderProxyTripDailyTipRequest,
  proxyUrl: string,
  options: ProviderProxyClientOptions = {},
): Promise<ProviderProxyTripDailyTipSuccessResponse> {
  const requestWithSession = {
    ...request,
    quotaSessionId: request.quotaSessionId ?? getProviderProxySessionId(options.storage),
  }
  const validation = validateProviderProxyTripDailyTipRequest(requestWithSession)
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
    throw new ProviderProxyClientError(buildProviderProxyErrorResponse({ code: 'network_error', operation: 'trip_daily_tip' }))
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ProviderProxyClientError(buildProviderProxyErrorResponse({ code: 'network_error', operation: 'trip_daily_tip' }), response.status)
  }

  const parsed = parseProviderProxyTripDailyTipResponse(body, validation.request)
  if (!parsed.ok) {
    throw new ProviderProxyClientError(parsed, response.status)
  }
  return parsed
}

export async function fetchProviderProxyExistingTripImport(
  request: ProviderProxyExistingTripImportRequest,
  proxyUrl: string,
  options: ProviderProxyClientOptions = {},
): Promise<ProviderProxyExistingTripImportSuccessResponse> {
  const requestWithSession = {
    ...request,
    quotaSessionId: request.quotaSessionId ?? getProviderProxySessionId(options.storage),
  }
  const validation = validateProviderProxyExistingTripImportRequest(requestWithSession)
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
    throw new ProviderProxyClientError(buildProviderProxyErrorResponse({ code: 'network_error', operation: 'ai_existing_trip_import' }))
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ProviderProxyClientError(buildProviderProxyErrorResponse({ code: 'network_error', operation: 'ai_existing_trip_import' }), response.status)
  }

  const parsed = parseProviderProxyExistingTripImportResponse(body)
  if (!parsed.ok) {
    throw new ProviderProxyClientError(parsed, response.status)
  }
  return parsed
}

export async function fetchProviderProxyTravelInboxClassify(
  request: ProviderProxyTravelInboxClassifyRequest,
  proxyUrl: string,
  options: ProviderProxyClientOptions = {},
): Promise<ProviderProxyTravelInboxClassifySuccessResponse> {
  const requestWithSession = {
    ...request,
    quotaSessionId: request.quotaSessionId ?? getProviderProxySessionId(options.storage),
  }
  const validation = validateProviderProxyTravelInboxClassifyRequest(requestWithSession)
  if (!validation.ok) throw new ProviderProxyClientError(validation.error)
  let response: Response
  try {
    response = await (options.fetcher ?? fetch)(proxyUrl, {
      body: JSON.stringify(validation.request),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal: options.signal,
    })
  } catch {
    throw new ProviderProxyClientError(buildProviderProxyErrorResponse({ code: 'network_error', operation: 'travel_inbox_classify' }))
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ProviderProxyClientError(buildProviderProxyErrorResponse({ code: 'network_error', operation: 'travel_inbox_classify' }), response.status)
  }
  const parsed = parseProviderProxyTravelInboxClassifyResponse(body, validation.request)
  if (!parsed.ok) throw new ProviderProxyClientError(parsed, response.status)
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

function parseProviderProxyRouteOrderSuggestionResponse(
  input: unknown,
  request: ProviderProxyRouteOrderSuggestionRequest,
): ProviderProxyRouteOrderSuggestionResponse {
  const record = readRecord(input)
  if (record.ok === true) {
    const validation = validateProviderProxyRouteOrderSuggestionSuccessResponse(record, request)
    if (validation) {
      return validation
    }
    return buildProviderProxyErrorResponse({ code: 'invalid_response', operation: 'route_order_suggestion' })
  }

  if (record.ok === false && typeof record.code === 'string') {
    const code = normalizeErrorCode(record.code)
    return buildProviderProxyErrorResponse({
      code,
      message: defaultProviderProxyErrorMessage(code, 'route_order_suggestion'),
      operation: 'route_order_suggestion',
      provider: isProviderProxyConcreteProvider(record.provider) ? record.provider : undefined,
      requestId: typeof record.requestId === 'string' ? record.requestId : undefined,
    })
  }

  return buildProviderProxyErrorResponse({ code: 'network_error', operation: 'route_order_suggestion' })
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

function parseProviderProxyAiTripDraftRefineResponse(input: unknown): ProviderProxyAiTripDraftRefineResponse {
  const record = readRecord(input)
  if (record.ok === true) {
    const validation = validateProviderProxyAiTripDraftRefineSuccessResponse(record)
    if (validation) {
      return validation
    }
    return buildProviderProxyErrorResponse({ code: 'invalid_response', operation: 'ai_trip_draft_refine' })
  }

  if (record.ok === false && typeof record.code === 'string') {
    const code = normalizeErrorCode(record.code)
    return buildProviderProxyErrorResponse({
      code,
      details: typeof record.details === 'string' ? record.details : undefined,
      message: typeof record.message === 'string' ? record.message : defaultProviderProxyErrorMessage(code, 'ai_trip_draft_refine'),
      operation: 'ai_trip_draft_refine',
      requestId: typeof record.requestId === 'string' ? record.requestId : undefined,
    })
  }

  return buildProviderProxyErrorResponse({ code: 'network_error', operation: 'ai_trip_draft_refine' })
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

function parseProviderProxyExistingTripImportResponse(input: unknown): ProviderProxyExistingTripImportResponse {
  const record = readRecord(input)
  if (record.ok === true) {
    const validation = validateProviderProxyExistingTripImportSuccessResponse(record)
    if (validation) {
      return validation
    }
    return buildProviderProxyErrorResponse({ code: 'invalid_response', operation: 'ai_existing_trip_import' })
  }

  if (record.ok === false && typeof record.code === 'string') {
    const code = normalizeErrorCode(record.code)
    return buildProviderProxyErrorResponse({
      code,
      details: typeof record.details === 'string' ? record.details : undefined,
      message: typeof record.message === 'string' ? record.message : defaultProviderProxyErrorMessage(code, 'ai_existing_trip_import'),
      operation: 'ai_existing_trip_import',
      requestId: typeof record.requestId === 'string' ? record.requestId : undefined,
    })
  }

  return buildProviderProxyErrorResponse({ code: 'network_error', operation: 'ai_existing_trip_import' })
}

function parseProviderProxyTravelInboxClassifyResponse(
  input: unknown,
  request: ProviderProxyTravelInboxClassifyRequest,
): ProviderProxyTravelInboxClassifyResponse {
  const record = readRecord(input)
  if (record.ok === true && record.operation === 'travel_inbox_classify' && (record.source === 'mock' || record.source === 'future_ai')) {
    const classification = validateTravelInboxClassification(record.classification, new Set(request.trips.map((trip) => trip.id)))
    if (classification) {
      return {
        classification,
        ok: true,
        operation: 'travel_inbox_classify',
        requestId: typeof record.requestId === 'string' ? record.requestId : undefined,
        source: record.source,
        warnings: Array.isArray(record.warnings) ? record.warnings.filter((item): item is string => typeof item === 'string').slice(0, 5) : undefined,
      }
    }
    return buildProviderProxyErrorResponse({ code: 'invalid_response', operation: 'travel_inbox_classify' })
  }
  if (record.ok === false && typeof record.code === 'string') {
    const code = normalizeErrorCode(record.code)
    return buildProviderProxyErrorResponse({
      code,
      message: typeof record.message === 'string' ? record.message : defaultProviderProxyErrorMessage(code, 'travel_inbox_classify'),
      operation: 'travel_inbox_classify',
      requestId: typeof record.requestId === 'string' ? record.requestId : undefined,
    })
  }
  return buildProviderProxyErrorResponse({ code: 'network_error', operation: 'travel_inbox_classify' })
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

function parseProviderProxyPlaceLookupResponse(input: unknown): ProviderProxyPlaceLookupResponse {
  const record = readRecord(input)
  if (record.ok === true) {
    const validation = validateProviderProxyPlaceLookupSuccessResponse(record)
    if (validation) {
      return validation
    }
    return buildProviderProxyErrorResponse({ code: 'invalid_response', operation: 'place_lookup' })
  }

  if (record.ok === false && typeof record.code === 'string') {
    const code = normalizeErrorCode(record.code)
    return buildProviderProxyErrorResponse({
      code,
      message: defaultProviderProxyErrorMessage(code, 'place_lookup'),
      operation: 'place_lookup',
      requestId: typeof record.requestId === 'string' ? record.requestId : undefined,
    })
  }

  return buildProviderProxyErrorResponse({ code: 'network_error', operation: 'place_lookup' })
}

function parseProviderProxyPlaceDetailsResponse(input: unknown): ProviderProxyPlaceDetailsResponse {
  const record = readRecord(input)
  if (record.ok === true) {
    const validation = validateProviderProxyPlaceDetailsSuccessResponse(record)
    if (validation) {
      return validation
    }
    return buildProviderProxyErrorResponse({ code: 'invalid_response', operation: 'place_details' })
  }

  if (record.ok === false && typeof record.code === 'string') {
    const code = normalizeErrorCode(record.code)
    return buildProviderProxyErrorResponse({
      code,
      message: defaultProviderProxyErrorMessage(code, 'place_details'),
      operation: 'place_details',
      requestId: typeof record.requestId === 'string' ? record.requestId : undefined,
    })
  }

  return buildProviderProxyErrorResponse({ code: 'network_error', operation: 'place_details' })
}

function parseProviderProxyTripContentEnrichmentResponse(
  input: unknown,
  request: ProviderProxyTripContentEnrichmentRequest,
): ProviderProxyTripContentEnrichmentResponse {
  const record = readRecord(input)
  if (record.ok === true) {
    const validation = validateProviderProxyTripContentEnrichmentSuccessResponse(record, request)
    if (validation) {
      return validation
    }
    return buildProviderProxyErrorResponse({ code: 'invalid_response', operation: 'trip_content_enrichment' })
  }

  if (record.ok === false && typeof record.code === 'string') {
    const code = normalizeErrorCode(record.code)
    return buildProviderProxyErrorResponse({
      code,
      message: defaultProviderProxyErrorMessage(code, 'trip_content_enrichment'),
      operation: 'trip_content_enrichment',
      requestId: typeof record.requestId === 'string' ? record.requestId : undefined,
    })
  }

  return buildProviderProxyErrorResponse({ code: 'network_error', operation: 'trip_content_enrichment' })
}

function parseProviderProxyTripDailyTipResponse(
  input: unknown,
  request: ProviderProxyTripDailyTipRequest,
): ProviderProxyTripDailyTipResponse {
  const record = readRecord(input)
  if (record.ok === true) {
    const validation = validateProviderProxyTripDailyTipSuccessResponse(record, request)
    if (validation) {
      return validation
    }
    return buildProviderProxyErrorResponse({ code: 'invalid_response', operation: 'trip_daily_tip' })
  }

  if (record.ok === false && typeof record.code === 'string') {
    const code = normalizeErrorCode(record.code)
    return buildProviderProxyErrorResponse({
      code,
      message: defaultProviderProxyErrorMessage(code, 'trip_daily_tip'),
      operation: 'trip_daily_tip',
      requestId: typeof record.requestId === 'string' ? record.requestId : undefined,
    })
  }

  return buildProviderProxyErrorResponse({ code: 'network_error', operation: 'trip_daily_tip' })
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

function validateProviderProxyRouteOrderSuggestionSuccessResponse(
  record: Record<string, unknown>,
  request: ProviderProxyRouteOrderSuggestionRequest,
): ProviderProxyRouteOrderSuggestionSuccessResponse | null {
  if (record.operation !== 'route_order_suggestion') {
    return null
  }
  if (record.provider !== 'mock' && !isProviderProxyConcreteProvider(record.provider)) {
    return null
  }
  const retrievedAt = typeof record.retrievedAt === 'string' ? record.retrievedAt : null
  const suggestedItemIds = Array.isArray(record.suggestedItemIds)
    ? record.suggestedItemIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : null
  const unchangedItemIds = Array.isArray(record.unchangedItemIds)
    ? record.unchangedItemIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : null
  const coordinateItemIds = request.items.filter((item) => item.coordinate).map((item) => item.id)
  if (
    !retrievedAt ||
    !isValidIsoLikeDate(retrievedAt) ||
    !suggestedItemIds ||
    !unchangedItemIds ||
    !hasSameStringSet(suggestedItemIds, coordinateItemIds) ||
    hasDuplicateStrings(suggestedItemIds) ||
    hasDuplicateStrings(unchangedItemIds)
  ) {
    return null
  }

  const distanceMeters = typeof record.distanceMeters === 'number' && Number.isFinite(record.distanceMeters)
    ? record.distanceMeters
    : undefined
  const durationSeconds = typeof record.durationSeconds === 'number' && Number.isFinite(record.durationSeconds)
    ? record.durationSeconds
    : undefined

  return {
    distanceMeters,
    durationSeconds,
    ok: true,
    operation: 'route_order_suggestion',
    provider: record.provider,
    requestId: typeof record.requestId === 'string' ? record.requestId : undefined,
    retrievedAt,
    suggestedItemIds,
    summary: typeof record.summary === 'string' && record.summary.trim()
      ? record.summary
      : '已生成路线顺序建议。',
    unchangedItemIds,
    warnings: Array.isArray(record.warnings)
      ? record.warnings.filter((warning): warning is string => typeof warning === 'string')
      : [],
  }
}

function validateProviderProxyPlaceLookupSuccessResponse(record: Record<string, unknown>): ProviderProxyPlaceLookupSuccessResponse | null {
  if (record.operation !== 'place_lookup') {
    return null
  }
  if (record.source !== 'mock' && record.source !== 'google_places') {
    return null
  }
  const retrievedAt = typeof record.retrievedAt === 'string' ? record.retrievedAt : null
  if (!retrievedAt || !isValidIsoLikeDate(retrievedAt) || !Array.isArray(record.results)) {
    return null
  }

  const results: ProviderProxyPlaceLookupSuccessResponse['results'] = []
  for (const result of record.results) {
    const item = readRecord(result)
    const location = readRecord(item.location)
    const hasLocation = item.location !== undefined
    const lat = Number(location.lat)
    const lng = Number(location.lng)
    const googleMapsUri = item.googleMapsUri
    if (
      !isNonEmptyString(item.placeId)
      || !isNonEmptyString(item.displayName)
      || !isNonEmptyString(item.formattedAddress)
      || item.provider !== 'google_places'
      || !isNonEmptyString(item.retrievedAt)
      || !isValidIsoLikeDate(item.retrievedAt)
      || (hasLocation && (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180))
      || (googleMapsUri !== undefined && (!isNonEmptyString(googleMapsUri) || !isSafeHttpUrl(googleMapsUri)))
    ) {
      return null
    }

    results.push({
      displayName: item.displayName,
      formattedAddress: item.formattedAddress,
      googleMapsUri: googleMapsUri as string | undefined,
      location: hasLocation ? { lat, lng } : undefined,
      placeId: item.placeId,
      provider: 'google_places',
      retrievedAt: item.retrievedAt,
    })
  }

  return {
    ok: true,
    operation: 'place_lookup',
    requestId: typeof record.requestId === 'string' ? record.requestId : undefined,
    results,
    retrievedAt,
    source: record.source,
    warnings: Array.isArray(record.warnings)
      ? record.warnings.filter((w): w is string => typeof w === 'string')
      : undefined,
  }
}

function validateProviderProxyPlaceDetailsSuccessResponse(record: Record<string, unknown>): ProviderProxyPlaceDetailsSuccessResponse | null {
  if (record.operation !== 'place_details') {
    return null
  }
  if (record.source !== 'mock' && record.source !== 'google_places') {
    return null
  }
  const retrievedAt = typeof record.retrievedAt === 'string' ? record.retrievedAt : null
  const detailsRecord = readRecord(record.details)
  if (!retrievedAt || !isValidIsoLikeDate(retrievedAt)) {
    return null
  }

  const location = readRecord(detailsRecord.location)
  const hasLocation = detailsRecord.location !== undefined
  const lat = Number(location.lat)
  const lng = Number(location.lng)
  const googleMapsUri = detailsRecord.googleMapsUri
  const websiteUri = detailsRecord.websiteUri
  const regularOpeningHours = readRegularOpeningHours(detailsRecord.regularOpeningHours)
  if (
    !isNonEmptyString(detailsRecord.placeId)
    || !isNonEmptyString(detailsRecord.displayName)
    || detailsRecord.provider !== 'google_places'
    || !isNonEmptyString(detailsRecord.retrievedAt)
    || !isValidIsoLikeDate(detailsRecord.retrievedAt)
    || (detailsRecord.formattedAddress !== undefined && !isNonEmptyString(detailsRecord.formattedAddress))
    || (hasLocation && (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180))
    || (googleMapsUri !== undefined && (!isNonEmptyString(googleMapsUri) || !isSafeHttpUrl(googleMapsUri)))
    || (websiteUri !== undefined && (!isNonEmptyString(websiteUri) || !isSafeHttpUrl(websiteUri)))
  ) {
    return null
  }

  return {
    details: {
      displayName: detailsRecord.displayName,
      editorialSummary: typeof detailsRecord.editorialSummary === 'string' ? detailsRecord.editorialSummary : undefined,
      formattedAddress: typeof detailsRecord.formattedAddress === 'string' ? detailsRecord.formattedAddress : undefined,
      googleMapsUri: googleMapsUri as string | undefined,
      location: hasLocation ? { lat, lng } : undefined,
      placeId: detailsRecord.placeId,
      priceLevel: typeof detailsRecord.priceLevel === 'string' ? detailsRecord.priceLevel : undefined,
      priceRangeText: typeof detailsRecord.priceRangeText === 'string' ? detailsRecord.priceRangeText : undefined,
      provider: 'google_places',
      regularOpeningHours,
      retrievedAt: detailsRecord.retrievedAt,
      websiteUri: websiteUri as string | undefined,
    },
    ok: true,
    operation: 'place_details',
    requestId: typeof record.requestId === 'string' ? record.requestId : undefined,
    retrievedAt,
    source: record.source,
    warnings: Array.isArray(record.warnings)
      ? record.warnings.filter((w): w is string => typeof w === 'string')
      : undefined,
  }
}

function validateProviderProxyTripContentEnrichmentSuccessResponse(
  record: Record<string, unknown>,
  request: ProviderProxyTripContentEnrichmentRequest,
): ProviderProxyTripContentEnrichmentSuccessResponse | null {
  if (record.operation !== 'trip_content_enrichment') {
    return null
  }
  if (record.source !== 'mock' && record.source !== 'future_ai') {
    return null
  }
  if (!Array.isArray(record.items)) {
    return null
  }

  const sourceIdsByItemId = new Map(request.items.map((item) => [item.itemId, new Set(item.sources.map((source) => source.id))]))
  const itemIds = new Set(sourceIdsByItemId.keys())
  const results: ProviderProxyTripContentEnrichmentSuccessResponse['items'] = []
  const seen = new Set<string>()
  for (const rawResult of record.items) {
    const result = readRecord(rawResult)
    const itemId = typeof result.itemId === 'string' ? result.itemId.trim() : ''
    const validSourceIds = sourceIdsByItemId.get(itemId)
    if (!itemId || !itemIds.has(itemId) || seen.has(itemId) || !validSourceIds) {
      return null
    }
    seen.add(itemId)

    const introduction = readEnrichmentFact(result.introduction, validSourceIds)
    const openingHours = readEnrichmentFact(result.openingHours, validSourceIds)
    const ticketPrice = readTicketPriceFact(result.ticketPrice, validSourceIds)
    const notices = readEnrichmentFacts(result.notices, validSourceIds)
    const recommendedStay = readRecommendedStay(result.recommendedStay, validSourceIds)
    if (
      (result.introduction !== undefined && !introduction) ||
      (result.openingHours !== undefined && !openingHours) ||
      (result.ticketPrice !== undefined && !ticketPrice) ||
      (result.notices !== undefined && !notices) ||
      (result.recommendedStay !== undefined && !recommendedStay)
    ) {
      return null
    }

    results.push({
      itemId,
      introduction,
      notices,
      openingHours,
      recommendedStay,
      ticketPrice,
      warnings: Array.isArray(result.warnings) ? result.warnings.filter((w): w is string => typeof w === 'string').slice(0, 5) : undefined,
    })
  }

  return {
    items: results,
    ok: true,
    operation: 'trip_content_enrichment',
    requestId: typeof record.requestId === 'string' ? record.requestId : undefined,
    source: record.source,
    warnings: Array.isArray(record.warnings) ? record.warnings.filter((w): w is string => typeof w === 'string') : undefined,
  }
}

function validateProviderProxyTripDailyTipSuccessResponse(
  record: Record<string, unknown>,
  request: ProviderProxyTripDailyTipRequest,
): ProviderProxyTripDailyTipSuccessResponse | null {
  if (record.operation !== 'trip_daily_tip') {
    return null
  }
  if (record.source !== 'mock' && record.source !== 'future_ai') {
    return null
  }
  const summary = typeof record.summary === 'string' ? record.summary.trim() : ''
  if (!summary) {
    return null
  }
  const validSourceIds = new Set(request.sources.map((source) => source.id))
  const sections: ProviderProxyTripDailyTipSuccessResponse['sections'] = []
  if (Array.isArray(record.sections)) {
    for (const rawSection of record.sections) {
      const section = readRecord(rawSection)
      const key = section.key
      if (key !== 'opening_hours' && key !== 'ticket_price' && key !== 'notices' && key !== 'route_risk') {
        return null
      }
      const title = typeof section.title === 'string' ? section.title.trim().slice(0, 80) : ''
      const text = typeof section.text === 'string' ? section.text.trim().slice(0, 700) : ''
      const sourceIds = readValidSourceIdList(section.sourceIds, validSourceIds)
      if (!title || !text || !sourceIds || sourceIds.length === 0) {
        return null
      }
      sections.push({ key, sourceIds, text, title })
    }
  }
  const sourceIds = readValidSourceIdList(record.sourceIds, validSourceIds)
  if (!sourceIds || sourceIds.length === 0 || sections.some((section) => section.sourceIds.some((sourceId) => !sourceIds.includes(sourceId)))) {
    return null
  }
  return {
    ok: true,
    operation: 'trip_daily_tip',
    requestId: typeof record.requestId === 'string' ? record.requestId : undefined,
    sections,
    source: record.source,
    sourceIds,
    summary,
    warnings: Array.isArray(record.warnings) ? record.warnings.filter((w): w is string => typeof w === 'string').slice(0, 5) : undefined,
  }
}

function validateProviderProxyExistingTripImportSuccessResponse(
  record: Record<string, unknown>,
): ProviderProxyExistingTripImportSuccessResponse | null {
  if (record.operation !== 'ai_existing_trip_import') {
    return null
  }
  if (record.source !== 'mock' && record.source !== 'future_ai') {
    return null
  }
  const result = readRecord(record.result)
  const days = Array.isArray(result.days) ? result.days : undefined
  const items = Array.isArray(result.items) ? result.items : undefined
  const tickets = Array.isArray(result.tickets) ? result.tickets : undefined
  const notes = Array.isArray(result.notes) ? result.notes : undefined
  if (!days && !items && !tickets && !notes) {
    return null
  }
  return {
    ok: true,
    operation: 'ai_existing_trip_import',
    requestId: typeof record.requestId === 'string' ? record.requestId : undefined,
    result: {
      days: days as ProviderProxyExistingTripImportSuccessResponse['result']['days'],
      items: items as ProviderProxyExistingTripImportSuccessResponse['result']['items'],
      notes: notes as ProviderProxyExistingTripImportSuccessResponse['result']['notes'],
      tickets: tickets as ProviderProxyExistingTripImportSuccessResponse['result']['tickets'],
      warnings: Array.isArray(result.warnings) ? result.warnings.filter((w): w is string => typeof w === 'string').slice(0, 8) : undefined,
    },
    source: record.source,
    warnings: Array.isArray(record.warnings) ? record.warnings.filter((w): w is string => typeof w === 'string').slice(0, 8) : undefined,
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

function readRegularOpeningHours(input: unknown): ProviderProxyPlaceDetailsSuccessResponse['details']['regularOpeningHours'] {
  const record = readRecord(input)
  const weekdayDescriptions = Array.isArray(record.weekdayDescriptions)
    ? record.weekdayDescriptions.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).slice(0, 7)
    : []
  if (weekdayDescriptions.length === 0 && typeof record.openNow !== 'boolean') {
    return undefined
  }
  return {
    openNow: typeof record.openNow === 'boolean' ? record.openNow : undefined,
    weekdayDescriptions,
  }
}

function readEnrichmentFact(input: unknown, validSourceIds: Set<string>): ProviderProxyTripContentEnrichmentSuccessResponse['items'][number]['introduction'] {
  if (input === undefined) return undefined
  const record = readRecord(input)
  const text = typeof record.text === 'string' ? record.text.trim() : ''
  const sourceIds = readValidSourceIds(record.sourceIds, validSourceIds)
  if (!text || sourceIds.length === 0) {
    return undefined
  }
  return { sourceIds, text }
}

function readTicketPriceFact(input: unknown, validSourceIds: Set<string>): ProviderProxyTripContentEnrichmentSuccessResponse['items'][number]['ticketPrice'] {
  const fact = readEnrichmentFact(input, validSourceIds)
  if (!fact) return undefined
  const record = readRecord(input)
  const kind = record.kind === 'admission' || record.kind === 'place_price_level' || record.kind === 'unknown'
    ? record.kind
    : 'unknown'
  return { ...fact, kind }
}

function readEnrichmentFacts(input: unknown, validSourceIds: Set<string>): ProviderProxyTripContentEnrichmentSuccessResponse['items'][number]['notices'] {
  if (input === undefined) return undefined
  if (!Array.isArray(input)) return undefined
  const facts = input.flatMap((rawFact) => {
    const fact = readEnrichmentFact(rawFact, validSourceIds)
    return fact ? [fact] : []
  }).slice(0, 5)
  return facts.length ? facts : undefined
}

function readRecommendedStay(input: unknown, validSourceIds: Set<string>): ProviderProxyTripContentEnrichmentSuccessResponse['items'][number]['recommendedStay'] {
  if (input === undefined) return undefined
  const record = readRecord(input)
  const basis = record.basis === 'source' ? 'source' : record.basis === 'ai_estimate' ? 'ai_estimate' : undefined
  const durationMinutes = Number(record.durationMinutes)
  const text = typeof record.text === 'string' ? record.text.trim() : ''
  const reason = typeof record.reason === 'string' ? record.reason.trim() : ''
  const sourceIds = readValidSourceIds(record.sourceIds, validSourceIds)
  if (!basis || !Number.isInteger(durationMinutes) || durationMinutes < 10 || durationMinutes > 720 || !text || !reason) {
    return undefined
  }
  if (basis === 'source' && sourceIds.length === 0) {
    return undefined
  }
  return {
    basis,
    durationMinutes,
    reason,
    sourceIds: sourceIds.length ? sourceIds : undefined,
    text,
  }
}

function readValidSourceIds(input: unknown, validSourceIds: Set<string>) {
  if (!Array.isArray(input)) return []
  return Array.from(new Set(input.filter((value): value is string => (
    typeof value === 'string' && validSourceIds.has(value)
  ))))
}

function hasDuplicateStrings(values: string[]) {
  return new Set(values).size !== values.length
}

function hasSameStringSet(first: string[], second: string[]) {
  if (first.length !== second.length) {
    return false
  }
  const secondSet = new Set(second)
  return first.every((value) => secondSet.has(value))
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

function validateProviderProxyAiTripDraftRefineSuccessResponse(record: Record<string, unknown>): ProviderProxyAiTripDraftRefineSuccessResponse | null {
  if (record.operation !== 'ai_trip_draft_refine') {
    return null
  }
  const validation = validateAiTripDraft(record.draft)
  if (!validation.valid || !validation.draft) {
    return null
  }
  if (record.source !== 'mock' && record.source !== 'future_ai') {
    return null
  }
  return {
    draft: validation.draft,
    ok: true,
    operation: 'ai_trip_draft_refine',
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

function readValidSourceIdList(input: unknown, validSourceIds: Set<string>): string[] | null {
  if (!Array.isArray(input)) {
    return null
  }
  const sourceIds = input.filter((value): value is string => typeof value === 'string' && validSourceIds.has(value))
  return sourceIds.length === input.length ? sourceIds : null
}
