import { db } from '../db/database'
import { ItineraryBaselineConflictError } from '../db/repositories'
import type {
  ItineraryExecutionStatus,
  ItineraryItem,
  ItineraryReplanPreference,
} from '../types'
import { emitTravelDataChanged } from './dataEvents'
import { enqueueObjectUpsert } from './objectSyncLocal'
import {
  appendTripIntelligenceExecutionResult,
  buildTripIntelligenceAppliedChangeRecordId,
} from './tripIntelligence/persistence'
import type { TripIntelligenceAppliedChange } from './tripIntelligence/types'
import { recordTripWriteForSync } from './tripSyncQueue'

export type ItemStateUpdateOptions = {
  expectedUpdatedAt: number
  historyTitle: string
  now?: number
  operationFingerprint: string
  tripId: string
}

export type ItemStateUpdateResult = {
  changed: boolean
  item: ItineraryItem
}

const ITEM_STATE_UPDATE_TRANSACTION_TABLES = [
  'itineraryItems',
  'trips',
  'syncOutbox',
  'objectSyncStates',
  'tripIntelligenceAppliedChanges',
  'tripIntelligenceSuggestionStates',
] as const

export async function updateItineraryItemExecutionStateAtomically(
  itemId: string,
  status: ItineraryExecutionStatus | null,
  options: ItemStateUpdateOptions,
): Promise<ItemStateUpdateResult> {
  return applyItemStateUpdate({
    actionType: status === 'completed'
      ? 'global_ai_item_completed'
      : status === 'skipped'
        ? 'global_ai_item_skipped'
        : 'global_ai_item_reactivated',
    buildNext: (item, updatedAt) => ({
      ...item,
      executionState: status ? { status, updatedAt } : undefined,
      updatedAt,
    }),
    detail: status === 'completed'
      ? '已确认标记为完成。'
      : status === 'skipped'
        ? '已确认标记为跳过。'
        : '已确认恢复为待进行。',
    itemId,
    matches: (item) => status
      ? item.executionState?.status === status
      : item.executionState === undefined,
    options,
  })
}

export async function updateItineraryItemReplanPreferenceAtomically(
  itemId: string,
  preference: ItineraryReplanPreference,
  options: ItemStateUpdateOptions,
): Promise<ItemStateUpdateResult> {
  const normalizedPreference = normalizePreference(preference)
  return applyItemStateUpdate({
    actionType: 'global_ai_item_replan_preference_updated',
    buildNext: (item, updatedAt) => ({
      ...item,
      replanPreference: normalizedPreference,
      updatedAt,
    }),
    detail: '已确认更新固定范围内的重排偏好。',
    itemId,
    matches: (item) => samePreference(item.replanPreference, normalizedPreference),
    options,
  })
}

async function applyItemStateUpdate({
  actionType,
  buildNext,
  detail,
  itemId,
  matches,
  options,
}: {
  actionType: string
  buildNext: (item: ItineraryItem, updatedAt: number) => ItineraryItem
  detail: string
  itemId: string
  matches: (item: ItineraryItem) => boolean
  options: ItemStateUpdateOptions
}) {
  let output: ItemStateUpdateResult | undefined
  const changeId = `action-gateway:${options.operationFingerprint}`
  const markerId = buildTripIntelligenceAppliedChangeRecordId(
    options.tripId,
    changeId,
  )

  await db.transaction(
    'rw',
    [...ITEM_STATE_UPDATE_TRANSACTION_TABLES],
    async () => {
      const item = await db.itineraryItems.get(itemId)
      if (!item || item.tripId !== options.tripId) {
        throw new ItineraryBaselineConflictError('目标行程点已不存在。')
      }
      const marker = await db.tripIntelligenceAppliedChanges.get(markerId)
      if (marker) {
        if (marker.tripId !== options.tripId || !matches(item)) {
          throw new ItineraryBaselineConflictError(
            '已执行的操作记录与当前行程点状态不一致。',
          )
        }
        output = { changed: false, item }
        return
      }
      if (item.updatedAt !== options.expectedUpdatedAt) {
        throw new ItineraryBaselineConflictError(
          '行程点内容已变化，请重新生成预览。',
        )
      }
      if (matches(item)) {
        output = { changed: false, item }
        return
      }

      const updatedAt = Math.max(options.now ?? Date.now(), item.updatedAt + 1)
      const updated = buildNext(item, updatedAt)
      await db.itineraryItems.put(updated)
      await db.trips.update(item.tripId, { updatedAt })
      await enqueueObjectUpsert({ object: updated, objectType: 'item' })
      await appendTripIntelligenceExecutionResult(item.tripId, {
        result: {
          appliedChanges: [buildAppliedChange({
            actionType,
            changeId,
            detail,
            item: updated,
            occurredAt: updatedAt,
          })],
          message: `${options.historyTitle}已完成。`,
          status: 'completed',
        },
        source: 'operations',
        title: options.historyTitle,
      }, updatedAt)
      output = { changed: true, item: updated }
    },
  )

  if (!output) throw new Error('行程点状态事务没有返回结果。')
  if (output.changed) {
    recordTripWriteForSync(output.item.tripId, 'item-state-updated', {
      emitChangeEvent: false,
    })
    emitTravelDataChanged()
  }
  return output
}

function buildAppliedChange({
  actionType,
  changeId,
  detail,
  item,
  occurredAt,
}: {
  actionType: string
  changeId: string
  detail: string
  item: ItineraryItem
  occurredAt: number
}): TripIntelligenceAppliedChange {
  return {
    actionType,
    detail,
    id: changeId,
    occurredAt,
    source: {
      id: 'item_state_update',
      kind: 'operations',
      label: '行程编辑',
    },
    targetId: item.id,
    targetType: 'item',
    title: item.title,
  }
}

function normalizePreference(
  preference: ItineraryReplanPreference,
): ItineraryReplanPreference {
  return {
    ...(preference.bufferMinutes !== undefined
      ? { bufferMinutes: preference.bufferMinutes }
      : {}),
    ...(preference.flexibility ? { flexibility: preference.flexibility } : {}),
    ...(preference.minimumStayMinutes !== undefined
      ? { minimumStayMinutes: preference.minimumStayMinutes }
      : {}),
    ...(preference.mobilitySuitability
      ? { mobilitySuitability: preference.mobilitySuitability }
      : {}),
    ...(preference.priority ? { priority: preference.priority } : {}),
    ...(preference.weatherSuitability
      ? { weatherSuitability: preference.weatherSuitability }
      : {}),
  }
}

function samePreference(
  first: ItineraryReplanPreference | undefined,
  second: ItineraryReplanPreference,
) {
  return JSON.stringify(normalizePreference(first ?? {}))
    === JSON.stringify(second)
}
