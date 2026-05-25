import {
  PROVIDER_PROXY_AI_TRIP_DRAFT_OPERATION,
  PROVIDER_PROXY_AI_TRIP_DRAFT_REPAIR_OPERATION,
  PROVIDER_PROXY_AI_TRIP_EDIT_PLAN_OPERATION,
  PROVIDER_PROXY_ROUTE_PREVIEW_OPERATION,
  PROVIDER_PROXY_TRAVEL_SEARCH_OPERATION,
  buildProviderProxyErrorResponse,
  defaultProviderProxyErrorMessage,
  isProviderProxyConcreteProvider,
  validateProviderProxyAiTripDraftRequest,
  validateProviderProxyAiTripDraftRepairRequest,
  validateProviderProxyAiTripEditPlanRequest,
  validateProviderProxyTravelSearchRequest,
  type ProviderProxyAiTripDraftRequest,
  type ProviderProxyAiTripDraftRepairRequest,
  type ProviderProxyAiTripEditPlanRequest,
  type ProviderProxyConcreteProvider,
  type ProviderProxyErrorCode,
  type ProviderProxyOperation,
  type ProviderProxyRoutePreviewRequest,
  type ProviderProxyRoutePreviewSuccessResponse,
  type ProviderProxyRouteSegment,
  validateProviderProxyRoutePreviewRequest,
} from '../../src/lib/providerProxyContract'
import { validateAiTripEditPatchPlan } from '../../src/lib/aiTripEditPatch'
import type { LngLat } from '../../src/lib/routing'
import type { AiTripDraft } from '../../src/lib/aiTripDraft'
import { listPlainDateRangeInclusive } from '../../src/lib/plainDate'
import {
  checkAndConsumeProviderProxyQuota,
  type ProviderProxyQuotaLimits,
  type ProviderProxyQuotaStore,
} from './quotaGuard'
import { buildAiTripDraftProviderInput } from './aiDraftPrompt'
import { buildAiTripDraftRepairProviderInput } from './aiDraftRepairPrompt'
import { buildAiTripEditProviderInput } from './aiTripEditPrompt'
import {
  createDisabledAiDraftProvider,
  createDisabledAiDraftRepairProvider,
  createMockAiDraftProvider,
  createMockAiDraftRepairProvider,
  createOpenAiCompatibleAiDraftProvider,
  createOpenAiCompatibleAiDraftRepairProvider,
  createUnavailableAiDraftProvider,
  createUnavailableAiDraftRepairProvider,
  type AiDraftProvider,
  type AiDraftProviderErrorCode,
  type AiDraftRepairProvider,
} from './aiDraftProvider'
import { normalizeAiDraftProviderOutput } from './aiDraftResponse'
import { extractJsonFromAiText } from './aiJson'
import { chooseAiReasoningMode } from './aiReasoningPolicy'
import {
  createDisabledAiTripEditProvider,
  createMockAiTripEditProvider,
  createOpenAiCompatibleAiTripEditProvider,
  createUnavailableAiTripEditProvider,
  type AiTripEditProvider,
  type AiTripEditProviderErrorCode,
} from './aiTripEditProvider'
import {
  createMockTravelSearchProvider,
  createUnavailableTravelSearchProvider,
  type TravelSearchProvider,
  type TravelSearchProviderErrorCode,
} from './searchProvider'

type ProviderProxyHandlerEnv = {
  GOOGLE_ROUTES_API_KEY?: string
  OPENROUTESERVICE_API_KEY?: string
  TRIPMAP_AI_PROVIDER?: string
  TRIPMAP_AI_API_KEY?: string
  TRIPMAP_AI_BASE_URL?: string
  TRIPMAP_AI_MODEL?: string
  TRIPMAP_AI_PROVIDER_KEY?: string
  TRIPMAP_PROVIDER_PROXY_ALLOWED_ORIGINS?: string
  TRIPMAP_PROVIDER_PROXY_MOCK?: string
}

export type ProviderProxyHandlerInput = {
  env?: ProviderProxyHandlerEnv
  fetcher?: typeof fetch
  quotaLimits?: Partial<ProviderProxyQuotaLimits>
  quotaStore?: ProviderProxyQuotaStore
  request: Request
}

const OPENROUTESERVICE_ENDPOINT = 'https://api.openrouteservice.org/v2/directions'
const GOOGLE_ROUTES_ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes'

