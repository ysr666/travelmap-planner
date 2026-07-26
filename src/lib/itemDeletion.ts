import { db } from '../db/database'
import * as repo from '../db/repositories'
import type { TripIntelligenceAppliedChange } from './tripIntelligence/types'
import type { TripReplanRecord } from '../types'
import { emitTravelDataChanged } from './dataEvents'
import { enqueueObjectDelete, enqueueObjectUpsert } from './objectSyncLocal'
import { appendTripIntelligenceExecutionResult } from './tripIntelligence/persistence'
import { recordTripWriteForSync } from './tripSyncQueue'

export type DeleteItineraryItemOptions =
  repo.DeleteItineraryItemReversibleOptions & {
    historyTitle?: string
  }

export type UndoItineraryItemDeletionOptions =
  repo.RestoreItineraryItemDeletionOptions & {
    historyTitle?: string
  }

const ITEM_DELETION_TRANSACTION_TABLES = [
  'days',
  'itineraryItems',
  'trips',
  'tripReplanRecords',
  'syncOutbox',
  'objectSyncStates',
  'tripIntelligenceAppliedChanges',
  'tripIntelligenceSuggestionStates',
] as const

export async function deleteItineraryItemReversible(
  itemId: string,
  options: DeleteItineraryItemOptions = {},
) {
  let output: Awaited<ReturnType<typeof repo.deleteItineraryItemReversible>>
  await db.transaction(
    'rw',
    [...ITEM_DELETION_TRANSACTION_TABLES],
    async () => {
      output = await repo.deleteItineraryItemReversible(itemId, options)
      if (!output?.deleted) return
      const operationFingerprint = output.operationRecord.operationFingerprint
        ?? `item-delete:${output.operationRecord.id}`
      await Promise.all([
        enqueueObjectDelete({
          deletedAtMs: output.operationRecord.updatedAt,
          objectId: output.deletedItem.id,
          objectType: 'item',
          tripId: output.deletedItem.tripId,
        }),
        ...output.changedItems.map((item) =>
          enqueueObjectUpsert({ object: item, objectType: 'item' as const }),
        ),
        enqueueObjectUpsert({
          object: output.operationRecord,
          objectType: 'replan_record',
        }),
      ])
      await appendItemDeletionHistory({
        actionType: 'itinerary_item_deleted',
        detail: '仅移除行程点；票据、账本和订单保持不变，可从删除历史撤销。',
        operationFingerprint,
        record: output.operationRecord,
        targetId: output.deletedItem.id,
        title: output.deletedItem.title,
      }, options.historyTitle ?? '删除行程点')
    },
  )
  if (output?.deleted) {
    recordTripWriteForSync(output.deletedItem.tripId, 'item-deleted-reversibly', {
      emitChangeEvent: false,
    })
    emitTravelDataChanged()
  }
  return output
}

export async function undoItineraryItemDeletion(
  recordId: string,
  options: UndoItineraryItemDeletionOptions = {},
) {
  let output: Awaited<ReturnType<typeof repo.restoreItineraryItemDeletion>> | undefined
  await db.transaction(
    'rw',
    [...ITEM_DELETION_TRANSACTION_TABLES],
    async () => {
      output = await repo.restoreItineraryItemDeletion(recordId, options)
      if (!output.restored) return
      const operationFingerprint = options.undoOperationFingerprint
        ?? `item-delete-undo:${output.operationRecord.id}`
      await Promise.all([
        ...output.changedItems.map((item) =>
          enqueueObjectUpsert({ object: item, objectType: 'item' as const }),
        ),
        enqueueObjectUpsert({
          object: output.operationRecord,
          objectType: 'replan_record',
        }),
      ])
      await appendItemDeletionHistory({
        actionType: 'itinerary_item_delete_undone',
        detail: '已恢复原行程点及当天顺序；票据、账本和订单关联保持不变。',
        operationFingerprint,
        record: output.operationRecord,
        targetId: output.restoredItem.id,
        title: output.restoredItem.title,
      }, options.historyTitle ?? '撤销删除')
    },
  )
  if (!output) throw new Error('撤销事务没有返回结果。')
  if (output.restored) {
    recordTripWriteForSync(output.restoredItem.tripId, 'item-deletion-undone', {
      emitChangeEvent: false,
    })
    emitTravelDataChanged()
  }
  return output
}

export async function listAppliedItemDeletionRecords(tripId: string) {
  const records = await db.tripReplanRecords.where('tripId').equals(tripId).toArray()
  return records
    .filter((record) =>
      record.operationKind === 'item_delete'
      && record.status === 'applied',
    )
    .sort((first, second) =>
      second.updatedAt - first.updatedAt || second.createdAt - first.createdAt,
    )
}

async function appendItemDeletionHistory(
  {
    actionType,
    detail,
    operationFingerprint,
    record,
    targetId,
    title,
  }: {
    actionType: string
    detail: string
    operationFingerprint: string
    record: TripReplanRecord
    targetId: string
    title: string
  },
  historyTitle: string,
) {
  const change: TripIntelligenceAppliedChange = {
    actionType,
    detail,
    id: `action-gateway:${operationFingerprint}`,
    occurredAt: record.updatedAt,
    source: {
      id: 'item_deletion',
      kind: 'operations',
      label: '行程编辑',
    },
    targetId,
    targetType: 'item',
    title,
  }
  await appendTripIntelligenceExecutionResult(record.tripId, {
    result: {
      appliedChanges: [change],
      message: `${historyTitle}已完成。`,
      status: 'completed',
    },
    source: 'operations',
    title: historyTitle,
  }, record.updatedAt)
}
