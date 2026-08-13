import {
  ACCOUNT_CLOUD_SCHEMA_VERSION,
  parseAccountObjectMutationV1,
  parseAccountObjectRowV1,
  type AccountObjectMutationOperation,
  type AccountObjectRowV1,
  type ClientMutableAccountObjectType,
  type JsonObject,
  type JsonValue,
} from './contract'

export const ACCOUNT_WORKFLOW_SCHEMA_VERSION = 1 as const
export const ACCOUNT_WORKFLOW_MAX_STEPS = 256
export const ACCOUNT_WORKFLOW_MAX_BYTES = 4 * 1024 * 1024

export const ACCOUNT_WORKFLOW_IDS = [
  'day.items.reorder@1',
  'item.move@1',
  'trip.import.commit@1',
  'ticket.bind@1',
  'ledger.batch@1',
  'trip.replan.apply@1',
  'trip.repair.apply@1',
] as const

export type AccountWorkflowId = typeof ACCOUNT_WORKFLOW_IDS[number]

export type AccountWorkflowDefinition = {
  allowedObjectTypes: readonly ClientMutableAccountObjectType[]
  allowedOperations: readonly AccountObjectMutationOperation[]
  maxSteps: number
  minSteps: number
}

export const ACCOUNT_WORKFLOW_DEFINITIONS = {
  'day.items.reorder@1': workflow(['item'], ['upsert'], 2, 128),
  'item.move@1': workflow(['item'], ['upsert'], 1, 128),
  'trip.import.commit@1': workflow([
    'trip',
    'day',
    'item',
    'ticket_meta',
    'ledger_settings',
    'ledger_participant',
    'ledger_budget',
    'ledger_expense',
  ], ['upsert'], 1, 256),
  'ticket.bind@1': workflow(['ticket_meta', 'item'], ['upsert'], 2, 33),
  'ledger.batch@1': workflow([
    'ledger_settings',
    'ledger_participant',
    'ledger_budget',
    'ledger_expense',
  ], ['upsert', 'delete'], 1, 128),
  'trip.replan.apply@1': workflow([
    'day',
    'item',
    'replan_event',
    'replan_record',
    'trip_intelligence_applied_change',
    'trip_intelligence_suggestion_state',
  ], ['upsert'], 1, 128),
  'trip.repair.apply@1': workflow([
    'item',
    'replan_event',
    'replan_record',
    'trip_intelligence_applied_change',
    'trip_intelligence_suggestion_state',
  ], ['upsert'], 1, 128),
} as const satisfies Record<AccountWorkflowId, AccountWorkflowDefinition>

export type AccountWorkflowStepV1 = {
  stepId: string
  mutationId: string
  objectType: ClientMutableAccountObjectType
  objectId: string
  operation: AccountObjectMutationOperation
  expectedRevision: number
  objectSchemaVersion: number
  payload?: JsonObject
}

export type AccountWorkflowRequestV1 = {
  schemaVersion: typeof ACCOUNT_WORKFLOW_SCHEMA_VERSION
  batchMutationId: string
  workflowId: AccountWorkflowId
  tripId: string
  deviceId: string
  steps: AccountWorkflowStepV1[]
}

export type AccountWorkflowAppliedStepV1 = {
  stepId: string
  mutationId: string
  appliedRevision: number
  currentRevision: number
  object: AccountObjectRowV1
}

export type AccountWorkflowConflictV1 = {
  stepId: string
  mutationId: string
  objectType: ClientMutableAccountObjectType
  objectId: string
  currentRevision: number
  currentObject: AccountObjectRowV1 | null
}

export type AccountWorkflowRejection =
  | 'account_context_mismatch'
  | 'batch_mutation_id_reused'
  | 'invalid_envelope'
  | 'invalid_identifier'
  | 'invalid_or_sensitive_payload'
  | 'invalid_version_or_revision'
  | 'mutation_id_reused'
  | 'object_trip_mismatch'
  | 'server_managed_object'
  | 'unknown_object_type'
  | 'unknown_workflow'
  | 'workflow_shape_invalid'

