import { describe, expect, it } from 'vitest'
import { RealtimeFactCache } from './realtimeFactCache'

function fact(index: number, overrides: Record<string, unknown> = {}) {
  return {
    confidence: 'high',
    expiresAt: `2026-08-18T09:1${index}:00.000Z`,
    id: `fact_${index}`,
    kind: 'route_eta',
    observedAt: `2026-08-18T09:0${index}:00.000Z`,
    rawRef: `fixture:route:${index}`,
    schemaVersion: 1,
    source: { label: '路线', provider: 'fixture_routes' },
    subject: { id: `item_${index}`, type: 'item' },
    tripId: 'trip_1',
    value: { durationMinutes: 10 + index, mode: 'walk', status: 'road' },
    ...overrides,
  }
}

describe('RealtimeFactCache', () => {
  it('keeps a bounded set and persists only validated normalized facts', () => {
    const storage = new MemoryStorage()
    const cache = new RealtimeFactCache({ maxEntries: 2, storage, storageKey: 'tripmap:realtime:test' })
    expect(cache.putAll([fact(0), fact(1), fact(2), { ...fact(3), providerPayload: {} }], '2026-08-18T09:10:00Z')).toMatchObject({
      accepted: [{ id: 'fact_0' }, { id: 'fact_1' }, { id: 'fact_2' }],
      rejected: ['实时事实包含未知字段。'],
    })
    expect(cache.list('2026-08-18T09:10:00Z').map((entry) => entry.id)).toEqual(['fact_2', 'fact_1'])

    const restored = new RealtimeFactCache({ maxEntries: 2, storage, storageKey: 'tripmap:realtime:test' })
    expect(restored.list('2026-08-18T09:10:00Z').map((entry) => entry.id)).toEqual(['fact_2', 'fact_1'])
  })

  it('keeps a recent expired fact as a labelled stale fallback and then prunes it', () => {
    const cache = new RealtimeFactCache({ staleRetentionMs: 60 * 60_000 })
    cache.put(fact(0, { expiresAt: '2026-08-18T09:10:00.000Z' }), '2026-08-18T09:00:00Z')
    expect(cache.select({ kind: 'route_eta', now: '2026-08-18T09:30:00Z', subjectId: 'item_0' }).state).toBe('stale')
    expect(cache.select({ kind: 'route_eta', now: '2026-08-18T10:10:00Z', subjectId: 'item_0' }).state).toBe('unavailable')
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
