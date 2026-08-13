import { db } from '../db/database'
import { ItineraryBaselineConflictError } from '../db/repositories'
import type {
  Day,
  ItineraryItem,
  LedgerExpense,
  TicketMeta,
  Trip,
  TripIntelligenceAppliedChangeRecord,
  TripDisruptionEvent,
  TripDisruptionKind,
  TripReplanAccountObjectBaselineEntry,
  TripReplanOption,
  TripReplanRecord,
  TripReplanSnapshot,
  TripReplanStrategy,
} from '../types'
import {
  buildReplanFingerprint,
  buildTripReplanPreview,
} from './adaptiveReplanning'
import { getActiveAccountHash } from './accountStorageScope'
import {
  ACCOUNT_OBJECT_MAX_PAYLOAD_BYTES,
  type JsonObject,
} from './accountCloud/contract'
import { isAccountCloudV2AccountEnabled } from './accountCloud/feature'
import { executeProductAccountWorkflowIfEnabled } from './accountCloud/workflowRuntimeLoader'
import {
  ACCOUNT_WORKFLOW_MAX_BYTES,
  ACCOUNT_WORKFLOW_MAX_STEPS,
} from './accountCloud/workflowLimits'
import { emitTravelDataChanged } from './dataEvents'
import { enqueueObjectUpsert } from './objectSyncLocal'
import {
  buildTripIntelligenceAppliedChangeRecordId,
  prepareTripIntelligenceExecutionPersistence,
} from './tripIntelligence/persistence'
import type { TripIntelligenceAppliedChange } from './tripIntelligence/types'
import { recordTripWriteForSync } from './tripSyncQueue'

export type AdaptiveReplanActionContext = {
  days: Day[]
  items: ItineraryItem[]
  ledgerExpenses: LedgerExpense[]
  tickets: TicketMeta[]
  trip: Trip
}

export type PreparedAdaptiveReplanAction = {
  baselineFingerprint: string
  dayId: string
  dayTitle: string
  dayTitlesById: Record<string, string>
  delayMinutes?: number
  disruptionKind: Exclude<TripDisruptionKind, 'skip'>
  eventId: string
  itemId?: string
  kind: 'adaptive-replan-action'
  occurredAt: string
  operationFingerprint: string
  previewFingerprint: string
  recordId: string
  selectedOption: TripReplanOption
  strategy: TripReplanStrategy
  tripId: string
}

export type AdaptiveReplanActionExecutionResult = {
  changed: boolean
  changedItemCount: number
  record?: TripReplanRecord
}

type AdaptiveReplanMutationPlan = {
  beforeFingerprint: string
  event: TripDisruptionEvent
  historyRecord: TripIntelligenceAppliedChangeRecord
  now: number
  record: TripReplanRecord
  trip: Trip
  tripId: string
  updatedItems: ItineraryItem[]
}

type PreparedAdaptiveReplanMutation =
  | { kind: 'apply'; plan: AdaptiveReplanMutationPlan }
  | { kind: 'replay'; record: TripReplanRecord }

const ADAPTIVE_REPLAN_TRANSACTION_TABLES = [
  'trips',
  'days',
  'itineraryItems',
  'ticketMetas',
  'ledgerExpenses',
  'tripReplanEvents',
  'tripReplanRecords',
  'syncOutbox',
  'objectSyncStates',
  'tripIntelligenceAppliedChanges',
  'tripIntelligenceSuggestionStates',
] as const

export async function loadAdaptiveReplanActionContext(
  tripId: string,
): Promise<AdaptiveReplanActionContext> {
  const [trip, days, items, tickets, ledgerExpenses] = await Promise.all([
    db.trips.get(tripId),
    db.days.where('tripId').equals(tripId).toArray(),
    db.itineraryItems.where('tripId').equals(tripId).toArray(),
    db.ticketMetas.where('tripId').equals(tripId).toArray(),
    db.ledgerExpenses.where('tripId').equals(tripId).toArray(),
  ])
  if (!trip) throw new ItineraryBaselineConflictError('当前旅行已不存在。')
  return { days, items, ledgerExpenses, tickets, trip }
}

