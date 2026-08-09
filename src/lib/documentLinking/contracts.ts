export const TRAVEL_DOCUMENT_LINK_SCHEMA_VERSION = 1 as const

export type TravelDocumentLinkSubjectType =
  | 'booking'
  | 'day'
  | 'insurance'
  | 'item'
  | 'lodging'
  | 'trip'

export type TravelDocumentLinkStatus = 'confirmed' | 'conflict' | 'suggested'

export type TravelDocumentLinkEvidence =
  | 'category_match'
  | 'date_match'
  | 'existing_reference'
  | 'explicit_instruction'
  | 'text_match'
  | 'time_match'

export type TravelDocumentLinkV1 = {
  confidence: number
  createdAt: number
  evidence: TravelDocumentLinkEvidence[]
  id: string
  reason: string
  schemaVersion: typeof TRAVEL_DOCUMENT_LINK_SCHEMA_VERSION
  status: TravelDocumentLinkStatus
  subjectId: string
  subjectType: TravelDocumentLinkSubjectType
  ticketId: string
  tripId: string
  updatedAt: number
}

const LINK_FIELDS = new Set([
  'confidence',
  'createdAt',
  'evidence',
  'id',
  'reason',
  'schemaVersion',
  'status',
  'subjectId',
  'subjectType',
  'ticketId',
  'tripId',
  'updatedAt',
])
const SUBJECT_TYPES = new Set<TravelDocumentLinkSubjectType>([
  'booking',
  'day',
  'insurance',
  'item',
  'lodging',
  'trip',
])
const STATUSES = new Set<TravelDocumentLinkStatus>(['confirmed', 'conflict', 'suggested'])
const EVIDENCE = new Set<TravelDocumentLinkEvidence>([
  'category_match',
  'date_match',
  'existing_reference',
  'explicit_instruction',
  'text_match',
  'time_match',
])
const CONTROLLED_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/

export function validateTravelDocumentLinkV1(input: unknown): TravelDocumentLinkV1 | null {
  const record = readRecord(input)
  if (
    Object.keys(record).some((field) => !LINK_FIELDS.has(field))
    || record.schemaVersion !== TRAVEL_DOCUMENT_LINK_SCHEMA_VERSION
  ) return null

  const id = readId(record.id)
  const tripId = readId(record.tripId)
  const ticketId = readId(record.ticketId)
  const subjectId = readId(record.subjectId)
  const subjectType = typeof record.subjectType === 'string'
    && SUBJECT_TYPES.has(record.subjectType as TravelDocumentLinkSubjectType)
    ? record.subjectType as TravelDocumentLinkSubjectType
    : null
  const status = typeof record.status === 'string'
    && STATUSES.has(record.status as TravelDocumentLinkStatus)
    ? record.status as TravelDocumentLinkStatus
    : null
  const confidence = Number(record.confidence)
  const reason = readText(record.reason, 180)
  const evidence = readEvidence(record.evidence)
  const createdAt = readTimestamp(record.createdAt)
  const updatedAt = readTimestamp(record.updatedAt)
  if (
    !id || !tripId || !ticketId || !subjectId || !subjectType || !status
    || !Number.isFinite(confidence) || confidence < 0 || confidence > 1
    || !reason || !evidence || evidence.length === 0
    || createdAt === null || updatedAt === null || updatedAt < createdAt
  ) return null

  return {
    confidence,
    createdAt,
    evidence,
    id,
    reason,
    schemaVersion: TRAVEL_DOCUMENT_LINK_SCHEMA_VERSION,
    status,
    subjectId,
    subjectType,
    ticketId,
    tripId,
    updatedAt,
  }
}

function readRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
}

function readId(input: unknown) {
  return typeof input === 'string' && CONTROLLED_ID.test(input) ? input : ''
}

function readText(input: unknown, maximum: number) {
  if (typeof input !== 'string') return ''
  const value = input.trim()
  return value && value.length <= maximum ? value : ''
}

function readEvidence(input: unknown): TravelDocumentLinkEvidence[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > EVIDENCE.size) return null
  const values = input.filter((value): value is TravelDocumentLinkEvidence =>
    typeof value === 'string' && EVIDENCE.has(value as TravelDocumentLinkEvidence),
  )
  if (values.length !== input.length || new Set(values).size !== values.length) return null
  return values
}

function readTimestamp(input: unknown) {
  return typeof input === 'number' && Number.isSafeInteger(input) && input >= 0
    ? input
    : null
}