export type AccountWorkflowRunResultV1 =
  | {
      schemaVersion: typeof ACCOUNT_WORKFLOW_SCHEMA_VERSION
      status: 'applied' | 'idempotent'
      batchMutationId: string
      workflowId: AccountWorkflowId
      tripId: string
      steps: AccountWorkflowAppliedStepV1[]
    }
  | {
      schemaVersion: typeof ACCOUNT_WORKFLOW_SCHEMA_VERSION
      status: 'conflict'
      batchMutationId: string
      workflowId: AccountWorkflowId
      tripId: string
      reason: 'receipt_advanced' | 'revision_mismatch'
      conflicts: AccountWorkflowConflictV1[]
    }
  | {
      schemaVersion: typeof ACCOUNT_WORKFLOW_SCHEMA_VERSION
      status: 'rejected'
      batchMutationId: string
      workflowId: AccountWorkflowId
      tripId: string
      reason: AccountWorkflowRejection
    }

export type AccountWorkflowContractErrorCode =
  | 'invalid_envelope'
  | 'invalid_response'
  | 'unknown_field'
  | 'unknown_workflow'
  | 'workflow_shape_invalid'

export class AccountWorkflowContractError extends Error {
  readonly code: AccountWorkflowContractErrorCode

  constructor(code: AccountWorkflowContractErrorCode) {
    super(code)
    this.name = 'AccountWorkflowContractError'
    this.code = code
  }
}

const REQUEST_FIELDS = new Set([
  'schemaVersion',
  'batchMutationId',
  'workflowId',
  'tripId',
  'deviceId',
  'steps',
])
const STEP_FIELDS = new Set([
  'stepId',
  'mutationId',
  'objectType',
  'objectId',
  'operation',
  'expectedRevision',
  'objectSchemaVersion',
  'payload',
])
const RESULT_BASE_FIELDS = [
  'schemaVersion',
  'status',
  'batchMutationId',
  'workflowId',
  'tripId',
] as const
const SUCCESS_RESULT_FIELDS = new Set([...RESULT_BASE_FIELDS, 'steps'])
const CONFLICT_RESULT_FIELDS = new Set([...RESULT_BASE_FIELDS, 'reason', 'conflicts'])
const REJECTED_RESULT_FIELDS = new Set([...RESULT_BASE_FIELDS, 'reason'])
const APPLIED_STEP_FIELDS = new Set([
  'stepId',
  'mutationId',
  'appliedRevision',
  'currentRevision',
  'object',
])
const CONFLICT_FIELDS = new Set([
  'stepId',
  'mutationId',
  'objectType',
  'objectId',
  'currentRevision',
  'currentObject',
])
const WORKFLOW_ID_SET = new Set<string>(ACCOUNT_WORKFLOW_IDS)
const REJECTION_SET = new Set<AccountWorkflowRejection>([
  'account_context_mismatch',
  'batch_mutation_id_reused',
  'invalid_envelope',
  'invalid_identifier',
  'invalid_or_sensitive_payload',
  'invalid_version_or_revision',
  'mutation_id_reused',
  'object_trip_mismatch',
  'server_managed_object',
  'unknown_object_type',
  'unknown_workflow',
  'workflow_shape_invalid',
])
const CONTROLLED_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/
const CONTROLLED_DEVICE_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function parseAccountWorkflowRequestV1(input: unknown): AccountWorkflowRequestV1 {
  const record = readRecord(input, 'invalid_envelope')
  assertOnlyFields(record, REQUEST_FIELDS)
  if (record.schemaVersion !== ACCOUNT_WORKFLOW_SCHEMA_VERSION) fail('invalid_envelope')

  const workflowId = readWorkflowId(record.workflowId)
  const batchMutationId = readString(record.batchMutationId, UUID, 'invalid_envelope')
  const tripId = readString(record.tripId, CONTROLLED_ID, 'invalid_envelope')
  const deviceId = readString(record.deviceId, CONTROLLED_DEVICE_ID, 'invalid_envelope')
  if (!Array.isArray(record.steps)) fail('invalid_envelope')
  const definition = ACCOUNT_WORKFLOW_DEFINITIONS[workflowId]
  if (
    record.steps.length < definition.minSteps
    || record.steps.length > definition.maxSteps
    || record.steps.length > ACCOUNT_WORKFLOW_MAX_STEPS
  ) {
    fail('workflow_shape_invalid')
  }

  const steps = record.steps.map((step, index) => parseWorkflowStep(step, tripId, deviceId, index))
  assertUniqueSteps(steps)
  assertWorkflowShape(workflowId, steps)

  const request = {
    batchMutationId,
    deviceId,
    schemaVersion: ACCOUNT_WORKFLOW_SCHEMA_VERSION,
    steps,
    tripId,
    workflowId,
  } satisfies AccountWorkflowRequestV1
  if (byteLength(request) > ACCOUNT_WORKFLOW_MAX_BYTES) fail('workflow_shape_invalid')
  return request
}

