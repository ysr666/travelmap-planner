import {
  PROVIDER_PROXY_AI_TRIP_DRAFT_OPERATION,
  PROVIDER_PROXY_AI_TRIP_DRAFT_REPAIR_OPERATION,
  PROVIDER_PROXY_MAX_AI_DRAFT_REPAIR_REQUESTS_PER_WINDOW,
  PROVIDER_PROXY_MAX_AI_DRAFT_REQUESTS_PER_WINDOW,
  PROVIDER_PROXY_MAX_COORDINATES,
  PROVIDER_PROXY_MAX_DAYS_PER_BATCH,
  type ProviderProxyOperation,
} from '../../src/lib/providerProxyContract'

export type ProviderProxyQuotaLimits = {
  maxAiDraftRepairRequestsPerWindow: number
  maxAiDraftRequestsPerWindow: number
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
  operation?: ProviderProxyOperation
  store?: ProviderProxyQuotaStore
}

export type ProviderProxyQuotaCheckResult =
  | { allowed: true; remaining: number; resetAt: number }
  | { allowed: false; reason: 'request_size' | 'day_batch_size' | 'rate_limit'; resetAt?: number }

export const DEFAULT_PROVIDER_PROXY_QUOTA_LIMITS: ProviderProxyQuotaLimits = {
  maxAiDraftRepairRequestsPerWindow: PROVIDER_PROXY_MAX_AI_DRAFT_REPAIR_REQUESTS_PER_WINDOW,
  maxAiDraftRequestsPerWindow: PROVIDER_PROXY_MAX_AI_DRAFT_REQUESTS_PER_WINDOW,
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
  operation,
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

  const isAiDraft = operation === PROVIDER_PROXY_AI_TRIP_DRAFT_OPERATION
  const isAiDraftRepair = operation === PROVIDER_PROXY_AI_TRIP_DRAFT_REPAIR_OPERATION
  const maxRequests = isAiDraftRepair
    ? effectiveLimits.maxAiDraftRepairRequestsPerWindow
    : isAiDraft
      ? effectiveLimits.maxAiDraftRequestsPerWindow
      : effectiveLimits.maxRouteRequestsPerWindow
  const identityPrefix = isAiDraftRepair ? 'ai_draft_repair|' : isAiDraft ? 'ai_draft|' : 'route|'
  const safeIdentity = `${identityPrefix}${identity.trim() || 'anonymous'}`

  const current = store.get(safeIdentity)
  const resetAt = current ? current.windowStartedAt + effectiveLimits.windowMs : nowMs + effectiveLimits.windowMs
  if (!current || resetAt <= nowMs) {
    store.set(safeIdentity, {
      count: 1,
      windowStartedAt: nowMs,
    })
    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetAt: nowMs + effectiveLimits.windowMs,
    }
  }

  if (current.count >= maxRequests) {
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
    remaining: maxRequests - current.count,
    resetAt,
  }
}
