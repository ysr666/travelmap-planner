import type { ProviderProxyPlaceDetailsSuccessResponse } from '../ai/providerProxyContract'
import { validateTravelMediaAssetV1, type TravelMediaAssetV1 } from './travelMedia'

const PLACE_MEDIA_TTL_MS = 24 * 60 * 60_000

export function buildPlacePhotoMediaAsset(input: {
  itemId: string
  response: ProviderProxyPlaceDetailsSuccessResponse
  tripId: string
}): TravelMediaAssetV1 | null {
  const photo = input.response.details.photos?.[0]
  if (!photo) return null
  const observedAtMs = Date.parse(input.response.retrievedAt)
  if (!Number.isFinite(observedAtMs)) return null

  const attribution = photo.authorAttributions.length > 0
    ? photo.authorAttributions.map((entry) => ({ label: entry.displayName, uri: entry.uri }))
    : [{ label: 'Google Maps' }]
  const candidate = {
    aspectRatio: photo.width / photo.height,
    attribution,
    expiresAt: new Date(observedAtMs + PLACE_MEDIA_TTL_MS).toISOString(),
    height: photo.height,
    id: `media_place_${controlledPart(input.itemId)}_${hashText(photo.photoRef)}_v1`.slice(0, 160),
    kind: 'place_photo',
    observedAt: new Date(observedAtMs).toISOString(),
    providerRef: photo.photoRef,
    renderRef: {
      photoRef: photo.photoRef,
      provider: 'google_places',
      type: 'provider_photo',
    },
    schemaVersion: 1,
    source: 'google_places',
    sourceUri: photo.googleMapsUri ?? input.response.details.googleMapsUri,
    subjectId: input.itemId,
    subjectType: 'item',
    tripId: input.tripId,
    width: photo.width,
  } satisfies TravelMediaAssetV1
  const validation = validateTravelMediaAssetV1(candidate)
  return validation.ok ? validation.value : null
}

function controlledPart(value: string) {
  return value.toLocaleLowerCase('en-US').replace(/[^a-z0-9_:-]/g, '_').replace(/^_+/, '').slice(0, 72) || 'item'
}

function hashText(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}
