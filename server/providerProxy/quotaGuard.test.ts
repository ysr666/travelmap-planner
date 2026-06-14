import { describe, expect, it, vi } from 'vitest'
import {
  buildProviderProxyQuotaIdentityMaterial,
  buildProviderProxyQuotaRowId,
  consumeProviderProxyQuota,
  createProviderProxyD1QuotaStorage,
  createProviderProxyMemoryQuotaStorage,
  hashProviderProxyQuotaIdentity,
  selectProviderProxyQuotaStorage,
  type ProviderProxyD1Database,
  type ProviderProxyD1PreparedStatement,
  type ProviderProxyD1Result,
  type ProviderProxyOperation,
  type ProviderProxyQuotaMemoryEntry,
} from './quotaGuard'

describe('provider proxy quota guard', () => {
  it('allows requests within the memory window and blocks over the limit', async () => {
    const store = new Map<string, ProviderProxyQuotaMemoryEntry>()
    const storage = createProviderProxyMemoryQuotaStorage(store)
    const limits = { maxRouteRequestsPerWindow: 2, windowMs: 1000 }
    const hasher = () => 'session-a-hash'

    expect((await consumeProviderProxyQuota({
      coordinateCount: 2,
      hasher,
      identity: { quotaSessionId: 'session-a' },
      limits,
      nowMs: 100,
      storage,
    })).allowed).toBe(true)
    expect((await consumeProviderProxyQuota({
      coordinateCount: 2,
      hasher,
      identity: { quotaSessionId: 'session-a' },
      limits,
      nowMs: 200,
      storage,
    })).allowed).toBe(true)
    expect(await consumeProviderProxyQuota({
      coordinateCount: 2,
      hasher,
      identity: { quotaSessionId: 'session-a' },
      limits,
      nowMs: 300,
      storage,
    })).toMatchObject({ allowed: false, reason: 'rate_limit' })
    expect(Array.from(store.keys())).toEqual(['route|session-a-hash'])
  })

  it('resets after the window and isolates identities through hashes', async () => {
    const store = new Map<string, ProviderProxyQuotaMemoryEntry>()
    const storage = createProviderProxyMemoryQuotaStorage(store)
    const limits = { maxRouteRequestsPerWindow: 1, windowMs: 1000 }
    const hasher = (value: string) => value.includes('session-b') ? 'hash-b' : 'hash-a'

    expect((await consumeProviderProxyQuota({
      coordinateCount: 2,
      hasher,
      identity: { quotaSessionId: 'session-a' },
      limits,
      nowMs: 100,
      storage,
    })).allowed).toBe(true)
    expect((await consumeProviderProxyQuota({
      coordinateCount: 2,
      hasher,
      identity: { quotaSessionId: 'session-b' },
      limits,
      nowMs: 200,
      storage,
    })).allowed).toBe(true)
    expect((await consumeProviderProxyQuota({
      coordinateCount: 2,
      hasher,
      identity: { quotaSessionId: 'session-a' },
      limits,
      nowMs: 1200,
      storage,
    })).allowed).toBe(true)
    expect(Array.from(store.keys()).sort()).toEqual(['route|hash-a', 'route|hash-b'])
  })

  it('blocks oversized coordinate and day requests before consuming quota', async () => {
    const storage = createProviderProxyMemoryQuotaStorage()
    const consume = vi.spyOn(storage, 'consume')

    expect(await consumeProviderProxyQuota({
      coordinateCount: 3,
      identity: { quotaSessionId: 'session-a' },
      limits: { maxCoordinatesPerRequest: 2 },
      storage,
    })).toMatchObject({ allowed: false, reason: 'request_size' })
    expect(await consumeProviderProxyQuota({
      coordinateCount: 2,
      dayCount: 8,
      identity: { quotaSessionId: 'session-a' },
      limits: { maxDaysPerBatch: 7 },
      storage,
    })).toMatchObject({ allowed: false, reason: 'day_batch_size' })
    expect(consume).not.toHaveBeenCalled()
  })

  it('all provider quota buckets are isolated for one identity hash', async () => {
    const store = new Map<string, ProviderProxyQuotaMemoryEntry>()
    const storage = createProviderProxyMemoryQuotaStorage(store)
    const limits = {
      maxAiDraftRepairRequestsPerWindow: 1,
      maxAiDraftRequestsPerWindow: 1,
      maxAiExpenseExtractRequestsPerWindow: 1,
      maxAiTripContentEnrichmentRequestsPerWindow: 1,
      maxAiTripEditRequestsPerWindow: 1,
      maxPlaceLookupRequestsPerWindow: 1,
      maxRouteRequestsPerWindow: 1,
      maxExchangeRateRequestsPerWindow: 1,
      maxTravelInboxClassifyRequestsPerWindow: 1,
      maxTravelSearchRequestsPerWindow: 1,
      windowMs: 1000,
    }
    const identity = { ip: '203.0.113.10', quotaSessionId: 'session-a' }
    const operations: ProviderProxyOperation[] = [
      'route_preview',
      'ai_trip_draft',
      'ai_trip_draft_repair',
      'ai_trip_draft_refine',
      'ai_trip_edit_plan',
      'trip_content_enrichment',
      'trip_daily_tip',
      'travel_inbox_classify',
      'travel_search',
      'place_lookup',
      'exchange_rate',
      'ai_expense_extract',
    ]

    for (const [index, operation] of operations.entries()) {
      expect((await consumeProviderProxyQuota({
        coordinateCount: operation === 'route_preview' ? 2 : 0,
        hasher: () => 'same-hash',
        identity,
        limits,
        nowMs: 100 + index,
        operation,
        storage,
      })).allowed).toBe(true)
    }

    expect(Array.from(store.keys()).sort()).toEqual([
      'ai_draft_refine|same-hash',
      'ai_draft_repair|same-hash',
      'ai_draft|same-hash',
      'ai_expense_extract|same-hash',
      'ai_trip_content|same-hash',
      'ai_trip_daily_tip|same-hash',
      'ai_trip_edit|same-hash',
      'fx|same-hash',
      'place|same-hash',
      'route|same-hash',
      'search|same-hash',
      'travel_inbox_classify|same-hash',
    ])
    expect(await consumeProviderProxyQuota({
      coordinateCount: 0,
      hasher: () => 'same-hash',
      identity,
      limits,
      nowMs: 200,
      operation: 'travel_search',
      storage,
    })).toMatchObject({ allowed: false, reason: 'rate_limit' })
    expect(await consumeProviderProxyQuota({
      coordinateCount: 0,
      hasher: () => 'same-hash',
      identity,
      limits,
      nowMs: 210,
      operation: 'place_lookup',
      storage,
    })).toMatchObject({ allowed: false, reason: 'rate_limit' })
  })

  it('builds deterministic anonymous identity material when session and IP are missing', async () => {
    const material = buildProviderProxyQuotaIdentityMaterial({
      ip: '   ',
      quotaSessionId: '',
    })
    const rowId = await buildProviderProxyQuotaRowId({
      bucket: 'route|',
      hasher: (value) => {
        expect(value).toBe('account:none|anonymous:provider-proxy')
        return 'anonymous-hash'
      },
      identity: { ip: '   ', quotaSessionId: '' },
    })

    expect(material).toBe('account:none|anonymous:provider-proxy')
    expect(rowId).toBe('route|anonymous-hash')
  })

  it('hashes row ids as bucket plus hash without raw session or IP', async () => {
    const rowId = await buildProviderProxyQuotaRowId({
      bucket: 'search|',
      hasher: () => 'fixed-hash',
      identity: {
        ip: '198.51.100.2',
        quotaSessionId: 'browser-session-secret',
      },
    })

    expect(rowId).toBe('search|fixed-hash')
    expect(rowId).not.toContain('browser-session-secret')
    expect(rowId).not.toContain('198.51.100.2')
  })

  it('supports dependency-free default hashing and injectable hashers', async () => {
    const hashed = await hashProviderProxyQuotaIdentity('account:none|session:test')
    const hasher = vi.fn((value: string) => {
      expect(value).toContain('session:session-a')
      expect(value).toContain('ip:203.0.113.5')
      return 'custom-hash'
    })

    expect(hashed).toMatch(/^[a-f0-9]{64}$/)
    await expect(buildProviderProxyQuotaRowId({
      bucket: 'place|',
      hasher,
      identity: { ip: '203.0.113.5', quotaSessionId: 'session-a' },
    })).resolves.toBe('place|custom-hash')
    expect(hasher).toHaveBeenCalledTimes(1)
  })

  it('uses memory fallback when D1 binding is absent and fail-closes when binding is invalid', async () => {
    const fallback = selectProviderProxyQuotaStorage({})
    await expect(fallback.consume({
      key: 'route|hash',
      maxRequests: 1,
      nowMs: 100,
      windowMs: 1000,
    })).resolves.toMatchObject({ allowed: true })

    const invalidBinding = selectProviderProxyQuotaStorage({ TRIPMAP_PROVIDER_QUOTA_D1: 'not-a-d1-binding' })
    await expect(invalidBinding.consume({
      key: 'route|hash',
      maxRequests: 1,
      nowMs: 100,
      windowMs: 1000,
    })).resolves.toMatchObject({ allowed: false, reason: 'storage_error' })
  })

  it('uses an atomic guarded D1 consume path and blocks over-limit without incrementing', async () => {
    const fake = createFakeD1()
    const storage = createProviderProxyD1QuotaStorage(fake.db)

    await expect(storage.consume({
      key: 'search|fixed-hash',
      maxRequests: 1,
      nowMs: 100,
      windowMs: 1000,
    })).resolves.toMatchObject({ allowed: true, remaining: 0, resetAt: 1100 })
    await expect(storage.consume({
      key: 'search|fixed-hash',
      maxRequests: 1,
      nowMs: 200,
      windowMs: 1000,
    })).resolves.toMatchObject({ allowed: false, reason: 'rate_limit', resetAt: 1100 })

    expect(fake.rows.get('search|fixed-hash')).toMatchObject({ count: 1 })
    expect(fake.queries[0]).toContain('INSERT INTO provider_quota')
    expect(fake.queries[0]).toContain('ON CONFLICT(id) DO UPDATE')
    expect(fake.queries[0]).toContain('WHERE provider_quota.expires_at <= ? OR provider_quota.count < ?')
    expect(fake.queries[0]).toContain('RETURNING count, window_started_at, expires_at')
    expect(fake.queries.join('\n')).not.toContain('CREATE TABLE')
  })

  it('fail-closes when D1 prepare or query fails', async () => {
    const throwingD1: ProviderProxyD1Database = {
      prepare() {
        throw new Error('no such table: provider_quota')
      },
    }
    const storage = createProviderProxyD1QuotaStorage(throwingD1)

    await expect(storage.consume({
      key: 'place|fixed-hash',
      maxRequests: 1,
      nowMs: 100,
      windowMs: 1000,
    })).resolves.toMatchObject({ allowed: false, reason: 'storage_error' })
  })
})

