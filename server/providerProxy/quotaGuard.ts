import {
  PROVIDER_PROXY_AI_TRIP_DRAFT_OPERATION,
  PROVIDER_PROXY_AI_TRIP_DRAFT_REFINE_OPERATION,
  PROVIDER_PROXY_AI_TRIP_DRAFT_REPAIR_OPERATION,
  PROVIDER_PROXY_AI_EXISTING_TRIP_IMPORT_OPERATION,
  PROVIDER_PROXY_MAX_AI_EXISTING_TRIP_IMPORT_REQUESTS_PER_WINDOW,
  PROVIDER_PROXY_MAX_TRAVEL_INBOX_CLASSIFY_REQUESTS_PER_WINDOW,
  PROVIDER_PROXY_AI_TRIP_EDIT_PLAN_OPERATION,
  PROVIDER_PROXY_MAX_AI_DRAFT_REPAIR_REQUESTS_PER_WINDOW,
  PROVIDER_PROXY_MAX_AI_DRAFT_REQUESTS_PER_WINDOW,
  PROVIDER_PROXY_MAX_AI_TRIP_EDIT_REQUESTS_PER_WINDOW,
  PROVIDER_PROXY_MAX_COORDINATES,
  PROVIDER_PROXY_MAX_DAYS_PER_BATCH,
  PROVIDER_PROXY_MAX_PLACE_LOOKUP_REQUESTS_PER_WINDOW,
  PROVIDER_PROXY_MAX_TRIP_CONTENT_ENRICHMENT_REQUESTS_PER_WINDOW,
  PROVIDER_PROXY_MAX_TRIP_OPERATIONS_SUMMARY_REQUESTS_PER_WINDOW,
  PROVIDER_PROXY_MAX_TRAVEL_SEARCH_REQUESTS_PER_WINDOW,
  PROVIDER_PROXY_PLACE_DETAILS_OPERATION,
  PROVIDER_PROXY_PLACE_LOOKUP_OPERATION,
  PROVIDER_PROXY_TRIP_CONTENT_ENRICHMENT_OPERATION,
  PROVIDER_PROXY_TRIP_DAILY_TIP_OPERATION,
  PROVIDER_PROXY_TRIP_OPERATIONS_SUMMARY_OPERATION,
  PROVIDER_PROXY_TRAVEL_SEARCH_OPERATION,
  type ProviderProxyOperation,
} from '../../src/lib/ai/providerProxyContract'

export type ProviderProxyQuotaBucket =
  | 'route|'
  | 'search|'
  | 'place|'
  | 'ai_draft|'
  | 'ai_draft_refine|'
  | 'ai_draft_repair|'
  | 'ai_existing_trip_import|'
  | 'travel_inbox_classify|'
  | 'ai_trip_content|'
  | 'ai_trip_daily_tip|'
  | 'ai_trip_operations|'
  | 'ai_trip_edit|'

export type ProviderProxyQuotaLimits = {
  maxAiDraftRepairRequestsPerWindow: number
  maxAiDraftRequestsPerWindow: number
  maxAiExistingTripImportRequestsPerWindow: number
  maxTravelInboxClassifyRequestsPerWindow: number
  maxAiTripContentEnrichmentRequestsPerWindow: number
  maxAiTripOperationsSummaryRequestsPerWindow: number
  maxAiTripEditRequestsPerWindow: number
  maxCoordinatesPerRequest: number
  maxDaysPerBatch: number
  maxPlaceLookupRequestsPerWindow: number
  maxRouteRequestsPerWindow: number
  maxTravelSearchRequestsPerWindow: number
  windowMs: number
}

export type ProviderProxyQuotaIdentityInput = {
  accountId?: string
  ip?: string
  quotaSessionId?: string
}

export type ProviderProxyQuotaHasher = (input: string) => Promise<string> | string

export type ProviderProxyQuotaStorageConsumeInput = {
  key: string
  maxRequests: number
  nowMs: number
  windowMs: number
}

export type ProviderProxyQuotaStorageConsumeResult =
  | { allowed: true; remaining: number; resetAt: number }
  | { allowed: false; reason: 'rate_limit' | 'storage_error'; resetAt?: number }

export type ProviderProxyQuotaStorage = {
  consume(input: ProviderProxyQuotaStorageConsumeInput): Promise<ProviderProxyQuotaStorageConsumeResult>
}

export type ProviderProxyQuotaMemoryEntry = {
  count: number
  expiresAt: number
  windowStartedAt: number
}

export type ProviderProxyQuotaMemoryStore = Map<string, ProviderProxyQuotaMemoryEntry>