export function buildAdaptiveReplanActionPreview({
  context,
  day,
  delayMinutes,
  disruptionKind,
  item,
  now = Date.now(),
  operationFingerprint,
  strategy = 'least_change',
}: {
  context: AdaptiveReplanActionContext
  day: Day
  delayMinutes?: number
  disruptionKind: PreparedAdaptiveReplanAction['disruptionKind']
  item?: ItineraryItem
  now?: number
  operationFingerprint: string
  strategy?: TripReplanStrategy
}): PreparedAdaptiveReplanAction {
  if (day.tripId !== context.trip.id) {
    throw new ItineraryBaselineConflictError('目标日期不属于当前旅行。')
  }
  if (item && (item.tripId !== context.trip.id || item.dayId !== day.id)) {
    throw new ItineraryBaselineConflictError('目标行程点不属于所选日期。')
  }
  const eventId = buildAdaptiveReplanObjectId(
    'replan_event',
    operationFingerprint,
  )
  const recordId = buildAdaptiveReplanObjectId(
    'replan_record',
    operationFingerprint,
  )
  const occurredAt = new Date(now).toISOString()
  const event = buildAdaptiveReplanEvent({
    createdAt: now,
    dayId: day.id,
    delayMinutes,
    disruptionKind,
    eventId,
    itemId: item?.id,
    occurredAt,
    tripId: context.trip.id,
  })
  const preview = buildTripReplanPreview({
    ...context,
    event,
    now: new Date(now),
  })
  const selectedOption = requireStrategyOption(preview.options, strategy)
  return {
    baselineFingerprint: buildAdaptiveReplanActionBaseline(context),
    dayId: day.id,
    dayTitle: day.title,
    dayTitlesById: Object.fromEntries(
      context.days.map((candidate) => [candidate.id, candidate.title]),
    ),
    ...(delayMinutes !== undefined ? { delayMinutes } : {}),
    disruptionKind,
    eventId,
    ...(item ? { itemId: item.id } : {}),
    kind: 'adaptive-replan-action',
    occurredAt,
    operationFingerprint,
    previewFingerprint: buildAdaptiveReplanOptionFingerprint(selectedOption),
    recordId,
    selectedOption,
    strategy,
    tripId: context.trip.id,
  }
}

export async function executeAdaptiveReplanAction(
  prepared: PreparedAdaptiveReplanAction,
): Promise<AdaptiveReplanActionExecutionResult> {
  if (countChangedItems(prepared.selectedOption) === 0) {
    return { changed: false, changedItemCount: 0 }
  }
  const mutation = await prepareAdaptiveReplanMutation(prepared)
  if (mutation.kind === 'replay') {
    return {
      changed: false,
      changedItemCount: countChangedItemsFromRecord(mutation.record),
      record: mutation.record,
    }
  }

  const plan = mutation.plan
  const steps = buildAdaptiveReplanWorkflowSteps(plan)
  if (canSubmitAdaptiveReplanWorkflow(steps)) {
    try {
      const accountCloud = await executeProductAccountWorkflowIfEnabled({
        apply: () => applyAdaptiveReplanMutationPlan(prepared, plan, {
          enqueueLegacy: false,
        }),
        steps,
        tripId: plan.tripId,
        workflowId: 'trip.replan.apply@1',
      })
      if (accountCloud.handled) {
        if (accountCloud.value.changed) emitTravelDataChanged()
        return accountCloud.value
      }
    } catch (error) {
      const replay = await recoverAdaptiveReplanReplay(prepared)
      if (replay) return replay
      throw error
    }
  }

  const legacyPlan = stripAdaptiveReplanAccountBaseline(plan)
  const output = await applyAdaptiveReplanMutationPlan(prepared, legacyPlan, {
    enqueueLegacy: true,
  })
  if (output.changed) {
    recordTripWriteForSync(prepared.tripId, 'ai-adaptive-replan-applied', {
      emitChangeEvent: false,
    })
    emitTravelDataChanged()
  }
  return output
}

export async function assertAdaptiveReplanActionApplied(
  prepared: PreparedAdaptiveReplanAction,
) {
  const context = await loadAdaptiveReplanActionContext(prepared.tripId)
  return assertAdaptiveReplanActionAppliedInTransaction(prepared, context)
}

export function buildAdaptiveReplanActionBaseline(
  context: AdaptiveReplanActionContext,
) {
  return stableStringify({
    days: [...context.days].sort(compareById),
    items: [...context.items].sort(compareById),
    ledgerExpenses: [...context.ledgerExpenses].sort(compareById),
    tickets: [...context.tickets].sort(compareById),
    trip: context.trip,
  })
}

