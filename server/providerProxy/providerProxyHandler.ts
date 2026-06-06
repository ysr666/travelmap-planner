import {
  PROVIDER_PROXY_AI_TRIP_DRAFT_OPERATION,
  PROVIDER_PROXY_AI_TRIP_DRAFT_REPAIR_OPERATION,
  PROVIDER_PROXY_AI_TRIP_DRAFT_REFINE_OPERATION,
  PROVIDER_PROXY_AI_EXISTING_TRIP_IMPORT_OPERATION,
  PROVIDER_PROXY_AI_TRIP_EDIT_PLAN_OPERATION,
  PROVIDER_PROXY_PLACE_DETAILS_OPERATION,
  PROVIDER_PROXY_PLACE_LOOKUP_OPERATION,
  PROVIDER_PROXY_ROUTE_ORDER_SUGGESTION_OPERATION,
  PROVIDER_PROXY_ROUTE_PREVIEW_OPERATION,
  PROVIDER_PROXY_TRIP_CONTENT_ENRICHMENT_OPERATION,
  PROVIDER_PROXY_TRIP_DAILY_TIP_OPERATION,
  PROVIDER_PROXY_TRAVEL_SEARCH_OPERATION,
  buildProviderProxyErrorResponse,
  defaultProviderProxyErrorMessage,
  isProviderProxyConcreteProvider,
  validateProviderProxyAiTripDraftRequest,
  validateProviderProxyAiTripDraftRepairRequest,
  validateProviderProxyAiTripDraftRefineRequest,
  validateProviderProxyExistingTripImportRequest,
  validateProviderProxyAiTripEditPlanRequest,
  validateProviderProxyPlaceDetailsRequest,
  validateProviderProxyPlaceLookupRequest,
  validateProviderProxyTripContentEnrichmentRequest,
  validateProviderProxyTripDailyTipRequest,
  validateProviderProxyRouteOrderSuggestionRequest,
  validateProviderProxyTravelSearchRequest,
  type ProviderProxyAiTripDraftRequest,
  type ProviderProxyAiTripDraftRepairRequest,
  type ProviderProxyAiTripDraftRefineRequest,
  type ProviderProxyAiTripDraftRefineScope,
  type ProviderProxyExistingTripImportRequest,
  type ProviderProxyAiTripEditPlanRequest,
  type ProviderProxyConcreteProvider,
  type ProviderProxyErrorCode,
  type ProviderProxyOperation,
  type ProviderProxyRouteOrderSuggestionRequest,
  type ProviderProxyRouteOrderSuggestionSuccessResponse,
  type ProviderProxyRoutePreviewRequest,
  type ProviderProxyRoutePreviewSuccessResponse,
  type ProviderProxyRouteSegment,
  validateProviderProxyRoutePreviewRequest,
} from '../../src/lib/ai/providerProxyContract'
import { validateAiTripEditPatchPlan } from '../../src/lib/ai/aiTripEditPatch'
import type { LngLat } from '../../src/lib/routing'
import type { AiTripDraft } from '../../src/lib/ai/aiTripDraft'
import { listPlainDateRangeInclusive } from '../../src/lib/plainDate'
import {
  consumeProviderProxyQuota,
  selectProviderProxyQuotaStorage,
  type ProviderProxyQuotaHasher,
  type ProviderProxyQuotaLimits,
  type ProviderProxyQuotaStorage,
} from './quotaGuard'
import { buildAiTripDraftProviderInput } from './aiDraftPrompt'
import { buildAiTripDraftRepairProviderInput } from './aiDraftRepairPrompt'
import { buildAiTripDraftRefineProviderInput } from './aiDraftRefinePrompt'
import { buildAiTripEditProviderInput } from './aiTripEditPrompt'
import {
  createDisabledAiDraftProvider,
  createDisabledAiDraftRepairProvider,
  createDisabledAiDraftRefineProvider,
  createMockAiDraftProvider,
  createMockAiDraftRepairProvider,
  createMockAiDraftRefineProvider,
  createOpenAiCompatibleAiDraftProvider,
  createOpenAiCompatibleAiDraftRepairProvider,
  createOpenAiCompatibleAiDraftRefineProvider,
  createUnavailableAiDraftProvider,
  createUnavailableAiDraftRepairProvider,
  createUnavailableAiDraftRefineProvider,
  type AiDraftProvider,
  type AiDraftProviderErrorCode,
  type AiDraftRefineProvider,
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
  createDisabledTravelSearchProvider,
  createMockTravelSearchProvider,
  createTavilyTravelSearchProvider,
  createUnavailableTravelSearchProvider,
  type TravelSearchProvider,
  type TravelSearchProviderErrorCode,
} from './searchProvider'
import {
  createDisabledPlaceLookupProvider,
  createGooglePlacesLookupProvider,
  createMockPlaceLookupProvider,
  createUnavailablePlaceLookupProvider,
  getGooglePlacesApiKey,
  type PlaceLookupProvider,
  type PlaceLookupProviderErrorCode,
} from './placeLookupProvider'
import {
  createDisabledPlaceDetailsProvider,
  createGooglePlacesDetailsProvider,
  createMockPlaceDetailsProvider,
  createUnavailablePlaceDetailsProvider,
  type PlaceDetailsProvider,
  type PlaceDetailsProviderErrorCode,
} from './placeDetailsProvider'
import {
  buildTripContentEnrichmentProviderInput,
  createDisabledTripContentEnrichmentProvider,
  createMockTripContentEnrichmentProvider,
  createOpenAiCompatibleTripContentEnrichmentProvider,
  createUnavailableTripContentEnrichmentProvider,
  type TripContentEnrichmentProvider,
  type TripContentEnrichmentProviderErrorCode,
} from './tripContentEnrichmentProvider'
import {
  buildTripDailyTipProviderInput,
  createDisabledTripDailyTipProvider,
  createMockTripDailyTipProvider,
  createOpenAiCompatibleTripDailyTipProvider,
  createUnavailableTripDailyTipProvider,
  type TripDailyTipProvider,
  type TripDailyTipProviderErrorCode,
} from './tripDailyTipProvider'
import {
  buildExistingTripImportProviderInput,
  createDisabledExistingTripImportProvider,
  createMockExistingTripImportProvider,
  createOpenAiCompatibleExistingTripImportProvider,
  createUnavailableExistingTripImportProvider,
  type ExistingTripImportProvider,
  type ExistingTripImportProviderErrorCode,
} from './existingTripImportProvider'