export type ProviderProxyD1Result = {
  meta?: {
    changes?: number
  }
  results?: unknown[]
  success?: boolean
}

export type ProviderProxyD1PreparedStatement = {
  bind(...values: Array<number | string>): ProviderProxyD1PreparedStatement
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>
  run(): Promise<ProviderProxyD1Result>
}

export type ProviderProxyD1Database = {
  batch?(statements: ProviderProxyD1PreparedStatement[]): Promise<ProviderProxyD1Result[]>
  prepare(query: string): ProviderProxyD1PreparedStatement
}

export type ProviderProxyQuotaCheckInput = {
  coordinateCount: number
  dayCount?: number
  hasher?: ProviderProxyQuotaHasher
  identity: ProviderProxyQuotaIdentityInput
  limits?: Partial<ProviderProxyQuotaLimits>
  nowMs?: number
  operation?: ProviderProxyOperation
  storage?: ProviderProxyQuotaStorage
}

export type ProviderProxyQuotaCheckResult =
  | { allowed: true; remaining: number; resetAt: number }
  | { allowed: false; reason: 'request_size' | 'day_batch_size' | 'rate_limit' | 'storage_error'; resetAt?: number }

export type ProviderProxyQuotaBucketConfig = {
  bucket: ProviderProxyQuotaBucket
  maxRequests: number
}

export const PROVIDER_PROXY_QUOTA_D1_BINDING = 'TRIPMAP_PROVIDER_QUOTA_D1'

export const DEFAULT_PROVIDER_PROXY_QUOTA_LIMITS: ProviderProxyQuotaLimits = {
  maxAiDraftRepairRequestsPerWindow: PROVIDER_PROXY_MAX_AI_DRAFT_REPAIR_REQUESTS_PER_WINDOW,
  maxAiDraftRequestsPerWindow: PROVIDER_PROXY_MAX_AI_DRAFT_REQUESTS_PER_WINDOW,
  maxAiExistingTripImportRequestsPerWindow: PROVIDER_PROXY_MAX_AI_EXISTING_TRIP_IMPORT_REQUESTS_PER_WINDOW,
  maxTravelInboxClassifyRequestsPerWindow: PROVIDER_PROXY_MAX_TRAVEL_INBOX_CLASSIFY_REQUESTS_PER_WINDOW,
  maxAiTripContentEnrichmentRequestsPerWindow: PROVIDER_PROXY_MAX_TRIP_CONTENT_ENRICHMENT_REQUESTS_PER_WINDOW,
  maxAiTripOperationsSummaryRequestsPerWindow: PROVIDER_PROXY_MAX_TRIP_OPERATIONS_SUMMARY_REQUESTS_PER_WINDOW,
  maxAiTripEditRequestsPerWindow: PROVIDER_PROXY_MAX_AI_TRIP_EDIT_REQUESTS_PER_WINDOW,
  maxCoordinatesPerRequest: PROVIDER_PROXY_MAX_COORDINATES,
  maxDaysPerBatch: PROVIDER_PROXY_MAX_DAYS_PER_BATCH,
  maxPlaceLookupRequestsPerWindow: PROVIDER_PROXY_MAX_PLACE_LOOKUP_REQUESTS_PER_WINDOW,
  maxRouteRequestsPerWindow: 60,
  maxTravelSearchRequestsPerWindow: PROVIDER_PROXY_MAX_TRAVEL_SEARCH_REQUESTS_PER_WINDOW,
  windowMs: 60_000,
}

const D1_CONSUME_QUOTA_SQL = `
INSERT INTO provider_quota (id, count, window_started_at, expires_at)
VALUES (?, 1, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  count = CASE
    WHEN provider_quota.expires_at <= ? THEN 1
    ELSE provider_quota.count + 1
  END,
  window_started_at = CASE
    WHEN provider_quota.expires_at <= ? THEN ?
    ELSE provider_quota.window_started_at
  END,
  expires_at = CASE
    WHEN provider_quota.expires_at <= ? THEN ?
    ELSE provider_quota.expires_at
  END
WHERE provider_quota.expires_at <= ? OR provider_quota.count < ?
RETURNING count, window_started_at, expires_at
`.trim()

const D1_SELECT_RESET_SQL = 'SELECT expires_at FROM provider_quota WHERE id = ?'
const defaultMemoryQuotaStore: ProviderProxyQuotaMemoryStore = new Map()
const defaultMemoryQuotaStorage = createProviderProxyMemoryQuotaStorage(defaultMemoryQuotaStore)

