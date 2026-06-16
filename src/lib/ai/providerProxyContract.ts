import type { RoutingMode, RoutingProfile, LngLat } from '../routing'
import type { AiTripDraft } from './aiTripDraft'
import { validateAiTripDraft } from './aiTripDraft'
import { generateMockAiTripDraft } from './aiTripDraftMock'
import type { AiTripEditContext } from './aiTripEditContext'
import { validateAiTripEditContext } from './aiTripEditContext'
import type { AiTripEditPatchPlan } from './aiTripEditPatch'
import { isValidPlainDate, listPlainDateRangeInclusive } from '../plainDate'
import type { TravelPace, TravelTransportPreference } from '../travelProfile'
import { isTravelPace, isTravelTransportPreference } from '../travelProfile'
import type {
  ContentEnrichmentConfidence,
  ContentEnrichmentSourceType,
} from '../../types'
import type {
  ExistingTripImportProviderResult,
  ExistingTripImportSourceKind,
} from './existingTripImport'
import type { LedgerExpenseCategory, TicketCategory, TicketScope, TravelInboxClassification, TravelInboxEntryCategory } from '../../types'
import { validateLedgerQueryPlan, type LedgerQueryPlan } from '../ledgerArchive'

export const PROVIDER_PROXY_ROUTE_PREVIEW_OPERATION = 'route_preview' as const
export const PROVIDER_PROXY_AI_TRIP_DRAFT_OPERATION = 'ai_trip_draft' as const
export const PROVIDER_PROXY_AI_TRIP_DRAFT_REPAIR_OPERATION = 'ai_trip_draft_repair' as const
export const PROVIDER_PROXY_AI_TRIP_DRAFT_REFINE_OPERATION = 'ai_trip_draft_refine' as const
export const PROVIDER_PROXY_AI_TRIP_EDIT_PLAN_OPERATION = 'ai_trip_edit_plan' as const
export const PROVIDER_PROXY_TRAVEL_SEARCH_OPERATION = 'travel_search' as const
export const PROVIDER_PROXY_PLACE_LOOKUP_OPERATION = 'place_lookup' as const
export const PROVIDER_PROXY_PLACE_DETAILS_OPERATION = 'place_details' as const
export const PROVIDER_PROXY_TRIP_CONTENT_ENRICHMENT_OPERATION = 'trip_content_enrichment' as const
export const PROVIDER_PROXY_TRIP_DAILY_TIP_OPERATION = 'trip_daily_tip' as const
export const PROVIDER_PROXY_TRIP_OPERATIONS_SUMMARY_OPERATION = 'trip_operations_summary' as const
export const PROVIDER_PROXY_AI_EXISTING_TRIP_IMPORT_OPERATION = 'ai_existing_trip_import' as const
export const PROVIDER_PROXY_TRAVEL_INBOX_CLASSIFY_OPERATION = 'travel_inbox_classify' as const
export const PROVIDER_PROXY_ROUTE_ORDER_SUGGESTION_OPERATION = 'route_order_suggestion' as const
export const PROVIDER_PROXY_EXCHANGE_RATE_OPERATION = 'exchange_rate' as const
export const PROVIDER_PROXY_AI_EXPENSE_EXTRACT_OPERATION = 'ai_expense_extract' as const
export const PROVIDER_PROXY_AI_EXPENSE_QUERY_OPERATION = 'ai_expense_query' as const
export const PROVIDER_PROXY_MAX_COORDINATES = 25
export const PROVIDER_PROXY_MAX_SEGMENTS = PROVIDER_PROXY_MAX_COORDINATES - 1
export const PROVIDER_PROXY_MAX_ROUTE_ORDER_ITEMS = 10
export const PROVIDER_PROXY_MAX_DAYS_PER_BATCH = 7
export const PROVIDER_PROXY_MAX_AI_DRAFT_REQUESTS_PER_WINDOW = 10
export const PROVIDER_PROXY_MAX_AI_DRAFT_REPAIR_REQUESTS_PER_WINDOW = 5
export const PROVIDER_PROXY_MAX_AI_TRIP_EDIT_REQUESTS_PER_WINDOW = 10
export const PROVIDER_PROXY_MAX_AI_EXISTING_TRIP_IMPORT_REQUESTS_PER_WINDOW = 5
export const PROVIDER_PROXY_MAX_TRAVEL_INBOX_CLASSIFY_REQUESTS_PER_WINDOW = 20
export const PROVIDER_PROXY_MAX_TRAVEL_SEARCH_REQUESTS_PER_WINDOW = 20
export const PROVIDER_PROXY_MAX_PLACE_LOOKUP_REQUESTS_PER_WINDOW = 30
export const PROVIDER_PROXY_MAX_TRIP_CONTENT_ENRICHMENT_REQUESTS_PER_WINDOW = 10
export const PROVIDER_PROXY_MAX_TRIP_OPERATIONS_SUMMARY_REQUESTS_PER_WINDOW = 10
export const PROVIDER_PROXY_MAX_EXCHANGE_RATE_REQUESTS_PER_WINDOW = 30
export const PROVIDER_PROXY_MAX_AI_EXPENSE_EXTRACT_REQUESTS_PER_WINDOW = 5
export const PROVIDER_PROXY_MAX_AI_EXPENSE_QUERY_REQUESTS_PER_WINDOW = 10

export type ProviderProxyOperation = typeof PROVIDER_PROXY_ROUTE_PREVIEW_OPERATION | typeof PROVIDER_PROXY_ROUTE_ORDER_SUGGESTION_OPERATION | typeof PROVIDER_PROXY_AI_TRIP_DRAFT_OPERATION | typeof PROVIDER_PROXY_AI_TRIP_DRAFT_REPAIR_OPERATION | typeof PROVIDER_PROXY_AI_TRIP_DRAFT_REFINE_OPERATION | typeof PROVIDER_PROXY_AI_TRIP_EDIT_PLAN_OPERATION | typeof PROVIDER_PROXY_AI_EXISTING_TRIP_IMPORT_OPERATION | typeof PROVIDER_PROXY_TRAVEL_INBOX_CLASSIFY_OPERATION | typeof PROVIDER_PROXY_TRAVEL_SEARCH_OPERATION | typeof PROVIDER_PROXY_PLACE_LOOKUP_OPERATION | typeof PROVIDER_PROXY_PLACE_DETAILS_OPERATION | typeof PROVIDER_PROXY_TRIP_CONTENT_ENRICHMENT_OPERATION | typeof PROVIDER_PROXY_TRIP_DAILY_TIP_OPERATION | typeof PROVIDER_PROXY_TRIP_OPERATIONS_SUMMARY_OPERATION | typeof PROVIDER_PROXY_EXCHANGE_RATE_OPERATION | typeof PROVIDER_PROXY_AI_EXPENSE_EXTRACT_OPERATION | typeof PROVIDER_PROXY_AI_EXPENSE_QUERY_OPERATION
export type ProviderProxyConcreteProvider = 'google' | 'openrouteservice'
export type ProviderProxyProvider = ProviderProxyConcreteProvider | 'auto'
export type ProviderProxyRouteOrderSuggestionProvider = ProviderProxyConcreteProvider | 'mock'
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

export type ProviderProxyExchangeRateRequest = {
  operation: typeof PROVIDER_PROXY_EXCHANGE_RATE_OPERATION
  requestedDate: string
  baseCurrency: string
  quoteCurrencies: string[]
  quotaSessionId?: string
  requestId?: string
}

export type ProviderProxyExchangeRateSuccessResponse = {
  ok: true
  operation: typeof PROVIDER_PROXY_EXCHANGE_RATE_OPERATION
  provider: 'frankfurter'
  requestedDate: string
  effectiveDate: string
  baseCurrency: string
  rates: Array<{ quoteCurrency: string; rate: string }>
  sourceUrl: string
  fetchedAt: string
  requestId?: string
}

export type ProviderProxyExchangeRateResponse = ProviderProxyExchangeRateSuccessResponse | ProviderProxyErrorResponse
export type ProviderProxyExchangeRateValidationResult =
  | { ok: true; request: ProviderProxyExchangeRateRequest }
  | { ok: false; error: ProviderProxyErrorResponse }

export type ProviderProxyAiExpenseExtractRequest = {
  operation: typeof PROVIDER_PROXY_AI_EXPENSE_EXTRACT_OPERATION
  candidates: Array<{
    candidateId: string
    title: string
    text: string
  }>
  participants: Array<{ alias: string; displayName: string }>
  defaultCurrency: string
  quotaSessionId?: string
  requestId?: string
}

export type ProviderProxyAiExpenseExtractSuggestion = {
  candidateId: string
  amount?: string
  currency?: string
  category?: LedgerExpenseCategory
  payerAlias?: string
}

export type ProviderProxyAiExpenseExtractSuccessResponse = {
  ok: true
  operation: typeof PROVIDER_PROXY_AI_EXPENSE_EXTRACT_OPERATION
  source: 'mock' | 'ai'
  suggestions: ProviderProxyAiExpenseExtractSuggestion[]
  requestId?: string
}

export type ProviderProxyAiExpenseExtractResponse = ProviderProxyAiExpenseExtractSuccessResponse | ProviderProxyErrorResponse
export type ProviderProxyAiExpenseExtractValidationResult =
  | { ok: true; request: ProviderProxyAiExpenseExtractRequest }
  | { ok: false; error: ProviderProxyErrorResponse }

export type ProviderProxyAiExpenseQueryRow = {
  id: string
  title: string
  date: string
  category: LedgerExpenseCategory
  amountMinor?: number
  currency?: string
  city?: string
  merchant?: string
  status: 'draft' | 'confirmed' | 'void'
  paymentStatus?: string
  orderStatus?: string
  reviewStatus?: string
  itemLinked: boolean
  sourceRefs: Array<{ id: string; kind: string; role: string }>
}

export type ProviderProxyAiExpenseQueryRequest = {
  operation: typeof PROVIDER_PROXY_AI_EXPENSE_QUERY_OPERATION
  question: string
  rows: ProviderProxyAiExpenseQueryRow[]
  quotaSessionId?: string
  requestId?: string
}

export type ProviderProxyAiExpenseQuerySuccessResponse = {
  ok: true
  operation: typeof PROVIDER_PROXY_AI_EXPENSE_QUERY_OPERATION
  source: 'mock' | 'ai'
  plan: LedgerQueryPlan
  presentation: 'summary' | 'list' | 'grouped'
  requestId?: string
}

export type ProviderProxyAiExpenseQueryResponse = ProviderProxyAiExpenseQuerySuccessResponse | ProviderProxyErrorResponse
export type ProviderProxyAiExpenseQueryValidationResult =
  | { ok: true; request: ProviderProxyAiExpenseQueryRequest }
  | { ok: false; error: ProviderProxyErrorResponse }

export type ProviderProxyValidationResult =
  | { ok: true; request: ProviderProxyRoutePreviewRequest }
  | { error: ProviderProxyErrorResponse; ok: false }

export type ProviderProxyRouteOrderSuggestionItem = {
  address?: string
  coordinate?: {
    lat: number
    lng: number
  }
  id: string
  locationName?: string
  title: string
}

export type ProviderProxyRouteOrderSuggestionRequest = {
  dayId?: string
  items: ProviderProxyRouteOrderSuggestionItem[]
  operation: typeof PROVIDER_PROXY_ROUTE_ORDER_SUGGESTION_OPERATION
  provider?: ProviderProxyProvider
  quotaSessionId?: string
  requestId?: string
  tripId?: string
}

export type ProviderProxyRouteOrderSuggestionSuccessResponse = {
  distanceMeters?: number
  durationSeconds?: number
  ok: true
  operation: typeof PROVIDER_PROXY_ROUTE_ORDER_SUGGESTION_OPERATION
  provider: ProviderProxyRouteOrderSuggestionProvider
  requestId?: string
  retrievedAt: string
  suggestedItemIds: string[]
  summary: string
  unchangedItemIds: string[]
  warnings: string[]
}

export type ProviderProxyRouteOrderSuggestionResponse =
  | ProviderProxyRouteOrderSuggestionSuccessResponse
  | ProviderProxyErrorResponse

export type ProviderProxyRouteOrderSuggestionValidationResult =
  | { ok: true; request: ProviderProxyRouteOrderSuggestionRequest }
  | { error: ProviderProxyErrorResponse; ok: false }

