import {
  getActiveTravelDatabase,
  type TravelConsoleDatabase,
} from '../../db/database'
import type {
  LedgerBudget,
  LedgerExpense,
  LedgerParticipant,
  LedgerSettings,
} from '../../types'
import { buildAccountTravelDatabaseName } from '../accountDatabase'
import { getActiveAccountHash } from '../accountStorageScope'
import { getObjectSyncDeviceId } from '../objectSyncLocal'
import { createAccountObjectMutationId } from './client'
import {
  ACCOUNT_CLOUD_SCHEMA_VERSION,
  parseAccountObjectMutationV1,
  type AccountObjectMutationOperation,
  type AccountObjectMutationV1,
  type ClientMutableAccountObjectType,
  type JsonObject,
} from './contract'
import { isAccountCloudV2AccountEnabled } from './feature'
import {
  assertAccountLedgerGraphPayloads,
  assertNoNewAccountLedgerGraphViolations,
  listActiveLedgerTicketReferences,
  listAccountLedgerGraphViolations,
  type AccountLedgerGraph,
} from './ledgerGraph'
import {
  buildAccountObjectKey,
  getAccountObjectRevision,
} from './localStore'
import {
  processAccountWorkflow,
  type AccountWorkflowProcessResult,
} from './workflowCoordinator'
import {
  ACCOUNT_WORKFLOW_DEFINITIONS,
  parseAccountWorkflowRequestV1,
  type AccountWorkflowStepV1,
  type AccountWorkflowId,
} from './workflowContract'
import {
  ACCOUNT_WORKFLOW_LOCAL_OBJECT_TYPES,
  getAccountWorkflowLocalObjectTable,
  readAccountWorkflowLocalPayload,
} from './workflowLocalCodec'
import {
  AccountWorkflowJournalError,
  createOptimisticAccountWorkflowIntent,
  getAccountWorkflowJournalEntry,
} from './workflowLocalStore'

export type ProductAccountWorkflowStep = {
  objectId: string
  objectSchemaVersion?: number
  objectType: ClientMutableAccountObjectType
  operation: AccountObjectMutationOperation
  payload?: JsonObject
}

export type ProductAccountWorkflowInput<T> = {
  apply: () => Promise<T>
  steps: ProductAccountWorkflowStep[]
  tripId: string
  workflowId: AccountWorkflowId
}

export type ProductAccountWorkflowResult<T> =
  | { handled: false }
  | { handled: true; value: T }

type ProductCandidateMutation = Omit<AccountObjectMutationV1, 'objectType'> & {
  objectType: ClientMutableAccountObjectType
}

export type AccountCloudWorkflowWriteErrorCode =
  | 'authentication_required'
  | 'conflict'
  | 'contract_unavailable'
  | 'invalid_state'
  | 'rejected'

export class AccountCloudWorkflowWriteError extends Error {
  readonly code: AccountCloudWorkflowWriteErrorCode

  constructor(code: AccountCloudWorkflowWriteErrorCode) {
    super(messageForWorkflowWriteError(code))
    this.name = 'AccountCloudWorkflowWriteError'
    this.code = code
  }
}

const PRODUCT_STEP_FIELDS = new Set([
  'objectId',
  'objectSchemaVersion',
  'objectType',
  'operation',
  'payload',
])
const PRODUCT_INPUT_FIELDS = new Set(['apply', 'steps', 'tripId', 'workflowId'])

