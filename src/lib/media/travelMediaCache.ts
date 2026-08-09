import {
  isTravelMediaAssetCurrent,
  validateTravelMediaAssetV1,
  type TravelMediaAssetV1,
} from './travelMedia'

export const TRAVEL_MEDIA_CACHE_VERSION = 1 as const
export const DEFAULT_TRAVEL_MEDIA_CACHE_LIMIT = 80
const MAX_SERIALIZED_CACHE_BYTES = 256 * 1024

type PersistedTravelMediaCacheV1 = {
  assets: TravelMediaAssetV1[]
  schemaVersion: typeof TRAVEL_MEDIA_CACHE_VERSION
}

export class TravelMediaCache {
  private readonly assets = new Map<string, TravelMediaAssetV1>()
  private readonly maxEntries: number
  private readonly storage?: Storage | null
  private readonly storageKey?: string

  constructor(options: {
    maxEntries?: number
    storage?: Storage | null
    storageKey?: string
  } = {}) {
    this.maxEntries = clampInteger(options.maxEntries, 1, 200, DEFAULT_TRAVEL_MEDIA_CACHE_LIMIT)
    this.storage = options.storage
    this.storageKey = normalizeStorageKey(options.storageKey)
    this.hydrate()
  }

  put(input: unknown, now: Date | number | string = Date.now()) {
    const validation = validateTravelMediaAssetV1(input)
    if (!validation.ok) return validation
    this.assets.set(validation.value.id, validation.value)
    this.prune(now)
    this.persist()
    return validation
  }

  putAll(inputs: unknown[], now: Date | number | string = Date.now()) {
    const accepted: TravelMediaAssetV1[] = []
    const rejected: string[] = []
    for (const input of inputs) {
      const validation = validateTravelMediaAssetV1(input)
      if (validation.ok) {
        accepted.push(validation.value)
        this.assets.set(validation.value.id, validation.value)
      } else {
        rejected.push(validation.error)
      }
    }
    this.prune(now)
    this.persist()
    return { accepted, rejected }
  }

  list(now: Date | number | string = Date.now()) {
    this.prune(now)
    return [...this.assets.values()].sort((left, right) => (
      Date.parse(right.observedAt) - Date.parse(left.observedAt) || left.id.localeCompare(right.id)
    ))
  }

  clear() {
    this.assets.clear()
    this.persist()
  }

  private prune(now: Date | number | string) {
    for (const [id, asset] of this.assets) {
      if (!isTravelMediaAssetCurrent(asset, now)) this.assets.delete(id)
    }
    const sorted = [...this.assets.values()].sort((left, right) => (
      Date.parse(right.observedAt) - Date.parse(left.observedAt)
    ))
    for (const asset of sorted.slice(this.maxEntries)) this.assets.delete(asset.id)
  }

  private hydrate() {
    if (!this.storage || !this.storageKey) return
    try {
      const serialized = this.storage.getItem(this.storageKey)
      if (!serialized || serialized.length > MAX_SERIALIZED_CACHE_BYTES) return
      const parsed = JSON.parse(serialized) as Partial<PersistedTravelMediaCacheV1>
      if (parsed.schemaVersion !== TRAVEL_MEDIA_CACHE_VERSION || !Array.isArray(parsed.assets)) return
      for (const input of parsed.assets.slice(0, this.maxEntries)) {
        const validation = validateTravelMediaAssetV1(input)
        if (validation.ok) this.assets.set(validation.value.id, validation.value)
      }
      this.prune(Date.now())
    } catch {
      // A malformed or unavailable cache must not block travel objects.
    }
  }

  private persist() {
    if (!this.storage || !this.storageKey) return
    try {
      const serialized = JSON.stringify({
        assets: [...this.assets.values()],
        schemaVersion: TRAVEL_MEDIA_CACHE_VERSION,
      } satisfies PersistedTravelMediaCacheV1)
      if (serialized.length <= MAX_SERIALIZED_CACHE_BYTES) this.storage.setItem(this.storageKey, serialized)
    } catch {
      // Cache persistence is optional.
    }
  }
}

function normalizeStorageKey(value: string | undefined) {
  return value && /^tripmap:media:[A-Za-z0-9:_-]{1,120}$/.test(value) ? value : undefined
}

function clampInteger(value: number | undefined, minimum: number, maximum: number, fallback: number) {
  return Number.isInteger(value) && value !== undefined && value >= minimum && value <= maximum ? value : fallback
}