export async function handleProviderProxyRequest({
  env = {},
  fetcher = fetch,
  quotaLimits,
  quotaStore,
  request,
}: ProviderProxyHandlerInput): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env)

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        ...corsHeaders,
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Max-Age': '86400',
        Allow: 'POST, OPTIONS',
      },
      status: 204,
    })
  }

  if (request.method !== 'POST') {
    return jsonResponse(
      buildProviderProxyErrorResponse({
        code: 'unsupported',
        message: 'Provider proxy only supports POST requests.',
      }),
      405,
      corsHeaders,
      { Allow: 'POST, OPTIONS' },
    )
  }

  if (!isJsonContentType(request.headers.get('Content-Type'))) {
    return jsonResponse(
      buildProviderProxyErrorResponse({
        code: 'invalid_request',
        message: 'Provider proxy requires application/json.',
      }),
      415,
      corsHeaders,
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonResponse(
      buildProviderProxyErrorResponse({ code: 'invalid_request' }),
      400,
      corsHeaders,
    )
  }

  const bodyRecord = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const operation = bodyRecord.operation

  if (operation === PROVIDER_PROXY_AI_TRIP_DRAFT_OPERATION) {
    return handleAiTripDraftRequest({ body, corsHeaders, env, fetcher, quotaLimits, quotaStore, request })
  }

  if (operation === PROVIDER_PROXY_AI_TRIP_DRAFT_REPAIR_OPERATION) {
    return handleAiTripDraftRepairRequest({ body, corsHeaders, env, fetcher, quotaLimits, quotaStore, request })
  }

  if (operation === PROVIDER_PROXY_AI_TRIP_EDIT_PLAN_OPERATION) {
    return handleAiTripEditPlanRequest({ body, corsHeaders, env, fetcher, quotaLimits, quotaStore, request })
  }

  if (operation === PROVIDER_PROXY_TRAVEL_SEARCH_OPERATION) {
    return handleTravelSearchRequest({ body, corsHeaders, env, quotaLimits, quotaStore, request })
  }

  return handleRoutePreviewRequest({ body, corsHeaders, env, fetcher, quotaLimits, quotaStore, request })
}

async function handleAiTripDraftRequest({
  body,
  corsHeaders,
  env,
  fetcher,
  quotaLimits,
  quotaStore,
  request,
}: {
  body: unknown
  corsHeaders: Record<string, string>
  env: ProviderProxyHandlerEnv
  fetcher: typeof fetch
  quotaLimits?: Partial<ProviderProxyQuotaLimits>
  quotaStore?: ProviderProxyQuotaStore
  request: Request
}): Promise<Response> {
  const validation = validateProviderProxyAiTripDraftRequest(body)
  if (!validation.ok) {
    return jsonResponse(validation.error, 400, corsHeaders)
  }

  const draftRequest = validation.request
  const quota = checkAndConsumeProviderProxyQuota({
    coordinateCount: 0,
    identity: getQuotaIdentity(request, draftRequest.quotaSessionId),
    limits: quotaLimits,
    operation: PROVIDER_PROXY_AI_TRIP_DRAFT_OPERATION,
    store: quotaStore,
  })
  if (!quota.allowed) {
    return jsonResponse(
      buildProviderProxyErrorResponse({
        code: quota.reason === 'rate_limit' ? 'quota_exceeded' : 'invalid_request',
        operation: PROVIDER_PROXY_AI_TRIP_DRAFT_OPERATION,
        requestId: draftRequest.requestId,
      }),
      quota.reason === 'rate_limit' ? 429 : 400,
      corsHeaders,
      quota.resetAt ? { 'Retry-After': String(Math.max(1, Math.ceil((quota.resetAt - Date.now()) / 1000))) } : undefined,
    )
  }

  try {
    const provider = selectAiDraftProvider(env, draftRequest, fetcher)
    const providerInput = buildAiTripDraftProviderInput(draftRequest, draftRequest.requestId)
    const reasoningMode = chooseAiReasoningMode({
      dayCount: listPlainDateRangeInclusive(draftRequest.startDate, draftRequest.endDate).length,
      operation: PROVIDER_PROXY_AI_TRIP_DRAFT_OPERATION,
    })
    const result = await provider.generateDraft({ ...providerInput, reasoningMode })

    if (!result.ok) {
      const status = mapAiDraftErrorCodeToStatus(result.errorCode)
      throw new ProviderProxyServerError(result.errorCode, status)
    }

    if (result.kind === 'draft') {
      return jsonResponse({
        draft: result.draft,
        ok: true,
        operation: PROVIDER_PROXY_AI_TRIP_DRAFT_OPERATION,
        requestId: draftRequest.requestId,
        source: result.source,
        warnings: result.warnings,
      }, 200, corsHeaders)
    }

    const extraction = normalizeAiDraftProviderOutput(result.rawText)
    if (!extraction.ok) {
      throw new ProviderProxyServerError('invalid_response', 502)
    }

    return jsonResponse({
      draft: extraction.draft,
      ok: true,
      operation: PROVIDER_PROXY_AI_TRIP_DRAFT_OPERATION,
      requestId: draftRequest.requestId,
      source: 'future_ai',
    }, 200, corsHeaders)
  } catch (caught) {
    const error = normalizeProviderProxyHandlerError(caught, PROVIDER_PROXY_AI_TRIP_DRAFT_OPERATION, draftRequest.requestId)
    return jsonResponse(error.body, error.status, corsHeaders)
  }
}

