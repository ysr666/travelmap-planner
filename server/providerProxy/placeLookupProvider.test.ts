import { describe, expect, it, vi } from 'vitest'
import {
  GOOGLE_PLACES_FIELD_MASK,
  GOOGLE_PLACES_TEXT_SEARCH_ENDPOINT,
  createDisabledPlaceLookupProvider,
  createGooglePlacesLookupProvider,
  createMockPlaceLookupProvider,
  createUnavailablePlaceLookupProvider,
} from './placeLookupProvider'

function validPlaceLookupRequest() {
  return {
    locale: 'zh-CN' as const,
    maxResults: 3,
    operation: 'place_lookup' as const,
    query: '杭州博物馆',
    region: 'CN',
  }
}

describe('place lookup provider foundation', () => {
  it('returns deterministic mock results for the same request', async () => {
    const provider = createMockPlaceLookupProvider({ now: '2026-02-03T04:05:06.000Z' })
    const first = await provider.lookup(validPlaceLookupRequest())
    const second = await provider.lookup(validPlaceLookupRequest())

    expect(first).toEqual(second)
    expect(first.ok).toBe(true)
    if (first.ok) {
      expect(first.response.source).toBe('mock')
      expect(first.response.retrievedAt).toBe('2026-02-03T04:05:06.000Z')
      expect(first.response.results).toHaveLength(3)
      expect(first.response.results[0]).toMatchObject({
        provider: 'google_places',
        retrievedAt: '2026-02-03T04:05:06.000Z',
      })
      expect(first.response.warnings).toContain('当前为模拟地点结果，不代表真实 Google Places 数据。')
    }
  })

  it('returns normalized disabled and unavailable errors without network dependencies', async () => {
    await expect(createDisabledPlaceLookupProvider().lookup(validPlaceLookupRequest())).resolves.toMatchObject({
      errorCode: 'unsupported',
      ok: false,
    })
    await expect(createUnavailablePlaceLookupProvider().lookup(validPlaceLookupRequest())).resolves.toMatchObject({
      errorCode: 'provider_unavailable',
      ok: false,
    })
  })

  it('calls Google Places with injected fetch, exact FieldMask, and compact request body', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      places: [
        {
          displayName: { languageCode: 'zh', text: '杭州博物馆' },
          formattedAddress: '浙江省杭州市上城区粮道山18号',
          googleMapsUri: 'https://maps.google.com/?cid=123',
          id: 'places/mock-google-1',
          location: { latitude: 30.245, longitude: 120.17 },
        },
      ],
    }), { headers: { 'Content-Type': 'application/json' }, status: 200 })) as unknown as typeof fetch
    const provider = createGooglePlacesLookupProvider(
      { TRIPMAP_GOOGLE_PLACES_API_KEY: 'test-place-key' },
      fetcher,
      { now: '2026-02-03T04:05:06.000Z' },
    )

    const result = await provider.lookup(validPlaceLookupRequest())

    expect(result.ok).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = vi.mocked(fetcher).mock.calls[0]
    expect(url).toBe(GOOGLE_PLACES_TEXT_SEARCH_ENDPOINT)
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': 'test-place-key',
      'X-Goog-FieldMask': GOOGLE_PLACES_FIELD_MASK,
    })
    expect((init?.headers as Record<string, string>)['X-Goog-FieldMask']).toBe('places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri')
    expect((init?.headers as Record<string, string>)['X-Goog-FieldMask']).not.toContain('*')
    expect(String(init?.body)).not.toContain('ticket')
    expect(String(init?.body)).not.toContain('route')
    expect(String(init?.body)).not.toContain('cloud')
    expect(String(init?.body)).not.toContain('coordinates')
    expect(JSON.parse(String(init?.body))).toEqual({
      languageCode: 'zh-CN',
      pageSize: 3,
      regionCode: 'CN',
      textQuery: '杭州博物馆',
    })

    if (result.ok) {
      expect(result.response).toMatchObject({
        ok: true,
        operation: 'place_lookup',
        retrievedAt: '2026-02-03T04:05:06.000Z',
        source: 'google_places',
      })
      expect(result.response.results).toEqual([
        {
          displayName: '杭州博物馆',
          formattedAddress: '浙江省杭州市上城区粮道山18号',
          googleMapsUri: 'https://maps.google.com/?cid=123',
          location: { lat: 30.245, lng: 120.17 },
          placeId: 'places/mock-google-1',
          provider: 'google_places',
          retrievedAt: '2026-02-03T04:05:06.000Z',
        },
      ])
    }
  })

  it('uses shared Google Maps Platform key when a dedicated Places key is absent', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      places: [
        {
          displayName: { languageCode: 'zh', text: '杭州博物馆' },
          formattedAddress: '浙江省杭州市上城区粮道山18号',
          id: 'places/mock-google-1',
          location: { latitude: 30.245, longitude: 120.17 },
        },
      ],
    }), { headers: { 'Content-Type': 'application/json' }, status: 200 })) as unknown as typeof fetch
    const provider = createGooglePlacesLookupProvider(
      { GOOGLE_MAPS_PLATFORM_API_KEY: 'shared-google-platform-secret' },
      fetcher,
      { now: '2026-02-03T04:05:06.000Z' },
    )

    const result = await provider.lookup(validPlaceLookupRequest())

    expect(result.ok).toBe(true)
    const [, init] = vi.mocked(fetcher).mock.calls[0]
    expect(init?.headers).toMatchObject({
      'X-Goog-Api-Key': 'shared-google-platform-secret',
      'X-Goog-FieldMask': GOOGLE_PLACES_FIELD_MASK,
    })
    expect(JSON.stringify(result)).not.toContain('shared-google-platform-secret')
  })

  it('drops malformed candidates and omits unsafe Google Maps URIs', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      places: [
        { displayName: { text: '' }, formattedAddress: 'Missing display name', id: 'places/bad-1' },
        {
          displayName: { text: 'Safe place' },
          formattedAddress: 'Safe address',
          googleMapsUri: 'javascript:alert(1)',
          id: 'places/safe-1',
          location: { latitude: 91, longitude: 120 },
        },
      ],
    }), { headers: { 'Content-Type': 'application/json' }, status: 200 })) as unknown as typeof fetch
    const provider = createGooglePlacesLookupProvider(
      { TRIPMAP_GOOGLE_PLACES_API_KEY: 'test-place-key' },
      fetcher,
      { now: '2026-02-03T04:05:06.000Z' },
    )

    const result = await provider.lookup(validPlaceLookupRequest())

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.response.results).toEqual([
        {
          displayName: 'Safe place',
          formattedAddress: 'Safe address',
          placeId: 'places/safe-1',
          provider: 'google_places',
          retrievedAt: '2026-02-03T04:05:06.000Z',
        },
      ])
    }
  })

  it('rejects malformed Google top-level responses without raw provider details', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      error: 'raw-provider-error',
      message: 'X-Goog-Api-Key test-place-key failed',
    }), { headers: { 'Content-Type': 'application/json' }, status: 200 })) as unknown as typeof fetch
    const provider = createGooglePlacesLookupProvider(
      { TRIPMAP_GOOGLE_PLACES_API_KEY: 'test-place-key' },
      fetcher,
      { now: '2026-02-03T04:05:06.000Z' },
    )

    const result = await provider.lookup(validPlaceLookupRequest())

    expect(result).toMatchObject({
      errorCode: 'provider_error',
      ok: false,
    })
    expect(JSON.stringify(result)).not.toContain('raw-provider-error')
    expect(JSON.stringify(result)).not.toContain('test-place-key')
    expect(JSON.stringify(result)).not.toContain('X-Goog-Api-Key')
  })

  it('returns provider errors without leaking raw body, headers, or keys', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      error: 'raw-google-provider-body',
      message: 'Authorization Bearer test-place-key stack trace',
    }), { headers: { 'Content-Type': 'application/json' }, status: 500 })) as unknown as typeof fetch
    const provider = createGooglePlacesLookupProvider(
      { TRIPMAP_GOOGLE_PLACES_API_KEY: 'test-place-key' },
      fetcher,
      { now: '2026-02-03T04:05:06.000Z' },
    )

    const result = await provider.lookup(validPlaceLookupRequest())

    expect(result).toMatchObject({
      errorCode: 'provider_error',
      ok: false,
    })
    expect(JSON.stringify(result)).not.toContain('raw-google-provider-body')
    expect(JSON.stringify(result)).not.toContain('test-place-key')
    expect(JSON.stringify(result)).not.toContain('Authorization')
    expect(JSON.stringify(result)).not.toContain('Bearer')
    expect(JSON.stringify(result)).not.toContain('stack trace')
  })
})
