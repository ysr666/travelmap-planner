import {
  PROVIDER_PROXY_PLACE_LOOKUP_OPERATION,
  type ProviderProxyErrorCode,
  type ProviderProxyPlaceLookupResult,
  type ProviderProxyPlaceLookupSuccessResponse,
  type ProviderProxyValidatedPlaceLookupRequest,
} from '../../src/lib/providerProxyContract'

export const GOOGLE_PLACES_TEXT_SEARCH_ENDPOINT = 'https://places.googleapis.com/v1/places:searchText'
export const GOOGLE_PLACES_FIELD_MASK = 'places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri'

export type PlaceLookupProviderErrorCode = Extract<ProviderProxyErrorCode, 'provider_unavailable' | 'provider_error' | 'network_error' | 'unsupported' | 'quota_exceeded'>

export type PlaceLookupProviderResult =
  | { ok: true; response: ProviderProxyPlaceLookupSuccessResponse }
  | { errorCode: PlaceLookupProviderErrorCode; message: string; ok: false }

export type PlaceLookupProvider = {
  readonly name: string
  lookup(request: ProviderProxyValidatedPlaceLookupRequest): Promise<PlaceLookupProviderResult>
}

type GooglePlacesEnv = {
  GOOGLE_MAPS_PLATFORM_API_KEY?: string
  TRIPMAP_GOOGLE_PLACES_API_KEY?: string
}

type GooglePlacesLookupProviderOptions = {
  now?: Date | string
}

const DEFAULT_MOCK_RETRIEVED_AT = '2026-01-01T00:00:00.000Z'
const MOCK_PLACE_LOOKUP_WARNING = '当前为模拟地点结果，不代表真实 Google Places 数据。'
const GOOGLE_PLACES_REQUEST_TIMEOUT_MS = 20_000
const MAX_DISPLAY_NAME_LENGTH = 160
const MAX_FORMATTED_ADDRESS_LENGTH = 300

export function createMockPlaceLookupProvider(options: GooglePlacesLookupProviderOptions = {}): PlaceLookupProvider {
  const retrievedAt = normalizeRetrievedAt(options.now)
  return {
    name: 'mock',
    async lookup(request) {
      return {
        ok: true,
        response: {
          ok: true,
          operation: PROVIDER_PROXY_PLACE_LOOKUP_OPERATION,
          requestId: request.requestId,
          results: buildMockPlaceLookupResults(request, retrievedAt),
          retrievedAt,
          source: 'mock',
          warnings: [MOCK_PLACE_LOOKUP_WARNING],
        },
      }
    },
  }
}

export function createDisabledPlaceLookupProvider(): PlaceLookupProvider {
  return {
    name: 'disabled',
    async lookup() {
      return { errorCode: 'unsupported', message: 'Place lookup is not enabled.', ok: false }
    },
  }
}

export function createUnavailablePlaceLookupProvider(): PlaceLookupProvider {
  return {
    name: 'unavailable',
    async lookup() {
      return { errorCode: 'provider_unavailable', message: 'Place lookup provider is not configured.', ok: false }
    },
  }
}

export function createGooglePlacesLookupProvider(
  env: GooglePlacesEnv,
  fetchImpl: typeof fetch = fetch,
  options: GooglePlacesLookupProviderOptions = {},
): PlaceLookupProvider {
  const apiKey = getGooglePlacesApiKey(env)

  return {
    name: 'google_places',
    async lookup(request) {
      if (!apiKey) {
        return { errorCode: 'provider_unavailable', message: 'Place lookup provider is not configured.', ok: false }
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), GOOGLE_PLACES_REQUEST_TIMEOUT_MS)
      let response: Response
      try {
        response = await fetchImpl(GOOGLE_PLACES_TEXT_SEARCH_ENDPOINT, {
          body: JSON.stringify(buildGooglePlacesTextSearchBody(request)),
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': GOOGLE_PLACES_FIELD_MASK,
          },
          method: 'POST',
          signal: controller.signal,
        })
      } catch {
        clearTimeout(timeoutId)
        return { errorCode: 'network_error', message: 'Place lookup provider request failed.', ok: false }
      }
      clearTimeout(timeoutId)

      if (!response.ok) {
        return {
          errorCode: response.status === 401 || response.status === 403 ? 'provider_unavailable' : response.status === 429 ? 'quota_exceeded' : 'provider_error',
          message: 'Place lookup provider returned an error.',
          ok: false,
        }
      }

      let data: unknown
      try {
        data = await response.json()
      } catch {
        return { errorCode: 'provider_error', message: 'Place lookup provider returned invalid JSON.', ok: false }
      }

      return normalizeGooglePlacesTextSearchResponse(data, request, normalizeRetrievedAt(options.now ?? new Date()))
    },
  }
}