async function prepareAdaptiveReplanMutation(
  prepared: PreparedAdaptiveReplanAction,
): Promise<PreparedAdaptiveReplanMutation> {
  const context = await loadAdaptiveReplanActionContext(prepared.tripId)
  if (await getAdaptiveReplanMarker(prepared)) {
    return {
      kind: 'replay',
      record: await assertAdaptiveReplanActionAppliedInTransaction(prepared, context),
    }
  }
  if (buildAdaptiveReplanActionBaseline(context) !== prepared.baselineFingerprint) {
    throw new ItineraryBaselineConflictError(
      '旅行、票据或账本内容已变化，请重新生成预览。',
    )
  }
  const day = context.days.find((candidate) => candidate.id === prepared.dayId)
  const item = prepared.itemId
    ? context.items.find((candidate) => candidate.id === prepared.itemId)
    : undefined
  if (!day || (prepared.itemId && !item)) {
    throw new ItineraryBaselineConflictError(
      '突发重排目标已不存在，请重新生成预览。',
    )
  }
  const latestItemUpdatedAt = context.items.reduce(
    (latest, candidate) => Math.max(latest, candidate.updatedAt),
    0,
  )
  const now = Math.max(Date.now(), context.trip.updatedAt + 1, latestItemUpdatedAt + 1)
  const event = buildAdaptiveReplanEvent({
    createdAt: now,
    dayId: day.id,
    delayMinutes: prepared.delayMinutes,
    disruptionKind: prepared.disruptionKind,
    eventId: prepared.eventId,
    itemId: item?.id,
    occurredAt: prepared.occurredAt,
    tripId: context.trip.id,
  })
  const preview = buildTripReplanPreview({ ...context, event, now: new Date(now) })
  const selectedOption = requireStrategyOption(preview.options, prepared.strategy)
  if (buildAdaptiveReplanOptionFingerprint(selectedOption) !== prepared.previewFingerprint) {
    throw new ItineraryBaselineConflictError('重排结果已变化，请重新生成预览。')
  }
  const updatedItems = applyAdaptiveReplanPatches(context.items, selectedOption, now)
  if (updatedItems.length === 0) {
    throw new ItineraryBaselineConflictError('重排方案已不再包含可应用的修改。')
  }
  const itemById = new Map(context.items.map((candidate) => [candidate.id, candidate]))
  for (const updated of updatedItems) itemById.set(updated.id, updated)
  const scopeItemIds = selectedOption.diff.itemChanges
    .filter((change) => change.changeType !== 'unchanged')
    .map((change) => change.itemId)
  const afterSnapshot = buildAdaptiveReplanScopedSnapshot(
    context.days,
    [...itemById.values()],
    scopeItemIds,
  )
  const persistedEvent: TripDisruptionEvent = {
    ...event,
    status: 'applied',
    updatedAt: now,
  }
  const appliedChange = buildAdaptiveReplanAppliedChange(prepared, {
    ...preview,
    afterSnapshot,
    appliedFingerprint: buildReplanFingerprint(afterSnapshot),
    createdAt: now,
    id: prepared.recordId,
    operationFingerprint: prepared.operationFingerprint,
    operationKind: 'adaptive_replan',
    scopeItemIds,
    selectedDiff: selectedOption.diff,
    selectedOptionId: selectedOption.id,
    status: 'applied',
    updatedAt: now,
  }, now)
  const history = prepareTripIntelligenceExecutionPersistence(context.trip.id, {
    result: {
      appliedChanges: [appliedChange],
      message: 'AI 突发重排已完成。',
      status: 'completed',
    },
    source: 'live',
    title: 'AI 突发重排',
  }, now)
  if (history.appliedRecords.length !== 1 || history.suggestionState) {
    throw new Error('突发重排历史记录生成失败。')
  }
  const accountObjectBaseline = isAccountCloudV2AccountEnabled(getActiveAccountHash())
    ? await loadAdaptiveReplanAccountObjectBaseline(context)
    : undefined
  const record: TripReplanRecord = {
    ...preview,
    ...(accountObjectBaseline ? { accountObjectBaseline } : {}),
    afterSnapshot,
    appliedFingerprint: buildReplanFingerprint(afterSnapshot),
    createdAt: now,
    id: prepared.recordId,
    operationFingerprint: prepared.operationFingerprint,
    operationKind: 'adaptive_replan',
    scopeItemIds,
    selectedDiff: selectedOption.diff,
    selectedOptionId: selectedOption.id,
    status: 'applied',
    updatedAt: now,
  }
  return {
    kind: 'apply',
    plan: {
      beforeFingerprint: prepared.baselineFingerprint,
      event: persistedEvent,
      historyRecord: history.appliedRecords[0],
      now,
      record,
      trip: { ...context.trip, updatedAt: now },
      tripId: context.trip.id,
      updatedItems,
    },
  }
}