export async function executeProductAccountWorkflow<T>(
  input: ProductAccountWorkflowInput<T>,
): Promise<ProductAccountWorkflowResult<T>> {
  if (!isAccountCloudV2AccountEnabled(getActiveAccountHash())) return { handled: false }
  const { accountHash, database } = requireActiveAccountContext()
  const prepared = await prepareWorkflowRequest(input, accountHash, database)
  if (!prepared) return { handled: false }

  let value: T
  try {
    const optimistic = await createOptimisticAccountWorkflowIntent({
      accountHash,
      apply: input.apply,
      database,
      input: prepared,
    })
    value = optimistic.value
  } catch (error) {
    if (error instanceof AccountWorkflowJournalError) {
      if (error.code === 'unbootstrapped') return { handled: false }
      if (
        error.code === 'object_busy'
        || error.code === 'stale_revision'
        || error.code === 'batch_reused'
      ) {
        throw new AccountCloudWorkflowWriteError('conflict')
      }
      if (error.code === 'account_context_mismatch') {
        throw new AccountCloudWorkflowWriteError('authentication_required')
      }
      throw new AccountCloudWorkflowWriteError('invalid_state')
    }
    throw error
  }

  await settleProductWorkflow(prepared.batchMutationId, prepared.steps.map((step) => ({
    mutationId: step.mutationId,
    objectKey: buildAccountObjectKey(step.objectType, step.objectId),
  })), accountHash, database)
  return { handled: true, value }
}