export type ProviderProxyAiTripDraftRequest = {
  dayCount?: number
  destination: string
  endDate: string
  interestTags?: string[]
  interestText?: string
  mealTimeProtection?: boolean
  mustVisitText?: string
  avoidText?: string
  freeTextRequirement?: string
  operation: typeof PROVIDER_PROXY_AI_TRIP_DRAFT_OPERATION
  partySize?: number
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

export type ProviderProxyAiTripDraftRefineScope =
  | { date: string; kind: 'day' }
  | { endDate: string; kind: 'date_range'; startDate: string }

export type ProviderProxyAiTripDraftRefinePreferences = {
  avoidText?: string
  freeTextRequirement?: string
  interestTags?: string[]
  interestText?: string
  mealTimeProtection?: boolean
  mustVisitText?: string
  partySize?: number
  pace?: TravelPace
  preferTransport?: TravelTransportPreference
}

export type ProviderProxyAiTripDraftRefineRequest = {
  draft: AiTripDraft
  guidance?: string
  operation: typeof PROVIDER_PROXY_AI_TRIP_DRAFT_REFINE_OPERATION
  preferences?: ProviderProxyAiTripDraftRefinePreferences
  quotaSessionId?: string
  requestId?: string
  scope: ProviderProxyAiTripDraftRefineScope
}

export type ProviderProxyAiTripDraftRefineSuccessResponse = {
  draft: AiTripDraft
  ok: true
  operation: typeof PROVIDER_PROXY_AI_TRIP_DRAFT_REFINE_OPERATION
  requestId?: string
  source: 'mock' | 'future_ai'
  warnings?: string[]
}

export type ProviderProxyAiTripDraftRefineResponse =
  | ProviderProxyAiTripDraftRefineSuccessResponse
  | ProviderProxyErrorResponse

export type ProviderProxyAiTripDraftRefineValidationResult =
  | { ok: true; request: ProviderProxyAiTripDraftRefineRequest }
  | { error: ProviderProxyErrorResponse; ok: false }

export type ProviderProxyAiTripEditPlanRequest = {
  operation: typeof PROVIDER_PROXY_AI_TRIP_EDIT_PLAN_OPERATION
  requestId?: string
  quotaSessionId?: string
  command: string
  context: AiTripEditContext
  searchResults?: ProviderProxyAiTripEditSearchSummary
}

export type ProviderProxyAiTripEditSearchResultSummary = {
  title: string
  url: string
  displayUrl: string
  domain: string
  snippet: string
  retrievedAt: string
  sourceType?: ProviderProxyTravelSearchSourceType
  confidence?: ProviderProxyTravelSearchConfidence
}

export type ProviderProxyAiTripEditSearchSummary = {
  query: string
  source: 'mock' | 'future_search'
  retrievedAt: string
  results: ProviderProxyAiTripEditSearchResultSummary[]
  warnings?: string[]
}

type ProviderProxyAiTripEditSearchSummaryValidationResult =
  | { ok: true; searchResults?: ProviderProxyAiTripEditSearchSummary }
  | { error: ProviderProxyErrorResponse; ok: false }

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

export type ProviderProxyExistingTripImportTripSummary = {
  destination?: string
  endDate: string
  id: string
  startDate: string
  timeZone?: string
  title: string
}

export type ProviderProxyExistingTripImportDaySummary = {
  date: string
  id: string
  sortOrder?: number
  timeZone?: string
  title?: string
}

export type ProviderProxyExistingTripImportItemSummary = {
  address?: string
  date: string
  dayId: string
  endDate?: string
  endTime?: string
  endTimeZone?: string
  id: string
  locationName?: string
  previousTransportDurationMinutes?: number
  previousTransportMode?: string
  previousTransportNote?: string
  startTime?: string
  startTimeZone?: string
  ticketCount?: number
  title: string
  transportMode?: string
}

export type ProviderProxyExistingTripImportSourceSummary = {
  fileName?: string
  id: string
  kind: ExistingTripImportSourceKind
  label: string
  mimeType?: string
  size?: number
  text: string
  warnings?: string[]
}

export type ProviderProxyExistingTripImportTicketSummary = {
  itemId?: string
  scope?: TicketScope
  summaryId: string
  ticketCategory?: TicketCategory
  title: string
}

export type ProviderProxyExistingTripImportRequest = {
  days: ProviderProxyExistingTripImportDaySummary[]
  existingTicketSummaries?: ProviderProxyExistingTripImportTicketSummary[]
  items: ProviderProxyExistingTripImportItemSummary[]
  locale?: ProviderProxyPlaceLookupLocale
  operation: typeof PROVIDER_PROXY_AI_EXISTING_TRIP_IMPORT_OPERATION
  quotaSessionId?: string
  requestId?: string
  sources: ProviderProxyExistingTripImportSourceSummary[]
  trip: ProviderProxyExistingTripImportTripSummary
}

export type ProviderProxyExistingTripImportSuccessResponse = {
  ok: true
  operation: typeof PROVIDER_PROXY_AI_EXISTING_TRIP_IMPORT_OPERATION
  requestId?: string
  result: ExistingTripImportProviderResult
  source: 'mock' | 'future_ai'
  warnings?: string[]
}

export type ProviderProxyExistingTripImportResponse =
  | ProviderProxyExistingTripImportSuccessResponse
  | ProviderProxyErrorResponse

export type ProviderProxyExistingTripImportValidationResult =
  | { ok: true; request: ProviderProxyExistingTripImportRequest }
  | { error: ProviderProxyErrorResponse; ok: false }

export type ProviderProxyTravelInboxTripSummary = {
  id: string
  title: string
  destination: string
  startDate: string
  endDate: string
}

export type ProviderProxyTravelInboxClassifyRequest = {
  operation: typeof PROVIDER_PROXY_TRAVEL_INBOX_CLASSIFY_OPERATION
  source: ProviderProxyExistingTripImportSourceSummary
  trips: ProviderProxyTravelInboxTripSummary[]
  quotaSessionId?: string
  requestId?: string
}

export type ProviderProxyTravelInboxClassifySuccessResponse = {
  ok: true
  operation: typeof PROVIDER_PROXY_TRAVEL_INBOX_CLASSIFY_OPERATION
  requestId?: string
  classification: TravelInboxClassification
  source: 'mock' | 'future_ai'
  warnings?: string[]
}

export type ProviderProxyTravelInboxClassifyResponse = ProviderProxyTravelInboxClassifySuccessResponse | ProviderProxyErrorResponse
export type ProviderProxyTravelInboxClassifyValidationResult =
  | { ok: true; request: ProviderProxyTravelInboxClassifyRequest }
  | { error: ProviderProxyErrorResponse; ok: false }

export type ProviderProxyTravelSearchLocale = 'zh-CN' | 'en-US'
export type ProviderProxyTravelSearchType = 'general' | 'opening_hours' | 'ticket_price' | 'official_site' | 'transport' | 'nearby_food'
export type ProviderProxyTravelSearchSourceType = 'official' | 'map' | 'ticketing' | 'travel_site' | 'unknown'
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
  title: string
  url: string
  displayUrl: string
  domain: string
  snippet: string
  sourceType?: ProviderProxyTravelSearchSourceType
  confidence?: ProviderProxyTravelSearchConfidence
  retrievedAt: string
}

export type ProviderProxyTravelSearchSuccessResponse = {
  ok: true
  operation: typeof PROVIDER_PROXY_TRAVEL_SEARCH_OPERATION
  requestId?: string
  source: 'mock' | 'future_search'
  query: string
  results: ProviderProxyTravelSearchResult[]
  retrievedAt: string
  warnings?: string[]
}

export type ProviderProxyTravelSearchResponse =
  | ProviderProxyTravelSearchSuccessResponse
  | ProviderProxyErrorResponse

export type ProviderProxyTravelSearchValidationResult =
  | { ok: true; request: ProviderProxyValidatedTravelSearchRequest }
  | { error: ProviderProxyErrorResponse; ok: false }

export type ProviderProxyPlaceLookupLocale = 'zh-CN' | 'en-US'

export type ProviderProxyPlaceLookupRequest = {
  operation: typeof PROVIDER_PROXY_PLACE_LOOKUP_OPERATION
  requestId?: string
  quotaSessionId?: string
  query: string
  locale?: ProviderProxyPlaceLookupLocale
  region?: string
  maxResults?: number
}

export type ProviderProxyValidatedPlaceLookupRequest = ProviderProxyPlaceLookupRequest & {
  maxResults: number
}

export type ProviderProxyPlaceLookupResult = {
  placeId: string
  displayName: string
  formattedAddress: string
  location?: {
    lat: number
    lng: number
  }
  googleMapsUri?: string
  provider: 'google_places'
  retrievedAt: string
}

export type ProviderProxyPlaceLookupSuccessResponse = {
  ok: true
  operation: typeof PROVIDER_PROXY_PLACE_LOOKUP_OPERATION
  requestId?: string
  source: 'mock' | 'google_places'
  retrievedAt: string
  results: ProviderProxyPlaceLookupResult[]
  warnings?: string[]
}

export type ProviderProxyPlaceLookupResponse =
  | ProviderProxyPlaceLookupSuccessResponse
  | ProviderProxyErrorResponse

export type ProviderProxyPlaceLookupValidationResult =
  | { ok: true; request: ProviderProxyValidatedPlaceLookupRequest }
  | { error: ProviderProxyErrorResponse; ok: false }

export type ProviderProxyPlaceDetailsRequest = {
  operation: typeof PROVIDER_PROXY_PLACE_DETAILS_OPERATION
  requestId?: string
  quotaSessionId?: string
  placeId: string
  locale?: ProviderProxyPlaceLookupLocale
  region?: string
}

export type ProviderProxyValidatedPlaceDetailsRequest = ProviderProxyPlaceDetailsRequest

export type ProviderProxyPlaceDetailsResult = {
  placeId: string
  displayName: string
  formattedAddress?: string
  location?: {
    lat: number
    lng: number
  }
  googleMapsUri?: string
  websiteUri?: string
  regularOpeningHours?: {
    openNow?: boolean
    weekdayDescriptions: string[]
  }
  priceLevel?: string
  priceRangeText?: string
  editorialSummary?: string
  provider: 'google_places'
  retrievedAt: string
}

export type ProviderProxyPlaceDetailsSuccessResponse = {
  ok: true
  operation: typeof PROVIDER_PROXY_PLACE_DETAILS_OPERATION
  requestId?: string
  source: 'mock' | 'google_places'
  retrievedAt: string
  details: ProviderProxyPlaceDetailsResult
  warnings?: string[]
}

export type ProviderProxyPlaceDetailsResponse =
  | ProviderProxyPlaceDetailsSuccessResponse
  | ProviderProxyErrorResponse

export type ProviderProxyPlaceDetailsValidationResult =
  | { ok: true; request: ProviderProxyValidatedPlaceDetailsRequest }
  | { error: ProviderProxyErrorResponse; ok: false }

export type ProviderProxyTripContentEnrichmentSourceSummary = {
  id: string
  confidence: ContentEnrichmentConfidence
  displayUrl?: string
  domain?: string
  label: string
  retrievedAt: string
  snippet?: string
  sourceType: ContentEnrichmentSourceType
  title: string
  url?: string
}

export type ProviderProxyTripContentEnrichmentPlaceSummary = {
  placeId: string
  displayName: string
  formattedAddress?: string
  googleMapsUri?: string
  websiteUri?: string
  regularOpeningHours?: ProviderProxyPlaceDetailsResult['regularOpeningHours']
  priceLevel?: string
  priceRangeText?: string
  editorialSummary?: string
  retrievedAt: string
}

export type ProviderProxyTripContentEnrichmentItemInput = {
  itemId: string
  title: string
  destination?: string
  dayTitle?: string
  date?: string
  locationName?: string
  address?: string
  place?: ProviderProxyTripContentEnrichmentPlaceSummary
  sources: ProviderProxyTripContentEnrichmentSourceSummary[]
}

export type ProviderProxyTripContentEnrichmentRequest = {
  operation: typeof PROVIDER_PROXY_TRIP_CONTENT_ENRICHMENT_OPERATION
  requestId?: string
  quotaSessionId?: string
  locale?: ProviderProxyPlaceLookupLocale
  items: ProviderProxyTripContentEnrichmentItemInput[]
}

export type ProviderProxyTripContentEnrichmentFact = {
  text: string
  sourceIds: string[]
}

export type ProviderProxyTripContentEnrichmentStay = {
  basis: 'ai_estimate' | 'source'
  durationMinutes: number
  reason: string
  sourceIds?: string[]
  text: string
}

export type ProviderProxyTripContentEnrichmentItemResult = {
  itemId: string
  introduction?: ProviderProxyTripContentEnrichmentFact
  openingHours?: ProviderProxyTripContentEnrichmentFact
  ticketPrice?: ProviderProxyTripContentEnrichmentFact & {
    kind?: 'admission' | 'place_price_level' | 'unknown'
  }
  notices?: ProviderProxyTripContentEnrichmentFact[]
  recommendedStay?: ProviderProxyTripContentEnrichmentStay
  warnings?: string[]
}

export type ProviderProxyTripContentEnrichmentSuccessResponse = {
  ok: true
  operation: typeof PROVIDER_PROXY_TRIP_CONTENT_ENRICHMENT_OPERATION
  requestId?: string
  source: 'mock' | 'future_ai'
  items: ProviderProxyTripContentEnrichmentItemResult[]
  warnings?: string[]
}

export type ProviderProxyTripContentEnrichmentResponse =
  | ProviderProxyTripContentEnrichmentSuccessResponse
  | ProviderProxyErrorResponse

export type ProviderProxyTripContentEnrichmentValidationResult =
  | { ok: true; request: ProviderProxyTripContentEnrichmentRequest }
  | { error: ProviderProxyErrorResponse; ok: false }

export type ProviderProxyTripDailyTipMode = 'pre_trip' | 'today' | 'tomorrow' | 'completed'
export type ProviderProxyTripDailyTipSectionKey = 'opening_hours' | 'ticket_price' | 'notices' | 'route_risk'

export type ProviderProxyTripDailyTipLocalSection = {
  key: ProviderProxyTripDailyTipSectionKey
  title: string
  items: Array<{
    sourceIds?: string[]
    text: string
    title: string
  }>
}

export type ProviderProxyTripDailyTipRequestItem = {
  endTime?: string
  itemId: string
  locationName?: string
  startTime?: string
  title: string
}

export type ProviderProxyTripDailyTipRequest = {
  dayTitle?: string
  destination: string
  generatedAt?: string
  items: ProviderProxyTripDailyTipRequestItem[]
  localSections: ProviderProxyTripDailyTipLocalSection[]
  mode: ProviderProxyTripDailyTipMode
  operation: typeof PROVIDER_PROXY_TRIP_DAILY_TIP_OPERATION
  quotaSessionId?: string
  requestId?: string
  routeStatus?: 'no_coordinates' | 'not_enough_points' | 'ready_to_generate' | 'cached' | 'stale_if_cache_key_changed'
  sources: ProviderProxyTripContentEnrichmentSourceSummary[]
  targetDate?: string
  tripTitle: string
}

export type ProviderProxyTripDailyTipSectionResult = {
  key: ProviderProxyTripDailyTipSectionKey
  sourceIds: string[]
  text: string
  title: string
}

export type ProviderProxyTripDailyTipSuccessResponse = {
  ok: true
  operation: typeof PROVIDER_PROXY_TRIP_DAILY_TIP_OPERATION
  requestId?: string
  sections: ProviderProxyTripDailyTipSectionResult[]
  source: 'mock' | 'future_ai'
  sourceIds: string[]
  summary: string
  warnings?: string[]
}

export type ProviderProxyTripDailyTipResponse =
  | ProviderProxyTripDailyTipSuccessResponse
  | ProviderProxyErrorResponse

export type ProviderProxyTripDailyTipValidationResult =
  | { ok: true; request: ProviderProxyTripDailyTipRequest }
  | { error: ProviderProxyErrorResponse; ok: false }

export type ProviderProxyTripOperationsPhase = 'pre_trip' | 'travel_morning' | 'traveling' | 'travel_evening' | 'post_trip'
export type ProviderProxyTripOperationsSeverity = 'low' | 'medium' | 'high'

export type ProviderProxyTripOperationsRecommendationInput = {
  actionKind: string
  actionLabel: string
  message: string
  severity: ProviderProxyTripOperationsSeverity
  title: string
  type: string
}

export type ProviderProxyTripOperationsSummaryRequest = {
  destination?: string
  generatedAt?: string
  operation: typeof PROVIDER_PROXY_TRIP_OPERATIONS_SUMMARY_OPERATION
  phase: ProviderProxyTripOperationsPhase
  quotaSessionId?: string
  recommendations: ProviderProxyTripOperationsRecommendationInput[]
  requestId?: string
  tripTitle: string
}

export type ProviderProxyTripOperationsSummarySuccessResponse = {
  highlights: string[]
  ok: true
  operation: typeof PROVIDER_PROXY_TRIP_OPERATIONS_SUMMARY_OPERATION
  requestId?: string
  source: 'mock' | 'future_ai'
  summary: string
  warnings?: string[]
}

export type ProviderProxyTripOperationsSummaryResponse =
  | ProviderProxyTripOperationsSummarySuccessResponse
  | ProviderProxyErrorResponse

