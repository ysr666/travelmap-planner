import {
  selectRealtimeFact,
  validateRealtimeFactV1,
  type RealtimeFactKind,
  type RealtimeFactSubjectType,
  type RealtimeFactV1,
} from './realtimeFact'

export const REALTIME_FACT_CACHE_VERSION = 1 as const
export const DEFAULT_REALTIME_FACT_CACHE_LIMIT = 100
export const DEFAULT_REALTIME_FACT_STALE_RETENTION_MS = 24 * 60 * 60_000
const MAX_SERIALIZED_CACHE_BYTES = 256 * 1024

type PersistedRealtimeFactCacheV1 = {
  schemaVersion: typeof REALTIME_FACT_CACHE_VERSION
  facts: RealtimeFactV1[]
}

export class RealtimeFactCache {
  private readonly facts = new Map<string, RealtimeFactV1>()
  private readonly maxEntries: number
  private readonly staleRetentionMs: number
  private readonly storage?: Storage | null
  private readonly storageKey?: string

  constructor(options: {
    maxEntries?: number
    staleRetentionMs?: number
    storage?: Storage | null
    storageKey?: string
  } = {}) {
    this.maxEntries = clampInteger(options.maxEntries, 1, 500, DEFAULT_REALTIME_FACT_CACHE_LIMIT)
    this.staleRetentionMs = clampInteger(
      options.staleRetentionMs,
      0,
      7 * 24 * 60 * 60_000,
      DEFAULT_REALTIME_FACT_STALE_RETENTION_MS,
    )
    this.storage = options.storage
    this.storageKey = normalizeStorageKey(options.storageKey)
    this.hydrate()
  }

  put(input: unknown, now: Date | number | string = Date.now()) {
    const validation = validateRealtimeFactV1(input)
    if (!validation.ok) return validation
    this.facts.set(validation.value.id, validation.value)
    this.prune(now)
    this.persist()
    return validation
  }

  putAll(inputs: unknown[], now: Date | number | string = Date.now()) {
    const accepted: RealtimeFactV1[] = []
    const rejected: string[] = []
    for (const input of inputs) {
      const validation = validateRealtimeFactV1(input)
      if (validation.ok) {
        accepted.push(validation.value)
        this.facts.set(validation.value.id, validation.value)
      } else {
        rejected.push(validation.error)
      }
    }
    this.prune(now)
    this.persist()
    return { accepted, rejected }
  }

  select(input: {
    kind: RealtimeFactKind
    subjectId: string
    subjectType?: RealtimeFactSubjectType
    now?: Date | number | string
  }) {
    this.prune(input.now)
    return selectRealtimeFact([...this.facts.values()], input)
  }

  list(now?: Date | number | string) {
    this.prune(now)
    return [...this.facts.values()].sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt))
  }

  clear() {
    this.facts.clear()
    this.persist()
  }

  private prune(now: Date | number | string = Date.now()) {
    const nowMs = toTimestamp(now)
    if (Number.isFinite(nowMs)) {
      for (const [id, fact] of this.facts) {
        if (Date.parse(fact.expiresAt) + this.staleRetentionMs <= nowMs) this.facts.delete(id)
      }
    }
    const sorted = [...this.facts.values()].sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt))
    for (const fact of sorted.slice(this.maxEntries)) this.facts.delete(fact.id)
  }

  private hydrate() {
    if (!this.storage || !this.storageKey) return
    try {
      const serialized = this.storage.getItem(this.storageKey)
      if (!serialized || serialized.length > MAX_SERIALIZED_CACHE_BYTES) return
      const parsed = JSON.parse(serialized) as Partial<PersistedRealtimeFactCacheV1>
      if (parsed.schemaVersion !== REALTIME_FACT_CACHE_VERSION || !Array.isArray(parsed.facts)) return
      for (const input of parsed.facts.slice(0, this.maxEntries)) {
        const validation = validateRealtimeFactV1(input)
        if (validation.ok) this.facts.set(validation.value.id, validation.value)
      }
      this.prune()
    } catch {
      // Restricted or malformed storage falls back to this in-memory cache.
    }
  }

  private persist() {
    if (!this.storage || !this.storageKey) return
    try {
      const payload: PersistedRealtimeFactCacheV1 = {
        facts: [...this.facts.values()],
        schemaVersion: REALTIME_FACT_CACHE_VERSION,
      }
      const serialized = JSON.stringify(payload)
      if (serialized.length <= MAX_SERIALIZED_CACHE_BYTES) this.storage.setItem(this.storageKey, serialized)
    } catch {
      // Cache persistence is optional and must not block the travel workflow.
    }
  }
}

function normalizeStorageKey(value: string | undefined) {
  if (!value) return undefined
  return /^tripmap:realtime:[A-Za-z0-9:_-]{1,120}$/.test(value) ? value : undefined
}

function clampInteger(value: number | undefined, minimum: number, maximum: number, fallback: number) {
  return Number.isInteger(value) && value !== undefined && value >= minimum && value <= maximum ? value : fallback
}

function toTimestamp(value: Date | number | string) {
  return typeof value === 'number' ? value : value instanceof Date ? value.getTime() : Date.parse(value)
}
