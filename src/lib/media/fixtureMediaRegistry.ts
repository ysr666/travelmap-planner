const fixtureMediaRegistry: Readonly<Record<string, string>> = Object.freeze({
  media_british_museum_thumb_v1: '/fixtures/product-fidelity/british-museum-thumb.webp',
  media_dishoom_thumb_v1: '/fixtures/product-fidelity/dishoom-thumb.webp',
  media_edinburgh_castle_hero_v1: '/fixtures/product-fidelity/edinburgh-castle-hero.webp',
  media_edinburgh_castle_thumb_v1: '/fixtures/product-fidelity/edinburgh-castle-thumb.webp',
  media_hotel_room_thumb_v1: '/fixtures/product-fidelity/hotel-room-thumb.webp',
  media_lner_azuma_thumb_v1: '/fixtures/product-fidelity/lner-azuma-thumb.webp',
  media_tower_bridge_thumb_v1: '/fixtures/product-fidelity/tower-bridge-thumb.webp',
})

export function resolveFixtureMediaAsset(assetId: string) {
  if (!__TRIPMAP_E2E__) return null
  return fixtureMediaRegistry[assetId] ?? null
}

export function listFixtureMediaAssetIds() {
  return Object.keys(fixtureMediaRegistry)
}