export function parseAccountWorkflowRunResultV1(input: unknown): AccountWorkflowRunResultV1 {
  const record = readRecord(input, 'invalid_response')
  if (record.schemaVersion !== ACCOUNT_WORKFLOW_SCHEMA_VERSION || typeof record.status !== 'string') {
    fail('invalid_response')
  }
  const batchMutationId = readString(record.batchMutationId, UUID, 'invalid_response')
  const workflowId = readWorkflowId(record.workflowId, 'invalid_response')
  const tripId = readString(record.tripId, CONTROLLED_ID, 'invalid_response')

  if (record.status === 'applied' || record.status === 'idempotent') {
    assertOnlyFields(record, SUCCESS_RESULT_FIELDS, 'invalid_response')
    if (!Array.isArray(record.steps) || record.steps.length < 1 || record.steps.length > ACCOUNT_WORKFLOW_MAX_STEPS) {
      fail('invalid_response')
    }
    const seen = new Set<string>()
    const steps = record.steps.map((value) => {
      const step = readRecord(value, 'invalid_response')
      assertOnlyFields(step, APPLIED_STEP_FIELDS, 'invalid_response')
      const stepId = readString(step.stepId, CONTROLLED_ID, 'invalid_response')
      const mutationId = readString(step.mutationId, UUID, 'invalid_response')
      const key = `${stepId}:${mutationId}`
      if (seen.has(key)) fail('invalid_response')
      seen.add(key)
      return {
        appliedRevision: readInteger(step.appliedRevision, 1, 'invalid_response'),
        currentRevision: readInteger(step.currentRevision, 1, 'invalid_response'),
        mutationId,
        object: parseAccountObjectRowV1(step.object),
        stepId,
      }
    })
    return {
      batchMutationId,
      schemaVersion: ACCOUNT_WORKFLOW_SCHEMA_VERSION,
      status: record.status,
      steps,
      tripId,
      workflowId,
    }
  }

  if (record.status === 'conflict') {
    assertOnlyFields(record, CONFLICT_RESULT_FIELDS, 'invalid_response')
    if (record.reason !== 'revision_mismatch' && record.reason !== 'receipt_advanced') {
      fail('invalid_response')
    }
    if (!Array.isArray(record.conflicts) || record.conflicts.length < 1 || record.conflicts.length > ACCOUNT_WORKFLOW_MAX_STEPS) {
      fail('invalid_response')
    }
    const seen = new Set<string>()
    const conflicts = record.conflicts.map((value) => {
      const conflict = readRecord(value, 'invalid_response')
      assertOnlyFields(conflict, CONFLICT_FIELDS, 'invalid_response')
      const objectType = readClientMutableObjectType(conflict.objectType)
      const objectId = readString(conflict.objectId, CONTROLLED_ID, 'invalid_response')
      const stepId = readString(conflict.stepId, CONTROLLED_ID, 'invalid_response')
      const mutationId = readString(conflict.mutationId, UUID, 'invalid_response')
      const currentRevision = readInteger(conflict.currentRevision, 0, 'invalid_response')
      const currentObject = conflict.currentObject === null
        ? null
        : parseAccountObjectRowV1(conflict.currentObject)
      if ((currentRevision === 0) !== (currentObject === null)) fail('invalid_response')
      if (currentObject && (
        currentObject.objectType !== objectType
        || currentObject.objectId !== objectId
        || currentObject.tripId !== tripId
        || currentObject.revision !== currentRevision
      )) {
        fail('invalid_response')
      }
      const key = `${stepId}:${mutationId}`
      if (seen.has(key)) fail('invalid_response')
      seen.add(key)
      return {
        currentObject,
        currentRevision,
        mutationId,
        objectId,
        objectType,
        stepId,
      }
    })
    return {
      batchMutationId,
      conflicts,
      reason: record.reason,
      schemaVersion: ACCOUNT_WORKFLOW_SCHEMA_VERSION,
      status: 'conflict',
      tripId,
      workflowId,
    }
  }

  if (record.status === 'rejected') {
    assertOnlyFields(record, REJECTED_RESULT_FIELDS, 'invalid_response')
    if (typeof record.reason !== 'string' || !REJECTION_SET.has(record.reason as AccountWorkflowRejection)) {
      fail('invalid_response')
    }
    return {
      batchMutationId,
      reason: record.reason as AccountWorkflowRejection,
      schemaVersion: ACCOUNT_WORKFLOW_SCHEMA_VERSION,
      status: 'rejected',
      tripId,
      workflowId,
    }
  }

  fail('invalid_response')
}