export function getGooglePlacesApiKey(env: GooglePlacesEnv) {
  return env.TRIPMAP_GOOGLE_PLACES_API_KEY?.trim() || env.GOOGLE_MAPS_PLATFORM_API_KEY?.trim()
}

function buildGooglePlacesTextSearchBody(request: ProviderProxyValidatedPlaceLookupRequest) {
  return {
    languageCode: request.locale,
    pageSize: Math.min(request.maxResults, 5),
    regionCode: request.region,
    textQuery: request.query,
  }
}

function normalizeGooglePlacesTextSearchResponse(
  input: unknown,
  request: ProviderProxyValidatedPlaceLookupRequest,
  retrievedAt: string,
): PlaceLookupProviderResult {
  const record = readRecord(input)
  if (!Array.isArray(record.places)) {
    return { errorCode: 'provider_error', message: 'Place lookup provider returned an invalid response.', ok: false }
  }

  const results = record.places.flatMap((place): ProviderProxyPlaceLookupResult[] => {
    const normalized = normalizeGooglePlace(place, retrievedAt)
    return normalized ? [normalized] : []
  }).slice(0, request.maxResults)

  return {
    ok: true,
    response: {
      ok: true,
      operation: PROVIDER_PROXY_PLACE_LOOKUP_OPERATION,
      requestId: request.requestId,
      results,
      retrievedAt,
      source: 'google_places',
    },
  }
}

function normalizeGooglePlace(input: unknown, retrievedAt: string): ProviderProxyPlaceLookupResult | null {
  const place = readRecord(input)
  const displayNameRecord = readRecord(place.displayName)
  const placeId = readNonEmptyString(place.id)
  const displayName = clampText(readNonEmptyString(displayNameRecord.text), MAX_DISPLAY_NAME_LENGTH)
  const formattedAddress = clampText(readNonEmptyString(place.formattedAddress), MAX_FORMATTED_ADDRESS_LENGTH)

  if (!placeId || !displayName || !formattedAddress) {
    return null
  }

  const result: ProviderProxyPlaceLookupResult = {
    displayName,
    formattedAddress,
    placeId,
    provider: 'google_places',
    retrievedAt,
  }
  const location = normalizeGooglePlaceLocation(place.location)
  const googleMapsUri = normalizeGoogleMapsUri(place.googleMapsUri)
  if (location) result.location = location
  if (googleMapsUri) result.googleMapsUri = googleMapsUri
  return result
}

function buildMockPlaceLookupResults(
  request: ProviderProxyValidatedPlaceLookupRequest,
  retrievedAt: string,
): ProviderProxyPlaceLookupResult[] {
  return Array.from({ length: request.maxResults }, (_, index) => {
    const position = index + 1
    const id = `mock-place-${stableHash(`${request.query}:${request.region ?? ''}:${position}`)}`
    return {
      displayName: `模拟地点 ${position}：${request.query}`,
      formattedAddress: `模拟地址 ${position}，${request.region ?? '本地'}`,
      googleMapsUri: `https://maps.google.com/?cid=${encodeURIComponent(id)}`,
      location: {
        lat: 30.24 + index / 100,
        lng: 120.15 + index / 100,
      },
      placeId: id,
      provider: 'google_places',
      retrievedAt,
    }
  })
}

function normalizeGooglePlaceLocation(value: unknown): ProviderProxyPlaceLookupResult['location'] {
  const location = readRecord(value)
  const lat = Number(location.latitude)
  const lng = Number(location.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return undefined
  }
  return { lat, lng }
}

function normalizeGoogleMapsUri(value: unknown): string | undefined {
  const uri = readNonEmptyString(value)
  if (!uri) return undefined
  try {
    const parsed = new URL(uri)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
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

function stableHash(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return hash.toString(36)
}
