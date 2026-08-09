import { describe, expect, it } from 'vitest'
import { PROVIDER_PROXY_PLACE_DETAILS_OPERATION, type ProviderProxyPlaceDetailsSuccessResponse } from '../ai/providerProxyContract'
import { buildPlacePhotoMediaAsset } from './placeMedia'

function response(overrides: Partial<ProviderProxyPlaceDetailsSuccessResponse['details']> = {}): ProviderProxyPlaceDetailsSuccessResponse {
  return {
    details: {
      displayName: 'Edinburgh Castle',
      googleMapsUri: 'https://maps.google.com/?cid=123',
      photos: [{
        authorAttributions: [{
          displayName: 'Google contributor',
          uri: 'https://www.google.com/maps/contrib/123',
        }],
        googleMapsUri: 'https://maps.google.com/?cid=123',
        height: 800,
        photoRef: 'places/ChIJOwg_06VP4jQRKahn5s/photos/ATKogpcControlledReference',
        width: 1200,
      }],
      placeId: 'ChIJOwg_06VP4jQRKahn5s',
      provider: 'google_places',
      retrievedAt: '2026-08-18T09:00:00.000Z',
      ...overrides,
    },
    ok: true,
    operation: PROVIDER_PROXY_PLACE_DETAILS_OPERATION,
    retrievedAt: '2026-08-18T09:00:00.000Z',
    source: 'google_places',
  }
}

describe('buildPlacePhotoMediaAsset', () => {
  it('converts one normalized Google photo reference into a 24-hour controlled asset', () => {
    const result = buildPlacePhotoMediaAsset({
      itemId: 'item_castle',
      response: response(),
      tripId: 'trip_uk',
    })

    expect(result).toMatchObject({
      aspectRatio: 1.5,
      expiresAt: '2026-08-19T09:00:00.000Z',
      kind: 'place_photo',
      renderRef: {
        provider: 'google_places',
        type: 'provider_photo',
      },
      subjectId: 'item_castle',
      tripId: 'trip_uk',
    })
  })

  it('returns no asset for missing photos or invalid attribution links', () => {
    expect(buildPlacePhotoMediaAsset({
      itemId: 'item_castle',
      response: response({ photos: [] }),
      tripId: 'trip_uk',
    })).toBeNull()
    expect(buildPlacePhotoMediaAsset({
      itemId: 'item_castle',
      response: response({
        photos: [{
          authorAttributions: [{ displayName: 'Injected', uri: 'https://evil.example/profile' }],
          height: 800,
          photoRef: 'places/ChIJOwg_06VP4jQRKahn5s/photos/ATKogpcControlledReference',
          width: 1200,
        }],
      }),
      tripId: 'trip_uk',
    })).toBeNull()
  })
})