async function applyAdaptiveReplanMutationPlan(
  prepared: PreparedAdaptiveReplanAction,
  plan: AdaptiveReplanMutationPlan,
  options: { enqueueLegacy: boolean },
): Promise<AdaptiveReplanActionExecutionResult> {
  let output: AdaptiveReplanActionExecutionResult | undefined
  const transactionTables = options.enqueueLegacy
    ? [...ADAPTIVE_REPLAN_TRANSACTION_TABLES]
    : [
        db.trips,
        db.days,
        db.itineraryItems,
        db.ticketMetas,
        db.ledgerExpenses,
        db.tripReplanEvents,
        db.tripReplanRecords,
        db.tripIntelligenceAppliedChanges,
        db.accountObjectRevisions,
      ]
  await db.transaction('rw', transactionTables, async () => {
    const context = await loadAdaptiveReplanActionContext(plan.tripId)
    if (await getAdaptiveReplanMarker(prepared)) {
      const record = await assertAdaptiveReplanActionAppliedInTransaction(prepared, context)
      output = {
        changed: false,
        changedItemCount: countChangedItemsFromRecord(record),
        record,
      }
      return
    }
    if (
      buildAdaptiveReplanActionBaseline(context) !== plan.beforeFingerprint
      || (
        plan.record.accountObjectBaseline
        && !sameJson(
          plan.record.accountObjectBaseline,
          await loadAdaptiveReplanAccountObjectBaseline(context),
        )
      )
    ) {
      throw new ItineraryBaselineConflictError(
        '旅行、票据或账本内容已变化，请重新生成预览。',
      )
    }
    if (
      await db.tripReplanEvents.get(plan.event.id)
      || await db.tripReplanRecords.get(plan.record.id)
      || await db.tripIntelligenceAppliedChanges.get(plan.historyRecord.id)
    ) {
      throw new ItineraryBaselineConflictError('重排记录标识已被占用，请重新生成预览。')
    }
    await db.itineraryItems.bulkPut(plan.updatedItems)
    await db.tripReplanEvents.put(plan.event)
    await db.tripReplanRecords.put(plan.record)
    await db.tripIntelligenceAppliedChanges.put(plan.historyRecord)
    await db.trips.put(plan.trip)
    if (options.enqueueLegacy) {
      await Promise.all([
        ...plan.updatedItems.map((updated) => enqueueObjectUpsert({ object: updated, objectType: 'item' })),
        enqueueObjectUpsert({ object: plan.event, objectType: 'replan_event' }),
        enqueueObjectUpsert({ object: plan.record, objectType: 'replan_record' }),
        enqueueObjectUpsert({
          object: plan.historyRecord,
          objectType: 'trip_intelligence_applied_change',
        }),
      ])
    }
    output = {
      changed: true,
      changedItemCount: plan.updatedItems.length,
      record: plan.record,
    }
  })
  if (!output) throw new Error('突发重排事务没有返回结果。')
  return output
}

function stripAdaptiveReplanAccountBaseline(
  plan: AdaptiveReplanMutationPlan,
): AdaptiveReplanMutationPlan {
  if (!plan.record.accountObjectBaseline) return plan
  const record = { ...plan.record }
  delete record.accountObjectBaseline
  return { ...plan, record }
}

function buildAdaptiveReplanWorkflowSteps(plan: AdaptiveReplanMutationPlan) {
  return [
    {
      objectId: plan.trip.id,
      objectType: 'trip' as const,
      operation: 'upsert' as const,
      payload: plan.trip as unknown as JsonObject,
    },
    ...plan.updatedItems.map((item) => ({
      objectId: item.id,
      objectType: 'item' as const,
      operation: 'upsert' as const,
      payload: item as unknown as JsonObject,
    })),
    {
      objectId: plan.event.id,
      objectType: 'replan_event' as const,
      operation: 'upsert' as const,
      payload: plan.event as unknown as JsonObject,
    },
    {
      objectId: plan.record.id,
      objectType: 'replan_record' as const,
      operation: 'upsert' as const,
      payload: plan.record as unknown as JsonObject,
    },
    {
      objectId: plan.historyRecord.id,
      objectType: 'trip_intelligence_applied_change' as const,
      operation: 'upsert' as const,
      payload: plan.historyRecord as unknown as JsonObject,
    },
  ]
}

