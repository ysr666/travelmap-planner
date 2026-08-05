import { isValidPlainDate } from '../plainDate'
import type {
  StructuredTravelFieldConfidence,
  StructuredTravelFieldEvidence,
  StructuredTravelFieldSourceType,
  TicketReadinessStatus,
  TicketStructuredFieldKey,
  TicketStructuredFieldsV1,
} from '../../types'

export const TRAVEL_OBJECT_SCHEMA_VERSION = 1 as const

export type LodgingReservationStatus = 'draft' | 'confirmed' | 'changed' | 'cancelled' | 'completed'
export type InsurancePolicyStatus = 'draft' | 'active' | 'expired' | 'cancelled'

export type LodgingReservationV1 = {
  schemaVersion: typeof TRAVEL_OBJECT_SCHEMA_VERSION
  id: string
  tripId: string
  itemId?: string
  ticketId?: string
  name: string
  address?: string
  checkInDate: string
  checkInTime?: string
  checkOutDate: string
  checkOutTime?: string
  nightCount: number
  confirmationNumber?: string
  status: LodgingReservationStatus
  mediaAssetId?: string
  source: StructuredTravelFieldEvidence
}

export type InsurancePolicyV1 = {
  schemaVersion: typeof TRAVEL_OBJECT_SCHEMA_VERSION
  id: string
  tripId: string
  ticketId?: string
  providerName: string
  providerCode?: string
  productName?: string
  policyNumber?: string
  effectiveFrom: string
  effectiveTo: string
  status: InsurancePolicyStatus
  source: StructuredTravelFieldEvidence
}

const TICKET_STRUCTURED_FIELDS = new Set([
  'entryTime',
  'fieldEvidence',
  'previewMediaAssetId',
  'schemaVersion',
  'serviceDate',
  'status',
])
const TICKET_FIELD_KEYS = new Set<TicketStructuredFieldKey>([
  'entryTime',
  'previewMediaAssetId',
  'serviceDate',
  'status',
])
const EVIDENCE_FIELDS = new Set(['confidence', 'observedAt', 'sourceId', 'sourceType'])
const SOURCE_TYPES = new Set<StructuredTravelFieldSourceType>(['manual', 'local_import', 'provider', 'ticket', 'fixture'])
const CONFIDENCE_VALUES = new Set<StructuredTravelFieldConfidence>(['high', 'medium', 'low'])
const TICKET_STATUSES = new Set<TicketReadinessStatus>(['ready', 'needs_review', 'expired', 'unavailable'])
const LODGING_FIELDS = new Set([
  'address',
  'checkInDate',
  'checkInTime',
  'checkOutDate',
  'checkOutTime',
  'confirmationNumber',
  'id',
  'itemId',
  'mediaAssetId',
  'name',
  'nightCount',
  'schemaVersion',
  'source',
  'status',
  'ticketId',
  'tripId',
])
const INSURANCE_FIELDS = new Set([
  'effectiveFrom',
  'effectiveTo',
  'id',
  'policyNumber',
  'productName',
  'providerCode',
  'providerName',
  'schemaVersion',
  'source',
  'status',
  'ticketId',
  'tripId',
])
const CONTROLLED_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/
const MEDIA_ID = /^media_[a-z0-9_]{1,120}_v\d+$/
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/

