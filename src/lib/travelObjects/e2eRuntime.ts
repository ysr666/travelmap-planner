import { validateTravelMediaAssetV1 } from '../media/travelMedia'
import { validateRealtimeFactV1 } from '../realtime/realtimeFact'
import {
  validateInsurancePolicyV1,
  validateLodgingReservationV1,
} from './contracts'
import {
  createEmptyTravelObjectRuntimeSupplements,
  type TravelObjectRuntimeSupplementsV1,
} from './runtime'

export const E2E_TRAVEL_OBJECT_CONTEXT_STORAGE_KEY = 'tripmap:e2e:travel-object-context-v1'
const MAX_CONTEXT_BYTES = 512 * 1024
const CONTEXT_FIELDS = new Set([
  'insurancePolicies',
  'lodgingReservations',
  'mediaAssets',
  'realtimeFacts',
  'schemaVersion',
  'tripId',
])

export function readE2eTravelObjectSupplements(input: {
  allowFixture: boolean
  storage?: Storage | null
  tripId: string
}): TravelObjectRuntimeSupplementsV1 {
  if (!input.allowFixture || !input.storage) return createEmptyTravelObjectRuntimeSupplements()
  try {
    const serialized = input.storage.getItem(E2E_TRAVEL_OBJECT_CONTEXT_STORAGE_KEY)
    if (!serialized || serialized.length > MAX_CONTEXT_BYTES) {
      return createEmptyTravelObjectRuntimeSupplements()
    }
    const record = readRecord(JSON.parse(serialized))
    if (!hasOnlyFields(record, CONTEXT_FIELDS) || record.schemaVersion !== 1 || record.tripId !== input.tripId) {
      return createEmptyTravelObjectRuntimeSupplements()
    }
    const insurancePolicies = readValidatedArray(
      record.insurancePolicies,
      20,
      validateInsurancePolicyV1,
      input.tripId,
    )
    const lodgingReservations = readValidatedArray(
      record.lodgingReservations,
      20,
      validateLodgingReservationV1,
      input.tripId,
    )
    const mediaAssets = readValidatedArray(record.mediaAssets, 80, (value) => {
      const validation = validateTravelMediaAssetV1(value)
      return validation.ok ? validation.value : null
    }, input.tripId)
    const realtimeFacts = readValidatedArray(record.realtimeFacts, 100, (value) => {
      const validation = validateRealtimeFactV1(value)
      return validation.ok ? validation.value : null
    }, input.tripId)
    if (!insurancePolicies || !lodgingReservations || !mediaAssets || !realtimeFacts) {
      return createEmptyTravelObjectRuntimeSupplements()
    }
    return { insurancePolicies, lodgingReservations, mediaAssets, realtimeFacts }
  } catch {
    return createEmptyTravelObjectRuntimeSupplements()
  }
}

function readValidatedArray<T extends { tripId?: string }>(
  input: unknown,
  limit: number,
  validator: (value: unknown) => T | null,
  tripId: string,
): T[] | null {
  if (!Array.isArray(input) || input.length > limit) return null
  const values: T[] = []
  for (const raw of input) {
    const value = validator(raw)
    if (!value || value.tripId !== tripId) return null
    values.push(value)
  }
  return values
}

function readRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
}

function hasOnlyFields(record: Record<string, unknown>, allowed: Set<string>) {
  return Object.keys(record).every((field) => allowed.has(field))
}
