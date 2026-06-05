import { describe, expect, it, vi } from 'vitest'
import {
  GOOGLE_PLACES_DETAILS_FIELD_MASK,
  GOOGLE_PLACES_DETAILS_ENDPOINT_PREFIX,
  createGooglePlacesDetailsProvider,
  createMockPlaceDetailsProvider,
  createUnavailablePlaceDetailsProvider,
} from './placeDetailsProvider'

function validPlaceDetailsRequest() {
  return {
    locale: 'zh-CN' as const,
    operation: 'place_details' as const,
    placeId: 'place-west-lake',
    region: 'CN',
  }
}

describe('place details provider', () => {
  it('returns deterministic mock details', async () => {
    const provider = createMockPlaceDetailsProvider({ now: '2026-02-03T04:05:06.000Z' })
    const result = await provider.getDetails(validPlaceDetailsRequest())

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.response.operation).toBe('place_details')
      expect(result.response.details.placeId).toBe('place-west-lake')
      expect(result.response.details.regularOpeningHours?.weekdayDescriptions[0]).toContain('09:00')
      expect(result.response.warnings).toContain('当前为模拟地点详情，不代表真实 Google Places 数据。')
    }
  })

  it('calls Google Places Details with exact field mask and shared Vite key', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      displayName: { text: '西湖风景名胜区' },
      editorialSummary: { text: '西湖是杭州代表性湖泊景观。' },
      formattedAddress: '浙江省杭州市西湖区',
      googleMapsUri: 'https://maps.google.com/west-lake',
      id: 'place-west-lake',
      location: { latitude: 30.25, longitude: 120.14 },
      priceLevel: 'PRICE_LEVEL_FREE',
      regularOpeningHours: {
        openNow: true,
        weekdayDescriptions: ['周一至周日 全天开放'],
      },
      websiteUri: 'https://westlake.example',
    }), { headers: { 'Content-Type': 'application/json' }, status: 200 })) as unknown as typeof fetch
    const provider = createGooglePlacesDetailsProvider(
      {
        GOOGLE_MAPS_PLATFORM_API_KEY: 'platform-secret',
        VITE_GOOGLE_MAPS_API_KEY: 'vite-shared-secret',
      },
      fetcher,
      { now: '2026-02-03T04:05:06.000Z' },
    )

    const result = await provider.getDetails(validPlaceDetailsRequest())

    expect(result.ok).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = vi.mocked(fetcher).mock.calls[0]
    expect(String(url)).toContain(GOOGLE_PLACES_DETAILS_ENDPOINT_PREFIX)
    expect(String(url)).toContain(encodeURIComponent('place-west-lake'))
    expect(String(url)).toContain('languageCode=zh-CN')
    expect(init?.method).toBe('GET')
    expect(init?.headers).toMatchObject({
      'X-Goog-Api-Key': 'vite-shared-secret',
      'X-Goog-FieldMask': GOOGLE_PLACES_DETAILS_FIELD_MASK,
    })
    expect((init?.headers as Record<string, string>)['X-Goog-FieldMask']).not.toContain('*')
    expect(JSON.stringify(result)).not.toContain('vite-shared-secret')
    if (result.ok) {
      expect(result.response.details).toMatchObject({
        displayName: '西湖风景名胜区',
        editorialSummary: '西湖是杭州代表性湖泊景观。',
        googleMapsUri: 'https://maps.google.com/west-lake',
        location: { lat: 30.25, lng: 120.14 },
        priceLevel: 'PRICE_LEVEL_FREE',
        websiteUri: 'https://westlake.example/',
      })
    }
  })

  it('normalizes unavailable and malformed responses without leaking raw provider details', async () => {
    await expect(createUnavailablePlaceDetailsProvider().getDetails(validPlaceDetailsRequest())).resolves.toMatchObject({
      errorCode: 'provider_unavailable',
      ok: false,
    })

    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      error: 'raw-google-provider-body',
      message: 'Authorization Bearer test-place-key stack trace',
    }), { headers: { 'Content-Type': 'application/json' }, status: 500 })) as unknown as typeof fetch
    const provider = createGooglePlacesDetailsProvider(
      { TRIPMAP_GOOGLE_PLACES_API_KEY: 'test-place-key' },
      fetcher,
      { now: '2026-02-03T04:05:06.000Z' },
    )

    const result = await provider.getDetails(validPlaceDetailsRequest())

    expect(result).toMatchObject({
      errorCode: 'provider_error',
      ok: false,
    })
    expect(JSON.stringify(result)).not.toContain('raw-google-provider-body')
    expect(JSON.stringify(result)).not.toContain('test-place-key')
    expect(JSON.stringify(result)).not.toContain('Authorization')
    expect(JSON.stringify(result)).not.toContain('Bearer')
  })
})