function selectAiDraftProvider(
  env: ProviderProxyHandlerEnv,
  request: ProviderProxyAiTripDraftRequest,
  fetchImpl?: typeof fetch,
): AiDraftProvider {
  if (isMockMode(env)) {
    return createMockAiDraftProvider(request)
  }
  if (env.TRIPMAP_AI_PROVIDER === 'openai_compatible') {
    return createOpenAiCompatibleAiDraftProvider(env, request, fetchImpl)
  }
  if (!env.TRIPMAP_AI_PROVIDER_KEY?.trim()) {
    return createUnavailableAiDraftProvider()
  }
  return createDisabledAiDraftProvider()
}

function mapAiDraftErrorCodeToStatus(code: AiDraftProviderErrorCode): number {
  switch (code) {
    case 'provider_unavailable': return 503
    case 'quota_exceeded': return 429
    case 'unsupported': return 501
    case 'network_error': return 502
    case 'provider_error': return 502
    default: return 502
  }
}

async function handleAiTripDraftRepairRequest({
  body,
  corsHeaders,
  env,
  fetcher,
  quotaLimits,
  quotaStore,
  request,
}: {
  body: unknown
  corsHeaders: Record<string, string>
  env: ProviderProxyHandlerEnv
  fetcher: typeof fetch
  quotaLimits?: Partial<ProviderProxyQuotaLimits>
  quotaStore?: ProviderProxyQuotaStore
  request: Request
}): Promise<Response> {
  const validation = validateProviderProxyAiTripDraftRepairRequest(body)
  if (!validation.ok) {
    return jsonResponse(validation.error, 400, corsHeaders)
  }

  const repairRequest = validation.request
  const quota = checkAndConsumeProviderProxyQuota({
    coordinateCount: 0,
    identity: getQuotaIdentity(request, repairRequest.quotaSessionId),
    limits: quotaLimits,
    operation: PROVIDER_PROXY_AI_TRIP_DRAFT_REPAIR_OPERATION,
    store: quotaStore,
  })
  if (!quota.allowed) {
    return jsonResponse(
      buildProviderProxyErrorResponse({
        code: quota.reason === 'rate_limit' ? 'quota_exceeded' : 'invalid_request',
        operation: PROVIDER_PROXY_AI_TRIP_DRAFT_REPAIR_OPERATION,
        requestId: repairRequest.requestId,
      }),
      quota.reason === 'rate_limit' ? 429 : 400,
      corsHeaders,
      quota.resetAt ? { 'Retry-After': String(Math.max(1, Math.ceil((quota.resetAt - Date.now()) / 1000))) } : undefined,
    )
  }

  try {
    const provider = selectAiDraftRepairProvider(env, repairRequest, fetcher)
    const providerInput = buildAiTripDraftRepairProviderInput(repairRequest, repairRequest.requestId)
    const reasoningMode = chooseAiReasoningMode({
      criticalCount: countCriticalFindings(repairRequest.qualityFindings),
      findingCount: repairRequest.qualityFindings.length,
      itemCount: countDraftItems(repairRequest.draft),
      operation: PROVIDER_PROXY_AI_TRIP_DRAFT_REPAIR_OPERATION,
      repairInstructionLength: repairRequest.repairInstruction?.trim().length,
    })
    const result = await provider.repairDraft({ ...providerInput, reasoningMode })

    if (!result.ok) {
      const status = mapAiDraftErrorCodeToStatus(result.errorCode)
      throw new ProviderProxyServerError(result.errorCode, status)
    }

    if (result.kind === 'draft') {
      return jsonResponse({
        draft: result.draft,
        ok: true,
        operation: PROVIDER_PROXY_AI_TRIP_DRAFT_REPAIR_OPERATION,
        requestId: repairRequest.requestId,
        source: result.source,
        warnings: result.warnings,
      }, 200, corsHeaders)
    }

    const extraction = normalizeAiDraftProviderOutput(result.rawText)
    if (!extraction.ok) {
      throw new ProviderProxyServerError('invalid_response', 502)
    }

    return jsonResponse({
      draft: extraction.draft,
      ok: true,
      operation: PROVIDER_PROXY_AI_TRIP_DRAFT_REPAIR_OPERATION,
      requestId: repairRequest.requestId,
      source: 'future_ai',
    }, 200, corsHeaders)
  } catch (caught) {
    const error = normalizeProviderProxyHandlerError(caught, PROVIDER_PROXY_AI_TRIP_DRAFT_REPAIR_OPERATION, repairRequest.requestId)
    return jsonResponse(error.body, error.status, corsHeaders)
  }
}