export function assertAccountWorkflowResultMatchesRequest(
  result: AccountWorkflowRunResultV1,
  request: AccountWorkflowRequestV1,
) {
  if (
    result.batchMutationId !== request.batchMutationId
    || result.workflowId !== request.workflowId
    || result.tripId !== request.tripId
  ) {
    fail('invalid_response')
  }

  const requestByStep = new Map(request.steps.map((step) => [step.stepId, step]))
  if (result.status === 'applied' || result.status === 'idempotent') {
    if (result.steps.length !== request.steps.length) fail('invalid_response')
    for (const applied of result.steps) {
      const requested = requestByStep.get(applied.stepId)
      if (!requested || applied.mutationId !== requested.mutationId) fail('invalid_response')
      if (
        applied.appliedRevision !== requested.expectedRevision + 1
        || applied.currentRevision !== applied.appliedRevision
        || applied.object.revision !== applied.appliedRevision
        || applied.object.mutationId !== requested.mutationId
        || applied.object.objectType !== requested.objectType
        || applied.object.objectId !== requested.objectId
        || applied.object.tripId !== request.tripId
        || applied.object.tombstone !== (requested.operation === 'delete')
      ) {
        fail('invalid_response')
      }
      if (requested.operation === 'upsert') {
        if (!sameJson(applied.object.payload, requested.payload)) fail('invalid_response')
      } else if (applied.object.payload !== null) {
        fail('invalid_response')
      }
    }
    return result
  }

  if (result.status === 'conflict') {
    for (const conflict of result.conflicts) {
      const requested = requestByStep.get(conflict.stepId)
      if (
        !requested
        || conflict.mutationId !== requested.mutationId
        || conflict.objectType !== requested.objectType
        || conflict.objectId !== requested.objectId
      ) {
        fail('invalid_response')
      }
    }
  }
  return result
}