export type ProviderProxyHandlerEnv = {
  [key: string]: unknown
  GOOGLE_MAPS_PLATFORM_API_KEY?: string
  GOOGLE_ROUTES_API_KEY?: string
  OPENROUTESERVICE_API_KEY?: string
  VITE_GOOGLE_MAPS_API_KEY?: string
  TRIPMAP_AI_PROVIDER?: string
  TRIPMAP_AI_API_KEY?: string
  TRIPMAP_AI_BASE_URL?: string
  TRIPMAP_AI_MODEL?: string
  TRIPMAP_AI_PROVIDER_KEY?: string
  TRIPMAP_PROVIDER_PROXY_ALLOWED_ORIGINS?: string
  TRIPMAP_PROVIDER_PROXY_MOCK?: string
  TRIPMAP_GOOGLE_PLACES_API_KEY?: string
  TRIPMAP_PLACE_PROVIDER?: string
  TRIPMAP_PROVIDER_QUOTA_D1?: unknown
  TRIPMAP_SEARCH_API_KEY?: string
  TRIPMAP_SEARCH_PROVIDER?: string
}

export type ProviderProxyHandlerInput = {
  env?: ProviderProxyHandlerEnv
  fetcher?: typeof fetch
  quotaHasher?: ProviderProxyQuotaHasher
  quotaLimits?: Partial<ProviderProxyQuotaLimits>
  quotaStorage?: ProviderProxyQuotaStorage
  request: Request
}

const OPENROUTESERVICE_ENDPOINT = 'https://api.openrouteservice.org/v2/directions'
const GOOGLE_ROUTES_ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes'
const GOOGLE_ROUTE_ORDER_FIELD_MASK = 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.optimizedIntermediateWaypointIndex'

export async function handleProviderProxyRequest({
  env = {},
  fetcher = fetch,
  quotaHasher,
  quotaLimits,
  quotaStorage,
  request,
}: ProviderProxyHandlerInput): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env)
  const selectedQuotaStorage = quotaStorage ?? selectProviderProxyQuotaStorage(env)

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
    return handleAiTripDraftRequest({ body, corsHeaders, env, fetcher, quotaHasher, quotaLimits, quotaStorage: selectedQuotaStorage, request })
  }

  if (operation === PROVIDER_PROXY_AI_TRIP_DRAFT_REPAIR_OPERATION) {
    return handleAiTripDraftRepairRequest({ body, corsHeaders, env, fetcher, quotaHasher, quotaLimits, quotaStorage: selectedQuotaStorage, request })
  }

  if (operation === PROVIDER_PROXY_AI_TRIP_DRAFT_REFINE_OPERATION) {
    return handleAiTripDraftRefineRequest({ body, corsHeaders, env, fetcher, quotaHasher, quotaLimits, quotaStorage: selectedQuotaStorage, request })
  }

  if (operation === PROVIDER_PROXY_AI_TRIP_EDIT_PLAN_OPERATION) {
    return handleAiTripEditPlanRequest({ body, corsHeaders, env, fetcher, quotaHasher, quotaLimits, quotaStorage: selectedQuotaStorage, request })
  }

  if (operation === PROVIDER_PROXY_AI_EXISTING_TRIP_IMPORT_OPERATION) {
    return handleExistingTripImportRequest({ body, corsHeaders, env, fetcher, quotaHasher, quotaLimits, quotaStorage: selectedQuotaStorage, request })
  }

  if (operation === PROVIDER_PROXY_TRAVEL_SEARCH_OPERATION) {
    return handleTravelSearchRequest({ body, corsHeaders, env, fetcher, quotaHasher, quotaLimits, quotaStorage: selectedQuotaStorage, request })
  }

  if (operation === PROVIDER_PROXY_PLACE_LOOKUP_OPERATION) {
    return handlePlaceLookupRequest({ body, corsHeaders, env, fetcher, quotaHasher, quotaLimits, quotaStorage: selectedQuotaStorage, request })
  }

  if (operation === PROVIDER_PROXY_PLACE_DETAILS_OPERATION) {
    return handlePlaceDetailsRequest({ body, corsHeaders, env, fetcher, quotaHasher, quotaLimits, quotaStorage: selectedQuotaStorage, request })
  }

  if (operation === PROVIDER_PROXY_TRIP_CONTENT_ENRICHMENT_OPERATION) {
    return handleTripContentEnrichmentRequest({ body, corsHeaders, env, fetcher, quotaHasher, quotaLimits, quotaStorage: selectedQuotaStorage, request })
  }

  if (operation === PROVIDER_PROXY_TRIP_DAILY_TIP_OPERATION) {
    return handleTripDailyTipRequest({ body, corsHeaders, env, fetcher, quotaHasher, quotaLimits, quotaStorage: selectedQuotaStorage, request })
  }

  if (operation === PROVIDER_PROXY_ROUTE_ORDER_SUGGESTION_OPERATION) {
    return handleRouteOrderSuggestionRequest({ body, corsHeaders, env, fetcher, quotaHasher, quotaLimits, quotaStorage: selectedQuotaStorage, request })
  }

  return handleRoutePreviewRequest({ body, corsHeaders, env, fetcher, quotaHasher, quotaLimits, quotaStorage: selectedQuotaStorage, request })
}