function selectAiDraftRepairProvider(
  env: ProviderProxyHandlerEnv,
  request: ProviderProxyAiTripDraftRepairRequest,
  fetchImpl?: typeof fetch,
): AiDraftRepairProvider {
  if (isMockMode(env)) {
    return createMockAiDraftRepairProvider(request)
  }
  if (env.TRIPMAP_AI_PROVIDER === 'openai_compatible') {
    return createOpenAiCompatibleAiDraftRepairProvider(env, fetchImpl)
  }
  if (!env.TRIPMAP_AI_PROVIDER_KEY?.trim()) {
    return createUnavailableAiDraftRepairProvider()
  }
  return createDisabledAiDraftRepairProvider()
}

function countDraftItems(draft: AiTripDraft): number {
  return draft.days.reduce((total, day) => total + day.items.length, 0)
}

function countCriticalFindings(findings: ProviderProxyAiTripDraftRepairRequest['qualityFindings']): number {
  return findings.filter((finding) => finding.severity === 'critical').length
}

async function handleAiTripEditPlanRequest({
  body,
  corsHeaders,
  env,
  fetcher,
  quotaLimits,
  quotaStore,
  request,
}: {
  body: unknown
  corsHeaders: Record<string, string>
  env: ProviderProxyHandlerEnv
  fetcher: typeof fetch
  quotaLimits?: Partial<ProviderProxyQuotaLimits>
  quotaStore?: ProviderProxyQuotaStore
  request: Request
}): Promise<Response> {
  const validation = validateProviderProxyAiTripEditPlanRequest(body)
  if (!validation.ok) {
    return jsonResponse(validation.error, 400, corsHeaders)
  }

  const editRequest = validation.request
  const quota = checkAndConsumeProviderProxyQuota({
    coordinateCount: 0,
    identity: getQuotaIdentity(request, editRequest.quotaSessionId),
    limits: quotaLimits,
    operation: PROVIDER_PROXY_AI_TRIP_EDIT_PLAN_OPERATION,
    store: quotaStore,
  })
  if (!quota.allowed) {
    return jsonResponse(
      buildProviderProxyErrorResponse({
        code: quota.reason === 'rate_limit' ? 'quota_exceeded' : 'invalid_request',
        operation: PROVIDER_PROXY_AI_TRIP_EDIT_PLAN_OPERATION,
        requestId: editRequest.requestId,
      }),
      quota.reason === 'rate_limit' ? 429 : 400,
      corsHeaders,
      quota.resetAt ? { 'Retry-After': String(Math.max(1, Math.ceil((quota.resetAt - Date.now()) / 1000))) } : undefined,
    )
  }

  try {
    const provider = selectAiTripEditProvider(env, editRequest, fetcher)
    const providerInput = buildAiTripEditProviderInput(editRequest, editRequest.requestId)
    const reasoningMode = chooseAiReasoningMode({
      editCommandLength: editRequest.command.length,
      itemCount: countEditContextItems(editRequest),
      operation: PROVIDER_PROXY_AI_TRIP_EDIT_PLAN_OPERATION,
    })
    const result = await provider.planEdit({ ...providerInput, reasoningMode })

    if (!result.ok) {
      throw new ProviderProxyServerError(result.errorCode, mapAiTripEditErrorCodeToStatus(result.errorCode))
    }

    if (result.kind === 'patch') {
      return jsonResponse({
        ok: true,
        operation: PROVIDER_PROXY_AI_TRIP_EDIT_PLAN_OPERATION,
        patchPlan: result.patchPlan,
        requestId: editRequest.requestId,
        source: result.source,
        warnings: result.warnings,
      }, 200, corsHeaders)
    }

    const extracted = extractJsonFromAiText(result.rawText)
    if (!extracted) {
      throw new ProviderProxyServerError('invalid_response', 502)
    }
    const patchValidation = validateAiTripEditPatchPlan(extracted, editRequest.context)
    if (!patchValidation.ok) {
      throw new ProviderProxyServerError('invalid_response', 502)
    }

    return jsonResponse({
      ok: true,
      operation: PROVIDER_PROXY_AI_TRIP_EDIT_PLAN_OPERATION,
      patchPlan: patchValidation.plan,
      requestId: editRequest.requestId,
      source: 'future_ai',
    }, 200, corsHeaders)
  } catch (caught) {
    const error = normalizeProviderProxyHandlerError(caught, PROVIDER_PROXY_AI_TRIP_EDIT_PLAN_OPERATION, editRequest.requestId)
    return jsonResponse(error.body, error.status, corsHeaders)
  }
}

