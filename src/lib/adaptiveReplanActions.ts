import { db } from '../db/database'
import { ItineraryBaselineConflictError } from '../db/repositories'
import type {
  Day,
  ItineraryItem,
  LedgerExpense,
  TicketMeta,
  Trip,
  TripDisruptionEvent,
  TripDisruptionKind,
  TripReplanOption,
  TripReplanRecord,
  TripReplanSnapshot,
  TripReplanStrategy,
} from '../types'
import {
  buildReplanFingerprint,
  buildTripReplanPreview,
} from './adaptiveReplanning'
import { emitTravelDataChanged } from './dataEvents'
import { enqueueObjectUpsert } from './objectSyncLocal'
import {
  appendTripIntelligenceExecutionResult,
  buildTripIntelligenceAppliedChangeRecordId,
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

  let output: AdaptiveReplanActionExecutionResult | undefined
  await db.transaction(
    'rw',
    [...ADAPTIVE_REPLAN_TRANSACTION_TABLES],
    async () => {
      const context = await loadAdaptiveReplanActionContext(prepared.tripId)
      const marker = await getAdaptiveReplanMarker(prepared)
      if (marker) {
        const record = await assertAdaptiveReplanActionAppliedInTransaction(
          prepared,
          context,
        )
        output = {
          changed: false,
          changedItemCount: countChangedItemsFromRecord(record),
          record,
        }
        return
      }

      if (
        buildAdaptiveReplanActionBaseline(context)
        !== prepared.baselineFingerprint
      ) {
        throw new ItineraryBaselineConflictError(
          '旅行、票据或账本内容已变化，请重新生成预览。',
        )
      }
      const day = context.days.find((candidate) =>
        candidate.id === prepared.dayId,
      )
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
      const now = Math.max(
        Date.now(),
        context.trip.updatedAt + 1,
        latestItemUpdatedAt + 1,
      )
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
      const preview = buildTripReplanPreview({
        ...context,
        event,
        now: new Date(now),
      })
      const selectedOption = requireStrategyOption(
        preview.options,
        prepared.strategy,
      )
      if (
        buildAdaptiveReplanOptionFingerprint(selectedOption)
        !== prepared.previewFingerprint
      ) {
        throw new ItineraryBaselineConflictError(
          '重排结果已变化，请重新生成预览。',
        )
      }
      const updatedItems = applyAdaptiveReplanPatches(
        context.items,
        selectedOption,
        now,
      )
      if (updatedItems.length === 0) {
        output = { changed: false, changedItemCount: 0 }
        return
      }

      const itemById = new Map(context.items.map((candidate) => [
        candidate.id,
        candidate,
      ]))
      for (const updated of updatedItems) itemById.set(updated.id, updated)
      const scopeItemIds = selectedOption.diff.itemChanges
        .filter((change) => change.changeType !== 'unchanged')
        .map((change) => change.itemId)
      const afterSnapshot = buildAdaptiveReplanScopedSnapshot(
        context.days,
        [...itemById.values()],
        scopeItemIds,
      )
      const appliedFingerprint = buildReplanFingerprint(afterSnapshot)
      const persistedEvent: TripDisruptionEvent = {
        ...event,
        status: 'applied',
        updatedAt: now,
      }
      const record: TripReplanRecord = {
        ...preview,
        afterSnapshot,
        appliedFingerprint,
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

      await db.itineraryItems.bulkPut(updatedItems)
      await db.tripReplanEvents.put(persistedEvent)
      await db.tripReplanRecords.put(record)
      await db.trips.put({ ...context.trip, updatedAt: now })
      await Promise.all([
        ...updatedItems.map((updated) =>
          enqueueObjectUpsert({ object: updated, objectType: 'item' }),
        ),
        enqueueObjectUpsert({
          object: persistedEvent,
          objectType: 'replan_event',
        }),
        enqueueObjectUpsert({
          object: record,
          objectType: 'replan_record',
        }),
      ])
      await appendTripIntelligenceExecutionResult(context.trip.id, {
        result: {
          appliedChanges: [
            buildAdaptiveReplanAppliedChange(prepared, record, now),
          ],
          message: 'AI 突发重排已完成。',
          status: 'completed',
        },
        source: 'live',
        title: 'AI 突发重排',
      }, now)
      output = {
        changed: true,
        changedItemCount: updatedItems.length,
        record,
      }
    },
  )

  if (!output) throw new Error('突发重排事务没有返回结果。')
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
  if (!selectedOption || selectedOption.strategy !== prepared.strategy) {
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

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([key, nested]) => [key, sortJson(nested)]),
  )
}
