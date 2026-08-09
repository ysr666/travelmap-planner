import {
  type ProviderProxyErrorCode,
  type ProviderProxyValidatedPlacePhotoRequest,
} from '../../src/lib/ai/providerProxyContract'
import { getGooglePlacesApiKey } from './placeLookupProvider'

export const GOOGLE_PLACES_PHOTO_ENDPOINT_PREFIX = 'https://places.googleapis.com/v1/'

export type PlacePhotoProviderErrorCode = Extract<
  ProviderProxyErrorCode,
  'provider_unavailable' | 'provider_error' | 'network_error' | 'unsupported' | 'quota_exceeded' | 'invalid_response'
>

export type PlacePhotoMedia = {
  bytes: Uint8Array
  contentType: 'image/jpeg' | 'image/png' | 'image/webp'
  height: number
  width: number
}

export type PlacePhotoProviderResult =
  | { ok: true; media: PlacePhotoMedia }
  | PlacePhotoProviderFailure

type PlacePhotoProviderFailure = {
  errorCode: PlacePhotoProviderErrorCode
  message: string
  ok: false
}

export type PlacePhotoProvider = {
  readonly name: string
  getPhoto(request: ProviderProxyValidatedPlacePhotoRequest): Promise<PlacePhotoProviderResult>
}

type GooglePlacesEnv = {
  GOOGLE_MAPS_PLATFORM_API_KEY?: string
  TRIPMAP_GOOGLE_PLACES_API_KEY?: string
  VITE_GOOGLE_MAPS_API_KEY?: string
}

const GOOGLE_PLACES_REQUEST_TIMEOUT_MS = 20_000
const MAX_MEDIA_BYTES = 3_000_000
const ALLOWED_MEDIA_TYPES = new Set<PlacePhotoMedia['contentType']>([
  'image/jpeg',
  'image/png',
  'image/webp',
])

export function createDisabledPlacePhotoProvider(): PlacePhotoProvider {
  return {
    name: 'disabled',
    async getPhoto() {
      return { errorCode: 'unsupported', message: 'Place photos are not enabled.', ok: false }
    },
  }
}

export function createUnavailablePlacePhotoProvider(): PlacePhotoProvider {
  return {
    name: 'unavailable',
    async getPhoto() {
      return { errorCode: 'provider_unavailable', message: 'Place photo provider is not configured.', ok: false }
    },
  }
}

export function createGooglePlacesPhotoProvider(
  env: GooglePlacesEnv,
  fetchImpl: typeof fetch = fetch,
): PlacePhotoProvider {
  const apiKey = getGooglePlacesApiKey(env)
  return {
    name: 'google_places',
    async getPhoto(request) {
      if (!apiKey) {
        return { errorCode: 'provider_unavailable', message: 'Place photo provider is not configured.', ok: false }
      }

      const mediaReference = await requestGooglePhotoUri(request, apiKey, fetchImpl)
      if (!mediaReference.ok) return mediaReference
      return fetchValidatedPhotoMedia(mediaReference.photoUri, request, fetchImpl)
    },
  }
}

async function requestGooglePhotoUri(
  request: ProviderProxyValidatedPlacePhotoRequest,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<{ ok: true; photoUri: string } | PlacePhotoProviderFailure> {
  const url = new URL(`${GOOGLE_PLACES_PHOTO_ENDPOINT_PREFIX}${request.photoRef}/media`)
  url.searchParams.set('maxWidthPx', String(request.maxWidthPx))
  url.searchParams.set('maxHeightPx', String(request.maxHeightPx))
  url.searchParams.set('skipHttpRedirect', 'true')

  const response = await fetchWithTimeout(url, {
    headers: { 'X-Goog-Api-Key': apiKey },
    method: 'GET',
    redirect: 'error',
  }, fetchImpl)
  if (!response.ok) return response
  if (!response.response.ok) return mapGoogleStatus(response.response.status)

  let body: unknown
  try {
    body = await response.response.json()
  } catch {
    return { errorCode: 'invalid_response', message: 'Place photo provider returned invalid metadata.', ok: false }
  }
  const photoUri = readNonEmptyString(readRecord(body).photoUri)
  if (!photoUri || !isAllowedGooglePhotoUri(photoUri)) {
    return { errorCode: 'invalid_response', message: 'Place photo provider returned an untrusted media location.', ok: false }
  }
  return { ok: true, photoUri }
}

async function fetchValidatedPhotoMedia(
  photoUri: string,
  request: ProviderProxyValidatedPlacePhotoRequest,
  fetchImpl: typeof fetch,
): Promise<PlacePhotoProviderResult> {
  const response = await fetchWithTimeout(photoUri, {
    headers: { Accept: 'image/jpeg,image/png,image/webp' },
    method: 'GET',
    redirect: 'error',
  }, fetchImpl)
  if (!response.ok) return response
  if (!response.response.ok) return mapGoogleStatus(response.response.status)

  const contentType = normalizeContentType(response.response.headers.get('Content-Type'))
  const declaredLength = Number(response.response.headers.get('Content-Length'))
  if (
    !contentType
    || (Number.isFinite(declaredLength) && (declaredLength < 1 || declaredLength > MAX_MEDIA_BYTES))
  ) {
    return { errorCode: 'invalid_response', message: 'Place photo provider returned an unsupported image.', ok: false }
  }

  const bytes = await readResponseBytes(response.response, MAX_MEDIA_BYTES)
  if (!bytes) {
    return { errorCode: 'invalid_response', message: 'Place photo provider returned an oversized image.', ok: false }
  }
  const dimensions = readImageDimensions(bytes, contentType)
  if (
    !dimensions
    || dimensions.width > request.maxWidthPx
    || dimensions.height > request.maxHeightPx
    || dimensions.width * dimensions.height > 2_560_000
  ) {
    return { errorCode: 'invalid_response', message: 'Place photo provider returned invalid image dimensions.', ok: false }
  }

  return {
    media: { bytes, contentType, ...dimensions },
    ok: true,
  }
}

async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<{ ok: true; response: Response } | PlacePhotoProviderFailure> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), GOOGLE_PLACES_REQUEST_TIMEOUT_MS)
  try {
    const response = await fetchImpl(input, { ...init, signal: controller.signal })
    return { ok: true, response }
  } catch {
    return { errorCode: 'network_error', message: 'Place photo provider request failed.', ok: false }
  } finally {
    clearTimeout(timeoutId)
  }
}