async function prepareWorkflowRequest<T>(
  input: ProductAccountWorkflowInput<T>,
  accountHash: string,
  database: TravelConsoleDatabase,
) {
  if (
    !input
    || typeof input !== 'object'
    || Object.keys(input).some((field) => !PRODUCT_INPUT_FIELDS.has(field))
    || typeof input.apply !== 'function'
    || typeof input.workflowId !== 'string'
    || !Object.hasOwn(ACCOUNT_WORKFLOW_DEFINITIONS, input.workflowId)
    || !Array.isArray(input.steps)
  ) {
    throw new AccountCloudWorkflowWriteError('invalid_state')
  }
  const deviceId = getObjectSyncDeviceId()
  const batchMutationId = createAccountObjectMutationId()
  const definition = ACCOUNT_WORKFLOW_DEFINITIONS[input.workflowId]
  if (
    input.steps.length < definition.minSteps
    || input.steps.length > definition.maxSteps
  ) {
    throw new AccountCloudWorkflowWriteError('invalid_state')
  }
  const candidateSteps: Array<{
    mutation: ProductCandidateMutation
    stepId: string
  }> = []
  const objectKeys = new Set<string>()

  for (const [index, rawStep] of input.steps.entries()) {
    if (
      !rawStep
      || typeof rawStep !== 'object'
      || Object.keys(rawStep).some((field) => !PRODUCT_STEP_FIELDS.has(field))
    ) {
      throw new AccountCloudWorkflowWriteError('invalid_state')
    }
    let mutation: AccountObjectMutationV1
    try {
      mutation = parseAccountObjectMutationV1({
        deviceId,
        expectedRevision: 0,
        mutationId: createAccountObjectMutationId(),
        objectId: rawStep.objectId,
        objectSchemaVersion: rawStep.objectSchemaVersion ?? 1,
        objectType: rawStep.objectType,
        operation: rawStep.operation,
        ...(rawStep.payload === undefined
          ? {}
          : { payload: toPlainJsonObject(rawStep.payload) }),
        schemaVersion: ACCOUNT_CLOUD_SCHEMA_VERSION,
        tripId: input.tripId,
      })
    } catch {
      throw new AccountCloudWorkflowWriteError('invalid_state')
    }
    if (
      !definition.allowedObjectTypes.some((objectType) => objectType === mutation.objectType)
      || !definition.allowedOperations.includes(mutation.operation)
    ) {
      throw new AccountCloudWorkflowWriteError('invalid_state')
    }
    const candidate = mutation as ProductCandidateMutation
    const objectKey = buildAccountObjectKey(candidate.objectType, candidate.objectId)
    if (objectKeys.has(objectKey)) {
      throw new AccountCloudWorkflowWriteError('invalid_state')
    }
    objectKeys.add(objectKey)
    candidateSteps.push({ mutation: candidate, stepId: `step_${index + 1}` })
  }

  let requiresLegacyFallback = false
  let movedItemCount = 0
  const moveDayIds = new Set<string>()
  const steps: AccountWorkflowStepV1[] = []
  for (const { mutation, stepId } of candidateSteps) {
    const objectKey = buildAccountObjectKey(mutation.objectType, mutation.objectId)
    let current
    try {
      current = await Promise.all([
        getAccountObjectRevision(objectKey, database),
        readAccountWorkflowLocalPayload(
          mutation.objectType,
          mutation.objectId,
          input.tripId,
          database,
        ),
        database.accountMutationJournal.where('objectKey').equals(objectKey).count(),
        database.accountWorkflowJournal.where('objectKeys').equals(objectKey).count(),
      ])
    } catch {
      throw new AccountCloudWorkflowWriteError('invalid_state')
    }
    const [revision, localPayload, singlePending, workflowPending] = current
    assertActiveAccountContext(accountHash, database)
    if (singlePending > 0 || workflowPending > 0) {
      throw new AccountCloudWorkflowWriteError('conflict')
    }
    if (input.workflowId === 'trip.import.commit@1' && (localPayload !== null || revision)) {
      throw new AccountCloudWorkflowWriteError('conflict')
    }
    if (localPayload !== null && !revision) requiresLegacyFallback = true
    if (revision && (
      revision.objectId !== mutation.objectId
      || revision.objectType !== mutation.objectType
      || revision.tripId !== input.tripId
      || revision.objectSchemaVersion !== mutation.objectSchemaVersion
      || revision.tombstone !== (localPayload === null)
      || !sameJson(revision.payload, localPayload)
    )) {
      throw new AccountCloudWorkflowWriteError('invalid_state')
    }
    if (mutation.operation === 'delete' && localPayload === null) {
      throw new AccountCloudWorkflowWriteError('invalid_state')
    }
    if (input.workflowId === 'day.items.reorder@1') {
      if (localPayload?.dayId !== mutation.payload?.dayId) {
        throw new AccountCloudWorkflowWriteError('invalid_state')
      }
    }
    if (input.workflowId === 'item.move@1') {
      const beforeDayId = localPayload?.dayId
      const afterDayId = mutation.payload?.dayId
      if (typeof beforeDayId !== 'string' || typeof afterDayId !== 'string') {
        throw new AccountCloudWorkflowWriteError('invalid_state')
      }
      moveDayIds.add(beforeDayId)
      moveDayIds.add(afterDayId)
      if (beforeDayId !== afterDayId) movedItemCount += 1
    }
    if (input.workflowId === 'ticket.bind@1' && localPayload) {
      assertTicketWorkflowMutation(mutation, localPayload)
    }
    if (input.workflowId === 'ledger.batch@1' && localPayload) {
      assertLedgerWorkflowMutation(mutation, localPayload)
    }
    if (
      input.workflowId === 'ledger.batch@1'
      && mutation.operation === 'upsert'
      && revision?.tombstone
    ) {
      throw new AccountCloudWorkflowWriteError('invalid_state')
    }
    steps.push({
      expectedRevision: revision?.revision ?? 0,
      mutationId: mutation.mutationId,
      objectId: mutation.objectId,
      objectSchemaVersion: mutation.objectSchemaVersion,
      objectType: mutation.objectType,
      operation: mutation.operation,
      ...(mutation.payload === undefined ? {} : { payload: mutation.payload }),
      stepId,
    })
  }

  assertActiveAccountContext(accountHash, database)
  if (requiresLegacyFallback && input.workflowId !== 'ledger.batch@1') return null
  if (input.workflowId === 'item.move@1' && (
    movedItemCount !== 1 || moveDayIds.size !== 2
  )) {
    throw new AccountCloudWorkflowWriteError('invalid_state')
  }
  if (input.workflowId === 'ticket.bind@1') {
    await assertCompleteTicketRelationship(input.tripId, steps, database)
  }
  if (input.workflowId === 'ledger.batch@1') {
    requiresLegacyFallback = await hasUnbootstrappedLedgerDependency(
      input.tripId,
      steps,
      accountHash,
      database,
    ) || requiresLegacyFallback
    if (requiresLegacyFallback) return null
  }
  if (input.workflowId === 'trip.import.commit@1') {
    await assertEmptyTripImportBaseline(input.tripId, accountHash, database)
  }
  try {
    return parseAccountWorkflowRequestV1({
      batchMutationId,
      deviceId,
      schemaVersion: 1,
      steps,
      tripId: input.tripId,
      workflowId: input.workflowId,
    })
  } catch {
    throw new AccountCloudWorkflowWriteError('invalid_state')
  }
}

