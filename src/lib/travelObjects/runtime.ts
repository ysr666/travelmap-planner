import { buildTicketStatusFact } from '../realtime/factAdapters'
import { validateRealtimeFactV1, type RealtimeFactV1 } from '../realtime/realtimeFact'
import { validateTravelMediaAssetV1, type TravelMediaAssetV1 } from '../media/travelMedia'
import {
  validateInsurancePolicyV1,
  validateLodgingReservationV1,
  type InsurancePolicyV1,
  type LodgingReservationV1,
} from './contracts'
import type { TicketMeta } from '../../types'

export const E2E_TRAVEL_OBJECT_CONTEXT_STORAGE_KEY = 'tripmap:e2e:travel-object-context-v1'
export const TRAVEL_OBJECT_MEDIA_CACHE_KEY = 'tripmap:media:travel-object-v1'
export const TRAVEL_OBJECT_REALTIME_CACHE_KEY = 'tripmap:realtime:travel-object-v1'
const MAX_CONTEXT_BYTES = 512 * 1024
const CONTEXT_FIELDS = new Set([
  'insurancePolicies',
  'lodgingReservations',
  'mediaAssets',
  'realtimeFacts',
  'schemaVersion',
  'tripId',
])

export type TravelObjectRuntimeSupplementsV1 = {
  insurancePolicies: InsurancePolicyV1[]
  lodgingReservations: LodgingReservationV1[]
  mediaAssets: TravelMediaAssetV1[]
  realtimeFacts: RealtimeFactV1[]
}

const EMPTY_SUPPLEMENTS: TravelObjectRuntimeSupplementsV1 = {
  insurancePolicies: [],
  lodgingReservations: [],
  mediaAssets: [],
  realtimeFacts: [],
}

export function readE2eTravelObjectSupplements(input: {
  allowFixture: boolean
  storage?: Storage | null
  tripId: string
}): TravelObjectRuntimeSupplementsV1 {
  if (!input.allowFixture || !input.storage) return EMPTY_SUPPLEMENTS
  try {
    const serialized = input.storage.getItem(E2E_TRAVEL_OBJECT_CONTEXT_STORAGE_KEY)
    if (!serialized || serialized.length > MAX_CONTEXT_BYTES) return EMPTY_SUPPLEMENTS
    const record = readRecord(JSON.parse(serialized))
    if (!hasOnlyFields(record, CONTEXT_FIELDS) || record.schemaVersion !== 1 || record.tripId !== input.tripId) {
      return EMPTY_SUPPLEMENTS
    }
    const insurancePolicies = readArray(record.insurancePolicies, 20, validateInsurancePolicyV1, input.tripId)
    const lodgingReservations = readArray(record.lodgingReservations, 20, validateLodgingReservationV1, input.tripId)
    const mediaAssets = readValidatedArray(record.mediaAssets, 80, (value) => {
      const validation = validateTravelMediaAssetV1(value)
      return validation.ok ? validation.value : null
    }, input.tripId)
    const realtimeFacts = readValidatedArray(record.realtimeFacts, 100, (value) => {
      const validation = validateRealtimeFactV1(value)
      return validation.ok ? validation.value : null
    }, input.tripId)
    if (!insurancePolicies || !lodgingReservations || !mediaAssets || !realtimeFacts) return EMPTY_SUPPLEMENTS
    return { insurancePolicies, lodgingReservations, mediaAssets, realtimeFacts }
  } catch {
    return EMPTY_SUPPLEMENTS
  }
}

export function buildTicketBlobMediaAssets(tickets: TicketMeta[], now: Date | number | string = Date.now()) {
  const nowMs = toTimestamp(now)
  const expiresAt = new Date(nowMs + 10 * 365 * 24 * 60 * 60_000).toISOString()
  return tickets.flatMap((ticket) => {
    if (ticket.storageMode !== 'copy' || ticket.fileType !== 'image') return []
    const observedAt = new Date(Math.min(nowMs, normalizeTicketTimestamp(ticket.updatedAt, nowMs))).toISOString()
    const validation = validateTravelMediaAssetV1({
      aspectRatio: 0.75,
      attribution: [],
      expiresAt,
      height: 1200,
      id: `media_ticket_${controlledPart(ticket.id)}_v1`.slice(0, 160),
      kind: 'document_preview',
      observedAt,
      providerRef: ticket.id,
      renderRef: { ticketId: ticket.id, type: 'ticket_blob' },
      schemaVersion: 1,
      source: 'ticket_blob',
      subjectId: ticket.id,
      subjectType: 'ticket',
      tripId: ticket.tripId,
      width: 900,
    })
    return validation.ok ? [validation.value] : []
  })
}

export function buildLocalTicketRealtimeFacts(tickets: TicketMeta[]) {
  return tickets.flatMap((ticket) => {
    const fact = buildTicketStatusFact(ticket)
    return fact ? [fact] : []
  })
}

function readArray<T extends { tripId?: string }>(
  input: unknown,
  limit: number,
  validator: (value: unknown) => T | null,
  tripId: string,
) {
  return readValidatedArray(input, limit, validator, tripId)
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
  return input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}
}

function hasOnlyFields(record: Record<string, unknown>, allowed: Set<string>) {
  return Object.keys(record).every((field) => allowed.has(field))
}

function controlledPart(value: string) {
  return value.toLocaleLowerCase('en-US').replace(/[^a-z0-9_:-]/g, '_').replace(/^_+/, '').slice(0, 112) || 'ticket'
}

function normalizeTicketTimestamp(value: number | string, fallback: number) {
  const timestamp = typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : fallback
}

function toTimestamp(value: Date | number | string) {
  const timestamp = typeof value === 'number' ? value : value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : Date.now()
}
