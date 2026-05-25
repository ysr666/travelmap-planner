import { describe, expect, it } from 'vitest'
import {
  checkAndConsumeProviderProxyQuota,
  createProviderProxyMemoryQuotaStore,
} from './quotaGuard'

describe('provider proxy quota guard', () => {
  it('allows requests within the window limit and blocks over the limit', () => {
    const store = createProviderProxyMemoryQuotaStore()
    const limits = { maxRouteRequestsPerWindow: 2, windowMs: 1000 }

    expect(checkAndConsumeProviderProxyQuota({
      coordinateCount: 2,
      identity: 'session-a',
      limits,
      nowMs: 100,
      store,
    }).allowed).toBe(true)
    expect(checkAndConsumeProviderProxyQuota({
      coordinateCount: 2,
      identity: 'session-a',
      limits,
      nowMs: 200,
      store,
    }).allowed).toBe(true)
    expect(checkAndConsumeProviderProxyQuota({
      coordinateCount: 2,
      identity: 'session-a',
      limits,
      nowMs: 300,
      store,
    })).toMatchObject({ allowed: false, reason: 'rate_limit' })
  })

  it('resets after the window and isolates identities', () => {
    const store = createProviderProxyMemoryQuotaStore()
    const limits = { maxRouteRequestsPerWindow: 1, windowMs: 1000 }

    expect(checkAndConsumeProviderProxyQuota({
      coordinateCount: 2,
      identity: 'session-a',
      limits,
      nowMs: 100,
      store,
    }).allowed).toBe(true)
    expect(checkAndConsumeProviderProxyQuota({
      coordinateCount: 2,
      identity: 'session-b',
      limits,
      nowMs: 200,
      store,
    }).allowed).toBe(true)
    expect(checkAndConsumeProviderProxyQuota({
      coordinateCount: 2,
      identity: 'session-a',
      limits,
      nowMs: 1200,
      store,
    }).allowed).toBe(true)
  })

  it('blocks oversized coordinate and day requests before consuming quota', () => {
    const store = createProviderProxyMemoryQuotaStore()

    expect(checkAndConsumeProviderProxyQuota({
      coordinateCount: 3,
      identity: 'session-a',
      limits: { maxCoordinatesPerRequest: 2 },
      store,
    })).toMatchObject({ allowed: false, reason: 'request_size' })
    expect(checkAndConsumeProviderProxyQuota({
      coordinateCount: 2,
      dayCount: 8,
      identity: 'session-a',
      limits: { maxDaysPerBatch: 7 },
      store,
    })).toMatchObject({ allowed: false, reason: 'day_batch_size' })
  })

  it('ai_draft quota is independent from route_preview quota', () => {
    const store = createProviderProxyMemoryQuotaStore()
    const limits = { maxRouteRequestsPerWindow: 1, maxAiDraftRequestsPerWindow: 1, windowMs: 1000 }

    expect(checkAndConsumeProviderProxyQuota({
      coordinateCount: 2,
      identity: 'session-a',
      limits,
      nowMs: 100,
      operation: 'route_preview',
      store,
    }).allowed).toBe(true)

    expect(checkAndConsumeProviderProxyQuota({
      coordinateCount: 2,
      identity: 'session-a',
      limits,
      nowMs: 200,
      operation: 'route_preview',
      store,
    }).allowed).toBe(false)

    expect(checkAndConsumeProviderProxyQuota({
      coordinateCount: 0,
      identity: 'session-a',
      limits,
      nowMs: 300,
      operation: 'ai_trip_draft',
      store,
    }).allowed).toBe(true)
  })

  it('travel_search quota is independent from route and AI quota buckets', () => {
    const store = createProviderProxyMemoryQuotaStore()
    const limits = {
      maxAiDraftRepairRequestsPerWindow: 1,
      maxAiDraftRequestsPerWindow: 1,
      maxRouteRequestsPerWindow: 1,
      maxTravelSearchRequestsPerWindow: 1,
      windowMs: 1000,
    }

    expect(checkAndConsumeProviderProxyQuota({
      coordinateCount: 2,
      identity: 'session-a',
      limits,
      nowMs: 100,
      operation: 'route_preview',
      store,
    }).allowed).toBe(true)
    expect(checkAndConsumeProviderProxyQuota({
      coordinateCount: 0,
      identity: 'session-a',
      limits,
      nowMs: 110,
      operation: 'ai_trip_draft',
      store,
    }).allowed).toBe(true)
    expect(checkAndConsumeProviderProxyQuota({
      coordinateCount: 0,
      identity: 'session-a',
      limits,
      nowMs: 120,
      operation: 'ai_trip_draft_repair',
      store,
    }).allowed).toBe(true)
    expect(checkAndConsumeProviderProxyQuota({
      coordinateCount: 0,
      identity: 'session-a',
      limits,
      nowMs: 130,
      operation: 'travel_search',
      store,
    }).allowed).toBe(true)

    expect(checkAndConsumeProviderProxyQuota({
      coordinateCount: 0,
      identity: 'session-a',
      limits,
      nowMs: 140,
      operation: 'travel_search',
      store,
    })).toMatchObject({ allowed: false, reason: 'rate_limit' })
  })
})
