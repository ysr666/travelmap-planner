import {
  PROVIDER_PROXY_PLACE_DETAILS_OPERATION,
  type ProviderProxyErrorCode,
  type ProviderProxyPlaceDetailsResult,
  type ProviderProxyPlaceDetailsSuccessResponse,
  type ProviderProxyValidatedPlaceDetailsRequest,
} from '../../src/lib/ai/providerProxyContract'
import { getGooglePlacesApiKey } from './placeLookupProvider'

export const GOOGLE_PLACES_DETAILS_ENDPOINT_PREFIX = 'https://places.googleapis.com/v1/places/'
export const GOOGLE_PLACES_DETAILS_FIELD_MASK = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'googleMapsUri',
  'websiteUri',
  'regularOpeningHours',
  'priceLevel',
  'priceRange',
  'editorialSummary',
].join(',')

export type PlaceDetailsProviderErrorCode = Extract<ProviderProxyErrorCode, 'provider_unavailable' | 'provider_error' | 'network_error' | 'unsupported' | 'quota_exceeded'>

export type PlaceDetailsProviderResult =
  | { ok: true; response: ProviderProxyPlaceDetailsSuccessResponse }
  | { errorCode: PlaceDetailsProviderErrorCode; message: string; ok: false }

export type PlaceDetailsProvider = {
  readonly name: string
  getDetails(request: ProviderProxyValidatedPlaceDetailsRequest): Promise<PlaceDetailsProviderResult>
}

type GooglePlacesEnv = {
  GOOGLE_MAPS_PLATFORM_API_KEY?: string
  TRIPMAP_GOOGLE_PLACES_API_KEY?: string
  VITE_GOOGLE_MAPS_API_KEY?: string
}

type GooglePlacesDetailsProviderOptions = {
  now?: Date | string
}

const DEFAULT_MOCK_RETRIEVED_AT = '2026-01-01T00:00:00.000Z'
const MOCK_PLACE_DETAILS_WARNING = '当前为模拟地点详情，不代表真实 Google Places 数据。'
const GOOGLE_PLACES_REQUEST_TIMEOUT_MS = 20_000
const MAX_DISPLAY_NAME_LENGTH = 160
const MAX_FORMATTED_ADDRESS_LENGTH = 300
const MAX_EDITORIAL_SUMMARY_LENGTH = 700

export function createMockPlaceDetailsProvider(options: GooglePlacesDetailsProviderOptions = {}): PlaceDetailsProvider {
  const retrievedAt = normalizeRetrievedAt(options.now)
  return {
    name: 'mock',
    async getDetails(request) {
      return {
        ok: true,
        response: {
          details: buildMockPlaceDetails(request, retrievedAt),
          ok: true,
          operation: PROVIDER_PROXY_PLACE_DETAILS_OPERATION,
          requestId: request.requestId,
          retrievedAt,
          source: 'mock',
          warnings: [MOCK_PLACE_DETAILS_WARNING],
        },
      }
    },
  }
}

export function createDisabledPlaceDetailsProvider(): PlaceDetailsProvider {
  return {
    name: 'disabled',
    async getDetails() {
      return { errorCode: 'unsupported', message: 'Place details is not enabled.', ok: false }
    },
  }
}

export function createUnavailablePlaceDetailsProvider(): PlaceDetailsProvider {
  return {
    name: 'unavailable',
    async getDetails() {
      return { errorCode: 'provider_unavailable', message: 'Place details provider is not configured.', ok: false }
    },
  }
}

export function createGooglePlacesDetailsProvider(
  env: GooglePlacesEnv,
  fetchImpl: typeof fetch = fetch,
  options: GooglePlacesDetailsProviderOptions = {},
): PlaceDetailsProvider {
  const apiKey = getGooglePlacesApiKey(env)

  return {
    name: 'google_places',
    async getDetails(request) {
      if (!apiKey) {
        return { errorCode: 'provider_unavailable', message: 'Place details provider is not configured.', ok: false }
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), GOOGLE_PLACES_REQUEST_TIMEOUT_MS)
      let response: Response
      try {
        response = await fetchImpl(buildGooglePlacesDetailsUrl(request), {
          headers: {
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': GOOGLE_PLACES_DETAILS_FIELD_MASK,
          },
          method: 'GET',
          signal: controller.signal,
        })
      } catch {
        clearTimeout(timeoutId)
        return { errorCode: 'network_error', message: 'Place details provider request failed.', ok: false }
      }
      clearTimeout(timeoutId)

      if (!response.ok) {
        return {
          errorCode: response.status === 401 || response.status === 403 ? 'provider_unavailable' : response.status === 429 ? 'quota_exceeded' : 'provider_error',
          message: 'Place details provider returned an error.',
          ok: false,
        }
      }

      let data: unknown
      try {
        data = await response.json()
      } catch {
        return { errorCode: 'provider_error', message: 'Place details provider returned invalid JSON.', ok: false }
      }

      return normalizeGooglePlacesDetailsResponse(data, request, normalizeRetrievedAt(options.now ?? new Date()))
    },
  }
}

function buildGooglePlacesDetailsUrl(request: ProviderProxyValidatedPlaceDetailsRequest) {
  const url = new URL(`${GOOGLE_PLACES_DETAILS_ENDPOINT_PREFIX}${encodeURIComponent(request.placeId)}`)
  if (request.locale) url.searchParams.set('languageCode', request.locale)
  if (request.region) url.searchParams.set('regionCode', request.region)
  return url.toString()
}