function selectAiTripEditProvider(
  env: ProviderProxyHandlerEnv,
  request: ProviderProxyAiTripEditPlanRequest,
  fetchImpl?: typeof fetch,
): AiTripEditProvider {
  if (isMockMode(env)) {
    return createMockAiTripEditProvider(request)
  }
  if (env.TRIPMAP_AI_PROVIDER === 'openai_compatible') {
    return createOpenAiCompatibleAiTripEditProvider(env, fetchImpl)
  }
  if (!env.TRIPMAP_AI_PROVIDER_KEY?.trim()) {
    return createUnavailableAiTripEditProvider()
  }
  return createDisabledAiTripEditProvider()
}

function countEditContextItems(request: ProviderProxyAiTripEditPlanRequest): number {
  return request.context.days.reduce((total, day) => total + day.items.length, 0)
}

function mapAiTripEditErrorCodeToStatus(code: AiTripEditProviderErrorCode): number {
  switch (code) {
    case 'provider_unavailable': return 503
    case 'quota_exceeded': return 429
    case 'unsupported': return 501
    case 'network_error': return 502
    case 'provider_error': return 502
    default: return 502
  }
}

async function handleTravelSearchRequest({
  body,
  corsHeaders,
  env,
  quotaLimits,
  quotaStore,
  request,
}: {
  body: unknown
  corsHeaders: Record<string, string>
  env: ProviderProxyHandlerEnv
  quotaLimits?: Partial<ProviderProxyQuotaLimits>
  quotaStore?: ProviderProxyQuotaStore
  request: Request
}): Promise<Response> {
  const validation = validateProviderProxyTravelSearchRequest(body)
  if (!validation.ok) {
    return jsonResponse(validation.error, 400, corsHeaders)
  }

  const searchRequest = validation.request
  const quota = checkAndConsumeProviderProxyQuota({
    coordinateCount: 0,
    identity: getQuotaIdentity(request, searchRequest.quotaSessionId),
    limits: quotaLimits,
    operation: PROVIDER_PROXY_TRAVEL_SEARCH_OPERATION,
    store: quotaStore,
  })
  if (!quota.allowed) {
    return jsonResponse(
      buildProviderProxyErrorResponse({
        code: quota.reason === 'rate_limit' ? 'quota_exceeded' : 'invalid_request',
        operation: PROVIDER_PROXY_TRAVEL_SEARCH_OPERATION,
        requestId: searchRequest.requestId,
      }),
      quota.reason === 'rate_limit' ? 429 : 400,
      corsHeaders,
      quota.resetAt ? { 'Retry-After': String(Math.max(1, Math.ceil((quota.resetAt - Date.now()) / 1000))) } : undefined,
    )
  }

  try {
    const provider = selectTravelSearchProvider(env)
    const result = await provider.search(searchRequest)
    if (!result.ok) {
      throw new ProviderProxyServerError(result.errorCode, mapTravelSearchErrorCodeToStatus(result.errorCode))
    }
    return jsonResponse(result.response, 200, corsHeaders)
  } catch (caught) {
    const error = normalizeProviderProxyHandlerError(caught, PROVIDER_PROXY_TRAVEL_SEARCH_OPERATION, searchRequest.requestId)
    return jsonResponse(error.body, error.status, corsHeaders)
  }
}

function selectTravelSearchProvider(env: ProviderProxyHandlerEnv): TravelSearchProvider {
  if (isMockMode(env)) {
    return createMockTravelSearchProvider()
  }
  return createUnavailableTravelSearchProvider()
}

function mapTravelSearchErrorCodeToStatus(code: TravelSearchProviderErrorCode): number {
  switch (code) {
    case 'provider_unavailable': return 503
    case 'unsupported': return 501
    case 'network_error': return 502
    case 'provider_error': return 502
    default: return 502
  }
}