async function handleAiTripDraftRequest({
  body,
  corsHeaders,
  env,
  fetcher,
  quotaHasher,
  quotaLimits,
  quotaStorage,
  request,
}: {
  body: unknown
  corsHeaders: Record<string, string>
  env: ProviderProxyHandlerEnv
  fetcher: typeof fetch
  quotaHasher?: ProviderProxyQuotaHasher
  quotaLimits?: Partial<ProviderProxyQuotaLimits>
  quotaStorage: ProviderProxyQuotaStorage
  request: Request
}): Promise<Response> {
  const validation = validateProviderProxyAiTripDraftRequest(body)
  if (!validation.ok) {
    return jsonResponse(validation.error, 400, corsHeaders)
  }

  const draftRequest = validation.request
  const quotaResponse = await consumeQuotaOrBuildErrorResponse({
    coordinateCount: 0,
    corsHeaders,
    operation: PROVIDER_PROXY_AI_TRIP_DRAFT_OPERATION,
    quotaHasher,
    quotaLimits,
    quotaSessionId: draftRequest.quotaSessionId,
    quotaStorage,
    request,
    requestId: draftRequest.requestId,
  })
  if (quotaResponse) {
    return quotaResponse
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
  quotaHasher,
  quotaLimits,
  quotaStorage,
  request,
}: {
  body: unknown
  corsHeaders: Record<string, string>
  env: ProviderProxyHandlerEnv
  fetcher: typeof fetch
  quotaHasher?: ProviderProxyQuotaHasher
  quotaLimits?: Partial<ProviderProxyQuotaLimits>
  quotaStorage: ProviderProxyQuotaStorage
  request: Request
}): Promise<Response> {
  const validation = validateProviderProxyAiTripDraftRepairRequest(body)
  if (!validation.ok) {
    return jsonResponse(validation.error, 400, corsHeaders)
  }

  const repairRequest = validation.request
  const quotaResponse = await consumeQuotaOrBuildErrorResponse({
    coordinateCount: 0,
    corsHeaders,
    operation: PROVIDER_PROXY_AI_TRIP_DRAFT_REPAIR_OPERATION,
    quotaHasher,
    quotaLimits,
    quotaSessionId: repairRequest.quotaSessionId,
    quotaStorage,
    request,
    requestId: repairRequest.requestId,
  })
  if (quotaResponse) {
    return quotaResponse
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

async function handleAiTripDraftRefineRequest({
  body,
  corsHeaders,
  env,
  fetcher,
  quotaHasher,
  quotaLimits,
  quotaStorage,
  request,
}: {
  body: unknown
  corsHeaders: Record<string, string>
  env: ProviderProxyHandlerEnv
  fetcher: typeof fetch
  quotaHasher?: ProviderProxyQuotaHasher
  quotaLimits?: Partial<ProviderProxyQuotaLimits>
  quotaStorage: ProviderProxyQuotaStorage
  request: Request
}): Promise<Response> {
  const validation = validateProviderProxyAiTripDraftRefineRequest(body)
  if (!validation.ok) {
    return jsonResponse(validation.error, 400, corsHeaders)
  }

  const refineRequest = validation.request
  const quotaResponse = await consumeQuotaOrBuildErrorResponse({
    coordinateCount: 0,
    corsHeaders,
    operation: PROVIDER_PROXY_AI_TRIP_DRAFT_REFINE_OPERATION,
    quotaHasher,
    quotaLimits,
    quotaSessionId: refineRequest.quotaSessionId,
    quotaStorage,
    request,
    requestId: refineRequest.requestId,
  })
  if (quotaResponse) {
    return quotaResponse
  }

  try {
    const provider = selectAiDraftRefineProvider(env, refineRequest, fetcher)
    const providerInput = buildAiTripDraftRefineProviderInput(refineRequest, refineRequest.requestId)
    const reasoningMode = chooseAiReasoningMode({
      itemCount: countDraftItemsInScope(refineRequest.draft, refineRequest.scope),
      operation: PROVIDER_PROXY_AI_TRIP_DRAFT_REFINE_OPERATION,
      repairInstructionLength: refineRequest.guidance?.trim().length,
    })
    const result = await provider.refineDraft({ ...providerInput, reasoningMode })

    if (!result.ok) {
      const status = mapAiDraftErrorCodeToStatus(result.errorCode)
      throw new ProviderProxyServerError(result.errorCode, status)
    }

    if (result.kind === 'draft') {
      return jsonResponse({
        draft: result.draft,
        ok: true,
        operation: PROVIDER_PROXY_AI_TRIP_DRAFT_REFINE_OPERATION,
        requestId: refineRequest.requestId,
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
      operation: PROVIDER_PROXY_AI_TRIP_DRAFT_REFINE_OPERATION,
      requestId: refineRequest.requestId,
      source: 'future_ai',
    }, 200, corsHeaders)
  } catch (caught) {
    const error = normalizeProviderProxyHandlerError(caught, PROVIDER_PROXY_AI_TRIP_DRAFT_REFINE_OPERATION, refineRequest.requestId)
    return jsonResponse(error.body, error.status, corsHeaders)
  }
}

function selectAiDraftRefineProvider(
  env: ProviderProxyHandlerEnv,
  request: ProviderProxyAiTripDraftRefineRequest,
  fetchImpl?: typeof fetch,
): AiDraftRefineProvider {
  if (isMockMode(env)) {
    return createMockAiDraftRefineProvider(request)
  }
  if (env.TRIPMAP_AI_PROVIDER === 'openai_compatible') {
    return createOpenAiCompatibleAiDraftRefineProvider(env, fetchImpl)
  }
  if (!env.TRIPMAP_AI_PROVIDER_KEY?.trim()) {
    return createUnavailableAiDraftRefineProvider()
  }
  return createDisabledAiDraftRefineProvider()
}

function countDraftItems(draft: AiTripDraft): number {
  return draft.days.reduce((total, day) => total + day.items.length, 0)
}

function countDraftItemsInScope(draft: AiTripDraft, scope: ProviderProxyAiTripDraftRefineScope): number {
  return draft.days.reduce((total, day) => {
    if (!isDraftDateInRefineScope(day.date, scope)) {
      return total
    }
    return total + day.items.length
  }, 0)
}

function isDraftDateInRefineScope(date: string, scope: ProviderProxyAiTripDraftRefineScope): boolean {
  if (scope.kind === 'day') {
    return date === scope.date
  }
  return date >= scope.startDate && date <= scope.endDate
}

function countCriticalFindings(findings: ProviderProxyAiTripDraftRepairRequest['qualityFindings']): number {
  return findings.filter((finding) => finding.severity === 'critical').length
}

async function handleAiTripEditPlanRequest({
  body,
  corsHeaders,
  env,
  fetcher,
  quotaHasher,
  quotaLimits,
  quotaStorage,
  request,
}: {
  body: unknown
  corsHeaders: Record<string, string>
  env: ProviderProxyHandlerEnv
  fetcher: typeof fetch
  quotaHasher?: ProviderProxyQuotaHasher
  quotaLimits?: Partial<ProviderProxyQuotaLimits>
  quotaStorage: ProviderProxyQuotaStorage
  request: Request
}): Promise<Response> {
  const validation = validateProviderProxyAiTripEditPlanRequest(body)
  if (!validation.ok) {
    return jsonResponse(validation.error, 400, corsHeaders)
  }

  const editRequest = validation.request
  const quotaResponse = await consumeQuotaOrBuildErrorResponse({
    coordinateCount: 0,
    corsHeaders,
    operation: PROVIDER_PROXY_AI_TRIP_EDIT_PLAN_OPERATION,
    quotaHasher,
    quotaLimits,
    quotaSessionId: editRequest.quotaSessionId,
    quotaStorage,
    request,
    requestId: editRequest.requestId,
  })
  if (quotaResponse) {
    return quotaResponse
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

async function handleExistingTripImportRequest({
  body,
  corsHeaders,
  env,
  fetcher,
  quotaHasher,
  quotaLimits,
  quotaStorage,
  request,
}: {
  body: unknown
  corsHeaders: Record<string, string>
  env: ProviderProxyHandlerEnv
  fetcher: typeof fetch
  quotaHasher?: ProviderProxyQuotaHasher
  quotaLimits?: Partial<ProviderProxyQuotaLimits>
  quotaStorage: ProviderProxyQuotaStorage
  request: Request
}): Promise<Response> {
  const validation = validateProviderProxyExistingTripImportRequest(body)
  if (!validation.ok) {
    return jsonResponse(validation.error, 400, corsHeaders)
  }

  const importRequest = validation.request
  const quotaResponse = await consumeQuotaOrBuildErrorResponse({
    coordinateCount: 0,
    corsHeaders,
    operation: PROVIDER_PROXY_AI_EXISTING_TRIP_IMPORT_OPERATION,
    quotaHasher,
    quotaLimits,
    quotaSessionId: importRequest.quotaSessionId,
    quotaStorage,
    request,
    requestId: importRequest.requestId,
  })
  if (quotaResponse) {
    return quotaResponse
  }

  try {
    const provider = selectExistingTripImportProvider(env, importRequest, fetcher)
    const providerInput = buildExistingTripImportProviderInput(importRequest, importRequest.requestId)
    const result = await provider.importTrip(importRequest, providerInput)

    if (!result.ok) {
      throw new ProviderProxyServerError(result.errorCode, mapExistingTripImportErrorCodeToStatus(result.errorCode))
    }

    return jsonResponse({
      ok: true,
      operation: PROVIDER_PROXY_AI_EXISTING_TRIP_IMPORT_OPERATION,
      requestId: importRequest.requestId,
      result: result.result,
      source: result.source,
      warnings: result.warnings,
    }, 200, corsHeaders)
  } catch (caught) {
    const error = normalizeProviderProxyHandlerError(caught, PROVIDER_PROXY_AI_EXISTING_TRIP_IMPORT_OPERATION, importRequest.requestId)
    return jsonResponse(error.body, error.status, corsHeaders)
  }
}

function selectExistingTripImportProvider(
  env: ProviderProxyHandlerEnv,
  _request: ProviderProxyExistingTripImportRequest,
  fetchImpl?: typeof fetch,
): ExistingTripImportProvider {
  if (isMockMode(env)) {
    return createMockExistingTripImportProvider()
  }
  if (env.TRIPMAP_AI_PROVIDER === 'openai_compatible') {
    return createOpenAiCompatibleExistingTripImportProvider(env, fetchImpl)
  }
  if (!env.TRIPMAP_AI_PROVIDER_KEY?.trim()) {
    return createUnavailableExistingTripImportProvider()
  }
  return createDisabledExistingTripImportProvider()
}

function mapExistingTripImportErrorCodeToStatus(code: ExistingTripImportProviderErrorCode): number {
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
  fetcher,
  quotaHasher,
  quotaLimits,
  quotaStorage,
  request,
}: {
  body: unknown
  corsHeaders: Record<string, string>
  env: ProviderProxyHandlerEnv
  fetcher: typeof fetch
  quotaHasher?: ProviderProxyQuotaHasher
  quotaLimits?: Partial<ProviderProxyQuotaLimits>
  quotaStorage: ProviderProxyQuotaStorage
  request: Request
}): Promise<Response> {
  const validation = validateProviderProxyTravelSearchRequest(body)
  if (!validation.ok) {
    return jsonResponse(validation.error, 400, corsHeaders)
  }

  const searchRequest = validation.request
  const quotaResponse = await consumeQuotaOrBuildErrorResponse({
    coordinateCount: 0,
    corsHeaders,
    operation: PROVIDER_PROXY_TRAVEL_SEARCH_OPERATION,
    quotaHasher,
    quotaLimits,
    quotaSessionId: searchRequest.quotaSessionId,
    quotaStorage,
    request,
    requestId: searchRequest.requestId,
  })
  if (quotaResponse) {
    return quotaResponse
  }

  try {
    const provider = selectTravelSearchProvider(env, fetcher)
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

function selectTravelSearchProvider(env: ProviderProxyHandlerEnv, fetcher: typeof fetch): TravelSearchProvider {
  if (isMockMode(env)) {
    return createMockTravelSearchProvider()
  }
  const provider = env.TRIPMAP_SEARCH_PROVIDER?.trim().toLowerCase()
  if (provider === 'mock') {
    return createMockTravelSearchProvider()
  }
  if (provider === 'disabled') {
    return createDisabledTravelSearchProvider()
  }
  if (provider === 'tavily') {
    if (!env.TRIPMAP_SEARCH_API_KEY?.trim()) {
      return createUnavailableTravelSearchProvider()
    }
    return createTavilyTravelSearchProvider(env, fetcher)
  }
  if (provider) {
    return createDisabledTravelSearchProvider()
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

async function handlePlaceLookupRequest({
  body,
  corsHeaders,
  env,
  fetcher,
  quotaHasher,
  quotaLimits,
  quotaStorage,
  request,
}: {
  body: unknown
  corsHeaders: Record<string, string>
  env: ProviderProxyHandlerEnv
  fetcher: typeof fetch
  quotaHasher?: ProviderProxyQuotaHasher
  quotaLimits?: Partial<ProviderProxyQuotaLimits>
  quotaStorage: ProviderProxyQuotaStorage
  request: Request
}): Promise<Response> {
  const validation = validateProviderProxyPlaceLookupRequest(body)
  if (!validation.ok) {
    return jsonResponse(validation.error, 400, corsHeaders)
  }

  const lookupRequest = validation.request
  const quotaResponse = await consumeQuotaOrBuildErrorResponse({
    coordinateCount: 0,
    corsHeaders,
    operation: PROVIDER_PROXY_PLACE_LOOKUP_OPERATION,
    quotaHasher,
    quotaLimits,
    quotaSessionId: lookupRequest.quotaSessionId,
    quotaStorage,
    request,
    requestId: lookupRequest.requestId,
  })
  if (quotaResponse) {
    return quotaResponse
  }

  try {
    const provider = selectPlaceLookupProvider(env, fetcher)
    const result = await provider.lookup(lookupRequest)
    if (!result.ok) {
      throw new ProviderProxyServerError(result.errorCode, mapPlaceLookupErrorCodeToStatus(result.errorCode))
    }
    return jsonResponse(result.response, 200, corsHeaders)
  } catch (caught) {
    const error = normalizeProviderProxyHandlerError(caught, PROVIDER_PROXY_PLACE_LOOKUP_OPERATION, lookupRequest.requestId)
    return jsonResponse(error.body, error.status, corsHeaders)
  }
}

function selectPlaceLookupProvider(env: ProviderProxyHandlerEnv, fetcher: typeof fetch): PlaceLookupProvider {
  if (isMockMode(env)) {
    return createMockPlaceLookupProvider()
  }
  const provider = env.TRIPMAP_PLACE_PROVIDER?.trim().toLowerCase()
  if (provider === 'mock') {
    return createMockPlaceLookupProvider()
  }
  if (provider === 'disabled') {
    return createDisabledPlaceLookupProvider()
  }
  if (provider === 'google_places' || (!provider && getGooglePlacesApiKey(env))) {
    if (!getGooglePlacesApiKey(env)) {
      return createUnavailablePlaceLookupProvider()
    }
    return createGooglePlacesLookupProvider(env, fetcher)
  }
  if (provider) {
    return createDisabledPlaceLookupProvider()
  }
  return createUnavailablePlaceLookupProvider()
}

function mapPlaceLookupErrorCodeToStatus(code: PlaceLookupProviderErrorCode): number {
  switch (code) {
    case 'provider_unavailable': return 503
    case 'quota_exceeded': return 429
    case 'unsupported': return 501
    case 'network_error': return 502
    case 'provider_error': return 502
    default: return 502
  }
}

async function handlePlaceDetailsRequest({
  body,
  corsHeaders,
  env,
  fetcher,
  quotaHasher,
  quotaLimits,
  quotaStorage,
  request,
}: {
  body: unknown
  corsHeaders: Record<string, string>
  env: ProviderProxyHandlerEnv
  fetcher: typeof fetch
  quotaHasher?: ProviderProxyQuotaHasher
  quotaLimits?: Partial<ProviderProxyQuotaLimits>
  quotaStorage: ProviderProxyQuotaStorage
  request: Request
}): Promise<Response> {
  const validation = validateProviderProxyPlaceDetailsRequest(body)
  if (!validation.ok) {
    return jsonResponse(validation.error, 400, corsHeaders)
  }

  const detailsRequest = validation.request
  const quotaResponse = await consumeQuotaOrBuildErrorResponse({
    coordinateCount: 0,
    corsHeaders,
    operation: PROVIDER_PROXY_PLACE_DETAILS_OPERATION,
    quotaHasher,
    quotaLimits,
    quotaSessionId: detailsRequest.quotaSessionId,
    quotaStorage,
    request,
    requestId: detailsRequest.requestId,
  })
  if (quotaResponse) {
    return quotaResponse
  }

  try {
    const provider = selectPlaceDetailsProvider(env, fetcher)
    const result = await provider.getDetails(detailsRequest)
    if (!result.ok) {
      throw new ProviderProxyServerError(result.errorCode, mapPlaceDetailsErrorCodeToStatus(result.errorCode))
    }
    return jsonResponse(result.response, 200, corsHeaders)
  } catch (caught) {
    const error = normalizeProviderProxyHandlerError(caught, PROVIDER_PROXY_PLACE_DETAILS_OPERATION, detailsRequest.requestId)
    return jsonResponse(error.body, error.status, corsHeaders)
  }
}

function selectPlaceDetailsProvider(env: ProviderProxyHandlerEnv, fetcher: typeof fetch): PlaceDetailsProvider {
  if (isMockMode(env)) {
    return createMockPlaceDetailsProvider()
  }
  const provider = env.TRIPMAP_PLACE_PROVIDER?.trim().toLowerCase()
  if (provider === 'mock') {
    return createMockPlaceDetailsProvider()
  }
  if (provider === 'disabled') {
    return createDisabledPlaceDetailsProvider()
  }
  if (provider === 'google_places' || (!provider && getGooglePlacesApiKey(env))) {
    if (!getGooglePlacesApiKey(env)) {
      return createUnavailablePlaceDetailsProvider()
    }
    return createGooglePlacesDetailsProvider(env, fetcher)
  }
  if (provider) {
    return createDisabledPlaceDetailsProvider()
  }
  return createUnavailablePlaceDetailsProvider()
}

function mapPlaceDetailsErrorCodeToStatus(code: PlaceDetailsProviderErrorCode): number {
  switch (code) {
    case 'provider_unavailable': return 503
    case 'quota_exceeded': return 429
    case 'unsupported': return 501
    case 'network_error': return 502
    case 'provider_error': return 502
    default: return 502
  }
}

async function handleTripContentEnrichmentRequest({
  body,
  corsHeaders,
  env,
  fetcher,
  quotaHasher,
  quotaLimits,
  quotaStorage,
  request,
}: {
  body: unknown
  corsHeaders: Record<string, string>
  env: ProviderProxyHandlerEnv
  fetcher: typeof fetch
  quotaHasher?: ProviderProxyQuotaHasher
  quotaLimits?: Partial<ProviderProxyQuotaLimits>
  quotaStorage: ProviderProxyQuotaStorage
  request: Request
}): Promise<Response> {
  const validation = validateProviderProxyTripContentEnrichmentRequest(body)
  if (!validation.ok) {
    return jsonResponse(validation.error, 400, corsHeaders)
  }

  const enrichmentRequest = validation.request
  const quotaResponse = await consumeQuotaOrBuildErrorResponse({
    coordinateCount: 0,
    corsHeaders,
    operation: PROVIDER_PROXY_TRIP_CONTENT_ENRICHMENT_OPERATION,
    quotaHasher,
    quotaLimits,
    quotaSessionId: enrichmentRequest.quotaSessionId,
    quotaStorage,
    request,
    requestId: enrichmentRequest.requestId,
  })
  if (quotaResponse) {
    return quotaResponse
  }

  try {
    const provider = selectTripContentEnrichmentProvider(env, fetcher)
    const providerInput = buildTripContentEnrichmentProviderInput(enrichmentRequest, enrichmentRequest.requestId)
    const result = await provider.enrich(enrichmentRequest, providerInput)
    if (!result.ok) {
      throw new ProviderProxyServerError(result.errorCode, mapTripContentEnrichmentErrorCodeToStatus(result.errorCode))
    }
    return jsonResponse({
      items: result.items,
      ok: true,
      operation: PROVIDER_PROXY_TRIP_CONTENT_ENRICHMENT_OPERATION,
      requestId: enrichmentRequest.requestId,
      source: result.source,
      warnings: result.warnings,
    }, 200, corsHeaders)
  } catch (caught) {
    const error = normalizeProviderProxyHandlerError(caught, PROVIDER_PROXY_TRIP_CONTENT_ENRICHMENT_OPERATION, enrichmentRequest.requestId)
    return jsonResponse(error.body, error.status, corsHeaders)
  }
}

function selectTripContentEnrichmentProvider(env: ProviderProxyHandlerEnv, fetcher: typeof fetch): TripContentEnrichmentProvider {
  if (isMockMode(env)) {
    return createMockTripContentEnrichmentProvider()
  }
  if (env.TRIPMAP_AI_PROVIDER === 'openai_compatible') {
    return createOpenAiCompatibleTripContentEnrichmentProvider(env, fetcher)
  }
  if (!env.TRIPMAP_AI_PROVIDER_KEY?.trim()) {
    return createUnavailableTripContentEnrichmentProvider()
  }
  return createDisabledTripContentEnrichmentProvider()
}

function mapTripContentEnrichmentErrorCodeToStatus(code: TripContentEnrichmentProviderErrorCode): number {
  switch (code) {
    case 'provider_unavailable': return 503
    case 'unsupported': return 501
    case 'invalid_response': return 502
    case 'network_error': return 502
    case 'provider_error': return 502
    default: return 502
  }
}

async function handleTripDailyTipRequest({
  body,
  corsHeaders,
  env,
  fetcher,
  quotaHasher,
  quotaLimits,
  quotaStorage,
  request,
}: {
  body: unknown
  corsHeaders: Record<string, string>
  env: ProviderProxyHandlerEnv
  fetcher: typeof fetch
  quotaHasher?: ProviderProxyQuotaHasher
  quotaLimits?: Partial<ProviderProxyQuotaLimits>
  quotaStorage: ProviderProxyQuotaStorage
  request: Request
}): Promise<Response> {
  const validation = validateProviderProxyTripDailyTipRequest(body)
  if (!validation.ok) {
    return jsonResponse(validation.error, 400, corsHeaders)
  }

  const tipRequest = validation.request
  const quotaResponse = await consumeQuotaOrBuildErrorResponse({
    coordinateCount: 0,
    corsHeaders,
    operation: PROVIDER_PROXY_TRIP_DAILY_TIP_OPERATION,
    quotaHasher,
    quotaLimits,
    quotaSessionId: tipRequest.quotaSessionId,
    quotaStorage,
    request,
    requestId: tipRequest.requestId,
  })
  if (quotaResponse) {
    return quotaResponse
  }

  try {
    const provider = selectTripDailyTipProvider(env, fetcher)
    const providerInput = buildTripDailyTipProviderInput(tipRequest, tipRequest.requestId)
    const result = await provider.generate(tipRequest, providerInput)
    if (!result.ok) {
      throw new ProviderProxyServerError(result.errorCode, mapTripDailyTipErrorCodeToStatus(result.errorCode))
    }
    return jsonResponse({
      ok: true,
      operation: PROVIDER_PROXY_TRIP_DAILY_TIP_OPERATION,
      requestId: tipRequest.requestId,
      sections: result.sections,
      source: result.source,
      sourceIds: result.sourceIds,
      summary: result.summary,
      warnings: result.warnings,
    }, 200, corsHeaders)
  } catch (caught) {
    const error = normalizeProviderProxyHandlerError(caught, PROVIDER_PROXY_TRIP_DAILY_TIP_OPERATION, tipRequest.requestId)
    return jsonResponse(error.body, error.status, corsHeaders)
  }
}

function selectTripDailyTipProvider(env: ProviderProxyHandlerEnv, fetcher: typeof fetch): TripDailyTipProvider {
  if (isMockMode(env)) {
    return createMockTripDailyTipProvider()
  }
  if (env.TRIPMAP_AI_PROVIDER === 'openai_compatible') {
    return createOpenAiCompatibleTripDailyTipProvider(env, fetcher)
  }
  if (!env.TRIPMAP_AI_PROVIDER_KEY?.trim()) {
    return createUnavailableTripDailyTipProvider()
  }
  return createDisabledTripDailyTipProvider()
}

function mapTripDailyTipErrorCodeToStatus(code: TripDailyTipProviderErrorCode): number {
  switch (code) {
    case 'provider_unavailable': return 503
    case 'unsupported': return 501
    case 'invalid_response': return 502
    case 'network_error': return 502
    case 'provider_error': return 502
    default: return 502
  }
}

async function handleRouteOrderSuggestionRequest({
  body,
  corsHeaders,
  env,
  fetcher,
  quotaHasher,
  quotaLimits,
  quotaStorage,
  request,
}: {
  body: unknown
  corsHeaders: Record<string, string>
  env: ProviderProxyHandlerEnv
  fetcher: typeof fetch
  quotaHasher?: ProviderProxyQuotaHasher
  quotaLimits?: Partial<ProviderProxyQuotaLimits>
  quotaStorage: ProviderProxyQuotaStorage
  request: Request
}): Promise<Response> {
  const validation = validateProviderProxyRouteOrderSuggestionRequest(body)
  if (!validation.ok) {
    return jsonResponse(validation.error, 400, corsHeaders)
  }

  const suggestionRequest = validation.request
  const quotaResponse = await consumeQuotaOrBuildErrorResponse({
    coordinateCount: suggestionRequest.items.filter((item) => item.coordinate).length,
    corsHeaders,
    operation: PROVIDER_PROXY_ROUTE_ORDER_SUGGESTION_OPERATION,
    quotaHasher,
    quotaLimits,
    quotaSessionId: suggestionRequest.quotaSessionId,
    quotaStorage,
    request,
    requestId: suggestionRequest.requestId,
  })
  if (quotaResponse) {
    return quotaResponse
  }

  try {
    if (isMockMode(env)) {
      return jsonResponse(buildMockRouteOrderSuggestionResponse(suggestionRequest), 200, corsHeaders)
    }

    const provider = selectRouteOrderSuggestionProvider(suggestionRequest, env)
    const apiKey = getProviderSecret(provider, env)
    if (!apiKey) {
      throw new ProviderProxyServerError('provider_unavailable', 503, provider)
    }
    const response = await fetchRouteOrderSuggestionFromProvider({
      apiKey,
      fetcher,
      provider,
      request: suggestionRequest,
    })
    return jsonResponse(response, 200, corsHeaders)
  } catch (caught) {
    const error = normalizeProviderProxyHandlerError(caught, PROVIDER_PROXY_ROUTE_ORDER_SUGGESTION_OPERATION, suggestionRequest.requestId)
    return jsonResponse(error.body, error.status, corsHeaders)
  }
}

async function handleRoutePreviewRequest({
  body,
  corsHeaders,
  env,
  fetcher,
  quotaHasher,
  quotaLimits,
  quotaStorage,
  request,
}: {
  body: unknown
  corsHeaders: Record<string, string>
  env: ProviderProxyHandlerEnv
  fetcher: typeof fetch
  quotaHasher?: ProviderProxyQuotaHasher
  quotaLimits?: Partial<ProviderProxyQuotaLimits>
  quotaStorage: ProviderProxyQuotaStorage
  request: Request
}): Promise<Response> {
  const validation = validateProviderProxyRoutePreviewRequest(body)
  if (!validation.ok) {
    return jsonResponse(validation.error, 400, corsHeaders)
  }

  const routeRequest = validation.request
  const quotaResponse = await consumeQuotaOrBuildErrorResponse({
    coordinateCount: routeRequest.coordinates.length,
    corsHeaders,
    operation: PROVIDER_PROXY_ROUTE_PREVIEW_OPERATION,
    quotaHasher,
    quotaLimits,
    quotaSessionId: routeRequest.quotaSessionId,
    quotaStorage,
    request,
    requestId: routeRequest.requestId,
  })
  if (quotaResponse) {
    return quotaResponse
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

async function fetchRouteOrderSuggestionFromProvider({
  apiKey,
  fetcher,
  provider,
  request,
}: {
  apiKey: string
  fetcher: typeof fetch
  provider: ProviderProxyConcreteProvider
  request: ProviderProxyRouteOrderSuggestionRequest
}): Promise<ProviderProxyRouteOrderSuggestionSuccessResponse> {
  if (provider !== 'google') {
    throw new ProviderProxyServerError('provider_unavailable', 503, provider)
  }
  return fetchGoogleRouteOrderSuggestion(request, apiKey, fetcher)
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

async function fetchGoogleRouteOrderSuggestion(
  request: ProviderProxyRouteOrderSuggestionRequest,
  apiKey: string,
  fetcher: typeof fetch,
): Promise<ProviderProxyRouteOrderSuggestionSuccessResponse> {
  const coordinateItems = getRouteOrderCoordinateItems(request)
  if (coordinateItems.length < 3) {
    return buildRouteOrderSuggestionResponse({
      provider: 'google',
      request,
      suggestedItemIds: coordinateItems.map((item) => item.id),
      summary: '当前行程点较少，已保持原顺序。',
      warnings: ['至少 3 个带坐标地点才可能产生顺序变化。'],
    })
  }

  const origin = coordinateItems[0]
  const destination = coordinateItems[coordinateItems.length - 1]
  const intermediates = coordinateItems.slice(1, -1)
  let response: Response
  try {
    response = await fetcher(GOOGLE_ROUTES_ENDPOINT, {
      body: JSON.stringify({
        destination: {
          location: {
            latLng: {
              latitude: destination.coordinate.lat,
              longitude: destination.coordinate.lng,
            },
          },
        },
        intermediates: intermediates.map((item) => ({
          location: {
            latLng: {
              latitude: item.coordinate.lat,
              longitude: item.coordinate.lng,
            },
          },
        })),
        optimizeWaypointOrder: true,
        origin: {
          location: {
            latLng: {
              latitude: origin.coordinate.lat,
              longitude: origin.coordinate.lng,
            },
          },
        },
        routingPreference: 'TRAFFIC_UNAWARE',
        travelMode: 'DRIVE',
      }),
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': GOOGLE_ROUTE_ORDER_FIELD_MASK,
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
  const parsed = parseGoogleRouteOrderResponse(data, intermediates.length)
  return buildRouteOrderSuggestionResponse({
    distanceMeters: parsed.distanceMeters,
    durationSeconds: parsed.durationSeconds,
    provider: 'google',
    request,
    suggestedItemIds: [
      origin.id,
      ...parsed.optimizedIntermediateIndexes.map((index) => intermediates[index].id),
      destination.id,
    ],
    summary: '已根据路线服务生成当前日顺序建议。',
    warnings: [],
  })
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

function buildRouteOrderSuggestionResponse({
  distanceMeters,
  durationSeconds,
  provider,
  request,
  suggestedItemIds,
  summary,
  warnings,
}: {
  distanceMeters?: number
  durationSeconds?: number
  provider: ProviderProxyRouteOrderSuggestionSuccessResponse['provider']
  request: ProviderProxyRouteOrderSuggestionRequest
  suggestedItemIds: string[]
  summary: string
  warnings: string[]
}): ProviderProxyRouteOrderSuggestionSuccessResponse {
  const coordinateItemIds = getRouteOrderCoordinateItems(request).map((item) => item.id)
  if (!hasSameStringSet(suggestedItemIds, coordinateItemIds)) {
    throw new ProviderProxyServerError('provider_error', 502, provider === 'mock' ? undefined : provider)
  }
  return {
    distanceMeters,
    durationSeconds,
    ok: true,
    operation: PROVIDER_PROXY_ROUTE_ORDER_SUGGESTION_OPERATION,
    provider,
    requestId: request.requestId,
    retrievedAt: new Date().toISOString(),
    suggestedItemIds,
    summary,
    unchangedItemIds: request.items.filter((item) => !item.coordinate).map((item) => item.id),
    warnings,
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

function buildMockRouteOrderSuggestionResponse(
  request: ProviderProxyRouteOrderSuggestionRequest,
): ProviderProxyRouteOrderSuggestionSuccessResponse {
  const coordinateItems = getRouteOrderCoordinateItems(request)
  const suggestedItemIds = [
    coordinateItems[0]?.id,
    ...coordinateItems.slice(1, -1).reverse().map((item) => item.id),
    coordinateItems[coordinateItems.length - 1]?.id,
  ].filter((value): value is string => Boolean(value))
  return buildRouteOrderSuggestionResponse({
    distanceMeters: estimateRouteOrderDistanceMeters(coordinateItems.map((item) => [item.coordinate.lng, item.coordinate.lat])),
    durationSeconds: estimateRouteOrderDurationSeconds(coordinateItems.map((item) => [item.coordinate.lng, item.coordinate.lat])),
    provider: 'mock',
    request,
    suggestedItemIds,
    summary: '已生成模拟路线顺序建议。',
    warnings: ['当前为模拟路线顺序建议，不代表真实路线服务结果。'],
  })
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
  if (getGoogleRoutesApiKey(env)) {
    return 'google'
  }
  throw new ProviderProxyServerError('provider_unavailable', 503)
}

function selectRouteOrderSuggestionProvider(
  request: ProviderProxyRouteOrderSuggestionRequest,
  env: ProviderProxyHandlerEnv,
): ProviderProxyConcreteProvider {
  if (request.provider === 'openrouteservice') {
    throw new ProviderProxyServerError('provider_unavailable', 503, 'openrouteservice')
  }
  if (request.provider === 'google') {
    return 'google'
  }
  if (getGoogleRoutesApiKey(env)) {
    return 'google'
  }
  throw new ProviderProxyServerError('provider_unavailable', 503)
}

function getProviderSecret(provider: ProviderProxyConcreteProvider, env: ProviderProxyHandlerEnv) {
  return provider === 'google' ? getGoogleRoutesApiKey(env) : env.OPENROUTESERVICE_API_KEY?.trim()
}

function getGoogleRoutesApiKey(env: ProviderProxyHandlerEnv) {
  return env.VITE_GOOGLE_MAPS_API_KEY?.trim() || env.GOOGLE_MAPS_PLATFORM_API_KEY?.trim() || env.GOOGLE_ROUTES_API_KEY?.trim()
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

function parseGoogleRouteOrderResponse(input: unknown, expectedIntermediateCount: number): {
  distanceMeters?: number
  durationSeconds?: number
  optimizedIntermediateIndexes: number[]
} {
  const routes = readRecord(input).routes
  const route = Array.isArray(routes) ? readRecord(routes[0]) : {}
  const rawIndexes = route.optimizedIntermediateWaypointIndex
  if (!Array.isArray(rawIndexes)) {
    throw new ProviderProxyServerError('provider_error', 502, 'google')
  }
  const optimizedIntermediateIndexes = rawIndexes.map((value) => Number(value))
  if (
    optimizedIntermediateIndexes.length !== expectedIntermediateCount ||
    optimizedIntermediateIndexes.some((value) => !Number.isInteger(value) || value < 0 || value >= expectedIntermediateCount) ||
    new Set(optimizedIntermediateIndexes).size !== optimizedIntermediateIndexes.length
  ) {
    throw new ProviderProxyServerError('provider_error', 502, 'google')
  }
  const durationSeconds = typeof route.duration === 'string'
    ? Number.parseFloat(route.duration.replace('s', ''))
    : undefined
  return {
    distanceMeters: typeof route.distanceMeters === 'number' && Number.isFinite(route.distanceMeters) ? route.distanceMeters : undefined,
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : undefined,
    optimizedIntermediateIndexes,
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

function getRouteOrderCoordinateItems(request: ProviderProxyRouteOrderSuggestionRequest) {
  return request.items.filter((item): item is ProviderProxyRouteOrderSuggestionRequest['items'][number] & {
    coordinate: { lat: number; lng: number }
  } => Boolean(item.coordinate))
}

function hasSameStringSet(first: string[], second: string[]) {
  if (first.length !== second.length) {
    return false
  }
  const secondSet = new Set(second)
  return first.every((value) => secondSet.has(value))
}

async function consumeQuotaOrBuildErrorResponse({
  coordinateCount,
  corsHeaders,
  dayCount,
  operation,
  quotaHasher,
  quotaLimits,
  quotaSessionId,
  quotaStorage,
  request,
  requestId,
}: {
  coordinateCount: number
  corsHeaders: Record<string, string>
  dayCount?: number
  operation: ProviderProxyOperation
  quotaHasher?: ProviderProxyQuotaHasher
  quotaLimits?: Partial<ProviderProxyQuotaLimits>
  quotaSessionId?: string
  quotaStorage: ProviderProxyQuotaStorage
  request: Request
  requestId?: string
}): Promise<Response | null> {
  const quota = await consumeProviderProxyQuota({
    coordinateCount,
    dayCount,
    hasher: quotaHasher,
    identity: getQuotaIdentity(request, quotaSessionId),
    limits: quotaLimits,
    operation,
    storage: quotaStorage,
  })

  if (quota.allowed) {
    return null
  }

  const quotaFailure = quota.reason === 'rate_limit' || quota.reason === 'storage_error'
  const code: ProviderProxyErrorCode = quotaFailure ? 'quota_exceeded' : 'invalid_request'
  return jsonResponse(
    buildProviderProxyErrorResponse({
      code,
      operation,
      requestId,
    }),
    quotaFailure ? 429 : 400,
    corsHeaders,
    quotaFailure && quota.resetAt ? { 'Retry-After': String(getRetryAfterSeconds(quota.resetAt)) } : {},
  )
}

function getQuotaIdentity(request: Request, quotaSessionId?: string) {
  return {
    ip: getQuotaRequestIp(request),
    quotaSessionId,
  }
}

function getQuotaRequestIp(request: Request) {
  const cfIp = request.headers.get('CF-Connecting-IP')?.trim()
  if (cfIp) {
    return cfIp
  }
  return request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
}

function getRetryAfterSeconds(resetAt: number) {
  return Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))
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

function estimateRouteOrderDistanceMeters(coordinates: LngLat[]) {
  let distance = 0
  for (let index = 1; index < coordinates.length; index += 1) {
    distance += estimateDistanceMeters(coordinates[index - 1], coordinates[index])
  }
  return distance
}

function estimateRouteOrderDurationSeconds(coordinates: LngLat[]) {
  return Math.max(60, Math.round(estimateRouteOrderDistanceMeters(coordinates) / 8))
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