function canSubmitAdaptiveReplanWorkflow(
  steps: ReturnType<typeof buildAdaptiveReplanWorkflowSteps>,
) {
  if (steps.length > ACCOUNT_WORKFLOW_MAX_STEPS) return false
  const encoder = new TextEncoder()
  if (steps.some((step) => (
    encoder.encode(JSON.stringify(step.payload)).byteLength > ACCOUNT_OBJECT_MAX_PAYLOAD_BYTES
  ))) return false
  const requestEnvelopeReserve = 4_096 + steps.length * 512
  return encoder.encode(JSON.stringify(steps)).byteLength
    <= ACCOUNT_WORKFLOW_MAX_BYTES - requestEnvelopeReserve
}

async function loadAdaptiveReplanAccountObjectBaseline(
  context: AdaptiveReplanActionContext,
): Promise<TripReplanAccountObjectBaselineEntry[]> {
  const { getAccountObjectRevision } = await import('./accountCloud/localStore')
  const objects = [
    { objectId: context.trip.id, objectType: 'trip' as const },
    ...context.days.map((day) => ({ objectId: day.id, objectType: 'day' as const })),
    ...context.items.map((item) => ({ objectId: item.id, objectType: 'item' as const })),
    ...context.tickets.map((ticket) => ({ objectId: ticket.id, objectType: 'ticket_meta' as const })),
    ...context.ledgerExpenses.map((expense) => ({
      objectId: expense.id,
      objectType: 'ledger_expense' as const,
    })),
  ].sort((left, right) => (
    left.objectType.localeCompare(right.objectType) || left.objectId.localeCompare(right.objectId)
  ))
  return Promise.all(objects.map(async (object) => ({
    expectedRevision: (await getAccountObjectRevision(
      `${object.objectType}:${object.objectId}`,
    ))?.revision ?? 0,
    ...object,
  })))
}

async function recoverAdaptiveReplanReplay(
  prepared: PreparedAdaptiveReplanAction,
): Promise<AdaptiveReplanActionExecutionResult | null> {
  try {
    const record = await assertAdaptiveReplanActionApplied(prepared)
    return {
      changed: false,
      changedItemCount: countChangedItemsFromRecord(record),
      record,
    }
  } catch {
    return null
  }
}

function applyAdaptiveReplanPatches(
  items: ItineraryItem[],
  option: TripReplanOption,
  updatedAt: number,
) {
  const itemById = new Map(items.map((item) => [item.id, item]))
  const changedItemIds = new Set(option.diff.itemChanges
    .filter((change) => change.changeType !== 'unchanged')
    .map((change) => change.itemId))
  return option.itemPatches.flatMap((entry) => {
    if (!changedItemIds.has(entry.itemId)) return []
    const item = itemById.get(entry.itemId)
    if (!item) {
      throw new ItineraryBaselineConflictError(
        '重排行程点已不存在，请重新生成预览。',
      )
    }
    return [{
      ...item,
      ...entry.patch,
      ...(entry.patch.executionState
        ? {
            executionState: {
              ...entry.patch.executionState,
              updatedAt,
            },
          }
        : {}),
      updatedAt,
    }]
  })
}