async function handleRoutePreviewRequest({
  body,
  corsHeaders,
  env,
  fetcher,
  quotaLimits,
  quotaStore,
  request,
}: {
  body: unknown
  corsHeaders: Record<string, string>
  env: ProviderProxyHandlerEnv
  fetcher: typeof fetch
  quotaLimits?: Partial<ProviderProxyQuotaLimits>
  quotaStore?: ProviderProxyQuotaStore
  request: Request
}): Promise<Response> {
  const validation = validateProviderProxyRoutePreviewRequest(body)
  if (!validation.ok) {
    return jsonResponse(validation.error, 400, corsHeaders)
  }

  const routeRequest = validation.request
  const quota = checkAndConsumeProviderProxyQuota({
    coordinateCount: routeRequest.coordinates.length,
    identity: getQuotaIdentity(request, routeRequest.quotaSessionId),
    limits: quotaLimits,
    operation: PROVIDER_PROXY_ROUTE_PREVIEW_OPERATION,
    store: quotaStore,
  })
  if (!quota.allowed) {
    return jsonResponse(
      buildProviderProxyErrorResponse({
        code: quota.reason === 'rate_limit' ? 'quota_exceeded' : 'invalid_request',
        operation: PROVIDER_PROXY_ROUTE_PREVIEW_OPERATION,
        requestId: routeRequest.requestId,
      }),
      quota.reason === 'rate_limit' ? 429 : 400,
      corsHeaders,
      quota.resetAt ? { 'Retry-After': String(Math.max(1, Math.ceil((quota.resetAt - Date.now()) / 1000))) } : undefined,
    )
  }

  try {
    const provider = selectProvider(routeRequest, env)
    if (isMockMode(env)) {
      return jsonResponse(buildMockRoutePreviewResponse(routeRequest, provider), 200, corsHeaders)
    }

    const apiKey = getProviderSecret(provider, env)
    if (!apiKey) {
      throw new ProviderProxyServerError('provider_unavailable', 503, provider)
    }

    const response = await fetchRoutePreviewFromProvider({
      apiKey,
      fetcher,
      provider,
      request: routeRequest,
    })
    return jsonResponse(response, 200, corsHeaders)
  } catch (caught) {
    const error = normalizeProviderProxyHandlerError(caught, PROVIDER_PROXY_ROUTE_PREVIEW_OPERATION, routeRequest.requestId)
    return jsonResponse(error.body, error.status, corsHeaders)
  }
}

async function fetchRoutePreviewFromProvider({
  apiKey,
  fetcher,
  provider,
  request,
}: {
  apiKey: string
  fetcher: typeof fetch
  provider: ProviderProxyConcreteProvider
  request: ProviderProxyRoutePreviewRequest
}): Promise<ProviderProxyRoutePreviewSuccessResponse> {
  const segments = provider === 'openrouteservice'
    ? await fetchOpenRouteServiceSegments(request, apiKey, fetcher)
    : await fetchGoogleRouteSegments(request, apiKey, fetcher)

  return buildRoutePreviewSuccessResponse(request, provider, segments)
}

async function fetchOpenRouteServiceSegments(
  request: ProviderProxyRoutePreviewRequest,
  apiKey: string,
  fetcher: typeof fetch,
): Promise<ProviderProxyRouteSegment[]> {
  const segments: ProviderProxyRouteSegment[] = []
  for (const segment of request.segments) {
    const from = request.coordinates[segment.fromCoordinateIndex]
    const to = request.coordinates[segment.toCoordinateIndex]
    let response: Response
    try {
      response = await fetcher(`${OPENROUTESERVICE_ENDPOINT}/${segment.profile}/geojson`, {
        body: JSON.stringify({ coordinates: [from, to] }),
        headers: {
          Authorization: apiKey,
          'Content-Type': 'application/json',
        },
        method: 'POST',
      })
    } catch {
      throw new ProviderProxyServerError('network_error', 502, 'openrouteservice')
    }

    if (!response.ok) {
      throw mapProviderStatusToError(response.status, 'openrouteservice')
    }

    const data = await readProviderJson(response, 'openrouteservice')
    const parsed = parseOpenRouteServiceGeoJson(data)
    segments.push({
      coordinates: parsed.coordinates,
      distanceMeters: parsed.distanceMeters,
      durationSeconds: parsed.durationSeconds,
      fromItemId: segment.fromItemId,
      kind: 'road',
      segmentIndex: segment.segmentIndex,
      toItemId: segment.toItemId,
    })
  }
  return segments
}

async function fetchGoogleRouteSegments(
  request: ProviderProxyRoutePreviewRequest,
  apiKey: string,
  fetcher: typeof fetch,
): Promise<ProviderProxyRouteSegment[]> {
  const segments: ProviderProxyRouteSegment[] = []
  for (const segment of request.segments) {
    const from = request.coordinates[segment.fromCoordinateIndex]
    const to = request.coordinates[segment.toCoordinateIndex]
    let response: Response
    try {
      response = await fetcher(GOOGLE_ROUTES_ENDPOINT, {
        body: JSON.stringify({
          destination: { location: { latLng: { latitude: to[1], longitude: to[0] } } },
          origin: { location: { latLng: { latitude: from[1], longitude: from[0] } } },
          routingPreference: 'TRAFFIC_UNAWARE',
          travelMode: mapGoogleTravelMode(segment.mode),
        }),
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline',
        },
        method: 'POST',
      })
    } catch {
      throw new ProviderProxyServerError('network_error', 502, 'google')
    }

    if (!response.ok) {
      throw mapProviderStatusToError(response.status, 'google')
    }

    const data = await readProviderJson(response, 'google')
    const parsed = parseGoogleRouteResponse(data)
    segments.push({
      coordinates: parsed.coordinates,
      distanceMeters: parsed.distanceMeters,
      durationSeconds: parsed.durationSeconds,
      fromItemId: segment.fromItemId,
      kind: 'road',
      segmentIndex: segment.segmentIndex,
      toItemId: segment.toItemId,
    })
  }
  return segments
}