function normalizeGooglePlacesDetailsResponse(
  input: unknown,
  request: ProviderProxyValidatedPlaceDetailsRequest,
  retrievedAt: string,
): PlaceDetailsProviderResult {
  const details = normalizeGooglePlaceDetails(input, retrievedAt)
  if (!details) {
    return { errorCode: 'provider_error', message: 'Place details provider returned an invalid response.', ok: false }
  }

  return {
    ok: true,
    response: {
      details,
      ok: true,
      operation: PROVIDER_PROXY_PLACE_DETAILS_OPERATION,
      requestId: request.requestId,
      retrievedAt,
      source: 'google_places',
    },
  }
}

function normalizeGooglePlaceDetails(input: unknown, retrievedAt: string): ProviderProxyPlaceDetailsResult | null {
  const place = readRecord(input)
  const displayNameRecord = readRecord(place.displayName)
  const placeId = readNonEmptyString(place.id)
  const displayName = clampText(readNonEmptyString(displayNameRecord.text), MAX_DISPLAY_NAME_LENGTH)
  if (!placeId || !displayName) {
    return null
  }

  const result: ProviderProxyPlaceDetailsResult = {
    displayName,
    placeId,
    provider: 'google_places',
    retrievedAt,
  }
  const formattedAddress = clampText(readNonEmptyString(place.formattedAddress), MAX_FORMATTED_ADDRESS_LENGTH)
  const location = normalizeGooglePlaceLocation(place.location)
  const googleMapsUri = normalizeSafeHttpUrl(place.googleMapsUri)
  const websiteUri = normalizeSafeHttpUrl(place.websiteUri)
  const regularOpeningHours = normalizeRegularOpeningHours(place.regularOpeningHours)
  const priceLevel = readNonEmptyString(place.priceLevel)
  const priceRangeText = normalizePriceRangeText(place.priceRange)
  const editorialSummary = normalizeEditorialSummary(place.editorialSummary)

  if (formattedAddress) result.formattedAddress = formattedAddress
  if (location) result.location = location
  if (googleMapsUri) result.googleMapsUri = googleMapsUri
  if (websiteUri) result.websiteUri = websiteUri
  if (regularOpeningHours) result.regularOpeningHours = regularOpeningHours
  if (priceLevel) result.priceLevel = priceLevel
  if (priceRangeText) result.priceRangeText = priceRangeText
  if (editorialSummary) result.editorialSummary = editorialSummary
  return result
}

function buildMockPlaceDetails(
  request: ProviderProxyValidatedPlaceDetailsRequest,
  retrievedAt: string,
): ProviderProxyPlaceDetailsResult {
  const suffix = request.placeId.replace(/^mock-place-/, '').slice(0, 8) || 'local'
  return {
    displayName: `模拟景点 ${suffix}`,
    editorialSummary: '这是一个适合放入行程的模拟景点摘要，用于预览内容补充流程。',
    formattedAddress: `模拟地址 ${suffix}`,
    googleMapsUri: `https://maps.google.com/?cid=${encodeURIComponent(request.placeId)}`,
    location: { lat: 30.25, lng: 120.16 },
    placeId: request.placeId,
    provider: 'google_places',
    regularOpeningHours: {
      openNow: true,
      weekdayDescriptions: ['周一至周日 09:00-17:00'],
    },
    retrievedAt,
    websiteUri: `https://places.example/${encodeURIComponent(suffix)}`,
  }
}

function normalizeGooglePlaceLocation(value: unknown): ProviderProxyPlaceDetailsResult['location'] {
  const location = readRecord(value)
  const lat = Number(location.latitude)
  const lng = Number(location.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return undefined
  }
  return { lat, lng }
}

function normalizeRegularOpeningHours(value: unknown): ProviderProxyPlaceDetailsResult['regularOpeningHours'] {
  const record = readRecord(value)
  const weekdayDescriptions = Array.isArray(record.weekdayDescriptions)
    ? record.weekdayDescriptions
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => clampText(item.trim(), 180))
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

function normalizePriceRangeText(value: unknown): string | undefined {
  const record = readRecord(value)
  const start = normalizeMoney(record.startPrice)
  const end = normalizeMoney(record.endPrice)
  if (start && end && start !== end) return `${start}-${end}`
  return start ?? end
}

function normalizeMoney(value: unknown): string | undefined {
  const record = readRecord(value)
  const currency = readNonEmptyString(record.currencyCode)
  const units = readNonEmptyString(record.units)
  const nanos = Number(record.nanos)
  if (!currency || !units) return undefined
  const number = Number(units) + (Number.isFinite(nanos) ? nanos / 1_000_000_000 : 0)
  if (!Number.isFinite(number)) return undefined
  return `${currency} ${Number.isInteger(number) ? number : number.toFixed(2)}`
}

function normalizeEditorialSummary(value: unknown): string | undefined {
  const record = readRecord(value)
  const text = clampText(readNonEmptyString(record.text), MAX_EDITORIAL_SUMMARY_LENGTH)
  return text || undefined
}

function normalizeSafeHttpUrl(value: unknown): string | undefined {
  const uri = readNonEmptyString(value)
  if (!uri) return undefined
  try {
    const parsed = new URL(uri)
    if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || parsed.username || parsed.password) {
      return undefined
    }
    return parsed.toString()
  } catch {
    return undefined
  }
}

function normalizeRetrievedAt(value: Date | string | undefined): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string' && value.trim()) return value.trim()
  return DEFAULT_MOCK_RETRIEVED_AT
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function clampText(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1)).trim()}…`
}