async function assertAdaptiveReplanActionAppliedInTransaction(
  prepared: PreparedAdaptiveReplanAction,
  context: AdaptiveReplanActionContext,
) {
  const changeId = buildAdaptiveReplanChangeId(prepared.operationFingerprint)
  const [marker, event, record] = await Promise.all([
    getAdaptiveReplanMarker(prepared),
    db.tripReplanEvents.get(prepared.eventId),
    db.tripReplanRecords.get(prepared.recordId),
  ])
  if (
    !marker
    || !event
    || !record
    || marker.tripId !== prepared.tripId
    || marker.actionType !== 'global_ai_adaptive_replan_applied'
    || marker.dedupeKey !== `${prepared.tripId}:${changeId}`
    || marker.executionSource !== 'live'
    || marker.executionStatus !== 'success'
    || marker.privacyLevel !== 'private'
    || marker.sourceKind !== 'live'
    || marker.targetId !== (prepared.itemId ?? prepared.dayId)
    || marker.targetType !== 'live'
    || event.tripId !== prepared.tripId
    || event.dayId !== prepared.dayId
    || event.itemId !== prepared.itemId
    || event.kind !== prepared.disruptionKind
    || event.delayMinutes !== prepared.delayMinutes
    || event.occurredAt !== prepared.occurredAt
    || event.status !== 'applied'
    || record.tripId !== prepared.tripId
    || record.eventId !== prepared.eventId
    || record.status !== 'applied'
    || record.operationKind !== 'adaptive_replan'
    || record.operationFingerprint !== prepared.operationFingerprint
    || record.createdAt !== event.createdAt
    || record.updatedAt !== event.updatedAt
    || marker.occurredAt !== record.updatedAt
    || marker.sourceId !== record.id
    || marker.updatedAt !== record.updatedAt
    || !record.appliedFingerprint
    || !record.afterSnapshot
  ) {
    throw new ItineraryBaselineConflictError(
      '已执行的突发重排记录不完整，请重新生成预览。',
    )
  }
  const selectedOption = record.options.find((candidate) =>
    candidate.id === record.selectedOptionId,
  )
  if (
    !selectedOption
    || selectedOption.strategy !== prepared.strategy
    || buildAdaptiveReplanOptionFingerprint(selectedOption) !== prepared.previewFingerprint
  ) {
    throw new ItineraryBaselineConflictError(
      '已执行的突发重排策略不一致，请重新生成预览。',
    )
  }
  const scopeItemIds = record.scopeItemIds
    ?? record.afterSnapshot.items.map((candidate) => candidate.id)
  const currentSnapshot = buildAdaptiveReplanScopedSnapshot(
    context.days,
    context.items,
    scopeItemIds,
  )
  if (
    buildReplanFingerprint(currentSnapshot)
    !== record.appliedFingerprint
  ) {
    throw new ItineraryBaselineConflictError(
      '突发重排后的行程已变化，请重新生成预览。',
    )
  }
  return record
}

function getAdaptiveReplanMarker(prepared: PreparedAdaptiveReplanAction) {
  const changeId = buildAdaptiveReplanChangeId(
    prepared.operationFingerprint,
  )
  return db.tripIntelligenceAppliedChanges.get(
    buildTripIntelligenceAppliedChangeRecordId(prepared.tripId, changeId),
  )
}

function buildAdaptiveReplanEvent({
  createdAt,
  dayId,
  delayMinutes,
  disruptionKind,
  eventId,
  itemId,
  occurredAt,
  tripId,
}: {
  createdAt: number
  dayId: string
  delayMinutes?: number
  disruptionKind: PreparedAdaptiveReplanAction['disruptionKind']
  eventId: string
  itemId?: string
  occurredAt: string
  tripId: string
}): TripDisruptionEvent {
  return {
    createdAt,
    dayId,
    ...(delayMinutes !== undefined ? { delayMinutes } : {}),
    evidence: [],
    id: eventId,
    ...(itemId ? { itemId } : {}),
    kind: disruptionKind,
    notes: formatAdaptiveReplanReport(disruptionKind, delayMinutes),
    occurredAt,
    reportedByRole: 'owner',
    status: 'reported',
    tripId,
    updatedAt: createdAt,
  }
}

function buildAdaptiveReplanAppliedChange(
  prepared: PreparedAdaptiveReplanAction,
  record: TripReplanRecord,
  occurredAt: number,
): TripIntelligenceAppliedChange {
  const changedItemCount = countChangedItemsFromRecord(record)
  return {
    actionType: 'global_ai_adaptive_replan_applied',
    detail: `已确认按${formatReplanStrategy(prepared.strategy)}调整 ${changedItemCount} 个行程点。`,
    id: buildAdaptiveReplanChangeId(prepared.operationFingerprint),
    occurredAt,
    source: {
      id: record.id,
      kind: 'live',
      label: '突发重排',
    },
    targetId: prepared.itemId ?? prepared.dayId,
    targetType: 'live',
    title: '突发重排已应用',
  }
}