function assertLedgerWorkflowMutation(
  mutation: ProductCandidateMutation,
  localPayload: JsonObject,
) {
  if (
    mutation.operation === 'upsert'
    && (
      !mutation.payload
      || mutation.payload.createdAt !== localPayload.createdAt
      || !isLaterTimestamp(mutation.payload.updatedAt, localPayload.updatedAt)
    )
  ) {
    throw new AccountCloudWorkflowWriteError('invalid_state')
  }
}

async function hasUnbootstrappedLedgerDependency(
  tripId: string,
  steps: AccountWorkflowStepV1[],
  accountHash: string,
  database: TravelConsoleDatabase,
) {
  const submitted = new Set(steps.map((step) => buildAccountObjectKey(step.objectType, step.objectId)))
  const dependencies = new Map<string, { objectId: string; objectType: ClientMutableAccountObjectType }>()
  addLedgerDependencies(dependencies, 'trip', [tripId])
  const [trip, settings, participants, budgets, expenses, itemIds, ticketIds] = await Promise.all([
    database.trips.get(tripId),
    database.ledgerSettings.where('tripId').equals(tripId).toArray(),
    database.ledgerParticipants.where('tripId').equals(tripId).toArray(),
    database.ledgerBudgets.where('tripId').equals(tripId).toArray(),
    database.ledgerExpenses.where('tripId').equals(tripId).toArray(),
    database.itineraryItems.where('tripId').equals(tripId).primaryKeys(),
    database.ticketMetas.where('tripId').equals(tripId).primaryKeys(),
  ])
  assertActiveAccountContext(accountHash, database)
  const currentGraph: AccountLedgerGraph = {
    budgets,
    expenses,
    itemIds,
    participants,
    settings,
    ticketIds,
    tripExists: Boolean(trip),
  }
  const prospectiveGraph = applyLedgerWorkflowSteps(currentGraph, steps)
  let needsFallback: boolean
  try {
    assertAccountLedgerGraphPayloads(currentGraph, tripId)
    assertAccountLedgerGraphPayloads(prospectiveGraph, tripId)
    assertNoNewAccountLedgerGraphViolations(currentGraph, prospectiveGraph)
    needsFallback = listAccountLedgerGraphViolations(prospectiveGraph).length > 0
  } catch {
    throw new AccountCloudWorkflowWriteError('invalid_state')
  }
  addLedgerDependencies(dependencies, 'ledger_settings', settings.map((record) => record.id))
  addLedgerDependencies(dependencies, 'ledger_participant', participants.map((record) => record.id))
  addLedgerDependencies(dependencies, 'ledger_budget', budgets.map((record) => record.id))
  addLedgerDependencies(dependencies, 'ledger_expense', expenses.map((record) => record.id))

  for (const expense of prospectiveGraph.expenses) {
    addLedgerExpenseDependencies(dependencies, expense)
  }

  for (const dependency of dependencies.values()) {
    const objectKey = buildAccountObjectKey(dependency.objectType, dependency.objectId)
    if (submitted.has(objectKey)) continue
    const [revision, localPayload, singlePending, workflowPending] = await Promise.all([
      getAccountObjectRevision(objectKey, database),
      readAccountWorkflowLocalPayload(dependency.objectType, dependency.objectId, tripId, database),
      database.accountMutationJournal.where('objectKey').equals(objectKey).count(),
      database.accountWorkflowJournal.where('objectKeys').equals(objectKey).count(),
    ])
    assertActiveAccountContext(accountHash, database)
    if (singlePending > 0 || workflowPending > 0) throw new AccountCloudWorkflowWriteError('conflict')
    if (localPayload === null) {
      if (needsFallback) continue
      throw new AccountCloudWorkflowWriteError('invalid_state')
    }
    if (!revision) {
      needsFallback = true
      continue
    }
    if (
      revision.objectId !== dependency.objectId
      || revision.objectType !== dependency.objectType
      || revision.tripId !== tripId
      || revision.tombstone
      || !sameJson(revision.payload, localPayload)
    ) {
      throw new AccountCloudWorkflowWriteError('invalid_state')
    }
  }
  return needsFallback
}