export function normalizeTicketStructuredFieldsV1(input: unknown): TicketStructuredFieldsV1 | undefined {
  if (input === undefined) return undefined
  const record = readRecord(input)
  if (!hasOnlyFields(record, TICKET_STRUCTURED_FIELDS) || record.schemaVersion !== TRAVEL_OBJECT_SCHEMA_VERSION) return undefined

  const serviceDate = readOptionalPlainDate(record.serviceDate)
  const entryTime = readOptionalTime(record.entryTime)
  const status = typeof record.status === 'string' && TICKET_STATUSES.has(record.status as TicketReadinessStatus)
    ? record.status as TicketReadinessStatus
    : undefined
  const previewMediaAssetId = readOptionalControlledId(record.previewMediaAssetId, MEDIA_ID)
  if (
    (record.serviceDate !== undefined && !serviceDate)
    || (record.entryTime !== undefined && !entryTime)
    || (record.status !== undefined && !status)
    || (record.previewMediaAssetId !== undefined && !previewMediaAssetId)
  ) return undefined

  const fieldEvidence = readTicketFieldEvidence(record.fieldEvidence)
  if (record.fieldEvidence !== undefined && !fieldEvidence) return undefined
  return {
    entryTime,
    fieldEvidence: fieldEvidence ?? undefined,
    previewMediaAssetId,
    schemaVersion: TRAVEL_OBJECT_SCHEMA_VERSION,
    serviceDate,
    status,
  }
}

export function validateLodgingReservationV1(input: unknown): LodgingReservationV1 | null {
  const record = readRecord(input)
  if (!hasOnlyFields(record, LODGING_FIELDS) || record.schemaVersion !== TRAVEL_OBJECT_SCHEMA_VERSION) return null
  const id = readControlledId(record.id)
  const tripId = readControlledId(record.tripId)
  const itemId = readOptionalControlledId(record.itemId)
  const ticketId = readOptionalControlledId(record.ticketId)
  const mediaAssetId = readOptionalControlledId(record.mediaAssetId, MEDIA_ID)
  const name = readText(record.name, 180)
  const address = readOptionalText(record.address, 400)
  const checkInDate = readPlainDate(record.checkInDate)
  const checkOutDate = readPlainDate(record.checkOutDate)
  const checkInTime = readOptionalTime(record.checkInTime)
  const checkOutTime = readOptionalTime(record.checkOutTime)
  const nightCount = Number(record.nightCount)
  const confirmationNumber = readOptionalText(record.confirmationNumber, 120)
  const status = isOneOf(record.status, ['draft', 'confirmed', 'changed', 'cancelled', 'completed'] as const)
  const source = readEvidence(record.source)
  if (
    !id || !tripId || !name || !checkInDate || !checkOutDate || checkOutDate <= checkInDate
    || !Number.isInteger(nightCount) || nightCount < 1 || nightCount > 365
    || !status || !source
    || (record.itemId !== undefined && !itemId)
    || (record.ticketId !== undefined && !ticketId)
    || (record.mediaAssetId !== undefined && !mediaAssetId)
    || (record.address !== undefined && !address)
    || (record.checkInTime !== undefined && !checkInTime)
    || (record.checkOutTime !== undefined && !checkOutTime)
    || (record.confirmationNumber !== undefined && !confirmationNumber)
  ) return null
  return {
    address,
    checkInDate,
    checkInTime,
    checkOutDate,
    checkOutTime,
    confirmationNumber,
    id,
    itemId,
    mediaAssetId,
    name,
    nightCount,
    schemaVersion: TRAVEL_OBJECT_SCHEMA_VERSION,
    source,
    status,
    ticketId,
    tripId,
  }
}

export function validateInsurancePolicyV1(input: unknown): InsurancePolicyV1 | null {
  const record = readRecord(input)
  if (!hasOnlyFields(record, INSURANCE_FIELDS) || record.schemaVersion !== TRAVEL_OBJECT_SCHEMA_VERSION) return null
  const id = readControlledId(record.id)
  const tripId = readControlledId(record.tripId)
  const ticketId = readOptionalControlledId(record.ticketId)
  const providerName = readText(record.providerName, 180)
  const providerCode = readOptionalControlledId(record.providerCode)
  const productName = readOptionalText(record.productName, 180)
  const policyNumber = readOptionalText(record.policyNumber, 120)
  const effectiveFrom = readIsoDate(record.effectiveFrom)
  const effectiveTo = readIsoDate(record.effectiveTo)
  const status = isOneOf(record.status, ['draft', 'active', 'expired', 'cancelled'] as const)
  const source = readEvidence(record.source)
  if (
    !id || !tripId || !providerName || !effectiveFrom || !effectiveTo
    || Date.parse(effectiveTo) <= Date.parse(effectiveFrom) || !status || !source
    || (record.ticketId !== undefined && !ticketId)
    || (record.providerCode !== undefined && !providerCode)
    || (record.productName !== undefined && !productName)
    || (record.policyNumber !== undefined && !policyNumber)
  ) return null
  return {
    effectiveFrom,
    effectiveTo,
    id,
    policyNumber,
    productName,
    providerCode,
    providerName,
    schemaVersion: TRAVEL_OBJECT_SCHEMA_VERSION,
    source,
    status,
    ticketId,
    tripId,
  }
}