export function createProviderProxyMemoryQuotaStorage(
  store: ProviderProxyQuotaMemoryStore = new Map(),
): ProviderProxyQuotaStorage {
  return {
    async consume({ key, maxRequests, nowMs, windowMs }) {
      const current = store.get(key)
      if (!current || current.expiresAt <= nowMs) {
        store.set(key, {
          count: 1,
          expiresAt: nowMs + windowMs,
          windowStartedAt: nowMs,
        })
        return {
          allowed: true,
          remaining: Math.max(0, maxRequests - 1),
          resetAt: nowMs + windowMs,
        }
      }

      if (current.count >= maxRequests) {
        return {
          allowed: false,
          reason: 'rate_limit',
          resetAt: current.expiresAt,
        }
      }

      const nextCount = current.count + 1
      store.set(key, {
        ...current,
        count: nextCount,
      })
      return {
        allowed: true,
        remaining: Math.max(0, maxRequests - nextCount),
        resetAt: current.expiresAt,
      }
    },
  }
}

export function createProviderProxyD1QuotaStorage(d1: ProviderProxyD1Database): ProviderProxyQuotaStorage {
  return {
    async consume({ key, maxRequests, nowMs, windowMs }) {
      const resetAt = nowMs + windowMs
      try {
        const row = await d1
          .prepare(D1_CONSUME_QUOTA_SQL)
          .bind(
            key,
            nowMs,
            resetAt,
            nowMs,
            nowMs,
            nowMs,
            nowMs,
            resetAt,
            nowMs,
            maxRequests,
          )
          .first<Record<string, unknown>>()

        if (row) {
          const count = readD1Integer(row.count)
          const rowResetAt = readD1Integer(row.expires_at)
          if (typeof count !== 'number' || typeof rowResetAt !== 'number') {
            return { allowed: false, reason: 'storage_error' }
          }
          return {
            allowed: true,
            remaining: Math.max(0, maxRequests - count),
            resetAt: rowResetAt,
          }
        }

        const resetRow = await d1
          .prepare(D1_SELECT_RESET_SQL)
          .bind(key)
          .first<Record<string, unknown>>()
        const rowResetAt = resetRow ? readD1Integer(resetRow.expires_at) : undefined
        return {
          allowed: false,
          reason: 'rate_limit',
          resetAt: rowResetAt,
        }
      } catch {
        return { allowed: false, reason: 'storage_error' }
      }
    },
  }
}

export function selectProviderProxyQuotaStorage(env?: Record<string, unknown>): ProviderProxyQuotaStorage {
  const maybeBinding = env?.[PROVIDER_PROXY_QUOTA_D1_BINDING]
  if (maybeBinding === undefined || maybeBinding === null) {
    return defaultMemoryQuotaStorage
  }
  if (isProviderProxyD1Database(maybeBinding)) {
    return createProviderProxyD1QuotaStorage(maybeBinding)
  }
  return createProviderProxyFailClosedQuotaStorage()
}

export async function consumeProviderProxyQuota({
  coordinateCount,
  dayCount = 1,
  hasher,
  identity,
  limits,
  nowMs = Date.now(),
  operation,
  storage = defaultMemoryQuotaStorage,
}: ProviderProxyQuotaCheckInput): Promise<ProviderProxyQuotaCheckResult> {
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

  const bucketConfig = getProviderProxyQuotaBucketConfig(operation, effectiveLimits)
  const key = await buildProviderProxyQuotaRowId({
    bucket: bucketConfig.bucket,
    hasher,
    identity,
  })
  const consumed = await storage.consume({
    key,
    maxRequests: bucketConfig.maxRequests,
    nowMs,
    windowMs: effectiveLimits.windowMs,
  })

  if (!consumed.allowed) {
    return consumed
  }
  return consumed
}