function parseWorkflowStep(
  input: unknown,
  tripId: string,
  deviceId: string,
  index: number,
): AccountWorkflowStepV1 {
  const record = readRecord(input, 'invalid_envelope')
  assertOnlyFields(record, STEP_FIELDS)
  const stepId = readString(record.stepId, CONTROLLED_ID, 'invalid_envelope')
  const mutationId = readString(record.mutationId, UUID, 'invalid_envelope')
  const mutation = parseAccountObjectMutationV1({
    deviceId,
    expectedRevision: record.expectedRevision,
    mutationId,
    objectId: record.objectId,
    objectSchemaVersion: record.objectSchemaVersion,
    objectType: record.objectType,
    operation: record.operation,
    ...(Object.hasOwn(record, 'payload') ? { payload: record.payload } : {}),
    schemaVersion: ACCOUNT_CLOUD_SCHEMA_VERSION,
    tripId,
  })
  if (index >= ACCOUNT_WORKFLOW_MAX_STEPS || mutation.mutationId !== mutationId) {
    fail('workflow_shape_invalid')
  }
  return {
    expectedRevision: mutation.expectedRevision,
    mutationId,
    objectId: mutation.objectId,
    objectSchemaVersion: mutation.objectSchemaVersion,
    objectType: mutation.objectType as ClientMutableAccountObjectType,
    operation: mutation.operation,
    ...(mutation.payload ? { payload: mutation.payload } : {}),
    stepId,
  }
}

function assertUniqueSteps(steps: AccountWorkflowStepV1[]) {
  const stepIds = new Set<string>()
  const mutationIds = new Set<string>()
  const objectKeys = new Set<string>()
  for (const step of steps) {
    const objectKey = `${step.objectType}:${step.objectId}`
    if (stepIds.has(step.stepId) || mutationIds.has(step.mutationId) || objectKeys.has(objectKey)) {
      fail('workflow_shape_invalid')
    }
    stepIds.add(step.stepId)
    mutationIds.add(step.mutationId)
    objectKeys.add(objectKey)
  }
}

function assertWorkflowShape(workflowId: AccountWorkflowId, steps: AccountWorkflowStepV1[]) {
  const definition = ACCOUNT_WORKFLOW_DEFINITIONS[workflowId]
  const allowedTypes = new Set<string>(definition.allowedObjectTypes)
  const allowedOperations = new Set<string>(definition.allowedOperations)
  if (steps.some((step) => !allowedTypes.has(step.objectType) || !allowedOperations.has(step.operation))) {
    fail('workflow_shape_invalid')
  }

  for (const step of steps) {
    if (step.objectType !== 'item' || step.operation !== 'upsert') continue
    const dayId = step.payload?.dayId
    const sortOrder = step.payload?.sortOrder
    const ticketIds = step.payload?.ticketIds
    if (
      typeof dayId !== 'string'
      || !CONTROLLED_ID.test(dayId)
      || !Number.isSafeInteger(sortOrder)
      || (sortOrder as number) < 0
      || !isUniqueControlledIdList(ticketIds)
    ) {
      fail('workflow_shape_invalid')
    }
  }

  if (workflowId === 'day.items.reorder@1') {
    const dayIds = new Set<string>()
    for (const step of steps) {
      const dayId = step.payload?.dayId
      if (step.expectedRevision < 1) fail('workflow_shape_invalid')
      dayIds.add(dayId as string)
    }
    if (dayIds.size !== 1 || !hasContiguousItemOrders(steps)) fail('workflow_shape_invalid')
  }

  if (workflowId === 'item.move@1') {
    if (
      steps.some((step) => step.expectedRevision < 1)
      || !hasContiguousItemOrders(steps)
    ) {
      fail('workflow_shape_invalid')
    }
  }

  if (workflowId === 'ticket.bind@1') {
    const ticketSteps = steps.filter((step) => step.objectType === 'ticket_meta')
    const itemSteps = steps.filter((step) => step.objectType === 'item')
    const ticketCount = ticketSteps.length
    const itemCount = itemSteps.length
    if (ticketCount !== 1 || itemCount !== steps.length - 1 || steps.some((step) => step.expectedRevision < 1)) {
      fail('workflow_shape_invalid')
    }
    const ticket = ticketSteps[0]
    const targetItemId = ticket.payload?.itemId
    if (targetItemId !== undefined && targetItemId !== null && (
      typeof targetItemId !== 'string' || !CONTROLLED_ID.test(targetItemId)
    )) {
      fail('workflow_shape_invalid')
    }
    const normalizedTarget = typeof targetItemId === 'string' ? targetItemId : null
    for (const item of itemSteps) {
      const ticketIds = item.payload?.ticketIds as JsonValue[]
      const hasTicket = ticketIds.includes(ticket.objectId)
      if ((item.objectId === normalizedTarget) !== hasTicket) fail('workflow_shape_invalid')
    }
    if (normalizedTarget && !itemSteps.some((item) => item.objectId === normalizedTarget)) {
      fail('workflow_shape_invalid')
    }
  }

  if (workflowId === 'ledger.batch@1' && steps.some((step) => (
    step.operation === 'delete' && step.expectedRevision < 1
  ))) {
    fail('workflow_shape_invalid')
  }
}