function readTicketFieldEvidence(input: unknown): TicketStructuredFieldsV1['fieldEvidence'] | null | undefined {
  if (input === undefined) return undefined
  const record = readRecord(input)
  const result: TicketStructuredFieldsV1['fieldEvidence'] = {}
  for (const [key, value] of Object.entries(record)) {
    if (!TICKET_FIELD_KEYS.has(key as TicketStructuredFieldKey)) return null
    const evidence = readEvidence(value)
    if (!evidence) return null
    result[key as TicketStructuredFieldKey] = evidence
  }
  return result
}

function readEvidence(input: unknown): StructuredTravelFieldEvidence | null {
  const record = readRecord(input)
  if (!hasOnlyFields(record, EVIDENCE_FIELDS)) return null
  const sourceType = typeof record.sourceType === 'string' && SOURCE_TYPES.has(record.sourceType as StructuredTravelFieldSourceType)
    ? record.sourceType as StructuredTravelFieldSourceType
    : null
  const confidence = typeof record.confidence === 'string' && CONFIDENCE_VALUES.has(record.confidence as StructuredTravelFieldConfidence)
    ? record.confidence as StructuredTravelFieldConfidence
    : null
  const sourceId = readOptionalControlledId(record.sourceId)
  const observedAt = readOptionalIsoDate(record.observedAt)
  if (
    !sourceType || !confidence
    || (record.sourceId !== undefined && !sourceId)
    || (record.observedAt !== undefined && !observedAt)
  ) return null
  return { confidence, observedAt, sourceId, sourceType }
}

function isOneOf<const T extends readonly string[]>(value: unknown, values: T): T[number] | null {
  return typeof value === 'string' && values.includes(value) ? value as T[number] : null
}

function readControlledId(input: unknown) {
  return typeof input === 'string' && CONTROLLED_ID.test(input) ? input : ''
}

function readOptionalControlledId(input: unknown, pattern = CONTROLLED_ID) {
  if (input === undefined) return undefined
  return typeof input === 'string' && pattern.test(input) ? input : undefined
}

function readText(input: unknown, maxLength: number) {
  if (typeof input !== 'string') return ''
  const value = input.trim()
  return value && value.length <= maxLength ? value : ''
}

function readOptionalText(input: unknown, maxLength: number) {
  if (input === undefined) return undefined
  return readText(input, maxLength) || undefined
}

function readPlainDate(input: unknown) {
  return typeof input === 'string' && isValidPlainDate(input) ? input : ''
}

function readOptionalPlainDate(input: unknown) {
  if (input === undefined) return undefined
  return readPlainDate(input) || undefined
}

function readOptionalTime(input: unknown) {
  if (input === undefined) return undefined
  return typeof input === 'string' && TIME.test(input) ? input : undefined
}

function readIsoDate(input: unknown) {
  if (typeof input !== 'string' || !Number.isFinite(Date.parse(input))) return ''
  return new Date(input).toISOString()
}

function readOptionalIsoDate(input: unknown) {
  if (input === undefined) return undefined
  return readIsoDate(input) || undefined
}

function hasOnlyFields(record: Record<string, unknown>, allowed: Set<string>) {
  return Object.keys(record).every((field) => allowed.has(field))
}

function readRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
}