function applyLedgerWorkflowSteps(
  graph: AccountLedgerGraph,
  steps: AccountWorkflowStepV1[],
): AccountLedgerGraph {
  const next: AccountLedgerGraph = {
    ...graph,
    budgets: [...graph.budgets],
    expenses: [...graph.expenses],
    participants: [...graph.participants],
    settings: [...graph.settings],
  }
  for (const step of steps) {
    const key = ledgerGraphKey(step.objectType)
    if (!key) throw new AccountCloudWorkflowWriteError('invalid_state')
    const records = next[key] as Array<LedgerSettings | LedgerParticipant | LedgerBudget | LedgerExpense>
    const remaining = records.filter((record) => record.id !== step.objectId)
    next[key] = (step.operation === 'delete'
      ? remaining
      : [...remaining, step.payload as unknown as typeof records[number]]) as never
  }
  return next
}

function ledgerGraphKey(
  objectType: ClientMutableAccountObjectType,
): 'settings' | 'participants' | 'budgets' | 'expenses' | null {
  switch (objectType) {
    case 'ledger_settings': return 'settings'
    case 'ledger_participant': return 'participants'
    case 'ledger_budget': return 'budgets'
    case 'ledger_expense': return 'expenses'
    default: return null
  }
}

function addLedgerExpenseDependencies(
  dependencies: Map<string, { objectId: string; objectType: ClientMutableAccountObjectType }>,
  payload: LedgerExpense,
) {
  const participantIds = [
    payload.payerParticipantId,
    ...payload.splitShares.map((share) => share.participantId),
  ]
  addLedgerDependencies(dependencies, 'ledger_participant', participantIds)
  addLedgerDependencies(dependencies, 'item', payload.itemIds ?? [])
  addLedgerDependencies(dependencies, 'ledger_expense', [payload.originalExpenseId])
  addLedgerDependencies(dependencies, 'ticket_meta', listActiveLedgerTicketReferences(payload))
}

function addLedgerDependencies(
  dependencies: Map<string, { objectId: string; objectType: ClientMutableAccountObjectType }>,
  objectType: ClientMutableAccountObjectType,
  values: readonly unknown[],
) {
  for (const value of values) {
    if (typeof value !== 'string') continue
    dependencies.set(buildAccountObjectKey(objectType, value), { objectId: value, objectType })
  }
}

async function assertEmptyTripImportBaseline(
  tripId: string,
  accountHash: string,
  database: TravelConsoleDatabase,
) {
  const counts = await Promise.all([
    ...ACCOUNT_WORKFLOW_LOCAL_OBJECT_TYPES.map((objectType) => (
      objectType === 'trip'
        ? getAccountWorkflowLocalObjectTable(objectType, database).get(tripId)
          .then((record) => record === undefined ? 0 : 1)
        : getAccountWorkflowLocalObjectTable(objectType, database).where('tripId').equals(tripId).count()
    )),
    database.accountObjectRevisions.where('tripId').equals(tripId).count(),
    database.accountMutationJournal.where('tripId').equals(tripId).count(),
    database.accountWorkflowJournal.where('tripId').equals(tripId).count(),
  ])
  assertActiveAccountContext(accountHash, database)
  if (counts.some((count) => count > 0)) {
    throw new AccountCloudWorkflowWriteError('conflict')
  }
}

