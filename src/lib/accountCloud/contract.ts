export const ACCOUNT_CLOUD_SCHEMA_VERSION = 1 as const
export const ACCOUNT_OBJECT_MAX_PAYLOAD_BYTES = 512 * 1024

export const ACCOUNT_OBJECT_TYPES = [
  'trip',
  'day',
  'item',
  'ticket_meta',
  'document_index',
  'document_trip_link',
  'transport_booking',
  'transport_segment',
  'lodging',
  'insurance',
  'media_asset',
  'realtime_fact',
  'ledger_settings',
  'ledger_participant',
  'ledger_budget',
  'ledger_expense',
  'trip_intelligence_applied_change',
  'trip_intelligence_suggestion_state',
  'shared_task',
  'ai_job',
  'replan_event',
  'replan_record',
] as const

export type AccountObjectType = typeof ACCOUNT_OBJECT_TYPES[number]
export type ServerManagedAccountObjectType = 'ai_job' | 'media_asset' | 'realtime_fact'
export type ClientMutableAccountObjectType = Exclude<AccountObjectType, ServerManagedAccountObjectType>
export type AccountObjectAuthority = 'client_mutable' | 'server_managed'
export type AccountObjectPrivacy = 'account' | 'redacted_metadata'

export type AccountObjectDefinition = {
  authority: AccountObjectAuthority
  payloadContract: string
  privacy: AccountObjectPrivacy
}

export const ACCOUNT_OBJECT_DEFINITIONS = {
  ai_job: definition('server_managed', 'AiJobV1', 'redacted_metadata'),
  day: definition('client_mutable', 'DayV1', 'account'),
  document_index: definition('client_mutable', 'RedactedDocumentIndexV1', 'redacted_metadata'),
  document_trip_link: definition('client_mutable', 'DocumentTripLinkV1', 'redacted_metadata'),
  insurance: definition('client_mutable', 'InsurancePolicyV1', 'redacted_metadata'),
  item: definition('client_mutable', 'ItineraryItemV1', 'account'),
  ledger_budget: definition('client_mutable', 'LedgerBudgetV1', 'account'),
  ledger_expense: definition('client_mutable', 'LedgerExpenseV1', 'account'),
  ledger_participant: definition('client_mutable', 'LedgerParticipantV1', 'account'),
  ledger_settings: definition('client_mutable', 'LedgerSettingsV1', 'account'),
  lodging: definition('client_mutable', 'LodgingReservationV1', 'redacted_metadata'),
  media_asset: definition('server_managed', 'TravelMediaAssetV1', 'redacted_metadata'),
  realtime_fact: definition('server_managed', 'RealtimeFactV1', 'redacted_metadata'),
  replan_event: definition('client_mutable', 'TripDisruptionEventV1', 'account'),
  replan_record: definition('client_mutable', 'TripReplanRecordV1', 'account'),
  shared_task: definition('client_mutable', 'SharedTaskV1', 'account'),
  ticket_meta: definition('client_mutable', 'TicketMetaV1', 'redacted_metadata'),
  transport_booking: definition('client_mutable', 'TransportBookingV1', 'redacted_metadata'),
  transport_segment: definition('client_mutable', 'TransportSegmentV1', 'redacted_metadata'),
  trip: definition('client_mutable', 'TripV1', 'account'),
  trip_intelligence_applied_change: definition(
    'client_mutable',
    'TripIntelligenceAppliedChangeV1',
    'redacted_metadata',
  ),
  trip_intelligence_suggestion_state: definition(
    'client_mutable',
    'TripIntelligenceSuggestionStateV1',
    'redacted_metadata',
  ),
} satisfies Record<AccountObjectType, AccountObjectDefinition>

export type JsonPrimitive = boolean | null | number | string
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export type JsonObject = { [key: string]: JsonValue }

export type AccountObjectMutationOperation = 'delete' | 'upsert'

export type AccountObjectMutationV1 = {
  schemaVersion: typeof ACCOUNT_CLOUD_SCHEMA_VERSION
  mutationId: string
  tripId: string
  objectType: AccountObjectType
  objectId: string
  operation: AccountObjectMutationOperation
  expectedRevision: number
  objectSchemaVersion: number
  deviceId: string
  payload?: JsonObject
}