function buildAdaptiveReplanScopedSnapshot(
  days: Day[],
  items: ItineraryItem[],
  itemIds: string[],
): TripReplanSnapshot {
  const itemIdSet = new Set(itemIds)
  const scopedItems = items
    .filter((item) => itemIdSet.has(item.id))
    .sort((first, second) =>
      first.sortOrder - second.sortOrder || first.id.localeCompare(second.id),
    )
    .map((item) => ({ ...item }))
  const dayIds = new Set(scopedItems.map((item) => item.dayId))
  return {
    days: days
      .filter((day) => dayIds.has(day.id))
      .sort((first, second) =>
        first.sortOrder - second.sortOrder || first.id.localeCompare(second.id),
      )
      .map((day) => ({ ...day })),
    items: scopedItems,
  }
}

function buildAdaptiveReplanOptionFingerprint(option: TripReplanOption) {
  return stableStringify({
    itemChanges: option.diff.itemChanges
      .map((change) => ({
        after: normalizeItemSchedule(change.after),
        before: normalizeItemSchedule(change.before),
        changeType: change.changeType,
        itemId: change.itemId,
      }))
      .sort(compareByItemId),
    ledgerImpacts: option.diff.ledgerImpacts
      .map((impact) => ({
        expenseId: impact.expenseId,
        impact: impact.impact,
        itemIds: [...impact.itemIds].sort(),
      }))
      .sort((first, second) =>
        first.expenseId.localeCompare(second.expenseId),
      ),
    patches: option.itemPatches
      .map((entry) => ({
        itemId: entry.itemId,
        patch: {
          ...entry.patch,
          ...(entry.patch.executionState
            ? {
                executionState: {
                  status: entry.patch.executionState.status,
                },
              }
            : {}),
        },
      }))
      .sort(compareByItemId),
    strategy: option.strategy,
    ticketImpacts: option.diff.ticketImpacts
      .map((impact) => ({
        impact: impact.impact,
        itemId: impact.itemId,
        ticketId: impact.ticketId,
      }))
      .sort((first, second) =>
        first.ticketId.localeCompare(second.ticketId),
      ),
  })
}

function normalizeItemSchedule(
  schedule: TripReplanOption['diff']['itemChanges'][number]['before'],
) {
  return {
    dayId: schedule.dayId,
    endTime: schedule.endTime,
    executionState: schedule.executionState
      ? { status: schedule.executionState.status }
      : undefined,
    sortOrder: schedule.sortOrder,
    startTime: schedule.startTime,
  }
}

function requireStrategyOption(
  options: TripReplanOption[],
  strategy: TripReplanStrategy,
) {
  const option = options.find((candidate) =>
    candidate.strategy === strategy,
  )
  if (!option) throw new Error('没有找到指定的本地重排策略。')
  return option
}

function countChangedItems(option: TripReplanOption) {
  return option.diff.itemChanges.filter((change) =>
    change.changeType !== 'unchanged',
  ).length
}

function countChangedItemsFromRecord(record: TripReplanRecord) {
  return record.selectedDiff?.itemChanges.filter((change) =>
    change.changeType !== 'unchanged',
  ).length ?? 0
}

function buildAdaptiveReplanObjectId(
  prefix: 'replan_event' | 'replan_record',
  operationFingerprint: string,
) {
  return `${prefix}_${operationFingerprint.replace(/[^a-zA-Z0-9_-]/g, '_')}`
}

function buildAdaptiveReplanChangeId(operationFingerprint: string) {
  return `action-gateway:${operationFingerprint}`
}

function formatAdaptiveReplanReport(
  kind: PreparedAdaptiveReplanAction['disruptionKind'],
  delayMinutes?: number,
) {
  if (kind === 'late') return `用户报告晚到 ${delayMinutes ?? 30} 分钟`
  if (kind === 'delay') return `用户报告延误 ${delayMinutes ?? 30} 分钟`
  if (kind === 'closure') return '用户报告地点临时关闭'
  if (kind === 'cancelled') return '用户报告安排已取消'
  return '用户报告天气不适合原安排'
}

function formatReplanStrategy(strategy: TripReplanStrategy) {
  if (strategy === 'preserve_most') return '尽量保留'
  if (strategy === 'shortest_route') return '最省路程'
  return '最少改动'
}

function compareById(
  first: { id: string },
  second: { id: string },
) {
  return first.id.localeCompare(second.id)
}

function compareByItemId(
  first: { itemId: string },
  second: { itemId: string },
) {
  return first.itemId.localeCompare(second.itemId)
}

function stableStringify(value: unknown) {
  return JSON.stringify(sortJson(value))
}

function sameJson(left: unknown, right: unknown) {
  return stableStringify(left) === stableStringify(right)
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([key, nested]) => [key, sortJson(nested)]),
  )
}