function hasContiguousItemOrders(steps: AccountWorkflowStepV1[]) {
  const ordersByDay = new Map<string, number[]>()
  for (const step of steps) {
    const dayId = step.payload?.dayId
    const sortOrder = step.payload?.sortOrder
    if (typeof dayId !== 'string' || typeof sortOrder !== 'number') return false
    const orders = ordersByDay.get(dayId) ?? []
    orders.push(sortOrder)
    ordersByDay.set(dayId, orders)
  }
  return [...ordersByDay.values()].every((orders) => (
    orders.length > 0
    && new Set(orders).size === orders.length
    && orders.sort((left, right) => left - right)
      .every((sortOrder, index) => sortOrder === index + 1)
  ))
}

function isUniqueControlledIdList(input: JsonValue | undefined) {
  if (!Array.isArray(input)) return false
  const ids = new Set<string>()
  for (const value of input) {
    if (typeof value !== 'string' || !CONTROLLED_ID.test(value) || ids.has(value)) return false
    ids.add(value)
  }
  return true
}

function workflow(
  allowedObjectTypes: readonly ClientMutableAccountObjectType[],
  allowedOperations: readonly AccountObjectMutationOperation[],
  minSteps: number,
  maxSteps: number,
): AccountWorkflowDefinition {
  return { allowedObjectTypes, allowedOperations, maxSteps, minSteps }
}

function readWorkflowId(
  input: unknown,
  code: AccountWorkflowContractErrorCode = 'unknown_workflow',
) {
  if (typeof input !== 'string' || !WORKFLOW_ID_SET.has(input)) fail(code)
  return input as AccountWorkflowId
}

function readClientMutableObjectType(input: unknown) {
  const mutation = parseAccountObjectMutationV1({
    deviceId: 'response_validator',
    expectedRevision: 0,
    mutationId: '00000000-0000-4000-8000-000000000000',
    objectId: 'response_validator',
    objectSchemaVersion: 1,
    objectType: input,
    operation: 'delete',
    schemaVersion: ACCOUNT_CLOUD_SCHEMA_VERSION,
    tripId: 'response_validator',
  })
  return mutation.objectType as ClientMutableAccountObjectType
}

function readRecord(input: unknown, code: AccountWorkflowContractErrorCode) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(code)
  return input as Record<string, unknown>
}

function assertOnlyFields(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  code: AccountWorkflowContractErrorCode = 'unknown_field',
) {
  if (Object.keys(record).some((key) => !allowed.has(key))) fail(code)
}

function readString(input: unknown, pattern: RegExp, code: AccountWorkflowContractErrorCode) {
  if (typeof input !== 'string' || !pattern.test(input)) fail(code)
  return input
}

function readInteger(input: unknown, minimum: number, code: AccountWorkflowContractErrorCode) {
  if (!Number.isSafeInteger(input) || (input as number) < minimum) fail(code)
  return input as number
}

function byteLength(input: unknown) {
  return new TextEncoder().encode(JSON.stringify(input)).byteLength
}

function sameJson(left: unknown, right: unknown) {
  return stableStringify(left) === stableStringify(right)
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}

function fail(code: AccountWorkflowContractErrorCode): never {
  throw new AccountWorkflowContractError(code)
}
