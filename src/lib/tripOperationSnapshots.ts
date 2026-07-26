import type { TripReplanRecord, TripReplanSnapshot } from '../types'

export function buildTripOperationSnapshotFingerprint(snapshot: TripReplanSnapshot) {
  return stableStringify({
    days: [...snapshot.days].sort(compareById),
    items: [...snapshot.items].sort(compareById),
  })
}

export function isAdaptiveTripReplanRecord(record: TripReplanRecord) {
  return !record.operationKind || record.operationKind === 'adaptive_replan'
}

function compareById(first: { id: string }, second: { id: string }) {
  return first.id.localeCompare(second.id)
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}