function mapGoogleStatus(status: number): PlacePhotoProviderFailure {
  if (status === 401 || status === 403) {
    return { errorCode: 'provider_unavailable', message: 'Place photo provider is unavailable.', ok: false }
  }
  if (status === 429) {
    return { errorCode: 'quota_exceeded', message: 'Place photo provider quota was exceeded.', ok: false }
  }
  return { errorCode: 'provider_error', message: 'Place photo provider returned an error.', ok: false }
}

function isAllowedGooglePhotoUri(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false
    const hostname = url.hostname.toLowerCase()
    return hostname === 'googleusercontent.com'
      || hostname.endsWith('.googleusercontent.com')
      || hostname === 'ggpht.com'
      || hostname.endsWith('.ggpht.com')
  } catch {
    return false
  }
}

function normalizeContentType(value: string | null): PlacePhotoMedia['contentType'] | null {
  const normalized = value?.split(';', 1)[0]?.trim().toLowerCase()
  return normalized && ALLOWED_MEDIA_TYPES.has(normalized as PlacePhotoMedia['contentType'])
    ? normalized as PlacePhotoMedia['contentType']
    : null
}

async function readResponseBytes(response: Response, maxBytes: number) {
  if (!response.body) return null
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } catch {
    return null
  }
  if (total < 1) return null
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export function readImageDimensions(
  bytes: Uint8Array,
  contentType: PlacePhotoMedia['contentType'],
): { width: number; height: number } | null {
  if (contentType === 'image/png') return readPngDimensions(bytes)
  if (contentType === 'image/jpeg') return readJpegDimensions(bytes)
  return readWebpDimensions(bytes)
}

function readPngDimensions(bytes: Uint8Array) {
  if (
    bytes.length < 24
    || bytes[0] !== 0x89
    || bytes[1] !== 0x50
    || bytes[2] !== 0x4e
    || bytes[3] !== 0x47
    || bytes[12] !== 0x49
    || bytes[13] !== 0x48
    || bytes[14] !== 0x44
    || bytes[15] !== 0x52
  ) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  return validDimensions(width, height)
}

function readJpegDimensions(bytes: Uint8Array) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let offset = 2
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    while (bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset]
    offset += 1
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.length) return null
    const length = (bytes[offset] << 8) | bytes[offset + 1]
    if (length < 2 || offset + length > bytes.length) return null
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      if (length < 7) return null
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4]
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6]
      return validDimensions(width, height)
    }
    offset += length
  }
  return null
}

function readWebpDimensions(bytes: Uint8Array) {
  if (
    bytes.length < 30
    || ascii(bytes, 0, 4) !== 'RIFF'
    || ascii(bytes, 8, 12) !== 'WEBP'
  ) return null
  const chunk = ascii(bytes, 12, 16)
  if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return validDimensions(readUInt16LE(bytes, 26) & 0x3fff, readUInt16LE(bytes, 28) & 0x3fff)
  }
  if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)
    return validDimensions((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1)
  }
  if (chunk === 'VP8X' && bytes.length >= 30) {
    const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16)
    const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16)
    return validDimensions(width, height)
  }
  return null
}

function validDimensions(width: number, height: number) {
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
    ? { height, width }
    : null
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.subarray(start, end))
}

function readUInt16LE(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readNonEmptyString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}
