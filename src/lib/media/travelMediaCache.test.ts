import { describe, expect, it } from 'vitest'
import { TravelMediaCache } from './travelMediaCache'

function asset(index: number, overrides: Record<string, unknown> = {}) {
  const id = [
    'media_british_museum_thumb_v1',
    'media_dishoom_thumb_v1',
    'media_tower_bridge_thumb_v1',
    'media_edinburgh_castle_thumb_v1',
  ][index]
  return {
    aspectRatio: 4 / 3,
    attribution: [{ label: 'Test asset · CC BY 4.0', uri: 'https://commons.wikimedia.org/wiki/File:Test.jpg' }],
    expiresAt: '2030-01-01T00:00:00.000Z',
    height: 600,
    id,
    kind: 'place_photo',
    observedAt: `2026-01-0${index + 1}T00:00:00.000Z`,
    providerRef: id,
    renderRef: { assetId: id, type: 'fixture_asset' },
    rightsRef: 'https://creativecommons.org/licenses/by/4.0/',
    schemaVersion: 1,
    source: 'fixture_registry',
    subjectId: `item_${index}`,
    subjectType: 'item',
    tripId: 'trip_test',
    width: 800,
    ...overrides,
  }
}

describe('TravelMediaCache', () => {
  it('persists only validated current assets and keeps the newest bounded set', () => {
    const storage = new MemoryStorage()
    const cache = new TravelMediaCache({ maxEntries: 2, storage, storageKey: 'tripmap:media:test' })
    const result = cache.putAll([
      asset(0),
      asset(1),
      asset(2),
      asset(3, { providerPayload: { token: 'not-allowed' } }),
    ], '2027-01-01T00:00:00.000Z')

    expect(result.accepted).toHaveLength(3)
    expect(result.rejected).toHaveLength(1)
    expect(cache.list('2027-01-01T00:00:00.000Z').map((entry) => entry.id)).toEqual([
      'media_tower_bridge_thumb_v1',
      'media_dishoom_thumb_v1',
    ])
    const restored = new TravelMediaCache({ maxEntries: 2, storage, storageKey: 'tripmap:media:test' })
    expect(restored.list('2027-01-01T00:00:00.000Z').map((entry) => entry.id)).toEqual([
      'media_tower_bridge_thumb_v1',
      'media_dishoom_thumb_v1',
    ])
  })

  it('prunes expired entries and ignores uncontrolled storage keys', () => {
    const storage = new MemoryStorage()
    const cache = new TravelMediaCache({ storage, storageKey: 'uncontrolled' })
    expect(cache.put(asset(0, { expiresAt: '2026-02-01T00:00:00.000Z' }), '2026-01-15T00:00:00.000Z').ok).toBe(true)
    expect(cache.list('2026-02-01T00:00:00.000Z')).toEqual([])
    expect(storage.length).toBe(0)
  })
})

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}
