import {
  PROVIDER_PROXY_MAX_COORDINATES,
  PROVIDER_PROXY_MAX_DAYS_PER_BATCH,
} from '../../src/lib/providerProxyContract'

export type ProviderProxyQuotaLimits = {
  maxCoordinatesPerRequest: number
  maxDaysPerBatch: number
  maxRouteRequestsPerWindow: number
  windowMs: number
}

export type ProviderProxyQuotaStore = Map<string, {
  count: number
  windowStartedAt: number
}>

export type ProviderProxyQuotaCheckInput = {
  coordinateCount: number
  dayCount?: number
  identity: string
  limits?: Partial<ProviderProxyQuotaLimits>
  nowMs?: number
  store?: ProviderProxyQuotaStore
}

export type ProviderProxyQuotaCheckResult =
  | { allowed: true; remaining: number; resetAt: number }
  | { allowed: false; reason: 'request_size' | 'day_batch_size' | 'rate_limit'; resetAt?: number }

export const DEFAULT_PROVIDER_PROXY_QUOTA_LIMITS: ProviderProxyQuotaLimits = {
  maxCoordinatesPerRequest: PROVIDER_PROXY_MAX_COORDINATES,
  maxDaysPerBatch: PROVIDER_PROXY_MAX_DAYS_PER_BATCH,
  maxRouteRequestsPerWindow: 60,
  windowMs: 60_000,
}

const defaultQuotaStore: ProviderProxyQuotaStore = new Map()

export function createProviderProxyMemoryQuotaStore(): ProviderProxyQuotaStore {
  return new Map()
}

export function checkAndConsumeProviderProxyQuota({
  coordinateCount,
  dayCount = 1,
  identity,
  limits,
  nowMs = Date.now(),
  store = defaultQuotaStore,
}: ProviderProxyQuotaCheckInput): ProviderProxyQuotaCheckResult {
  const effectiveLimits = {
    ...DEFAULT_PROVIDER_PROXY_QUOTA_LIMITS,
    ...limits,
  }

  if (coordinateCount > effectiveLimits.maxCoordinatesPerRequest) {
    return { allowed: false, reason: 'request_size' }
  }

  if (dayCount > effectiveLimits.maxDaysPerBatch) {
    return { allowed: false, reason: 'day_batch_size' }
  }

  const safeIdentity = identity.trim() || 'anonymous'
  const current = store.get(safeIdentity)
  const resetAt = current ? current.windowStartedAt + effectiveLimits.windowMs : nowMs + effectiveLimits.windowMs
  if (!current || resetAt <= nowMs) {
    store.set(safeIdentity, {
      count: 1,
      windowStartedAt: nowMs,
    })
    return {
      allowed: true,
      remaining: effectiveLimits.maxRouteRequestsPerWindow - 1,
      resetAt: nowMs + effectiveLimits.windowMs,
    }
  }

  if (current.count >= effectiveLimits.maxRouteRequestsPerWindow) {
    return {
      allowed: false,
      reason: 'rate_limit',
      resetAt,
    }
  }

  current.count += 1
  store.set(safeIdentity, current)
  return {
    allowed: true,
    remaining: effectiveLimits.maxRouteRequestsPerWindow - current.count,
    resetAt,
  }
}