export function getProviderProxyQuotaBucketConfig(
  operation: ProviderProxyOperation | undefined,
  limits: ProviderProxyQuotaLimits,
): ProviderProxyQuotaBucketConfig {
  if (operation === PROVIDER_PROXY_AI_TRIP_DRAFT_REPAIR_OPERATION) {
    return { bucket: 'ai_draft_repair|', maxRequests: limits.maxAiDraftRepairRequestsPerWindow }
  }
  if (operation === PROVIDER_PROXY_AI_TRIP_DRAFT_REFINE_OPERATION) {
    return { bucket: 'ai_draft_refine|', maxRequests: limits.maxAiDraftRepairRequestsPerWindow }
  }
  if (operation === PROVIDER_PROXY_AI_TRIP_DRAFT_OPERATION) {
    return { bucket: 'ai_draft|', maxRequests: limits.maxAiDraftRequestsPerWindow }
  }
  if (operation === PROVIDER_PROXY_AI_EXISTING_TRIP_IMPORT_OPERATION) {
    return { bucket: 'ai_existing_trip_import|', maxRequests: limits.maxAiExistingTripImportRequestsPerWindow }
  }
  if (operation === 'travel_inbox_classify') {
    return { bucket: 'travel_inbox_classify|', maxRequests: limits.maxTravelInboxClassifyRequestsPerWindow }
  }
  if (operation === PROVIDER_PROXY_AI_TRIP_EDIT_PLAN_OPERATION) {
    return { bucket: 'ai_trip_edit|', maxRequests: limits.maxAiTripEditRequestsPerWindow }
  }
  if (operation === PROVIDER_PROXY_TRIP_CONTENT_ENRICHMENT_OPERATION) {
    return { bucket: 'ai_trip_content|', maxRequests: limits.maxAiTripContentEnrichmentRequestsPerWindow }
  }
  if (operation === PROVIDER_PROXY_TRIP_DAILY_TIP_OPERATION) {
    return { bucket: 'ai_trip_daily_tip|', maxRequests: limits.maxAiTripContentEnrichmentRequestsPerWindow }
  }
  if (operation === PROVIDER_PROXY_TRIP_OPERATIONS_SUMMARY_OPERATION) {
    return { bucket: 'ai_trip_operations|', maxRequests: limits.maxAiTripOperationsSummaryRequestsPerWindow }
  }
  if (operation === PROVIDER_PROXY_PLACE_LOOKUP_OPERATION || operation === PROVIDER_PROXY_PLACE_DETAILS_OPERATION) {
    return { bucket: 'place|', maxRequests: limits.maxPlaceLookupRequestsPerWindow }
  }
  if (operation === PROVIDER_PROXY_TRAVEL_SEARCH_OPERATION) {
    return { bucket: 'search|', maxRequests: limits.maxTravelSearchRequestsPerWindow }
  }
  return { bucket: 'route|', maxRequests: limits.maxRouteRequestsPerWindow }
}

export async function buildProviderProxyQuotaRowId({
  bucket,
  hasher = hashProviderProxyQuotaIdentity,
  identity,
}: {
  bucket: ProviderProxyQuotaBucket
  hasher?: ProviderProxyQuotaHasher
  identity: ProviderProxyQuotaIdentityInput
}): Promise<string> {
  const identityMaterial = buildProviderProxyQuotaIdentityMaterial(identity)
  const hashed = normalizeHasherOutput(await hasher(identityMaterial))
  return `${bucket}${hashed}`
}

export function buildProviderProxyQuotaIdentityMaterial({
  accountId,
  ip,
  quotaSessionId,
}: ProviderProxyQuotaIdentityInput): string {
  const parts: string[] = []
  const safeAccountId = sanitizeQuotaIdentityPart(accountId)
  const safeSessionId = sanitizeQuotaIdentityPart(quotaSessionId)
  const safeIp = sanitizeQuotaIdentityPart(ip)

  if (safeAccountId) {
    parts.push(`account:${safeAccountId}`)
  } else {
    parts.push('account:none')
  }
  if (safeSessionId) {
    parts.push(`session:${safeSessionId}`)
  }
  if (safeIp) {
    parts.push(`ip:${safeIp}`)
  }
  if (!safeSessionId && !safeIp) {
    parts.push('anonymous:provider-proxy')
  }

  return parts.join('|')
}

export async function hashProviderProxyQuotaIdentity(input: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (subtle && typeof TextEncoder !== 'undefined') {
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(input))
    return arrayBufferToHex(digest)
  }

  try {
    const nodeCrypto = await import('node:crypto')
    return nodeCrypto.createHash('sha256').update(input).digest('hex')
  } catch {
    return fallbackHash(input)
  }
}

function createProviderProxyFailClosedQuotaStorage(): ProviderProxyQuotaStorage {
  return {
    async consume() {
      return { allowed: false, reason: 'storage_error' }
    },
  }
}

function isProviderProxyD1Database(value: unknown): value is ProviderProxyD1Database {
  return Boolean(value && typeof value === 'object' && typeof (value as { prepare?: unknown }).prepare === 'function')
}

function readD1Integer(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value)
  }
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Math.trunc(Number(value))
  }
  return undefined
}

function sanitizeQuotaIdentityPart(value: string | undefined): string | undefined {
  const trimmed = value?.trim().replace(/\s+/g, ' ')
  if (!trimmed) {
    return undefined
  }
  return trimmed.slice(0, 200)
}

function normalizeHasherOutput(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
  return normalized || 'empty-hash'
}

function arrayBufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function fallbackHash(input: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