function buildRoutePreviewSuccessResponse(
  request: ProviderProxyRoutePreviewRequest,
  provider: ProviderProxyConcreteProvider,
  segments: ProviderProxyRouteSegment[],
): ProviderProxyRoutePreviewSuccessResponse {
  return {
    ok: true,
    operation: PROVIDER_PROXY_ROUTE_PREVIEW_OPERATION,
    provider,
    requestId: request.requestId,
    route: {
      distanceMeters: sumOptional(segments.map((segment) => segment.distanceMeters)),
      durationSeconds: sumOptional(segments.map((segment) => segment.durationSeconds)),
      lineStrings: segments.map((segment) => segment.coordinates),
      segments,
      status: segments.length > 0 ? 'road' : 'failed',
      warnings: [],
    },
  }
}

function buildMockRoutePreviewResponse(
  request: ProviderProxyRoutePreviewRequest,
  provider: ProviderProxyConcreteProvider,
): ProviderProxyRoutePreviewSuccessResponse {
  const segments = request.segments.map((segment) => {
    const from = request.coordinates[segment.fromCoordinateIndex]
    const to = request.coordinates[segment.toCoordinateIndex]
    return {
      coordinates: [from, to],
      distanceMeters: estimateDistanceMeters(from, to),
      durationSeconds: Math.max(60, Math.round(estimateDistanceMeters(from, to) / 8)),
      fromItemId: segment.fromItemId,
      kind: 'road' as const,
      segmentIndex: segment.segmentIndex,
      toItemId: segment.toItemId,
    }
  })
  return buildRoutePreviewSuccessResponse(request, provider, segments)
}

function selectProvider(
  request: ProviderProxyRoutePreviewRequest,
  env: ProviderProxyHandlerEnv,
): ProviderProxyConcreteProvider {
  if (isProviderProxyConcreteProvider(request.provider)) {
    return request.provider
  }
  if (env.OPENROUTESERVICE_API_KEY || isMockMode(env)) {
    return 'openrouteservice'
  }
  if (env.GOOGLE_ROUTES_API_KEY) {
    return 'google'
  }
  throw new ProviderProxyServerError('provider_unavailable', 503)
}

function getProviderSecret(provider: ProviderProxyConcreteProvider, env: ProviderProxyHandlerEnv) {
  return provider === 'google' ? env.GOOGLE_ROUTES_API_KEY?.trim() : env.OPENROUTESERVICE_API_KEY?.trim()
}

function normalizeProviderProxyHandlerError(
  caught: unknown,
  operation: ProviderProxyOperation,
  requestId?: string,
) {
  if (caught instanceof ProviderProxyServerError) {
    return {
      body: buildProviderProxyErrorResponse({
        code: caught.code,
        operation,
        provider: caught.provider,
        requestId,
      }),
      status: caught.status,
    }
  }

  return {
    body: buildProviderProxyErrorResponse({
      code: 'provider_error',
      operation,
      requestId,
    }),
    status: 502,
  }
}

function mapProviderStatusToError(status: number, provider: ProviderProxyConcreteProvider) {
  if (status === 429) {
    return new ProviderProxyServerError('quota_exceeded', 429, provider)
  }
  if (status === 401 || status === 403 || status >= 500) {
    return new ProviderProxyServerError('provider_unavailable', 503, provider)
  }
  return new ProviderProxyServerError('provider_error', 502, provider)
}

async function readProviderJson(response: Response, provider: ProviderProxyConcreteProvider) {
  try {
    return await response.json()
  } catch {
    throw new ProviderProxyServerError('provider_error', 502, provider)
  }
}