function assertTicketWorkflowMutation(
  mutation: ProductCandidateMutation,
  localPayload: JsonObject,
) {
  if (!mutation.payload) throw new AccountCloudWorkflowWriteError('invalid_state')
  if (mutation.objectType === 'ticket_meta') {
    const immutableFields = [
      'bookingId',
      'createdAt',
      'fileType',
      'id',
      'mimeType',
      'size',
      'storageMode',
      'tripId',
    ] as const
    if (
      immutableFields.some((field) => !sameJson(localPayload[field], mutation.payload?.[field]))
      || !isLaterTimestamp(mutation.payload.updatedAt, localPayload.updatedAt)
    ) {
      throw new AccountCloudWorkflowWriteError('invalid_state')
    }
    return
  }
  if (mutation.objectType !== 'item') {
    throw new AccountCloudWorkflowWriteError('invalid_state')
  }
  const beforeTicketIds = localPayload.ticketIds
  const afterTicketIds = mutation.payload.ticketIds
  if (!Array.isArray(beforeTicketIds) || !Array.isArray(afterTicketIds)) {
    throw new AccountCloudWorkflowWriteError('invalid_state')
  }
  const ticketId = afterTicketIds.find((value) => (
    typeof value === 'string' && !beforeTicketIds.includes(value)
  )) ?? beforeTicketIds.find((value) => (
    typeof value === 'string' && !afterTicketIds.includes(value)
  ))
  if (
    !sameJson(
      withoutFields(localPayload, ['ticketIds', 'updatedAt']),
      withoutFields(mutation.payload, ['ticketIds', 'updatedAt']),
    )
    || (
      sameJson(beforeTicketIds, afterTicketIds)
        ? !sameJson(localPayload, mutation.payload)
        : !isLaterTimestamp(mutation.payload.updatedAt, localPayload.updatedAt)
    )
    || (
      typeof ticketId === 'string'
      && !sameJson(
        beforeTicketIds.filter((value) => value !== ticketId),
        afterTicketIds.filter((value) => value !== ticketId),
      )
    )
  ) {
    throw new AccountCloudWorkflowWriteError('invalid_state')
  }
}

function withoutFields(
  value: JsonObject,
  fields: readonly string[],
) {
  const result = { ...value }
  for (const field of fields) delete result[field]
  return result
}

function isLaterTimestamp(after: unknown, before: unknown) {
  return Number.isSafeInteger(after)
    && Number.isSafeInteger(before)
    && (after as number) > (before as number)
}

async function assertCompleteTicketRelationship(
  tripId: string,
  steps: AccountWorkflowStepV1[],
  database: TravelConsoleDatabase,
) {
  const ticketSteps = steps.filter((step) => step.objectType === 'ticket_meta')
  const itemSteps = steps.filter((step) => step.objectType === 'item')
  if (ticketSteps.length !== 1 || itemSteps.length !== steps.length - 1) {
    throw new AccountCloudWorkflowWriteError('invalid_state')
  }
  const ticketStep = ticketSteps[0]
  const ticketId = ticketStep.objectId
  const targetItemId = typeof ticketStep.payload?.itemId === 'string'
    ? ticketStep.payload.itemId
    : null
  const currentTicket = await readAccountWorkflowLocalPayload(
    'ticket_meta',
    ticketId,
    tripId,
    database,
  )
  const tripItems = await database.itineraryItems.where('tripId').equals(tripId).toArray()
  const currentItemsById = new Map(tripItems.map((item) => [item.id, item]))
  const requiredItemIds = new Set<string>()
  if (typeof currentTicket?.itemId === 'string') requiredItemIds.add(currentTicket.itemId)
  if (targetItemId) requiredItemIds.add(targetItemId)
  for (const item of tripItems) {
    if ((item.ticketIds ?? []).includes(ticketId)) requiredItemIds.add(item.id)
  }
  const providedItemIds = new Set(itemSteps.map((step) => step.objectId))
  if (
    providedItemIds.size !== requiredItemIds.size
    || [...requiredItemIds].some((itemId) => !providedItemIds.has(itemId))
  ) {
    throw new AccountCloudWorkflowWriteError('invalid_state')
  }
  for (const itemStep of itemSteps) {
    const currentItem = currentItemsById.get(itemStep.objectId)
    const afterTicketIds = itemStep.payload?.ticketIds
    if (
      !currentItem
      || !Array.isArray(afterTicketIds)
      || !sameJson(
        (currentItem.ticketIds ?? []).filter((value) => value !== ticketId),
        afterTicketIds.filter((value) => value !== ticketId),
      )
    ) {
      throw new AccountCloudWorkflowWriteError('invalid_state')
    }
  }
}