export type ProviderProxyTripOperationsSummaryValidationResult =
  | { ok: true; request: ProviderProxyTripOperationsSummaryRequest }
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
const VALID_TRAVEL_SEARCH_TYPES = new Set<ProviderProxyTravelSearchType>(['general', 'opening_hours', 'ticket_price', 'official_site', 'transport', 'nearby_food'])
const VALID_TRAVEL_SEARCH_SOURCE_TYPES = new Set<ProviderProxyTravelSearchSourceType>(['official', 'map', 'ticketing', 'travel_site', 'unknown'])
const VALID_TRAVEL_SEARCH_CONFIDENCES = new Set<ProviderProxyTravelSearchConfidence>(['low', 'medium', 'high'])
const VALID_PLACE_LOOKUP_LOCALES = new Set<ProviderProxyPlaceLookupLocale>(['zh-CN', 'en-US'])
const VALID_CONTENT_ENRICHMENT_SOURCE_TYPES = new Set<ContentEnrichmentSourceType>(['google_places', 'official', 'map', 'ticketing', 'travel_site', 'ai_estimate', 'unknown'])
const VALID_CONTENT_ENRICHMENT_CONFIDENCES = new Set<ContentEnrichmentConfidence>(['high', 'medium', 'low', 'unknown'])
const VALID_TRIP_DAILY_TIP_MODES = new Set<ProviderProxyTripDailyTipMode>(['pre_trip', 'today', 'tomorrow', 'completed'])
const VALID_TRIP_DAILY_TIP_SECTION_KEYS = new Set<ProviderProxyTripDailyTipSectionKey>(['opening_hours', 'ticket_price', 'notices', 'route_risk'])
const VALID_TRIP_DAILY_TIP_ROUTE_STATUSES = new Set<NonNullable<ProviderProxyTripDailyTipRequest['routeStatus']>>(['no_coordinates', 'not_enough_points', 'ready_to_generate', 'cached', 'stale_if_cache_key_changed'])
const VALID_TRIP_OPERATIONS_PHASES = new Set<ProviderProxyTripOperationsPhase>(['pre_trip', 'travel_morning', 'traveling', 'travel_evening', 'post_trip'])
const VALID_TRIP_OPERATIONS_SEVERITIES = new Set<ProviderProxyTripOperationsSeverity>(['low', 'medium', 'high'])
const VALID_EXISTING_TRIP_IMPORT_SOURCE_KINDS = new Set<ExistingTripImportSourceKind>(['pasted_text', 'text_file', 'email', 'html', 'pdf', 'image', 'trip_plan', 'ticket_file'])
const ROUTE_ORDER_ALLOWED_TOP_LEVEL_FIELDS = new Set([
  'dayId',
  'items',
  'operation',
  'provider',
  'quotaSessionId',
  'requestId',
  'tripId',
])
const ROUTE_ORDER_ALLOWED_ITEM_FIELDS = new Set([
  'address',
  'coordinate',
  'id',
  'locationName',
  'title',
])
const ROUTE_ORDER_ALLOWED_COORDINATE_FIELDS = new Set(['lat', 'lng'])
const FORBIDDEN_TRAVEL_SEARCH_FIELDS = new Set([
  'apikey',
  'authorization',
  'cloudtoken',
  'coordinates',
  'days',
  'fulltrip',
  'headers',
  'itineraryitems',
  'items',
  'localdb',
  'providerkey',
  'routecache',
  'ticketid',
  'ticketids',
  'ticketblobs',
  'ticketmetas',
  'token',
  'trip',
])
const FORBIDDEN_PLACE_LOOKUP_FIELDS = new Set([
  'apikey',
  'authorization',
  'blob',
  'blobs',
  'cloud',
  'cloudstate',
  'cloudstatus',
  'cloudtoken',
  'coordinates',
  'days',
  'file',
  'filename',
  'filenames',
  'files',
  'fulldb',
  'fulltrip',
  'headers',
  'itineraryitems',
  'items',
  'lat',
  'lng',
  'localdb',
  'note',
  'notes',
  'ocr',
  'providerkey',
  'routecache',
  'ticket',
  'tickets',
  'ticketid',
  'ticketids',
  'ticketblobs',
  'ticketfiles',
  'ticketmetas',
  'token',
  'trip',
])
const FORBIDDEN_PLACE_DETAILS_FIELDS = new Set([
  ...FORBIDDEN_PLACE_LOOKUP_FIELDS,
  'query',
  'search',
])
const FORBIDDEN_TRIP_CONTENT_ENRICHMENT_FIELDS = new Set([
  'apikey',
  'authorization',
  'bearer',
  'blob',
  'blobs',
  'cloud',
  'cloudstate',
  'cloudstatus',
  'cloudtoken',
  'coordinates',
  'days',
  'file',
  'filename',
  'filenames',
  'files',
  'fulldb',
  'fulltrip',
  'headers',
  'itineraryitems',
  'lat',
  'lng',
  'localdb',
  'note',
  'notes',
  'ocr',
  'providerkey',
  'route',
  'routecache',
  'ticket',
  'tickets',
  'ticketid',
  'ticketids',
  'ticketblobs',
  'ticketfiles',
  'ticketmetas',
  'token',
  'trip',
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
  'ticketId',
  'ticketIds',
  'externalUrl',
  'url',
  'fileName',
  'fileNames',
  'blob',
  'blobs',
  'route',
  'cloud',
  'cloudStatus',
])
const FORBIDDEN_EXISTING_TRIP_IMPORT_FIELDS = new Set([
  'apiKey',
  'apikey',
  'Authorization',
  'authorization',
  'Bearer',
  'bearer',
  'blob',
  'blobs',
  'cloud',
  'cloudState',
  'cloudStatus',
  'cloudToken',
  'coordinates',
  'externalUrl',
  'file',
  'files',
  'headers',
  'lat',
  'lng',
  'localDb',
  'localdb',
  'providerKey',
  'route',
  'routeCache',
  'ticket',
  'tickets',
  'ticketBlob',
  'ticketBlobs',
  'ticketFile',
  'ticketFiles',
  'ticketId',
  'ticketIds',
  'ticketMeta',
  'ticketMetas',
  'token',
])
const MAX_TRAVEL_SEARCH_QUERY_LENGTH = 300
const MAX_TRAVEL_SEARCH_REGION_LENGTH = 80
const DEFAULT_TRAVEL_SEARCH_MAX_RESULTS = 5
const MAX_PLACE_LOOKUP_QUERY_LENGTH = 200
const DEFAULT_PLACE_LOOKUP_MAX_RESULTS = 5
const MAX_PLACE_ID_LENGTH = 220
const MAX_TRIP_CONTENT_ENRICHMENT_ITEMS = 6
const MAX_TRIP_CONTENT_ENRICHMENT_SOURCES_PER_ITEM = 8
const MAX_TRIP_CONTENT_ENRICHMENT_TEXT = 700
const MAX_TRIP_CONTENT_ENRICHMENT_SOURCE_SNIPPET = 500
const MAX_TRIP_DAILY_TIP_ITEMS = 20
const MAX_TRIP_DAILY_TIP_LOCAL_SECTIONS = 4
const MAX_TRIP_DAILY_TIP_LOCAL_SECTION_ITEMS = 5
const MAX_TRIP_DAILY_TIP_SOURCES = 12
const MAX_TRIP_DAILY_TIP_TEXT = 700
const MAX_TRIP_OPERATIONS_RECOMMENDATIONS = 5
const MAX_TRIP_OPERATIONS_TEXT = 220
const MAX_AI_TRIP_EDIT_SEARCH_RESULTS = 3
const MAX_AI_TRIP_EDIT_SEARCH_SNIPPET_LENGTH = 500
const AI_TRIP_EDIT_SEARCH_ALLOWED_FIELDS = new Set(['query', 'source', 'retrievedAt', 'results', 'warnings'])
const AI_TRIP_EDIT_SEARCH_RESULT_ALLOWED_FIELDS = new Set(['title', 'url', 'displayUrl', 'domain', 'snippet', 'retrievedAt', 'sourceType', 'confidence'])
const MAX_EXISTING_TRIP_IMPORT_DAYS = 120
const MAX_EXISTING_TRIP_IMPORT_ITEMS = 1000
const MAX_EXISTING_TRIP_IMPORT_EXISTING_TICKETS = 1000
const MAX_EXISTING_TRIP_IMPORT_SOURCES = 12
const MAX_EXISTING_TRIP_IMPORT_SOURCE_TEXT_LENGTH = 4000
const MAX_EXISTING_TRIP_IMPORT_TOTAL_TEXT_LENGTH = 24000
const MAX_EXISTING_TRIP_IMPORT_TEXT_FIELD = 240
const MAX_TRAVEL_INBOX_CLASSIFY_TRIPS = 30
const VALID_TRAVEL_INBOX_CATEGORIES = new Set<TravelInboxEntryCategory>(['unclassified', 'itinerary', 'ticket', 'note', 'mixed'])
const EXISTING_TRIP_IMPORT_TICKET_SUMMARY_ALLOWED_FIELDS = new Set(['itemId', 'scope', 'summaryId', 'ticketCategory', 'title'])

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