function parseOpenRouteServiceGeoJson(input: unknown): {
  coordinates: LngLat[]
  distanceMeters?: number
  durationSeconds?: number
} {
  const features = readRecord(input).features
  const feature = Array.isArray(features) ? features[0] : null
  const geometry = readRecord(feature).geometry
  const coordinates = readRecord(geometry).coordinates
  if (!Array.isArray(coordinates)) {
    throw new ProviderProxyServerError('provider_error', 502, 'openrouteservice')
  }

  const parsedCoordinates = coordinates.flatMap((coordinate) => {
    const lngLat = normalizeLngLat(coordinate)
    return lngLat ? [lngLat] : []
  })
  if (parsedCoordinates.length < 2) {
    throw new ProviderProxyServerError('provider_error', 502, 'openrouteservice')
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

function parseGoogleRouteResponse(input: unknown): {
  coordinates: LngLat[]
  distanceMeters?: number
  durationSeconds?: number
} {
  const routes = readRecord(input).routes
  const route = Array.isArray(routes) ? readRecord(routes[0]) : {}
  const polyline = readRecord(route.polyline).encodedPolyline
  if (typeof polyline !== 'string') {
    throw new ProviderProxyServerError('provider_error', 502, 'google')
  }
  const coordinates = decodeGooglePolyline(polyline)
  if (coordinates.length < 2) {
    throw new ProviderProxyServerError('provider_error', 502, 'google')
  }
  const durationSeconds = typeof route.duration === 'string'
    ? Number.parseFloat(route.duration.replace('s', ''))
    : undefined
  return {
    coordinates,
    distanceMeters: typeof route.distanceMeters === 'number' ? route.distanceMeters : undefined,
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : undefined,
  }
}

function decodeGooglePolyline(encoded: string): LngLat[] {
  const coordinates: LngLat[] = []
  let lat = 0
  let lng = 0
  let index = 0

  while (index < encoded.length) {
    let shift = 0
    let result = 0
    let byte: number
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    lat += (result & 1) ? ~(result >> 1) : (result >> 1)

    shift = 0
    result = 0
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    lng += (result & 1) ? ~(result >> 1) : (result >> 1)

    coordinates.push([lng / 1e5, lat / 1e5])
  }

  return coordinates
}

function normalizeLngLat(input: unknown): LngLat | null {
  if (!Array.isArray(input) || input.length < 2) {
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

function mapGoogleTravelMode(mode: string) {
  if (mode === 'walk') return 'WALK'
  if (mode === 'bus' || mode === 'train' || mode === 'transit' || mode === 'subway') return 'TRANSIT'
  if (mode === 'cycling') return 'BICYCLE'
  return 'DRIVE'
}

function getQuotaIdentity(request: Request, quotaSessionId?: string) {
  const ip = request.headers.get('CF-Connecting-IP') ?? request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
  return [
    quotaSessionId ?? 'no-session',
    ip ?? 'no-ip',
  ].join('|')
}

function getCorsHeaders(request: Request, env: ProviderProxyHandlerEnv): Record<string, string> {
  const origin = request.headers.get('Origin')
  if (!origin) {
    return {}
  }

  const allowedOrigins = parseAllowedOrigins(env.TRIPMAP_PROVIDER_PROXY_ALLOWED_ORIGINS)
  if (!allowedOrigins.has(origin) && !allowedOrigins.has('*')) {
    return {}
  }

  return {
    'Access-Control-Allow-Origin': allowedOrigins.has('*') ? '*' : origin,
    'Vary': 'Origin',
  }
}

function parseAllowedOrigins(value?: string) {
  return new Set((value ?? '').split(',').map((origin) => origin.trim()).filter(Boolean))
}

function isJsonContentType(value: string | null) {
  return value?.toLowerCase().split(';')[0].trim() === 'application/json'
}

function isMockMode(env: ProviderProxyHandlerEnv) {
  return env.TRIPMAP_PROVIDER_PROXY_MOCK === '1' || env.TRIPMAP_PROVIDER_PROXY_MOCK === 'true'
}

function jsonResponse(
  body: unknown,
  status: number,
  corsHeaders: Record<string, string>,
  extraHeaders: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    headers: {
      ...corsHeaders,
      ...extraHeaders,
      'Content-Type': 'application/json; charset=utf-8',
    },
    status,
  })
}

function estimateDistanceMeters(first: LngLat, second: LngLat) {
  const latScale = 111_320
  const lngScale = 111_320 * Math.cos(((first[1] + second[1]) / 2) * Math.PI / 180)
  return Math.round(Math.hypot((first[0] - second[0]) * lngScale, (first[1] - second[1]) * latScale))
}

function sumOptional(values: Array<number | undefined>) {
  const present = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return present.length ? present.reduce((sum, value) => sum + value, 0) : undefined
}

function readRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? input as Record<string, unknown> : {}
}

class ProviderProxyServerError extends Error {
  readonly code: ProviderProxyErrorCode
  readonly provider?: ProviderProxyConcreteProvider
  readonly status: number

  constructor(code: ProviderProxyErrorCode, status: number, provider?: ProviderProxyConcreteProvider) {
    super(defaultProviderProxyErrorMessage(code))
    this.name = 'ProviderProxyServerError'
    this.code = code
    this.provider = provider
    this.status = status
  }
}
