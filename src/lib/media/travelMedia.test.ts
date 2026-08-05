import { describe, expect, it } from 'vitest'
import {
  isGooglePlacesPhotoRef,
  isTravelMediaAssetCurrent,
  selectTravelMediaAsset,
  validateTravelMediaAssetV1,
  type TravelMediaAssetV1,
} from './travelMedia'

function fixtureAsset(overrides: Record<string, unknown> = {}) {
  return {
    aspectRatio: 4 / 3,
    attribution: [{
      label: 'Test Author · CC BY 4.0',
      uri: 'https://commons.wikimedia.org/wiki/File:Test.jpg',
    }],
    expiresAt: '2030-01-01T00:00:00.000Z',
    height: 600,
    id: 'media_test_thumb_v1',
    kind: 'place_photo',
    observedAt: '2026-01-01T00:00:00.000Z',
    providerRef: 'media_test_thumb_v1',
    renderRef: { assetId: 'media_test_thumb_v1', type: 'fixture_asset' },
    rightsRef: 'https://creativecommons.org/licenses/by/4.0/',
    schemaVersion: 1,
    source: 'fixture_registry',
    sourceUri: 'https://commons.wikimedia.org/wiki/File:Test.jpg',
    subjectId: 'item_test',
    subjectType: 'item',
    tripId: 'trip_test',
    width: 800,
    ...overrides,
  }
}

describe('TravelMediaAssetV1', () => {
  it('accepts a controlled fixture asset and normalizes dates', () => {
    const result = validateTravelMediaAssetV1(fixtureAsset())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.renderRef).toEqual({ assetId: 'media_test_thumb_v1', type: 'fixture_asset' })
    expect(result.value.observedAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('accepts only a Google resource name for provider photos', () => {
    const photoRef = 'places/ChIJN1t_tDeuEmsRUsoyG83frY4/photos/ATKogpcFidelityPhotoReference'
    const result = validateTravelMediaAssetV1(fixtureAsset({
      attribution: [{ label: 'Google contributor', uri: 'https://www.google.com/maps/contrib/123' }],
      id: 'media_google_place_v1',
      providerRef: photoRef,
      renderRef: { photoRef, provider: 'google_places', type: 'provider_photo' },
      source: 'google_places',
    }))
    expect(result.ok).toBe(true)
    expect(isGooglePlacesPhotoRef(photoRef)).toBe(true)
  })

  it.each([
    ['arbitrary URL', { providerRef: 'https://example.com/image.jpg', renderRef: { photoRef: 'https://example.com/image.jpg', provider: 'google_places', type: 'provider_photo' }, source: 'google_places' }],
    ['private URL', { providerRef: 'http://127.0.0.1/admin', renderRef: { photoRef: 'http://127.0.0.1/admin', provider: 'google_places', type: 'provider_photo' }, source: 'google_places' }],
    ['mismatched fixture ref', { renderRef: { assetId: 'media_other_thumb_v1', type: 'fixture_asset' } }],
    ['unknown field', { rawProviderPayload: { token: 'secret' } }],
    ['oversized pixels', { height: 8192, width: 8192, aspectRatio: 1 }],
  ])('rejects %s', (_label, override) => {
    expect(validateTravelMediaAssetV1(fixtureAsset(override)).ok).toBe(false)
  })

  it('rejects non-Google attribution links for Google photos', () => {
    const photoRef = 'places/ChIJN1t_tDeuEmsRUsoyG83frY4/photos/ATKogpcFidelityPhotoReference'
    expect(validateTravelMediaAssetV1(fixtureAsset({
      attribution: [{ label: 'Injected', uri: 'https://evil.example/profile' }],
      providerRef: photoRef,
      renderRef: { photoRef, provider: 'google_places', type: 'provider_photo' },
      source: 'google_places',
    })).ok).toBe(false)
  })

  it('does not present expired media as current', () => {
    const result = validateTravelMediaAssetV1(fixtureAsset())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(isTravelMediaAssetCurrent(result.value, '2027-01-01T00:00:00.000Z')).toBe(true)
    expect(isTravelMediaAssetCurrent(result.value, '2030-01-01T00:00:00.000Z')).toBe(false)
  })

  it('selects a current, sufficiently wide asset without crossing subjects', () => {
    const base = validateTravelMediaAssetV1(fixtureAsset())
    const hero = validateTravelMediaAssetV1(fixtureAsset({
      aspectRatio: 1.5,
      height: 800,
      id: 'media_test_hero_v1',
      providerRef: 'media_test_hero_v1',
      renderRef: { assetId: 'media_test_hero_v1', type: 'fixture_asset' },
      width: 1200,
    }))
    expect(base.ok && hero.ok).toBe(true)
    if (!base.ok || !hero.ok) return
    const selected = selectTravelMediaAsset([base.value, hero.value] satisfies TravelMediaAssetV1[], {
      minimumWidth: 1000,
      now: '2027-01-01T00:00:00.000Z',
      subjectId: 'item_test',
      subjectType: 'item',
    })
    expect(selected?.id).toBe('media_test_hero_v1')
  })
})