function createFakeD1() {
  const rows = new Map<string, { count: number; expires_at: number; window_started_at: number }>()
  const queries: string[] = []
  const db: ProviderProxyD1Database = {
    prepare(query: string) {
      queries.push(query)
      return createFakeStatement(query, rows)
    },
  }

  return { db, queries, rows }
}

function createFakeStatement(
  query: string,
  rows: Map<string, { count: number; expires_at: number; window_started_at: number }>,
): ProviderProxyD1PreparedStatement {
  let values: Array<number | string> = []
  return {
    bind(...boundValues: Array<number | string>) {
      values = boundValues
      return this
    },
    async first<T = Record<string, unknown>>() {
      if (query.startsWith('INSERT INTO provider_quota')) {
        const key = String(values[0])
        const nowMs = Number(values[1])
        const resetAt = Number(values[2])
        const maxRequests = Number(values[9])
        const current = rows.get(key)
        if (!current || current.expires_at <= nowMs) {
          const row = { count: 1, expires_at: resetAt, window_started_at: nowMs }
          rows.set(key, row)
          return row as T
        }
        if (current.count < maxRequests) {
          const row = { ...current, count: current.count + 1 }
          rows.set(key, row)
          return row as T
        }
        return null
      }

      if (query.startsWith('SELECT expires_at')) {
        const key = String(values[0])
        return (rows.get(key) ?? null) as T | null
      }

      return null
    },
    async run(): Promise<ProviderProxyD1Result> {
      return { success: true }
    },
  }
}