async function settleProductWorkflow(
  batchMutationId: string,
  expectedReceipts: Array<{ mutationId: string; objectKey: string }>,
  accountHash: string,
  database: TravelConsoleDatabase,
) {
  let result: AccountWorkflowProcessResult
  try {
    result = await processAccountWorkflow(batchMutationId, { database })
  } catch {
    throw new AccountCloudWorkflowWriteError('invalid_state')
  }
  if (!hasActiveAccountContext(accountHash, database)) return
  if (
    result.status === 'committed'
    || result.status === 'queued_offline'
    || result.status === 'retry_scheduled'
  ) {
    return
  }
  if (result.status === 'blocked_auth') {
    throw new AccountCloudWorkflowWriteError('authentication_required')
  }
  if (result.status === 'conflict') {
    throw new AccountCloudWorkflowWriteError('conflict')
  }
  if (result.status === 'rejected') {
    throw new AccountCloudWorkflowWriteError('rejected')
  }
  if (result.status === 'blocked_contract') {
    throw new AccountCloudWorkflowWriteError('contract_unavailable')
  }
  if (result.status === 'missing' || result.status === 'not_runnable') {
    const pending = await getAccountWorkflowJournalEntry(batchMutationId, database)
    if (!hasActiveAccountContext(accountHash, database)) return
    if (pending?.status === 'pending' || pending?.status === 'retry' || pending?.status === 'inflight') {
      return
    }
    if (pending?.status === 'blocked_auth') {
      throw new AccountCloudWorkflowWriteError('authentication_required')
    }
    if (pending?.status === 'conflict') {
      throw new AccountCloudWorkflowWriteError('conflict')
    }
    if (pending?.status === 'blocked_contract') {
      throw new AccountCloudWorkflowWriteError('contract_unavailable')
    }
    const receipts = await database.accountObjectRevisions.bulkGet(
      expectedReceipts.map((receipt) => receipt.objectKey),
    )
    if (!hasActiveAccountContext(accountHash, database)) return
    if (receipts.every((receipt, index) => (
      receipt?.mutationId === expectedReceipts[index]?.mutationId
    ))) {
      return
    }
  }
  throw new AccountCloudWorkflowWriteError('invalid_state')
}

function requireActiveAccountContext() {
  const accountHash = getActiveAccountHash()
  if (!accountHash) throw new AccountCloudWorkflowWriteError('authentication_required')
  const database = getActiveTravelDatabase()
  assertActiveAccountContext(accountHash, database)
  return { accountHash, database }
}

function assertActiveAccountContext(
  accountHash: string,
  database: TravelConsoleDatabase,
) {
  if (!hasActiveAccountContext(accountHash, database)) {
    throw new AccountCloudWorkflowWriteError('authentication_required')
  }
}

function hasActiveAccountContext(
  accountHash: string,
  database: TravelConsoleDatabase,
) {
  return getActiveAccountHash() === accountHash
    && getActiveTravelDatabase() === database
    && database.name === buildAccountTravelDatabaseName(accountHash)
}

function sameJson(left: unknown, right: unknown) {
  return stableStringify(left) === stableStringify(right)
}

function toPlainJsonObject(value: JsonObject) {
  const serialized = JSON.stringify(value)
  if (!serialized) throw new AccountCloudWorkflowWriteError('invalid_state')
  const parsed = JSON.parse(serialized) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AccountCloudWorkflowWriteError('invalid_state')
  }
  return parsed as JsonObject
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

function messageForWorkflowWriteError(code: AccountCloudWorkflowWriteErrorCode) {
  switch (code) {
    case 'authentication_required':
      return '登录已过期，请重新登录后重试。'
    case 'conflict':
      return '账号中的内容已变化，请刷新后重试。'
    case 'contract_unavailable':
      return '账号保存暂时不可用，请稍后重试。'
    case 'invalid_state':
      return '本次批量修改未能安全保存，请刷新后重试。'
    case 'rejected':
      return '本次批量修改不符合账号保存规则。'
  }
}