export function validateProviderProxyRouteOrderSuggestionRequest(
  input: unknown,
): ProviderProxyRouteOrderSuggestionValidationResult {
  const record = readRecord(input)
  const requestId = readOptionalString(record.requestId, 128)

  if (record.operation !== PROVIDER_PROXY_ROUTE_ORDER_SUGGESTION_OPERATION) {
    return routeOrderSuggestionInvalidRequest('不支持的 provider proxy 操作。', requestId)
  }

  const topLevelViolation = findDisallowedObjectFieldPath(record, ROUTE_ORDER_ALLOWED_TOP_LEVEL_FIELDS)
  if (topLevelViolation) {
    return routeOrderSuggestionInvalidRequest('路线顺序建议请求包含不允许的字段。', requestId)
  }

  const provider = record.provider ?? 'auto'
  if (!isProviderProxyProvider(provider)) {
    return routeOrderSuggestionInvalidRequest('路线顺序建议 provider 无效。', requestId)
  }

  if (!Array.isArray(record.items)) {
    return routeOrderSuggestionInvalidRequest('路线顺序建议缺少行程点。', requestId)
  }
  if (record.items.length > PROVIDER_PROXY_MAX_ROUTE_ORDER_ITEMS) {
    return routeOrderSuggestionInvalidRequest(`路线顺序建议最多支持 ${PROVIDER_PROXY_MAX_ROUTE_ORDER_ITEMS} 个行程点。`, requestId)
  }

  const items: ProviderProxyRouteOrderSuggestionItem[] = []
  const seenIds = new Set<string>()
  let coordinateItemCount = 0
  for (const [index, rawItem] of record.items.entries()) {
    const itemRecord = readRecord(rawItem)
    const itemViolation = findDisallowedObjectFieldPath(itemRecord, ROUTE_ORDER_ALLOWED_ITEM_FIELDS, `$.items[${index}]`)
    if (itemViolation) {
      return routeOrderSuggestionInvalidRequest('路线顺序建议行程点包含不允许的字段。', requestId)
    }

    const id = typeof itemRecord.id === 'string' ? itemRecord.id.trim() : ''
    if (!id) {
      return routeOrderSuggestionInvalidRequest('路线顺序建议行程点缺少 ID。', requestId)
    }
    if (seenIds.has(id)) {
      return routeOrderSuggestionInvalidRequest('路线顺序建议行程点 ID 不能重复。', requestId)
    }
    seenIds.add(id)

    const title = typeof itemRecord.title === 'string' ? itemRecord.title.trim() : ''
    if (!title) {
      return routeOrderSuggestionInvalidRequest('路线顺序建议行程点缺少标题。', requestId)
    }

    const coordinate = normalizeRouteOrderCoordinate(itemRecord.coordinate)
    if (itemRecord.coordinate !== undefined && !coordinate) {
      return routeOrderSuggestionInvalidRequest('路线顺序建议行程点坐标无效。', requestId)
    }
    if (coordinate) {
      coordinateItemCount += 1
    }

    items.push({
      address: readOptionalString(itemRecord.address, 240),
      coordinate,
      id,
      locationName: readOptionalString(itemRecord.locationName, 160),
      title,
    })
  }

  if (coordinateItemCount < 2) {
    return routeOrderSuggestionInvalidRequest('路线顺序建议至少需要 2 个带坐标的行程点。', requestId)
  }

  return {
    ok: true,
    request: {
      dayId: readOptionalString(record.dayId, 128),
      items,
      operation: PROVIDER_PROXY_ROUTE_ORDER_SUGGESTION_OPERATION,
      provider,
      quotaSessionId: readOptionalString(record.quotaSessionId, 160),
      requestId,
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
    if (code === 'quota_exceeded') return '今日 AI 行程生成次数已达上限。'
    if (code === 'invalid_request') return 'AI 行程生成请求无效。'
    if (code === 'provider_error') return 'AI 行程生成服务请求失败。'
    if (code === 'network_error') return '网络异常或请求超时。'
    if (code === 'unsupported') return '当前 AI 行程生成请求暂不支持。'
    if (code === 'invalid_response') return 'AI 行程生成服务返回的内容无法解析。'
    return 'AI 行程生成服务暂不可用。'
  }
  if (operation === PROVIDER_PROXY_AI_TRIP_DRAFT_REPAIR_OPERATION) {
    if (code === 'quota_exceeded') return '今日 AI 行程修复次数已达上限。'
    if (code === 'invalid_request') return 'AI 行程修复请求无效。'
    if (code === 'provider_error') return 'AI 行程修复服务请求失败。'
    if (code === 'network_error') return '网络异常或请求超时。'
    if (code === 'unsupported') return '当前 AI 行程修复请求暂不支持。'
    if (code === 'invalid_response') return 'AI 行程修复服务返回的内容无法解析。'
    return 'AI 行程修复服务暂不可用。'
  }
  if (operation === PROVIDER_PROXY_AI_TRIP_DRAFT_REFINE_OPERATION) {
    if (code === 'quota_exceeded') return '今日 AI 行程优化次数已达上限。'
    if (code === 'invalid_request') return 'AI 行程优化请求无效。'
    if (code === 'provider_error') return 'AI 行程优化服务请求失败。'
    if (code === 'network_error') return '网络异常或请求超时。'
    if (code === 'unsupported') return '当前 AI 行程优化请求暂不支持。'
    if (code === 'invalid_response') return 'AI 行程优化服务返回的内容无法解析。'
    return 'AI 行程优化服务暂不可用。'
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
  if (operation === PROVIDER_PROXY_AI_EXISTING_TRIP_IMPORT_OPERATION) {
    if (code === 'quota_exceeded') return '今日 AI 识别导入次数已达上限。'
    if (code === 'invalid_request') return 'AI 识别导入请求无效。'
    if (code === 'provider_error') return 'AI 识别导入服务请求失败。'
    if (code === 'network_error') return '网络异常或请求超时。'
    if (code === 'unsupported') return '当前 AI 识别导入暂不支持。'
    if (code === 'invalid_response') return 'AI 识别导入服务返回的内容无法解析。'
    return 'AI 识别导入服务暂不可用。'
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
  if (operation === PROVIDER_PROXY_PLACE_LOOKUP_OPERATION) {
    if (code === 'quota_exceeded') return '今日地点查询次数已达上限。'
    if (code === 'invalid_request') return '地点查询请求无效。'
    if (code === 'provider_error') return '地点查询服务请求失败。'
    if (code === 'network_error') return '网络异常或请求超时。'
    if (code === 'unsupported') return '当前地点查询请求暂不支持。'
    if (code === 'invalid_response') return '地点查询服务返回的内容无法解析。'
    return '地点查询服务暂不可用。'
  }
  if (operation === PROVIDER_PROXY_PLACE_DETAILS_OPERATION) {
    if (code === 'quota_exceeded') return '今日地点详情次数已达上限。'
    if (code === 'invalid_request') return '地点详情请求无效。'
    if (code === 'provider_error') return '地点详情服务请求失败。'
    if (code === 'network_error') return '网络异常或请求超时。'
    if (code === 'unsupported') return '当前地点详情请求暂不支持。'
    if (code === 'invalid_response') return '地点详情服务返回的内容无法解析。'
    return '地点详情服务暂不可用。'
  }
  if (operation === PROVIDER_PROXY_TRIP_CONTENT_ENRICHMENT_OPERATION) {
    if (code === 'quota_exceeded') return '今日内容补充次数已达上限。'
    if (code === 'invalid_request') return '内容补充请求无效。'
    if (code === 'provider_error') return '内容补充服务请求失败。'
    if (code === 'network_error') return '网络异常或请求超时。'
    if (code === 'unsupported') return '当前内容补充请求暂不支持。'
    if (code === 'invalid_response') return '内容补充服务返回的内容无法解析。'
    return '内容补充服务暂不可用。'
  }
  if (operation === PROVIDER_PROXY_TRIP_DAILY_TIP_OPERATION) {
    if (code === 'quota_exceeded') return '今日旅行提示生成次数已达上限。'
    if (code === 'invalid_request') return '今日旅行提示请求无效。'
    if (code === 'provider_error') return '今日旅行提示服务请求失败。'
    if (code === 'network_error') return '网络异常或请求超时。'
    if (code === 'unsupported') return '当前今日旅行提示暂不支持。'
    if (code === 'invalid_response') return '今日旅行提示服务返回的内容无法解析。'
    return '今日旅行提示服务暂不可用。'
  }
  if (operation === PROVIDER_PROXY_TRIP_OPERATIONS_SUMMARY_OPERATION) {
    if (code === 'quota_exceeded') return '今日执行建议摘要次数已达上限。'
    if (code === 'invalid_request') return '执行建议摘要请求无效。'
    if (code === 'provider_error') return '执行建议摘要服务请求失败。'
    if (code === 'network_error') return '网络异常或请求超时。'
    if (code === 'unsupported') return '当前执行建议摘要暂不支持。'
    if (code === 'invalid_response') return '执行建议摘要服务返回的内容无法解析。'
    return '执行建议摘要服务暂不可用。'
  }
  if (operation === PROVIDER_PROXY_ROUTE_ORDER_SUGGESTION_OPERATION) {
    if (code === 'quota_exceeded') return '今日路线建议次数已达上限。'
    if (code === 'invalid_request') return '路线顺序建议请求无效。'
    if (code === 'provider_error') return '路线顺序建议服务请求失败。'
    if (code === 'network_error') return '网络异常或请求超时。'
    if (code === 'unsupported') return '当前路线顺序建议暂不支持。'
    if (code === 'invalid_response') return '路线顺序建议服务返回的内容无法解析。'
    return '路线顺序建议服务暂不可用。'
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

function normalizeRouteOrderCoordinate(input: unknown): ProviderProxyRouteOrderSuggestionItem['coordinate'] | undefined {
  if (input === undefined) {
    return undefined
  }
  const record = readRecord(input)
  const disallowed = findDisallowedObjectFieldPath(record, ROUTE_ORDER_ALLOWED_COORDINATE_FIELDS)
  if (disallowed) {
    return undefined
  }
  const lat = Number(record.lat)
  const lng = Number(record.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return undefined
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return undefined
  }
  return { lat, lng }
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

function readOptionalTimeZone(value: unknown) {
  const timeZone = readOptionalString(value, 128)
  if (!timeZone) {
    return undefined
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0))
    return timeZone
  } catch {
    return undefined
  }
}

function readRequiredTrimmedString(value: unknown, maxLength: number) {
  return readOptionalString(value, maxLength) ?? ''
}

function clampText(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1)).trim()}…`
}

function readRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? input as Record<string, unknown> : {}
}

function readOptionalPositiveInteger(value: unknown) {
  if (value === undefined) {
    return undefined
  }
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim())
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
  return undefined
}

function readInterestTags(value: unknown): { ok: true; tags?: string[] } | { message: string; ok: false } {
  if (value === undefined) {
    return { ok: true }
  }
  if (!Array.isArray(value)) {
    return { message: '兴趣标签必须是数组。', ok: false }
  }
  if (value.length > MAX_AI_INTEREST_TAGS) {
    return { message: `兴趣标签不能超过 ${MAX_AI_INTEREST_TAGS} 个。`, ok: false }
  }
  if (value.some((tag) => typeof tag !== 'string' || tag.trim().length === 0)) {
    return { message: `每个兴趣标签必须为 1 到 ${MAX_AI_INTEREST_TAG_LENGTH} 个字符。`, ok: false }
  }
  const tags = Array.from(new Set(value.map((tag) => tag.trim())))
  if (tags.some((tag) => tag.length > MAX_AI_INTEREST_TAG_LENGTH)) {
    return { message: `每个兴趣标签必须为 1 到 ${MAX_AI_INTEREST_TAG_LENGTH} 个字符。`, ok: false }
  }
  return { ok: true, tags: tags.length > 0 ? tags : undefined }
}

function findDisallowedObjectFieldPath(input: unknown, allowedFields: Set<string>, path = '$'): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return `${path}`
  }
  for (const key of Object.keys(input as Record<string, unknown>)) {
    if (!allowedFields.has(key)) {
      return `${path}.${key}`
    }
  }
  return null
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
const MAX_AI_PARTY_SIZE = 99
const MAX_AI_INTEREST_TAGS = 12
const MAX_AI_INTEREST_TAG_LENGTH = 40

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

  const dayCount = readOptionalPositiveInteger(record.dayCount)
  if (record.dayCount !== undefined && dayCount === undefined) {
    return aiDraftInvalidRequest(`天数必须是 1 到 ${MAX_AI_DAYS} 之间的整数。`, requestId)
  }
  if (dayCount !== undefined && dayCount > MAX_AI_DAYS) {
    return aiDraftInvalidRequest(`天数必须是 1 到 ${MAX_AI_DAYS} 之间的整数。`, requestId)
  }
  if (dayCount !== undefined && dates.length > 0 && dayCount !== dates.length) {
    return aiDraftInvalidRequest('天数需要和日期范围一致。', requestId)
  }

  const partySize = readOptionalPositiveInteger(record.partySize)
  if (record.partySize !== undefined && partySize === undefined) {
    return aiDraftInvalidRequest(`同行人数必须是 1 到 ${MAX_AI_PARTY_SIZE} 之间的整数。`, requestId)
  }
  if (partySize !== undefined && partySize > MAX_AI_PARTY_SIZE) {
    return aiDraftInvalidRequest(`同行人数必须是 1 到 ${MAX_AI_PARTY_SIZE} 之间的整数。`, requestId)
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

  const rawInterestText = typeof record.interestText === 'string' ? record.interestText.trim() : undefined
  if (rawInterestText && rawInterestText.length > MAX_AI_FREE_TEXT_LENGTH) {
    return aiDraftInvalidRequest(`"兴趣偏好"不能超过 ${MAX_AI_FREE_TEXT_LENGTH} 个字符。`, requestId)
  }

  const interestTagsResult = readInterestTags(record.interestTags)
  if (!interestTagsResult.ok) {
    return aiDraftInvalidRequest(interestTagsResult.message, requestId)
  }

  const mustVisitText = rawMustVisit || undefined
  const avoidText = rawAvoid || undefined
  const freeTextRequirement = rawFreeText || undefined
  const interestText = rawInterestText || undefined

  return {
    ok: true,
    request: {
      dayCount,
      destination,
      endDate,
      freeTextRequirement,
      interestTags: interestTagsResult.tags,
      interestText,
      mealTimeProtection: typeof record.mealTimeProtection === 'boolean' ? record.mealTimeProtection : undefined,
      mustVisitText,
      avoidText,
      operation: PROVIDER_PROXY_AI_TRIP_DRAFT_OPERATION,
      partySize,
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
    dayCount: request.dayCount,
    endDate: request.endDate,
    freeTextRequirement: request.freeTextRequirement,
    interestTags: request.interestTags,
    interestText: request.interestText,
    mealTimeProtection: request.mealTimeProtection,
    mustVisitText: request.mustVisitText,
    avoidText: request.avoidText,
    partySize: request.partySize,
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

function aiDraftRefineInvalidRequest(message: string, requestId?: string): ProviderProxyAiTripDraftRefineValidationResult {
  return {
    error: buildProviderProxyErrorResponse({
      code: 'invalid_request',
      message,
      operation: PROVIDER_PROXY_AI_TRIP_DRAFT_REFINE_OPERATION,
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

function placeLookupInvalidRequest(message: string, requestId?: string): ProviderProxyPlaceLookupValidationResult {
  return {
    error: buildProviderProxyErrorResponse({
      code: 'invalid_request',
      message,
      operation: PROVIDER_PROXY_PLACE_LOOKUP_OPERATION,
      requestId,
    }),
    ok: false,
  }
}

function placeDetailsInvalidRequest(message: string, requestId?: string): ProviderProxyPlaceDetailsValidationResult {
  return {
    error: buildProviderProxyErrorResponse({
      code: 'invalid_request',
      message,
      operation: PROVIDER_PROXY_PLACE_DETAILS_OPERATION,
      requestId,
    }),
    ok: false,
  }
}

function tripContentEnrichmentInvalidRequest(
  message: string,
  requestId?: string,
): ProviderProxyTripContentEnrichmentValidationResult {
  return {
    error: buildProviderProxyErrorResponse({
      code: 'invalid_request',
      message,
      operation: PROVIDER_PROXY_TRIP_CONTENT_ENRICHMENT_OPERATION,
      requestId,
    }),
    ok: false,
  }
}

function tripDailyTipInvalidRequest(
  message: string,
  requestId?: string,
): ProviderProxyTripDailyTipValidationResult {
  return {
    error: buildProviderProxyErrorResponse({
      code: 'invalid_request',
      message,
      operation: PROVIDER_PROXY_TRIP_DAILY_TIP_OPERATION,
      requestId,
    }),
    ok: false,
  }
}

function tripOperationsSummaryInvalidRequest(
  message: string,
  requestId?: string,
): ProviderProxyTripOperationsSummaryValidationResult {
  return {
    error: buildProviderProxyErrorResponse({
      code: 'invalid_request',
      message,
      operation: PROVIDER_PROXY_TRIP_OPERATIONS_SUMMARY_OPERATION,
      requestId,
    }),
    ok: false,
  }
}

function existingTripImportInvalidRequest(
  message: string,
  requestId?: string,
): ProviderProxyExistingTripImportValidationResult {
  return {
    error: buildProviderProxyErrorResponse({
      code: 'invalid_request',
      message,
      operation: PROVIDER_PROXY_AI_EXISTING_TRIP_IMPORT_OPERATION,
      requestId,
    }),
    ok: false,
  }
}

function routeOrderSuggestionInvalidRequest(
  message: string,
  requestId?: string,
): ProviderProxyRouteOrderSuggestionValidationResult {
  return {
    error: buildProviderProxyErrorResponse({
      code: 'invalid_request',
      message,
      operation: PROVIDER_PROXY_ROUTE_ORDER_SUGGESTION_OPERATION,
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

export function validateProviderProxyAiTripDraftRefineRequest(input: unknown): ProviderProxyAiTripDraftRefineValidationResult {
  const record = readRecord(input)
  const requestId = readOptionalString(record.requestId, 128)

  if (record.operation !== PROVIDER_PROXY_AI_TRIP_DRAFT_REFINE_OPERATION) {
    return aiDraftRefineInvalidRequest('不支持的 provider proxy 操作。', requestId)
  }

  if (record.draft === undefined || record.draft === null) {
    return aiDraftRefineInvalidRequest('缺少 draft 参数。', requestId)
  }

  const draftValidation = validateAiTripDraft(record.draft)
  if (!draftValidation.valid || !draftValidation.draft) {
    return aiDraftRefineInvalidRequest('draft 未通过 schema 校验。', requestId)
  }

  const scopeResult = readRefineScope(record.scope, draftValidation.draft)
  if (!scopeResult.ok) {
    return aiDraftRefineInvalidRequest(scopeResult.message, requestId)
  }

  const preferencesResult = readRefinePreferences(record.preferences)
  if (!preferencesResult.ok) {
    return aiDraftRefineInvalidRequest(preferencesResult.message, requestId)
  }

  if (record.guidance !== undefined && typeof record.guidance !== 'string') {
    return aiDraftRefineInvalidRequest('guidance 必须是字符串。', requestId)
  }
  if (typeof record.guidance === 'string' && record.guidance.length > MAX_REPAIR_INSTRUCTION_LENGTH) {
    return aiDraftRefineInvalidRequest(`guidance 不能超过 ${MAX_REPAIR_INSTRUCTION_LENGTH} 个字符。`, requestId)
  }

  return {
    ok: true,
    request: {
      draft: draftValidation.draft,
      guidance: readOptionalString(record.guidance, MAX_REPAIR_INSTRUCTION_LENGTH),
      operation: PROVIDER_PROXY_AI_TRIP_DRAFT_REFINE_OPERATION,
      preferences: preferencesResult.preferences,
      quotaSessionId: readOptionalString(record.quotaSessionId, 128),
      requestId,
      scope: scopeResult.scope,
    },
  }
}

export function buildMockAiTripDraftRefineProxyResponse(
  request: ProviderProxyAiTripDraftRefineRequest,
): ProviderProxyAiTripDraftRefineSuccessResponse {
  const mockDraft = generateMockAiTripDraft({
    destination: request.draft.destination,
    endDate: request.draft.endDate,
    mealTimeProtection: request.preferences?.mealTimeProtection,
    mustVisitText: request.preferences?.mustVisitText,
    avoidText: request.preferences?.avoidText,
    freeTextRequirement: request.preferences?.freeTextRequirement,
    interestTags: request.preferences?.interestTags,
    interestText: request.preferences?.interestText,
    partySize: request.preferences?.partySize,
    pace: request.preferences?.pace,
    preferTransport: request.preferences?.preferTransport,
    startDate: request.draft.startDate,
  })
  const mockDaysByDate = new Map(mockDraft.days.map((day) => [day.date, day]))
  const days = request.draft.days.map((day) => {
    if (!isDateInRefineScope(day.date, request.scope)) {
      return day
    }
    return mockDaysByDate.get(day.date) ?? day
  })

  return {
    draft: {
      ...request.draft,
      days,
    },
    ok: true,
    operation: PROVIDER_PROXY_AI_TRIP_DRAFT_REFINE_OPERATION,
    requestId: request.requestId,
    source: 'mock',
    warnings: ['当前为本地示例优化，非真实 AI 生成。'],
  }
}

function readRefineScope(
  input: unknown,
  draft: AiTripDraft,
): { ok: true; scope: ProviderProxyAiTripDraftRefineScope } | { message: string; ok: false } {
  const record = readRecord(input)
  const draftDates = new Set(draft.days.map((day) => day.date))
  if (record.kind === 'day') {
    const date = typeof record.date === 'string' ? record.date.trim() : ''
    if (!isValidPlainDate(date)) {
      return { message: '单日优化日期无效。', ok: false }
    }
    if (!draftDates.has(date)) {
      return { message: '单日优化日期必须存在于当前草案。', ok: false }
    }
    return { ok: true, scope: { date, kind: 'day' } }
  }

  if (record.kind === 'date_range') {
    const startDate = typeof record.startDate === 'string' ? record.startDate.trim() : ''
    const endDate = typeof record.endDate === 'string' ? record.endDate.trim() : ''
    if (!isValidPlainDate(startDate) || !isValidPlainDate(endDate)) {
      return { message: '日期范围无效。', ok: false }
    }
    if (endDate < startDate) {
      return { message: '日期范围结束日期不能早于开始日期。', ok: false }
    }
    if (!draftDates.has(startDate) || !draftDates.has(endDate)) {
      return { message: '日期范围必须存在于当前草案。', ok: false }
    }
    const selected = draft.days.some((day) => day.date >= startDate && day.date <= endDate)
    if (!selected) {
      return { message: '日期范围未选中任何草案日程。', ok: false }
    }
    return { ok: true, scope: { endDate, kind: 'date_range', startDate } }
  }

  return { message: '优化 scope 必须是 day 或 date_range。', ok: false }
}

const REFINE_PREFERENCE_FIELDS = new Set([
  'avoidText',
  'freeTextRequirement',
  'interestTags',
  'interestText',
  'mealTimeProtection',
  'mustVisitText',
  'partySize',
  'pace',
  'preferTransport',
])

function readRefinePreferences(
  input: unknown,
): { ok: true; preferences?: ProviderProxyAiTripDraftRefinePreferences } | { message: string; ok: false } {
  if (input === undefined) {
    return { ok: true }
  }
  const record = readRecord(input)
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { message: 'preferences 必须是对象。', ok: false }
  }
  const disallowed = findDisallowedObjectFieldPath(record, REFINE_PREFERENCE_FIELDS)
  if (disallowed) {
    return { message: 'preferences 包含不允许的字段。', ok: false }
  }

  const partySize = readOptionalPositiveInteger(record.partySize)
  if (record.partySize !== undefined && partySize === undefined) {
    return { message: `同行人数必须是 1 到 ${MAX_AI_PARTY_SIZE} 之间的整数。`, ok: false }
  }
  if (partySize !== undefined && partySize > MAX_AI_PARTY_SIZE) {
    return { message: `同行人数必须是 1 到 ${MAX_AI_PARTY_SIZE} 之间的整数。`, ok: false }
  }

  const interestTagsResult = readInterestTags(record.interestTags)
  if (!interestTagsResult.ok) {
    return { message: interestTagsResult.message, ok: false }
  }

  const avoidText = readRefineTextPreference(record.avoidText, '"不想要的安排"')
  if (!avoidText.ok) {
    return avoidText
  }
  const freeTextRequirement = readRefineTextPreference(record.freeTextRequirement, '"补充要求"')
  if (!freeTextRequirement.ok) {
    return freeTextRequirement
  }
  const interestText = readRefineTextPreference(record.interestText, '"兴趣偏好"')
  if (!interestText.ok) {
    return interestText
  }
  const mustVisitText = readRefineTextPreference(record.mustVisitText, '"想去的地方"')
  if (!mustVisitText.ok) {
    return mustVisitText
  }

  if (record.mealTimeProtection !== undefined && typeof record.mealTimeProtection !== 'boolean') {
    return { message: 'mealTimeProtection 必须是布尔值。', ok: false }
  }
  if (record.pace !== undefined && !isTravelPace(record.pace)) {
    return { message: '无效的旅行节奏。', ok: false }
  }
  if (record.preferTransport !== undefined && !isTravelTransportPreference(record.preferTransport)) {
    return { message: '无效的交通偏好。', ok: false }
  }

  const preferences: ProviderProxyAiTripDraftRefinePreferences = {
    avoidText: avoidText.value,
    freeTextRequirement: freeTextRequirement.value,
    interestTags: interestTagsResult.tags,
    interestText: interestText.value,
    mealTimeProtection: typeof record.mealTimeProtection === 'boolean' ? record.mealTimeProtection : undefined,
    mustVisitText: mustVisitText.value,
    partySize,
    pace: isTravelPace(record.pace) ? record.pace : undefined,
    preferTransport: isTravelTransportPreference(record.preferTransport) ? record.preferTransport : undefined,
  }
  return Object.values(preferences).some((value) => value !== undefined)
    ? { ok: true, preferences }
    : { ok: true }
}

function readRefineTextPreference(
  input: unknown,
  label: string,
): { ok: true; value?: string } | { message: string; ok: false } {
  if (input === undefined) {
    return { ok: true }
  }
  if (typeof input !== 'string') {
    return { message: `${label}必须是字符串。`, ok: false }
  }
  const trimmed = input.trim()
  if (trimmed.length > MAX_AI_FREE_TEXT_LENGTH) {
    return { message: `${label}不能超过 ${MAX_AI_FREE_TEXT_LENGTH} 个字符。`, ok: false }
  }
  return { ok: true, value: trimmed || undefined }
}

function isDateInRefineScope(date: string, scope: ProviderProxyAiTripDraftRefineScope) {
  if (scope.kind === 'day') {
    return date === scope.date
  }
  return date >= scope.startDate && date <= scope.endDate
}

export function validateProviderProxyAiTripEditPlanRequest(input: unknown): ProviderProxyAiTripEditPlanValidationResult {
  const record = readRecord(input)
  const requestId = readOptionalString(record.requestId, 128)

  if (record.operation !== PROVIDER_PROXY_AI_TRIP_EDIT_PLAN_OPERATION) {
    return aiTripEditPlanInvalidRequest('不支持的 provider proxy 操作。', requestId)
  }

  const forbiddenFieldPath = findForbiddenRequestFieldPath(withoutSearchResults(record), FORBIDDEN_AI_TRIP_EDIT_FIELDS)
  if (forbiddenFieldPath) {
    return aiTripEditPlanInvalidRequest('AI 修改建议请求包含不允许的敏感字段。', requestId)
  }

  const searchResultsValidation = validateAiTripEditSearchSummary(record.searchResults, requestId)
  if (!searchResultsValidation.ok) {
    return searchResultsValidation
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
      searchResults: searchResultsValidation.searchResults,
    },
  }
}

function validateAiTripEditSearchSummary(
  input: unknown,
  requestId?: string,
): ProviderProxyAiTripEditSearchSummaryValidationResult {
  if (input === undefined) {
    return { ok: true, searchResults: undefined }
  }

  const record = readRecord(input)
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return aiTripEditPlanInvalidRequest('AI 修改建议搜索来源无效。', requestId)
  }
  for (const key of Object.keys(record)) {
    if (!AI_TRIP_EDIT_SEARCH_ALLOWED_FIELDS.has(key)) {
      return aiTripEditPlanInvalidRequest('AI 修改建议搜索来源包含未知字段。', requestId)
    }
  }

  const query = typeof record.query === 'string' ? record.query.trim() : ''
  const retrievedAt = typeof record.retrievedAt === 'string' ? record.retrievedAt.trim() : ''
  if (!query || query.length > MAX_TRAVEL_SEARCH_QUERY_LENGTH) {
    return aiTripEditPlanInvalidRequest('AI 修改建议搜索关键词无效。', requestId)
  }
  if ((record.source !== 'mock' && record.source !== 'future_search') || !isValidIsoLikeDate(retrievedAt)) {
    return aiTripEditPlanInvalidRequest('AI 修改建议搜索来源无效。', requestId)
  }
  if (!Array.isArray(record.results) || record.results.length < 1 || record.results.length > MAX_AI_TRIP_EDIT_SEARCH_RESULTS) {
    return aiTripEditPlanInvalidRequest(`AI 修改建议搜索来源最多支持 ${MAX_AI_TRIP_EDIT_SEARCH_RESULTS} 条结果。`, requestId)
  }

  const results: ProviderProxyAiTripEditSearchResultSummary[] = []
  for (const rawResult of record.results) {
    const resultRecord = readRecord(rawResult)
    if (!rawResult || typeof rawResult !== 'object' || Array.isArray(rawResult)) {
      return aiTripEditPlanInvalidRequest('AI 修改建议搜索结果无效。', requestId)
    }
    for (const key of Object.keys(resultRecord)) {
      if (!AI_TRIP_EDIT_SEARCH_RESULT_ALLOWED_FIELDS.has(key)) {
        return aiTripEditPlanInvalidRequest('AI 修改建议搜索结果包含未知字段。', requestId)
      }
    }

    const title = typeof resultRecord.title === 'string' ? resultRecord.title.trim() : ''
    const url = typeof resultRecord.url === 'string' ? resultRecord.url.trim() : ''
    const displayUrl = typeof resultRecord.displayUrl === 'string' ? resultRecord.displayUrl.trim() : ''
    const domain = typeof resultRecord.domain === 'string' ? resultRecord.domain.trim() : ''
    const snippet = typeof resultRecord.snippet === 'string' ? resultRecord.snippet.trim() : ''
    const resultRetrievedAt = typeof resultRecord.retrievedAt === 'string' ? resultRecord.retrievedAt.trim() : ''
    const sourceType = resultRecord.sourceType
    const confidence = resultRecord.confidence

    if (
      !title ||
      !isSafeHttpUrl(url) ||
      !displayUrl ||
      !domain ||
      !snippet ||
      snippet.length > MAX_AI_TRIP_EDIT_SEARCH_SNIPPET_LENGTH ||
      !isValidIsoLikeDate(resultRetrievedAt) ||
      (sourceType !== undefined && (typeof sourceType !== 'string' || !VALID_TRAVEL_SEARCH_SOURCE_TYPES.has(sourceType as ProviderProxyTravelSearchSourceType))) ||
      (confidence !== undefined && (typeof confidence !== 'string' || !VALID_TRAVEL_SEARCH_CONFIDENCES.has(confidence as ProviderProxyTravelSearchConfidence)))
    ) {
      return aiTripEditPlanInvalidRequest('AI 修改建议搜索结果无效。', requestId)
    }

    results.push({
      confidence: confidence as ProviderProxyTravelSearchConfidence | undefined,
      displayUrl,
      domain,
      retrievedAt: resultRetrievedAt,
      snippet,
      sourceType: sourceType as ProviderProxyTravelSearchSourceType | undefined,
      title,
      url,
    })
  }

  const warnings = Array.isArray(record.warnings)
    ? record.warnings.filter((warning): warning is string => typeof warning === 'string' && warning.trim().length > 0).slice(0, 3)
    : undefined

  return {
    ok: true,
    searchResults: {
      query,
      results,
      retrievedAt,
      source: record.source,
      warnings,
    },
  }
}

function withoutSearchResults(record: Record<string, unknown>) {
  const rest: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (key !== 'searchResults') {
      rest[key] = value
    }
  }
  return rest
}

export function validateProviderProxyExistingTripImportRequest(
  input: unknown,
): ProviderProxyExistingTripImportValidationResult {
  const record = readRecord(input)
  const requestId = readOptionalString(record.requestId, 128)

  if (record.operation !== PROVIDER_PROXY_AI_EXISTING_TRIP_IMPORT_OPERATION) {
    return existingTripImportInvalidRequest('不支持的 provider proxy 操作。', requestId)
  }

  const forbiddenFieldPath = findForbiddenRequestFieldPath(record, FORBIDDEN_EXISTING_TRIP_IMPORT_FIELDS)
  if (forbiddenFieldPath) {
    return existingTripImportInvalidRequest('AI 识别导入请求包含不允许的敏感字段。', requestId)
  }

  const trip = readExistingTripImportTrip(record.trip)
  if (!trip) {
    return existingTripImportInvalidRequest('当前旅行摘要无效。', requestId)
  }

  if (!Array.isArray(record.days) || record.days.length > MAX_EXISTING_TRIP_IMPORT_DAYS) {
    return existingTripImportInvalidRequest(`日期摘要不能超过 ${MAX_EXISTING_TRIP_IMPORT_DAYS} 天。`, requestId)
  }
  const days: ProviderProxyExistingTripImportDaySummary[] = []
  const dayIds = new Set<string>()
  for (const rawDay of record.days) {
    const day = readExistingTripImportDay(rawDay)
    if (!day || dayIds.has(day.id)) {
      return existingTripImportInvalidRequest('日期摘要无效。', requestId)
    }
    dayIds.add(day.id)
    days.push(day)
  }

  if (!Array.isArray(record.items) || record.items.length > MAX_EXISTING_TRIP_IMPORT_ITEMS) {
    return existingTripImportInvalidRequest(`行程点摘要不能超过 ${MAX_EXISTING_TRIP_IMPORT_ITEMS} 个。`, requestId)
  }
  const items: ProviderProxyExistingTripImportItemSummary[] = []
  const itemIds = new Set<string>()
  for (const rawItem of record.items) {
    const item = readExistingTripImportItem(rawItem, dayIds)
    if (!item || itemIds.has(item.id)) {
      return existingTripImportInvalidRequest('行程点摘要无效。', requestId)
    }
    itemIds.add(item.id)
    items.push(item)
  }

  const existingTicketSummariesResult = readExistingTripImportTicketSummaries(record.existingTicketSummaries, itemIds)
  if (!existingTicketSummariesResult.ok) {
    return existingTripImportInvalidRequest(existingTicketSummariesResult.message, requestId)
  }

  if (!Array.isArray(record.sources) || record.sources.length < 1 || record.sources.length > MAX_EXISTING_TRIP_IMPORT_SOURCES) {
    return existingTripImportInvalidRequest(`识别来源必须为 1 到 ${MAX_EXISTING_TRIP_IMPORT_SOURCES} 段文本。`, requestId)
  }
  const sources: ProviderProxyExistingTripImportSourceSummary[] = []
  const sourceIds = new Set<string>()
  let totalTextLength = 0
  for (const rawSource of record.sources) {
    const source = readExistingTripImportSource(rawSource)
    if (!source || sourceIds.has(source.id)) {
      return existingTripImportInvalidRequest('识别来源摘要无效。', requestId)
    }
    sourceIds.add(source.id)
    totalTextLength += source.text.length
    sources.push(source)
  }
  if (totalTextLength > MAX_EXISTING_TRIP_IMPORT_TOTAL_TEXT_LENGTH) {
    return existingTripImportInvalidRequest(`识别文本总长度不能超过 ${MAX_EXISTING_TRIP_IMPORT_TOTAL_TEXT_LENGTH} 个字符。`, requestId)
  }

  const locale = record.locale
  if (locale !== undefined && !isPlaceLookupLocale(locale)) {
    return existingTripImportInvalidRequest('识别语言设置无效。', requestId)
  }

  return {
    ok: true,
    request: {
      days,
      existingTicketSummaries: existingTicketSummariesResult.existingTicketSummaries,
      items,
      locale: locale as ProviderProxyPlaceLookupLocale | undefined,
      operation: PROVIDER_PROXY_AI_EXISTING_TRIP_IMPORT_OPERATION,
      quotaSessionId: readOptionalString(record.quotaSessionId, 160),
      requestId,
      sources,
      trip,
    },
  }
}

export function validateProviderProxyTravelInboxClassifyRequest(
  input: unknown,
): ProviderProxyTravelInboxClassifyValidationResult {
  const record = readRecord(input)
  const requestId = readOptionalString(record.requestId, 128)
  if (record.operation !== PROVIDER_PROXY_TRAVEL_INBOX_CLASSIFY_OPERATION) {
    return travelInboxClassifyInvalidRequest('不支持的 provider proxy 操作。', requestId)
  }
  const forbiddenFieldPath = findForbiddenRequestFieldPath(record, FORBIDDEN_EXISTING_TRIP_IMPORT_FIELDS)
  if (forbiddenFieldPath) {
    return travelInboxClassifyInvalidRequest('旅行收件箱分类请求包含不允许的敏感字段。', requestId)
  }
  const source = readExistingTripImportSource(record.source)
  if (!source) {
    return travelInboxClassifyInvalidRequest('待分类来源摘要无效。', requestId)
  }
  if (!Array.isArray(record.trips) || record.trips.length > MAX_TRAVEL_INBOX_CLASSIFY_TRIPS) {
    return travelInboxClassifyInvalidRequest(`旅行摘要不能超过 ${MAX_TRAVEL_INBOX_CLASSIFY_TRIPS} 个。`, requestId)
  }
  const trips: ProviderProxyTravelInboxTripSummary[] = []
  const ids = new Set<string>()
  for (const inputTrip of record.trips) {
    const trip = readTravelInboxTripSummary(inputTrip)
    if (!trip || ids.has(trip.id)) {
      return travelInboxClassifyInvalidRequest('旅行摘要无效。', requestId)
    }
    ids.add(trip.id)
    trips.push(trip)
  }
  return {
    ok: true,
    request: {
      operation: PROVIDER_PROXY_TRAVEL_INBOX_CLASSIFY_OPERATION,
      quotaSessionId: readOptionalString(record.quotaSessionId, 160),
      requestId,
      source,
      trips,
    },
  }
}

function readTravelInboxTripSummary(input: unknown): ProviderProxyTravelInboxTripSummary | null {
  const record = readRecord(input)
  const id = readRequiredTrimmedString(record.id, 128)
  const title = readRequiredTrimmedString(record.title, MAX_EXISTING_TRIP_IMPORT_TEXT_FIELD)
  const destination = readRequiredTrimmedString(record.destination, MAX_EXISTING_TRIP_IMPORT_TEXT_FIELD)
  const startDate = readRequiredTrimmedString(record.startDate, 10)
  const endDate = readRequiredTrimmedString(record.endDate, 10)
  if (!id || !title || !destination || !isValidPlainDate(startDate) || !isValidPlainDate(endDate) || endDate < startDate) return null
  return { destination, endDate, id, startDate, title }
}

export function validateTravelInboxClassification(
  input: unknown,
  validTripIds: Set<string>,
): TravelInboxClassification | null {
  const record = readRecord(input)
  const targetTripId = readOptionalString(record.targetTripId, 128)
  const category = record.category
  const confidence = record.confidence
  const reason = readRequiredTrimmedString(record.reason, 300)
  if (
    (targetTripId && !validTripIds.has(targetTripId)) ||
    !VALID_TRAVEL_INBOX_CATEGORIES.has(category as TravelInboxEntryCategory) ||
    (confidence !== 'low' && confidence !== 'medium' && confidence !== 'high') ||
    !reason
  ) return null
  return {
    category: category as TravelInboxEntryCategory,
    confidence,
    reason,
    targetTripId,
  }
}

function travelInboxClassifyInvalidRequest(message: string, requestId?: string): ProviderProxyTravelInboxClassifyValidationResult {
  return {
    error: buildProviderProxyErrorResponse({
      code: 'invalid_request',
      message,
      operation: PROVIDER_PROXY_TRAVEL_INBOX_CLASSIFY_OPERATION,
      requestId,
    }),
    ok: false,
  }
}

function readExistingTripImportTrip(input: unknown): ProviderProxyExistingTripImportTripSummary | null {
  const record = readRecord(input)
  const id = readRequiredTrimmedString(record.id, 128)
  const title = readRequiredTrimmedString(record.title, MAX_EXISTING_TRIP_IMPORT_TEXT_FIELD)
  const startDate = readRequiredTrimmedString(record.startDate, 10)
  const endDate = readRequiredTrimmedString(record.endDate, 10)
  if (!id || !title || !isValidPlainDate(startDate) || !isValidPlainDate(endDate) || endDate < startDate) {
    return null
  }
  return {
    destination: readOptionalString(record.destination, MAX_EXISTING_TRIP_IMPORT_TEXT_FIELD),
    endDate,
    id,
    startDate,
    timeZone: readOptionalTimeZone(record.timeZone),
    title,
  }
}

function readExistingTripImportDay(input: unknown): ProviderProxyExistingTripImportDaySummary | null {
  const record = readRecord(input)
  const id = readRequiredTrimmedString(record.id, 128)
  const date = readRequiredTrimmedString(record.date, 10)
  if (!id || !isValidPlainDate(date)) return null
  const sortOrder = typeof record.sortOrder === 'number' && Number.isFinite(record.sortOrder) ? record.sortOrder : undefined
  return {
    date,
    id,
    sortOrder,
    timeZone: readOptionalTimeZone(record.timeZone),
    title: readOptionalString(record.title, MAX_EXISTING_TRIP_IMPORT_TEXT_FIELD),
  }
}

function readExistingTripImportItem(input: unknown, dayIds: Set<string>): ProviderProxyExistingTripImportItemSummary | null {
  const record = readRecord(input)
  const id = readRequiredTrimmedString(record.id, 128)
  const dayId = readRequiredTrimmedString(record.dayId, 128)
  const date = readRequiredTrimmedString(record.date, 10)
  const title = readRequiredTrimmedString(record.title, MAX_EXISTING_TRIP_IMPORT_TEXT_FIELD)
  if (!id || !dayIds.has(dayId) || !isValidPlainDate(date) || !title) return null
  const startTime = readOptionalString(record.startTime, 5)
  const endTime = readOptionalString(record.endTime, 5)
  if ((startTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) || (endTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime))) {
    return null
  }
  const endDate = readOptionalString(record.endDate, 10)
  if (endDate && !isValidPlainDate(endDate)) {
    return null
  }
  const duration = readOptionalPositiveInteger(record.previousTransportDurationMinutes)
  return {
    address: readOptionalString(record.address, MAX_EXISTING_TRIP_IMPORT_TEXT_FIELD),
    date,
    dayId,
    endDate,
    endTime,
    endTimeZone: readOptionalTimeZone(record.endTimeZone),
    id,
    locationName: readOptionalString(record.locationName, MAX_EXISTING_TRIP_IMPORT_TEXT_FIELD),
    previousTransportDurationMinutes: duration !== undefined && duration <= 24 * 60 ? duration : undefined,
    previousTransportMode: readOptionalString(record.previousTransportMode, 40),
    previousTransportNote: readOptionalString(record.previousTransportNote, MAX_EXISTING_TRIP_IMPORT_TEXT_FIELD),
    startTime,
    startTimeZone: readOptionalTimeZone(record.startTimeZone),
    ticketCount: readOptionalPositiveInteger(record.ticketCount),
    title,
    transportMode: readOptionalString(record.transportMode, 40),
  }
}

function readExistingTripImportTicketSummaries(
  input: unknown,
  itemIds: Set<string>,
): { existingTicketSummaries?: ProviderProxyExistingTripImportTicketSummary[]; ok: true } | { message: string; ok: false } {
  if (input === undefined) {
    return { ok: true }
  }
  if (!Array.isArray(input) || input.length > MAX_EXISTING_TRIP_IMPORT_EXISTING_TICKETS) {
    return { message: `现有票据摘要不能超过 ${MAX_EXISTING_TRIP_IMPORT_EXISTING_TICKETS} 个。`, ok: false }
  }

  const summaryIds = new Set<string>()
  const existingTicketSummaries: ProviderProxyExistingTripImportTicketSummary[] = []
  for (const rawSummary of input) {
    const record = readRecord(rawSummary)
    if (!rawSummary || typeof rawSummary !== 'object' || Array.isArray(rawSummary)) {
      return { message: '现有票据摘要无效。', ok: false }
    }
    for (const key of Object.keys(record)) {
      if (!EXISTING_TRIP_IMPORT_TICKET_SUMMARY_ALLOWED_FIELDS.has(key)) {
        return { message: '现有票据摘要包含不允许的字段。', ok: false }
      }
    }
    const summaryId = readRequiredTrimmedString(record.summaryId, 128)
    const title = readRequiredTrimmedString(record.title, MAX_EXISTING_TRIP_IMPORT_TEXT_FIELD)
    const itemId = readOptionalString(record.itemId, 128)
    const scope = record.scope
    const ticketCategory = record.ticketCategory
    if (
      !summaryId ||
      summaryIds.has(summaryId) ||
      !title ||
      (itemId !== undefined && !itemIds.has(itemId)) ||
      (scope !== undefined && scope !== 'trip' && scope !== 'item' && scope !== 'unassigned') ||
      (ticketCategory !== undefined && !isExistingTripImportTicketCategory(ticketCategory))
    ) {
      return { message: '现有票据摘要无效。', ok: false }
    }
    summaryIds.add(summaryId)
    existingTicketSummaries.push({
      itemId,
      scope: scope as TicketScope | undefined,
      summaryId,
      ticketCategory: ticketCategory as TicketCategory | undefined,
      title,
    })
  }
  return { existingTicketSummaries, ok: true }
}

function isExistingTripImportTicketCategory(input: unknown): input is TicketCategory {
  return input === 'admission_ticket' ||
    input === 'train_ticket' ||
    input === 'flight_ticket' ||
    input === 'hotel_booking' ||
    input === 'restaurant_reservation' ||
    input === 'transport_booking' ||
    input === 'other'
}

function readExistingTripImportSource(input: unknown): ProviderProxyExistingTripImportSourceSummary | null {
  const record = readRecord(input)
  const id = readRequiredTrimmedString(record.id, 128)
  const label = readRequiredTrimmedString(record.label, MAX_EXISTING_TRIP_IMPORT_TEXT_FIELD)
  const text = readRequiredTrimmedString(record.text, MAX_EXISTING_TRIP_IMPORT_SOURCE_TEXT_LENGTH)
  const kind = record.kind
  if (!id || !label || !text || typeof kind !== 'string' || !VALID_EXISTING_TRIP_IMPORT_SOURCE_KINDS.has(kind as ExistingTripImportSourceKind)) {
    return null
  }
  return {
    fileName: readOptionalString(record.fileName, MAX_EXISTING_TRIP_IMPORT_TEXT_FIELD),
    id,
    kind: kind as ExistingTripImportSourceKind,
    label,
    mimeType: readOptionalString(record.mimeType, 120),
    size: readOptionalPositiveInteger(record.size),
    text,
    warnings: Array.isArray(record.warnings)
      ? record.warnings.filter((warning): warning is string => typeof warning === 'string' && warning.trim().length > 0).slice(0, 5)
      : undefined,
  }
}

export function validateProviderProxyExchangeRateRequest(input: unknown): ProviderProxyExchangeRateValidationResult {
  const record = readRecord(input)
  const requestId = readOptionalString(record.requestId, 128)
  if (record.operation !== PROVIDER_PROXY_EXCHANGE_RATE_OPERATION) {
    return { error: buildProviderProxyErrorResponse({ code: 'invalid_request', operation: PROVIDER_PROXY_EXCHANGE_RATE_OPERATION, requestId }), ok: false }
  }
  const requestedDate = typeof record.requestedDate === 'string' ? record.requestedDate.trim() : ''
  const baseCurrency = normalizeCurrency(record.baseCurrency)
  const quoteCurrencies = Array.isArray(record.quoteCurrencies)
    ? [...new Set(record.quoteCurrencies.map(normalizeCurrency).filter((value): value is string => Boolean(value)))]
    : []
  if (!isValidPlainDate(requestedDate) || !baseCurrency || quoteCurrencies.length < 1 || quoteCurrencies.length > 2 || quoteCurrencies.includes(baseCurrency)) {
    return {
      error: buildProviderProxyErrorResponse({
        code: 'invalid_request',
        message: '汇率请求必须包含有效日期、基础币种和 1 至 2 个不同目标币种。',
        operation: PROVIDER_PROXY_EXCHANGE_RATE_OPERATION,
        requestId,
      }),
      ok: false,
    }
  }
  return {
    ok: true,
    request: {
      baseCurrency,
      operation: PROVIDER_PROXY_EXCHANGE_RATE_OPERATION,
      quoteCurrencies,
      quotaSessionId: readOptionalString(record.quotaSessionId, 160),
      requestedDate,
      requestId,
    },
  }
}

export function validateProviderProxyAiExpenseExtractRequest(input: unknown): ProviderProxyAiExpenseExtractValidationResult {
  const record = readRecord(input)
  const requestId = readOptionalString(record.requestId, 128)
  if (record.operation !== PROVIDER_PROXY_AI_EXPENSE_EXTRACT_OPERATION) {
    return { error: buildProviderProxyErrorResponse({ code: 'invalid_request', operation: PROVIDER_PROXY_AI_EXPENSE_EXTRACT_OPERATION, requestId }), ok: false }
  }
  const defaultCurrency = normalizeCurrency(record.defaultCurrency)
  const rawCandidates = Array.isArray(record.candidates) ? record.candidates.slice(0, 20) : []
  const candidates = rawCandidates.map((value) => {
    const candidate = readRecord(value)
    const candidateId = readOptionalString(candidate.candidateId, 120)
    const title = readOptionalString(candidate.title, 240)
    const text = readOptionalString(candidate.text, 8_000)
    return candidateId && title && text ? { candidateId, text, title } : undefined
  }).filter((value): value is { candidateId: string; text: string; title: string } => Boolean(value))
  const rawParticipants = Array.isArray(record.participants) ? record.participants.slice(0, 30) : []
  const participants = rawParticipants.map((value) => {
    const participant = readRecord(value)
    const alias = readOptionalString(participant.alias, 40)
    const displayName = readOptionalString(participant.displayName, 120)
    return alias && displayName ? { alias, displayName } : undefined
  }).filter((value): value is { alias: string; displayName: string } => Boolean(value))
  if (!defaultCurrency || candidates.length === 0 || candidates.length !== rawCandidates.length || participants.length !== rawParticipants.length) {
    return {
      error: buildProviderProxyErrorResponse({
        code: 'invalid_request',
        message: '费用识别请求格式不正确。',
        operation: PROVIDER_PROXY_AI_EXPENSE_EXTRACT_OPERATION,
        requestId,
      }),
      ok: false,
    }
  }
  return {
    ok: true,
    request: {
      candidates,
      defaultCurrency,
      operation: PROVIDER_PROXY_AI_EXPENSE_EXTRACT_OPERATION,
      participants,
      quotaSessionId: readOptionalString(record.quotaSessionId, 160),
      requestId,
    },
  }
}

export function validateProviderProxyAiExpenseQueryRequest(input: unknown): ProviderProxyAiExpenseQueryValidationResult {
  const record = readRecord(input)
  const requestId = readOptionalString(record.requestId, 128)
  if (record.operation !== PROVIDER_PROXY_AI_EXPENSE_QUERY_OPERATION) {
    return { error: buildProviderProxyErrorResponse({ code: 'invalid_request', operation: PROVIDER_PROXY_AI_EXPENSE_QUERY_OPERATION, requestId }), ok: false }
  }
  const question = readOptionalString(record.question, 500)
  const allRows = Array.isArray(record.rows) ? record.rows : []
  const rawRows = allRows.slice(0, 80)
  const categories = new Set<LedgerExpenseCategory>(['lodging', 'transport', 'admission', 'food', 'shopping', 'insurance', 'connectivity', 'other'])
  const statuses = new Set(['draft', 'confirmed', 'void'])
  const rows = rawRows.flatMap<ProviderProxyAiExpenseQueryRow>((value) => {
    const row = readRecord(value)
    const id = readOptionalString(row.id, 120)
    const title = readOptionalString(row.title, 240)
    const date = readOptionalString(row.date, 32)
    const category = typeof row.category === 'string' && categories.has(row.category as LedgerExpenseCategory) ? row.category as LedgerExpenseCategory : undefined
    const status = typeof row.status === 'string' && statuses.has(row.status) ? row.status as ProviderProxyAiExpenseQueryRow['status'] : undefined
    const sourceRefs = Array.isArray(row.sourceRefs) ? row.sourceRefs.slice(0, 12).map((source) => {
      const sourceRecord = readRecord(source)
      const sourceId = readOptionalString(sourceRecord.id, 160)
      const kind = readOptionalString(sourceRecord.kind, 40)
      const role = readOptionalString(sourceRecord.role, 40)
      return sourceId && kind && role ? { id: sourceId, kind, role } : undefined
    }).filter((source): source is { id: string; kind: string; role: string } => Boolean(source)) : []
    if (!id || !title || !date || !category || !status || typeof row.itemLinked !== 'boolean') return []
    const amountMinor = Number.isSafeInteger(row.amountMinor) ? Number(row.amountMinor) : undefined
    const city = readOptionalString(row.city, 120)
    const currency = normalizeCurrency(row.currency)
    const merchant = readOptionalString(row.merchant, 160)
    const orderStatus = readOptionalString(row.orderStatus, 40)
    const paymentStatus = readOptionalString(row.paymentStatus, 40)
    const reviewStatus = readOptionalString(row.reviewStatus, 40)
    return [{
      ...(amountMinor !== undefined ? { amountMinor } : {}),
      category,
      ...(city ? { city } : {}),
      ...(currency ? { currency } : {}),
      date,
      id,
      itemLinked: row.itemLinked,
      ...(merchant ? { merchant } : {}),
      ...(orderStatus ? { orderStatus } : {}),
      ...(paymentStatus ? { paymentStatus } : {}),
      ...(reviewStatus ? { reviewStatus } : {}),
      sourceRefs,
      status,
      title,
    }]
  })
  if (!question || allRows.length === 0 || allRows.length > 80 || rows.length !== rawRows.length) {
    return { error: buildProviderProxyErrorResponse({ code: 'invalid_request', message: '账单问答请求格式不正确。', operation: PROVIDER_PROXY_AI_EXPENSE_QUERY_OPERATION, requestId }), ok: false }
  }
  return { ok: true, request: { operation: PROVIDER_PROXY_AI_EXPENSE_QUERY_OPERATION, question, quotaSessionId: readOptionalString(record.quotaSessionId, 160), requestId, rows } }
}

export function validateProviderProxyAiExpenseQueryResponsePlan(input: unknown) {
  const record = readRecord(input)
  const allowedKeys = new Set(['ok', 'operation', 'source', 'requestId', 'plan', 'presentation'])
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) return undefined
  const plan = validateLedgerQueryPlan(record.plan)
  const presentation = record.presentation
  if (!plan || (presentation !== 'summary' && presentation !== 'list' && presentation !== 'grouped')) return undefined
  return { plan, presentation }
}

function normalizeCurrency(value: unknown) {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toUpperCase()
  return /^[A-Z]{3}$/.test(normalized) ? normalized : undefined
}

export function validateProviderProxyTravelSearchRequest(input: unknown): ProviderProxyTravelSearchValidationResult {
  const record = readRecord(input)
  const requestId = readOptionalString(record.requestId, 128)

  if (record.operation !== PROVIDER_PROXY_TRAVEL_SEARCH_OPERATION) {
    return travelSearchInvalidRequest('不支持的 provider proxy 操作。', requestId)
  }

  const forbiddenFieldPath = findForbiddenRequestFieldPath(record, FORBIDDEN_TRAVEL_SEARCH_FIELDS)
  if (forbiddenFieldPath) {
    return travelSearchInvalidRequest('搜索请求包含不允许的敏感字段。', requestId)
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

  const rawMaxResults = record.maxResults
  let maxResults = DEFAULT_TRAVEL_SEARCH_MAX_RESULTS
  if (rawMaxResults !== undefined) {
    if (typeof rawMaxResults !== 'number' || !Number.isInteger(rawMaxResults) || rawMaxResults < 1) {
      return travelSearchInvalidRequest('搜索结果数量必须是正整数。', requestId)
    }
    maxResults = Math.min(rawMaxResults, DEFAULT_TRAVEL_SEARCH_MAX_RESULTS)
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

export function validateProviderProxyPlaceLookupRequest(input: unknown): ProviderProxyPlaceLookupValidationResult {
  const record = readRecord(input)
  const requestId = readOptionalString(record.requestId, 128)

  if (record.operation !== PROVIDER_PROXY_PLACE_LOOKUP_OPERATION) {
    return placeLookupInvalidRequest('不支持的 provider proxy 操作。', requestId)
  }

  const forbiddenFieldPath = findForbiddenRequestFieldPath(record, FORBIDDEN_PLACE_LOOKUP_FIELDS)
  if (forbiddenFieldPath) {
    return placeLookupInvalidRequest('地点查询请求包含不允许的敏感字段。', requestId)
  }

  const query = typeof record.query === 'string' ? record.query.trim() : ''
  if (!query) {
    return placeLookupInvalidRequest('请输入地点查询关键词。', requestId)
  }
  if (query.length > MAX_PLACE_LOOKUP_QUERY_LENGTH) {
    return placeLookupInvalidRequest(`地点查询关键词不能超过 ${MAX_PLACE_LOOKUP_QUERY_LENGTH} 个字符。`, requestId)
  }

  const locale = record.locale
  if (locale !== undefined && !isPlaceLookupLocale(locale)) {
    return placeLookupInvalidRequest('地点查询语言设置无效。', requestId)
  }

  const region = typeof record.region === 'string' ? record.region.trim().toUpperCase() : undefined
  if (record.region !== undefined && typeof record.region !== 'string') {
    return placeLookupInvalidRequest('地点查询地区必须是字符串。', requestId)
  }
  if (region && !/^[A-Z]{2}$/.test(region)) {
    return placeLookupInvalidRequest('地点查询地区必须是 2 位国家或地区代码。', requestId)
  }

  const rawMaxResults = record.maxResults
  let maxResults = DEFAULT_PLACE_LOOKUP_MAX_RESULTS
  if (rawMaxResults !== undefined) {
    if (typeof rawMaxResults !== 'number' || !Number.isInteger(rawMaxResults) || rawMaxResults < 1) {
      return placeLookupInvalidRequest('地点查询结果数量必须是正整数。', requestId)
    }
    maxResults = Math.min(rawMaxResults, DEFAULT_PLACE_LOOKUP_MAX_RESULTS)
  }

  return {
    ok: true,
    request: {
      locale: isPlaceLookupLocale(locale) ? locale : undefined,
      maxResults,
      operation: PROVIDER_PROXY_PLACE_LOOKUP_OPERATION,
      query,
      quotaSessionId: readOptionalString(record.quotaSessionId, 160),
      region: region || undefined,
      requestId,
    },
  }
}

export function validateProviderProxyPlaceDetailsRequest(input: unknown): ProviderProxyPlaceDetailsValidationResult {
  const record = readRecord(input)
  const requestId = readOptionalString(record.requestId, 128)

  if (record.operation !== PROVIDER_PROXY_PLACE_DETAILS_OPERATION) {
    return placeDetailsInvalidRequest('不支持的 provider proxy 操作。', requestId)
  }

  const forbiddenFieldPath = findForbiddenRequestFieldPath(record, FORBIDDEN_PLACE_DETAILS_FIELDS)
  if (forbiddenFieldPath) {
    return placeDetailsInvalidRequest('地点详情请求包含不允许的敏感字段。', requestId)
  }

  const placeId = typeof record.placeId === 'string' ? record.placeId.trim() : ''
  if (!placeId || placeId.length > MAX_PLACE_ID_LENGTH) {
    return placeDetailsInvalidRequest('地点详情 placeId 无效。', requestId)
  }

  const locale = record.locale
  if (locale !== undefined && !isPlaceLookupLocale(locale)) {
    return placeDetailsInvalidRequest('地点详情语言设置无效。', requestId)
  }

  const region = typeof record.region === 'string' ? record.region.trim().toUpperCase() : undefined
  if (record.region !== undefined && typeof record.region !== 'string') {
    return placeDetailsInvalidRequest('地点详情地区必须是字符串。', requestId)
  }
  if (region && !/^[A-Z]{2}$/.test(region)) {
    return placeDetailsInvalidRequest('地点详情地区必须是 2 位国家或地区代码。', requestId)
  }

  return {
    ok: true,
    request: {
      locale: isPlaceLookupLocale(locale) ? locale : undefined,
      operation: PROVIDER_PROXY_PLACE_DETAILS_OPERATION,
      placeId,
      quotaSessionId: readOptionalString(record.quotaSessionId, 160),
      region: region || undefined,
      requestId,
    },
  }
}

export function validateProviderProxyTripContentEnrichmentRequest(input: unknown): ProviderProxyTripContentEnrichmentValidationResult {
  const record = readRecord(input)
  const requestId = readOptionalString(record.requestId, 128)

  if (record.operation !== PROVIDER_PROXY_TRIP_CONTENT_ENRICHMENT_OPERATION) {
    return tripContentEnrichmentInvalidRequest('不支持的 provider proxy 操作。', requestId)
  }

  const forbiddenFieldPath = findForbiddenRequestFieldPath(record, FORBIDDEN_TRIP_CONTENT_ENRICHMENT_FIELDS)
  if (forbiddenFieldPath) {
    return tripContentEnrichmentInvalidRequest('内容补充请求包含不允许的敏感字段。', requestId)
  }

  const locale = record.locale
  if (locale !== undefined && !isPlaceLookupLocale(locale)) {
    return tripContentEnrichmentInvalidRequest('内容补充语言设置无效。', requestId)
  }

  if (!Array.isArray(record.items) || record.items.length < 1 || record.items.length > MAX_TRIP_CONTENT_ENRICHMENT_ITEMS) {
    return tripContentEnrichmentInvalidRequest(`内容补充一次最多支持 ${MAX_TRIP_CONTENT_ENRICHMENT_ITEMS} 个行程点。`, requestId)
  }

  const items: ProviderProxyTripContentEnrichmentItemInput[] = []
  const itemIds = new Set<string>()
  for (const rawItem of record.items) {
    const item = readTripContentEnrichmentItem(rawItem)
    if (!item.ok) {
      return tripContentEnrichmentInvalidRequest(item.message, requestId)
    }
    if (itemIds.has(item.item.itemId)) {
      return tripContentEnrichmentInvalidRequest('内容补充行程点不能重复。', requestId)
    }
    itemIds.add(item.item.itemId)
    items.push(item.item)
  }

  return {
    ok: true,
    request: {
      items,
      locale: isPlaceLookupLocale(locale) ? locale : undefined,
      operation: PROVIDER_PROXY_TRIP_CONTENT_ENRICHMENT_OPERATION,
      quotaSessionId: readOptionalString(record.quotaSessionId, 160),
      requestId,
    },
  }
}

export function validateProviderProxyTripDailyTipRequest(input: unknown): ProviderProxyTripDailyTipValidationResult {
  const record = readRecord(input)
  const requestId = readOptionalString(record.requestId, 128)

  if (record.operation !== PROVIDER_PROXY_TRIP_DAILY_TIP_OPERATION) {
    return tripDailyTipInvalidRequest('不支持的 provider proxy 操作。', requestId)
  }

  const forbiddenFieldPath = findForbiddenRequestFieldPath(record, FORBIDDEN_TRIP_CONTENT_ENRICHMENT_FIELDS)
  if (forbiddenFieldPath) {
    return tripDailyTipInvalidRequest('今日旅行提示请求包含不允许的敏感字段。', requestId)
  }

  const tripTitle = readRequiredTrimmedString(record.tripTitle, 160)
  const destination = readRequiredTrimmedString(record.destination, 160)
  if (!tripTitle || !destination) {
    return tripDailyTipInvalidRequest('今日旅行提示缺少旅行标题或目的地。', requestId)
  }
  if (!VALID_TRIP_DAILY_TIP_MODES.has(record.mode as ProviderProxyTripDailyTipMode)) {
    return tripDailyTipInvalidRequest('今日旅行提示模式无效。', requestId)
  }
  if (record.routeStatus !== undefined && !VALID_TRIP_DAILY_TIP_ROUTE_STATUSES.has(record.routeStatus as NonNullable<ProviderProxyTripDailyTipRequest['routeStatus']>)) {
    return tripDailyTipInvalidRequest('今日旅行提示路线状态无效。', requestId)
  }

  const sourcesResult = readTripDailyTipSources(record.sources)
  if (!sourcesResult.ok) {
    return tripDailyTipInvalidRequest(sourcesResult.message, requestId)
  }
  const validSourceIds = new Set(sourcesResult.sources.map((source) => source.id))
  const sectionsResult = readTripDailyTipLocalSections(record.localSections, validSourceIds)
  if (!sectionsResult.ok) {
    return tripDailyTipInvalidRequest(sectionsResult.message, requestId)
  }
  const itemsResult = readTripDailyTipItems(record.items)
  if (!itemsResult.ok) {
    return tripDailyTipInvalidRequest(itemsResult.message, requestId)
  }

  return {
    ok: true,
    request: {
      dayTitle: readOptionalString(record.dayTitle, 160),
      destination,
      generatedAt: readOptionalString(record.generatedAt, 80),
      items: itemsResult.items,
      localSections: sectionsResult.sections,
      mode: record.mode as ProviderProxyTripDailyTipMode,
      operation: PROVIDER_PROXY_TRIP_DAILY_TIP_OPERATION,
      quotaSessionId: readOptionalString(record.quotaSessionId, 160),
      requestId,
      routeStatus: record.routeStatus as ProviderProxyTripDailyTipRequest['routeStatus'],
      sources: sourcesResult.sources,
      targetDate: readOptionalString(record.targetDate, 32),
      tripTitle,
    },
  }
}

export function validateProviderProxyTripOperationsSummaryRequest(input: unknown): ProviderProxyTripOperationsSummaryValidationResult {
  const record = readRecord(input)
  const requestId = readOptionalString(record.requestId, 128)

  if (record.operation !== PROVIDER_PROXY_TRIP_OPERATIONS_SUMMARY_OPERATION) {
    return tripOperationsSummaryInvalidRequest('不支持的 provider proxy 操作。', requestId)
  }

  const forbiddenFieldPath = findForbiddenRequestFieldPath(record, FORBIDDEN_TRIP_CONTENT_ENRICHMENT_FIELDS)
  if (forbiddenFieldPath) {
    return tripOperationsSummaryInvalidRequest('执行建议摘要请求包含不允许的敏感字段。', requestId)
  }

  const tripTitle = readRequiredTrimmedString(record.tripTitle, 160)
  if (!tripTitle) {
    return tripOperationsSummaryInvalidRequest('执行建议摘要缺少旅行标题。', requestId)
  }
  if (!VALID_TRIP_OPERATIONS_PHASES.has(record.phase as ProviderProxyTripOperationsPhase)) {
    return tripOperationsSummaryInvalidRequest('执行建议摘要阶段无效。', requestId)
  }
  if (!Array.isArray(record.recommendations) || record.recommendations.length < 1 || record.recommendations.length > MAX_TRIP_OPERATIONS_RECOMMENDATIONS) {
    return tripOperationsSummaryInvalidRequest(`执行建议摘要最多支持 ${MAX_TRIP_OPERATIONS_RECOMMENDATIONS} 条建议。`, requestId)
  }

  const recommendations: ProviderProxyTripOperationsRecommendationInput[] = []
  for (const rawRecommendation of record.recommendations) {
    const recommendation = readTripOperationsRecommendation(rawRecommendation)
    if (!recommendation.ok) {
      return tripOperationsSummaryInvalidRequest(recommendation.message, requestId)
    }
    recommendations.push(recommendation.recommendation)
  }

  return {
    ok: true,
    request: {
      destination: readOptionalString(record.destination, 160),
      generatedAt: readOptionalString(record.generatedAt, 80),
      operation: PROVIDER_PROXY_TRIP_OPERATIONS_SUMMARY_OPERATION,
      phase: record.phase as ProviderProxyTripOperationsPhase,
      quotaSessionId: readOptionalString(record.quotaSessionId, 160),
      recommendations,
      requestId,
      tripTitle,
    },
  }
}

function readTripOperationsRecommendation(
  input: unknown,
): { ok: true; recommendation: ProviderProxyTripOperationsRecommendationInput } | { message: string; ok: false } {
  const record = readRecord(input)
  const title = readRequiredTrimmedString(record.title, MAX_TRIP_OPERATIONS_TEXT)
  const message = readRequiredTrimmedString(record.message, MAX_TRIP_OPERATIONS_TEXT)
  const actionLabel = readRequiredTrimmedString(record.actionLabel, 80)
  const type = readRequiredTrimmedString(record.type, 80)
  const actionKind = readRequiredTrimmedString(record.actionKind, 80)
  if (!title || !message || !actionLabel || !type || !actionKind) {
    return { message: '执行建议摘要包含空建议字段。', ok: false }
  }
  if (!VALID_TRIP_OPERATIONS_SEVERITIES.has(record.severity as ProviderProxyTripOperationsSeverity)) {
    return { message: '执行建议摘要严重级别无效。', ok: false }
  }
  return {
    ok: true,
    recommendation: {
      actionKind,
      actionLabel,
      message,
      severity: record.severity as ProviderProxyTripOperationsSeverity,
      title,
      type,
    },
  }
}

function readTripContentEnrichmentItem(input: unknown): { ok: true; item: ProviderProxyTripContentEnrichmentItemInput } | { message: string; ok: false } {
  const record = readRecord(input)
  const itemId = readRequiredTrimmedString(record.itemId, 128)
  const title = readRequiredTrimmedString(record.title, 160)
  if (!itemId || !title) {
    return { message: '内容补充行程点缺少标题或 ID。', ok: false }
  }
  const sourcesResult = readTripContentEnrichmentSources(record.sources)
  if (!sourcesResult.ok) {
    return sourcesResult
  }
  const placeResult = readTripContentEnrichmentPlace(record.place)
  if (!placeResult.ok) {
    return placeResult
  }

  return {
    item: {
      address: readOptionalString(record.address, 240),
      date: readOptionalString(record.date, 32),
      dayTitle: readOptionalString(record.dayTitle, 160),
      destination: readOptionalString(record.destination, 160),
      itemId,
      locationName: readOptionalString(record.locationName, 160),
      place: placeResult.place,
      sources: sourcesResult.sources,
      title,
    },
    ok: true,
  }
}

function readTripContentEnrichmentPlace(
  input: unknown,
): { ok: true; place?: ProviderProxyTripContentEnrichmentPlaceSummary } | { message: string; ok: false } {
  if (input === undefined) {
    return { ok: true, place: undefined }
  }
  const record = readRecord(input)
  const placeId = readRequiredTrimmedString(record.placeId, MAX_PLACE_ID_LENGTH)
  const displayName = readRequiredTrimmedString(record.displayName, 160)
  const retrievedAt = readRequiredTrimmedString(record.retrievedAt, 80)
  if (!placeId || !displayName || !isValidIsoLikeDate(retrievedAt)) {
    return { message: '内容补充地点详情摘要无效。', ok: false }
  }
  const googleMapsUri = readOptionalString(record.googleMapsUri, 500)
  const websiteUri = readOptionalString(record.websiteUri, 500)
  if ((googleMapsUri && !isSafeHttpUrl(googleMapsUri)) || (websiteUri && !isSafeHttpUrl(websiteUri))) {
    return { message: '内容补充地点详情链接无效。', ok: false }
  }
  return {
    ok: true,
    place: {
      displayName,
      editorialSummary: readOptionalString(record.editorialSummary, MAX_TRIP_CONTENT_ENRICHMENT_TEXT),
      formattedAddress: readOptionalString(record.formattedAddress, 300),
      googleMapsUri,
      placeId,
      priceLevel: readOptionalString(record.priceLevel, 80),
      priceRangeText: readOptionalString(record.priceRangeText, 120),
      regularOpeningHours: readOpeningHoursSummary(record.regularOpeningHours),
      retrievedAt,
      websiteUri,
    },
  }
}

function readTripContentEnrichmentSources(
  input: unknown,
): { ok: true; sources: ProviderProxyTripContentEnrichmentSourceSummary[] } | { message: string; ok: false } {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_TRIP_CONTENT_ENRICHMENT_SOURCES_PER_ITEM) {
    return { message: `内容补充每个行程点需提供 1-${MAX_TRIP_CONTENT_ENRICHMENT_SOURCES_PER_ITEM} 条来源摘要。`, ok: false }
  }
  const sources: ProviderProxyTripContentEnrichmentSourceSummary[] = []
  const ids = new Set<string>()
  for (const rawSource of input) {
    const record = readRecord(rawSource)
    const id = readRequiredTrimmedString(record.id, 128)
    const label = readRequiredTrimmedString(record.label, 80)
    const title = readRequiredTrimmedString(record.title, 160)
    const retrievedAt = readRequiredTrimmedString(record.retrievedAt, 80)
    const sourceType = record.sourceType
    const confidence = record.confidence
    const url = readOptionalString(record.url, 500)
    if (
      !id ||
      ids.has(id) ||
      !label ||
      !title ||
      !isValidIsoLikeDate(retrievedAt) ||
      !VALID_CONTENT_ENRICHMENT_SOURCE_TYPES.has(sourceType as ContentEnrichmentSourceType) ||
      !VALID_CONTENT_ENRICHMENT_CONFIDENCES.has(confidence as ContentEnrichmentConfidence) ||
      (url && !isSafeHttpUrl(url))
    ) {
      return { message: '内容补充来源摘要无效。', ok: false }
    }
    ids.add(id)
    sources.push({
      confidence: confidence as ContentEnrichmentConfidence,
      displayUrl: readOptionalString(record.displayUrl, 180),
      domain: readOptionalString(record.domain, 180),
      id,
      label,
      retrievedAt,
      snippet: readOptionalString(record.snippet, MAX_TRIP_CONTENT_ENRICHMENT_SOURCE_SNIPPET),
      sourceType: sourceType as ContentEnrichmentSourceType,
      title,
      url,
    })
  }
  return { ok: true, sources }
}

function readTripDailyTipSources(
  input: unknown,
): { ok: true; sources: ProviderProxyTripContentEnrichmentSourceSummary[] } | { message: string; ok: false } {
  if (!Array.isArray(input) || input.length > MAX_TRIP_DAILY_TIP_SOURCES) {
    return { message: `今日旅行提示来源摘要不能超过 ${MAX_TRIP_DAILY_TIP_SOURCES} 条。`, ok: false }
  }
  const sources: ProviderProxyTripContentEnrichmentSourceSummary[] = []
  const ids = new Set<string>()
  for (const rawSource of input) {
    const record = readRecord(rawSource)
    const id = readRequiredTrimmedString(record.id, 128)
    const label = readRequiredTrimmedString(record.label, 80)
    const title = readRequiredTrimmedString(record.title, 160)
    const retrievedAt = readRequiredTrimmedString(record.retrievedAt, 80)
    const sourceType = record.sourceType
    const confidence = record.confidence
    const url = readOptionalString(record.url, 500)
    if (
      !id ||
      ids.has(id) ||
      !label ||
      !title ||
      !isValidIsoLikeDate(retrievedAt) ||
      !VALID_CONTENT_ENRICHMENT_SOURCE_TYPES.has(sourceType as ContentEnrichmentSourceType) ||
      !VALID_CONTENT_ENRICHMENT_CONFIDENCES.has(confidence as ContentEnrichmentConfidence) ||
      (url && !isSafeHttpUrl(url))
    ) {
      return { message: '今日旅行提示来源摘要无效。', ok: false }
    }
    ids.add(id)
    sources.push({
      confidence: confidence as ContentEnrichmentConfidence,
      displayUrl: readOptionalString(record.displayUrl, 180),
      domain: readOptionalString(record.domain, 180),
      id,
      label,
      retrievedAt,
      snippet: readOptionalString(record.snippet, MAX_TRIP_CONTENT_ENRICHMENT_SOURCE_SNIPPET),
      sourceType: sourceType as ContentEnrichmentSourceType,
      title,
      url,
    })
  }
  return { ok: true, sources }
}

function readTripDailyTipLocalSections(
  input: unknown,
  validSourceIds: Set<string>,
): { ok: true; sections: ProviderProxyTripDailyTipLocalSection[] } | { message: string; ok: false } {
  if (!Array.isArray(input) || input.length > MAX_TRIP_DAILY_TIP_LOCAL_SECTIONS) {
    return { message: `今日旅行提示本地摘要不能超过 ${MAX_TRIP_DAILY_TIP_LOCAL_SECTIONS} 组。`, ok: false }
  }
  const sections: ProviderProxyTripDailyTipLocalSection[] = []
  const keys = new Set<string>()
  for (const rawSection of input) {
    const record = readRecord(rawSection)
    const key = record.key
    const title = readRequiredTrimmedString(record.title, 80)
    if (!VALID_TRIP_DAILY_TIP_SECTION_KEYS.has(key as ProviderProxyTripDailyTipSectionKey) || !title || keys.has(String(key))) {
      return { message: '今日旅行提示本地摘要分类无效。', ok: false }
    }
    if (!Array.isArray(record.items) || record.items.length > MAX_TRIP_DAILY_TIP_LOCAL_SECTION_ITEMS) {
      return { message: `今日旅行提示每组摘要不能超过 ${MAX_TRIP_DAILY_TIP_LOCAL_SECTION_ITEMS} 条。`, ok: false }
    }
    const items: ProviderProxyTripDailyTipLocalSection['items'] = []
    for (const rawItem of record.items) {
      const item = readRecord(rawItem)
      const itemTitle = readRequiredTrimmedString(item.title, 120)
      const text = readRequiredTrimmedString(item.text, MAX_TRIP_DAILY_TIP_TEXT)
      const sourceIds = readSourceIds(item.sourceIds, validSourceIds)
      if (!itemTitle || !text || (item.sourceIds !== undefined && !sourceIds)) {
        return { message: '今日旅行提示本地摘要条目无效。', ok: false }
      }
      items.push({ sourceIds, text, title: itemTitle })
    }
    keys.add(String(key))
    sections.push({ items, key: key as ProviderProxyTripDailyTipSectionKey, title })
  }
  return { ok: true, sections }
}

function readTripDailyTipItems(
  input: unknown,
): { ok: true; items: ProviderProxyTripDailyTipRequestItem[] } | { message: string; ok: false } {
  if (!Array.isArray(input) || input.length > MAX_TRIP_DAILY_TIP_ITEMS) {
    return { message: `今日旅行提示行程点不能超过 ${MAX_TRIP_DAILY_TIP_ITEMS} 个。`, ok: false }
  }
  const items: ProviderProxyTripDailyTipRequestItem[] = []
  const itemIds = new Set<string>()
  for (const rawItem of input) {
    const record = readRecord(rawItem)
    const itemId = readRequiredTrimmedString(record.itemId, 128)
    const title = readRequiredTrimmedString(record.title, 160)
    if (!itemId || !title || itemIds.has(itemId)) {
      return { message: '今日旅行提示行程点无效。', ok: false }
    }
    itemIds.add(itemId)
    items.push({
      endTime: readOptionalString(record.endTime, 20),
      itemId,
      locationName: readOptionalString(record.locationName, 160),
      startTime: readOptionalString(record.startTime, 20),
      title,
    })
  }
  return { ok: true, items }
}

function readSourceIds(input: unknown, validSourceIds: Set<string>): string[] | undefined {
  if (input === undefined) {
    return undefined
  }
  if (!Array.isArray(input)) {
    return undefined
  }
  const sourceIds = input.filter((value): value is string => typeof value === 'string' && validSourceIds.has(value))
  return sourceIds.length === input.length ? sourceIds : undefined
}

function readOpeningHoursSummary(input: unknown): ProviderProxyPlaceDetailsResult['regularOpeningHours'] {
  const record = readRecord(input)
  const weekdayDescriptions = Array.isArray(record.weekdayDescriptions)
    ? record.weekdayDescriptions
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => clampText(value.trim(), 180))
      .slice(0, 7)
    : []
  if (weekdayDescriptions.length === 0 && typeof record.openNow !== 'boolean') {
    return undefined
  }
  return {
    openNow: typeof record.openNow === 'boolean' ? record.openNow : undefined,
    weekdayDescriptions,
  }
}

function isTravelSearchLocale(value: unknown): value is ProviderProxyTravelSearchLocale {
  return typeof value === 'string' && VALID_TRAVEL_SEARCH_LOCALES.has(value as ProviderProxyTravelSearchLocale)
}

function isTravelSearchType(value: unknown): value is ProviderProxyTravelSearchType {
  return typeof value === 'string' && VALID_TRAVEL_SEARCH_TYPES.has(value as ProviderProxyTravelSearchType)
}

function isPlaceLookupLocale(value: unknown): value is ProviderProxyPlaceLookupLocale {
  return typeof value === 'string' && VALID_PLACE_LOOKUP_LOCALES.has(value as ProviderProxyPlaceLookupLocale)
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
    if (forbiddenFields.has(key) || forbiddenFields.has(key.toLowerCase())) {
      return `${path}.${key}`
    }
    const nested = findForbiddenRequestFieldPath(value, forbiddenFields, `${path}.${key}`)
    if (nested) return nested
  }
  return null
}
