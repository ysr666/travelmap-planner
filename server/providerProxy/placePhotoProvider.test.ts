import { describe, expect, it, vi } from 'vitest'
import {
  GOOGLE_PLACES_PHOTO_ENDPOINT_PREFIX,
  createDisabledPlacePhotoProvider,
  createGooglePlacesPhotoProvider,
  createUnavailablePlacePhotoProvider,
  readImageDimensions,
} from './placePhotoProvider'

const PHOTO_REF = 'places/ChIJN1t_tDeuEmsRUsoyG83frY4/photos/ATKogpcFidelityPhotoReference'

function validPhotoRequest() {
  return {
    maxHeightPx: 900,
    maxWidthPx: 1200,
    operation: 'place_photo' as const,
    photoRef: PHOTO_REF,
    requestId: 'photo-1',
  }
}

function pngHeader(width: number, height: number) {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

function imageResponse(bytes: Uint8Array, contentType = 'image/png') {
  const body = new Uint8Array(bytes.byteLength)
  body.set(bytes)
  return new Response(body, {
    headers: {
      'Content-Length': String(body.byteLength),
      'Content-Type': contentType,
    },
    status: 200,
  })
}

describe('place photo provider', () => {
  it('uses the fixed Google endpoint and returns only validated image bytes', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (vi.mocked(fetcher).mock.calls.length === 1) {
        expect(String(input)).toContain(`${GOOGLE_PLACES_PHOTO_ENDPOINT_PREFIX}${PHOTO_REF}/media`)
        expect(String(input)).toContain('maxWidthPx=1200')
        expect(String(input)).toContain('maxHeightPx=900')
        expect(String(input)).toContain('skipHttpRedirect=true')
        expect(init?.headers).toMatchObject({ 'X-Goog-Api-Key': 'server-photo-secret' })
        expect(init?.redirect).toBe('error')
        return new Response(JSON.stringify({
          photoUri: 'https://lh3.googleusercontent.com/place-photo-content',
        }), { headers: { 'Content-Type': 'application/json' }, status: 200 })
      }
      expect(String(input)).toBe('https://lh3.googleusercontent.com/place-photo-content')
      expect(init?.redirect).toBe('error')
      expect(init?.headers).toMatchObject({ Accept: 'image/jpeg,image/png,image/webp' })
      return imageResponse(pngHeader(1200, 900))
    }) as unknown as typeof fetch
    const provider = createGooglePlacesPhotoProvider({
      TRIPMAP_GOOGLE_PLACES_API_KEY: 'server-photo-secret',
    }, fetcher)

    const result = await provider.getPhoto(validPhotoRequest())

    expect(result.ok).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(result)).not.toContain('server-photo-secret')
    expect(JSON.stringify(result)).not.toContain('googleusercontent.com')
    if (result.ok) {
      expect(result.media).toMatchObject({ contentType: 'image/png', height: 900, width: 1200 })
      expect(result.media.bytes.byteLength).toBe(24)
    }
  })

  it.each([
    'http://127.0.0.1/private.png',
    'https://example.com/photo.png',
    'https://googleusercontent.com.evil.example/photo.png',
    'https://user:password@lh3.googleusercontent.com/photo.png',
  ])('rejects an untrusted media location: %s', async (photoUri) => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ photoUri }), { status: 200 })) as unknown as typeof fetch
    const provider = createGooglePlacesPhotoProvider({ TRIPMAP_GOOGLE_PLACES_API_KEY: 'server-photo-secret' }, fetcher)

    await expect(provider.getPhoto(validPhotoRequest())).resolves.toMatchObject({
      errorCode: 'invalid_response',
      ok: false,
    })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('rejects unsupported MIME and dimensions above the requested variant', async () => {
    for (const response of [
      imageResponse(pngHeader(1200, 900), 'image/svg+xml'),
      imageResponse(pngHeader(1201, 900)),
    ]) {
      const fetcher = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({
          photoUri: 'https://lh3.googleusercontent.com/place-photo-content',
        }), { status: 200 }))
        .mockResolvedValueOnce(response) as unknown as typeof fetch
      const result = await createGooglePlacesPhotoProvider({
        TRIPMAP_GOOGLE_PLACES_API_KEY: 'server-photo-secret',
      }, fetcher).getPhoto(validPhotoRequest())

      expect(result).toMatchObject({ errorCode: 'invalid_response', ok: false })
    }
  })

  it('normalizes disabled, unavailable, and provider failures', async () => {
    await expect(createDisabledPlacePhotoProvider().getPhoto(validPhotoRequest())).resolves.toMatchObject({
      errorCode: 'unsupported',
      ok: false,
    })
    await expect(createUnavailablePlacePhotoProvider().getPhoto(validPhotoRequest())).resolves.toMatchObject({
      errorCode: 'provider_unavailable',
      ok: false,
    })
    const fetcher = vi.fn(async () => new Response('raw provider body with server-photo-secret', { status: 500 })) as unknown as typeof fetch
    const result = await createGooglePlacesPhotoProvider({
      TRIPMAP_GOOGLE_PLACES_API_KEY: 'server-photo-secret',
    }, fetcher).getPhoto(validPhotoRequest())
    expect(result).toMatchObject({ errorCode: 'provider_error', ok: false })
    expect(JSON.stringify(result)).not.toContain('raw provider body')
    expect(JSON.stringify(result)).not.toContain('server-photo-secret')
  })

  it('reads PNG dimensions without trusting response metadata', () => {
    expect(readImageDimensions(pngHeader(640, 480), 'image/png')).toEqual({ height: 480, width: 640 })
    expect(readImageDimensions(new Uint8Array([0x89, 0x50]), 'image/png')).toBeNull()
  })
})