export type AccountObjectRowV1 = {
  schemaVersion: typeof ACCOUNT_CLOUD_SCHEMA_VERSION
  tripId: string
  objectType: AccountObjectType
  objectId: string
  payload: JsonObject | null
  objectSchemaVersion: number
  revision: number
  mutationId: string
  actorId: string
  deviceId: string
  tombstone: boolean
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

export type AccountObjectMutationResultV1 =
  | {
      schemaVersion: typeof ACCOUNT_CLOUD_SCHEMA_VERSION
      status: 'applied' | 'idempotent'
      mutationId: string
      appliedRevision: number
      currentRevision: number
      object: AccountObjectRowV1
    }
  | {
      schemaVersion: typeof ACCOUNT_CLOUD_SCHEMA_VERSION
      status: 'conflict'
      mutationId: string
      reason: 'revision_mismatch'
      currentRevision: number
      currentObject: AccountObjectRowV1 | null
    }
  | {
      schemaVersion: typeof ACCOUNT_CLOUD_SCHEMA_VERSION
      status: 'rejected'
      mutationId: string
      reason: AccountObjectMutationRejection
    }

export type AccountObjectMutationRejection =
  | 'delete_payload_not_allowed'
  | 'invalid_identifier_or_operation'
  | 'invalid_or_sensitive_payload'
  | 'invalid_version_or_revision'
  | 'mutation_id_reused'
  | 'object_trip_mismatch'
  | 'receipt_object_missing'
  | 'server_managed_object'
  | 'unknown_object_type'

export type AccountCloudContractErrorCode =
  | 'invalid_envelope'
  | 'invalid_identifier'
  | 'invalid_payload'
  | 'invalid_response'
  | 'sensitive_payload'
  | 'server_managed_object'
  | 'unknown_field'
  | 'unknown_object_type'

export class AccountCloudContractError extends Error {
  readonly code: AccountCloudContractErrorCode

  constructor(code: AccountCloudContractErrorCode, message: string) {
    super(message)
    this.name = 'AccountCloudContractError'
    this.code = code
  }
}

const OBJECT_TYPE_SET = new Set<string>(ACCOUNT_OBJECT_TYPES)
const MUTATION_FIELDS = new Set([
  'schemaVersion',
  'mutationId',
  'tripId',
  'objectType',
  'objectId',
  'operation',
  'expectedRevision',
  'objectSchemaVersion',
  'deviceId',
  'payload',
])
const ROW_FIELDS = new Set([
  'schemaVersion',
  'tripId',
  'objectType',
  'objectId',
  'payload',
  'objectSchemaVersion',
  'revision',
  'mutationId',
  'actorId',
  'deviceId',
  'tombstone',
  'deletedAt',
  'createdAt',
  'updatedAt',
])
const APPLIED_RESULT_FIELDS = new Set([
  'schemaVersion',
  'status',
  'mutationId',
  'appliedRevision',
  'currentRevision',
  'object',
])
const CONFLICT_RESULT_FIELDS = new Set([
  'schemaVersion',
  'status',
  'mutationId',
  'reason',
  'currentRevision',
  'currentObject',
])
const REJECTED_RESULT_FIELDS = new Set(['schemaVersion', 'status', 'mutationId', 'reason'])
const REJECTION_SET = new Set<AccountObjectMutationRejection>([
  'delete_payload_not_allowed',
  'invalid_identifier_or_operation',
  'invalid_or_sensitive_payload',
  'invalid_version_or_revision',
  'mutation_id_reused',
  'object_trip_mismatch',
  'receipt_object_missing',
  'server_managed_object',
  'unknown_object_type',
])
const CONTROLLED_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/
const CONTROLLED_DEVICE_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_JSON_DEPTH = 32
const MAX_JSON_NODES = 20_000
const ENVELOPE_OWNED_PAYLOAD_FIELDS = new Set([
  'owner_id',
  'ownerId',
  'actor_id',
  'actorId',
  'mutation_id',
  'mutationId',
  'revision',
  'tombstone',
  'deleted_at',
  'deletedAt',
])
const FORBIDDEN_PAYLOAD_KEYS = new Set([
  'password',
  'passcode',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'bearer',
  'secret',
  'providerkey',
  'apikey',
  'blob',
  'fileblob',
  'rawproviderpayload',
  'providerpayload',
  'ocrtext',
  'documentbody',
  'passportnumber',
  'visanumber',
])

export function parseAccountObjectMutationV1(input: unknown): AccountObjectMutationV1 {
  const record = readRecord(input, 'invalid_envelope')
  assertOnlyFields(record, MUTATION_FIELDS)
  if (record.schemaVersion !== ACCOUNT_CLOUD_SCHEMA_VERSION) {
    fail('invalid_envelope', 'Unsupported account-cloud schema version.')
  }

  const mutationId = readControlledId(record.mutationId, CONTROLLED_ID)
  const tripId = readControlledId(record.tripId, CONTROLLED_ID)
  const objectId = readControlledId(record.objectId, CONTROLLED_ID)
  const deviceId = readControlledId(record.deviceId, CONTROLLED_DEVICE_ID)
  const objectType = readObjectType(record.objectType)
  const definitionForType = ACCOUNT_OBJECT_DEFINITIONS[objectType]
  if (definitionForType.authority !== 'client_mutable') {
    fail('server_managed_object', `Object type ${objectType} is server managed.`)
  }

  const operation = record.operation
  if (operation !== 'upsert' && operation !== 'delete') {
    fail('invalid_envelope', 'Unsupported account-cloud mutation operation.')
  }
  const expectedRevision = readBoundedInteger(record.expectedRevision, 0, Number.MAX_SAFE_INTEGER)
  const objectSchemaVersion = readBoundedInteger(record.objectSchemaVersion, 1, 32)

  if (operation === 'delete') {
    if (record.payload !== undefined) {
      fail('invalid_payload', 'Delete mutations cannot include a payload.')
    }
    return {
      deviceId,
      expectedRevision,
      mutationId,
      objectId,
      objectSchemaVersion,
      objectType,
      operation,
      schemaVersion: ACCOUNT_CLOUD_SCHEMA_VERSION,
      tripId,
    }
  }

  const payload = readJsonObject(record.payload)
  assertPayloadIdentity(payload, { objectId, objectType, tripId })
  const canonicalPayload = assertPayloadBoundary(payload)
  return {
    deviceId,
    expectedRevision,
    mutationId,
    objectId,
    objectSchemaVersion,
    objectType,
    operation,
    payload: canonicalPayload,
    schemaVersion: ACCOUNT_CLOUD_SCHEMA_VERSION,
    tripId,
  }
}

export function parseAccountObjectRowV1(input: unknown): AccountObjectRowV1 {
  const record = readRecord(input, 'invalid_response')
  assertOnlyFields(record, ROW_FIELDS, 'invalid_response')
  if (record.schemaVersion !== ACCOUNT_CLOUD_SCHEMA_VERSION) {
    fail('invalid_response', 'Unsupported account-object response version.')
  }
  const objectType = readObjectType(record.objectType, 'invalid_response')
  const tombstone = readBoolean(record.tombstone)
  const rawPayload = record.payload === null ? null : readJsonObject(record.payload, 'invalid_response')
  const deletedAt = readNullableIsoDate(record.deletedAt)
  if (tombstone ? rawPayload !== null || deletedAt === null : rawPayload === null || deletedAt !== null) {
    fail('invalid_response', 'Account-object tombstone fields are inconsistent.')
  }
  const objectId = readControlledId(record.objectId, CONTROLLED_ID, 'invalid_response')
  const tripId = readControlledId(record.tripId, CONTROLLED_ID, 'invalid_response')
  let payload: JsonObject | null = null
  if (rawPayload) {
    assertPayloadIdentity(rawPayload, { objectId, objectType, tripId }, 'invalid_response')
    payload = assertPayloadBoundary(rawPayload, 'invalid_response')
  }
  return {
    actorId: readControlledId(record.actorId, UUID, 'invalid_response'),
    createdAt: readIsoDate(record.createdAt),
    deletedAt,
    deviceId: readControlledId(record.deviceId, CONTROLLED_DEVICE_ID, 'invalid_response'),
    mutationId: readControlledId(record.mutationId, CONTROLLED_ID, 'invalid_response'),
    objectId,
    objectSchemaVersion: readBoundedInteger(record.objectSchemaVersion, 1, 32, 'invalid_response'),
    objectType,
    payload,
    revision: readBoundedInteger(record.revision, 1, Number.MAX_SAFE_INTEGER, 'invalid_response'),
    schemaVersion: ACCOUNT_CLOUD_SCHEMA_VERSION,
    tombstone,
    tripId,
    updatedAt: readIsoDate(record.updatedAt),
  }
}

export function parseAccountObjectMutationResultV1(input: unknown): AccountObjectMutationResultV1 {
  const record = readRecord(input, 'invalid_response')
  if (record.schemaVersion !== ACCOUNT_CLOUD_SCHEMA_VERSION || typeof record.status !== 'string') {
    fail('invalid_response', 'Account-cloud RPC returned an invalid envelope.')
  }
  const mutationId = readControlledId(record.mutationId, CONTROLLED_ID, 'invalid_response')

  if (record.status === 'applied' || record.status === 'idempotent') {
    assertOnlyFields(record, APPLIED_RESULT_FIELDS, 'invalid_response')
    return {
      appliedRevision: readBoundedInteger(record.appliedRevision, 1, Number.MAX_SAFE_INTEGER, 'invalid_response'),
      currentRevision: readBoundedInteger(record.currentRevision, 1, Number.MAX_SAFE_INTEGER, 'invalid_response'),
      mutationId,
      object: parseAccountObjectRowV1(record.object),
      schemaVersion: ACCOUNT_CLOUD_SCHEMA_VERSION,
      status: record.status,
    }
  }

  if (record.status === 'conflict') {
    assertOnlyFields(record, CONFLICT_RESULT_FIELDS, 'invalid_response')
    if (record.reason !== 'revision_mismatch') {
      fail('invalid_response', 'Account-cloud RPC returned an unknown conflict reason.')
    }
    const currentRevision = readBoundedInteger(record.currentRevision, 0, Number.MAX_SAFE_INTEGER, 'invalid_response')
    const currentObject = record.currentObject === null ? null : parseAccountObjectRowV1(record.currentObject)
    if ((currentRevision === 0) !== (currentObject === null)) {
      fail('invalid_response', 'Account-cloud conflict state is inconsistent.')
    }
    return {
      currentObject,
      currentRevision,
      mutationId,
      reason: 'revision_mismatch',
      schemaVersion: ACCOUNT_CLOUD_SCHEMA_VERSION,
      status: 'conflict',
    }
  }

  if (record.status === 'rejected') {
    assertOnlyFields(record, REJECTED_RESULT_FIELDS, 'invalid_response')
    if (typeof record.reason !== 'string' || !REJECTION_SET.has(record.reason as AccountObjectMutationRejection)) {
      fail('invalid_response', 'Account-cloud RPC returned an unknown rejection reason.')
    }
    return {
      mutationId,
      reason: record.reason as AccountObjectMutationRejection,
      schemaVersion: ACCOUNT_CLOUD_SCHEMA_VERSION,
      status: 'rejected',
    }
  }

  fail('invalid_response', 'Account-cloud RPC returned an unknown status.')
}

function definition(
  authority: AccountObjectAuthority,
  payloadContract: string,
  privacy: AccountObjectPrivacy,
): AccountObjectDefinition {
  return { authority, payloadContract, privacy }
}

function readObjectType(
  input: unknown,
  code: AccountCloudContractErrorCode = 'unknown_object_type',
): AccountObjectType {
  if (typeof input !== 'string' || !OBJECT_TYPE_SET.has(input)) {
    fail(code, 'Unknown account object type.')
  }
  return input as AccountObjectType
}

function assertPayloadIdentity(
  payload: JsonObject,
  identity: Pick<AccountObjectMutationV1, 'objectId' | 'objectType' | 'tripId'>,
  code: AccountCloudContractErrorCode = 'invalid_payload',
) {
  if (payload.id !== identity.objectId) {
    fail(code, 'Payload object identity does not match the mutation target.')
  }
  if (identity.objectType === 'trip') {
    if (identity.tripId !== identity.objectId) {
      fail(code, 'Trip mutations must use the trip ID as the object ID.')
    }
    return
  }
  if (payload.tripId !== identity.tripId) {
    fail(code, 'Payload trip identity does not match the mutation target.')
  }
}

function assertPayloadBoundary(
  payload: JsonObject,
  code: AccountCloudContractErrorCode = 'sensitive_payload',
) {
  for (const key of Object.keys(payload)) {
    if (ENVELOPE_OWNED_PAYLOAD_FIELDS.has(key)) {
      fail(code, `Payload cannot set envelope field ${key}.`)
    }
  }

  const state = { nodes: 0 }
  validateJsonValue(payload, new WeakSet<object>(), state, 0, code)
  const serialized = JSON.stringify(payload)
  if (new TextEncoder().encode(serialized).byteLength > ACCOUNT_OBJECT_MAX_PAYLOAD_BYTES) {
    fail('invalid_payload', 'Account-object payload exceeds the size limit.')
  }
  return JSON.parse(serialized) as JsonObject
}

function validateJsonValue(
  value: JsonValue,
  ancestors: WeakSet<object>,
  state: { nodes: number },
  depth: number,
  code: AccountCloudContractErrorCode,
) {
  state.nodes += 1
  if (state.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) {
    fail('invalid_payload', 'Account-object payload is too complex.')
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('invalid_payload', 'Account-object payload contains a non-finite number.')
    return
  }
  if (typeof value !== 'object') {
    fail('invalid_payload', 'Account-object payload must contain JSON values only.')
  }
  if (ancestors.has(value)) {
    fail('invalid_payload', 'Account-object payload cannot be cyclic.')
  }
  ancestors.add(value)
  if (Array.isArray(value)) {
    for (const entry of value) validateJsonValue(entry, ancestors, state, depth + 1, code)
  } else {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      fail('invalid_payload', 'Account-object payload must be plain JSON.')
    }
    for (const [key, entry] of Object.entries(value)) {
      if (key.length === 0 || key.length > 160) {
        fail('invalid_payload', 'Account-object payload contains an invalid key.')
      }
      if (FORBIDDEN_PAYLOAD_KEYS.has(normalizeKey(key))) {
        fail(code, `Payload contains forbidden field ${key}.`)
      }
      validateJsonValue(entry, ancestors, state, depth + 1, code)
    }
  }
  ancestors.delete(value)
}

function normalizeKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function readJsonObject(
  input: unknown,
  code: AccountCloudContractErrorCode = 'invalid_payload',
): JsonObject {
  const record = readRecord(input, code)
  return record as JsonObject
}

function readRecord(
  input: unknown,
  code: AccountCloudContractErrorCode,
): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail(code, 'Expected an object.')
  }
  return input as Record<string, unknown>
}

function assertOnlyFields(
  record: Record<string, unknown>,
  allowed: Set<string>,
  code: AccountCloudContractErrorCode = 'unknown_field',
) {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) fail(code, `Unknown account-cloud field ${key}.`)
  }
}

function readControlledId(
  input: unknown,
  pattern: RegExp,
  code: AccountCloudContractErrorCode = 'invalid_identifier',
) {
  if (typeof input !== 'string' || !pattern.test(input)) {
    fail(code, 'Invalid account-cloud identifier.')
  }
  return input
}

function readBoundedInteger(
  input: unknown,
  minimum: number,
  maximum: number,
  code: AccountCloudContractErrorCode = 'invalid_envelope',
) {
  if (!Number.isSafeInteger(input) || (input as number) < minimum || (input as number) > maximum) {
    fail(code, 'Invalid account-cloud integer.')
  }
  return input as number
}

function readBoolean(input: unknown) {
  if (typeof input !== 'boolean') fail('invalid_response', 'Invalid account-cloud boolean.')
  return input
}

function readIsoDate(input: unknown) {
  if (typeof input !== 'string' || !Number.isFinite(Date.parse(input))) {
    fail('invalid_response', 'Invalid account-cloud timestamp.')
  }
  return input
}

function readNullableIsoDate(input: unknown) {
  if (input === null) return null
  return readIsoDate(input)
}

function fail(code: AccountCloudContractErrorCode, message: string): never {
  throw new AccountCloudContractError(code, message)
}
