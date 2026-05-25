import { createId } from '../db/ids'
import { db } from '../db/database'
import { emitTravelDataChanged } from './dataEvents'
import { buildAiTripEditContext } from './aiTripEditContext'
import { validateAiTripEditPatchPlan, type AiTripEditPatchPlan } from './aiTripEditPatch'
import type { ItineraryItem } from '../types'

export type ApplyAiTripEditPatchResult =
  | { ok: true; appliedOperationCount: number }
  | { ok: false; errors: string[] }

export async function applyAiTripEditPatchPlanToDb(
  tripId: string,
  plan: AiTripEditPatchPlan,
  options: { now?: number } = {},
): Promise<ApplyAiTripEditPatchResult> {
  try {
    const now = options.now ?? Date.now()
    const result = await db.transaction('rw', db.trips, db.days, db.itineraryItems, async () => {
      const [trip, days, items] = await Promise.all([
        db.trips.get(tripId),
        db.days.where('tripId').equals(tripId).toArray(),
        db.itineraryItems.where('tripId').equals(tripId).toArray(),
      ])

      if (!trip) {
        return { errors: ['旅行不存在。'], ok: false as const }
      }

      const contextResult = buildAiTripEditContext({ days, items, trip })
      if (!contextResult.ok) {
        return { errors: contextResult.errors, ok: false as const }
      }

      const validation = validateAiTripEditPatchPlan(plan, contextResult.context)
      if (!validation.ok) {
        return {
          errors: validation.errors.map((error) => `${error.path}: ${error.message}`),
          ok: false as const,
        }
      }

      const itemMap = new Map(items.map((item) => [item.id, { ...item }]))
      for (const operation of validation.plan.operations) {
        if (operation.type === 'delete_item') {
          const item = itemMap.get(operation.itemId)
          if (item?.ticketIds.length) {
            return {
              errors: [`项目「${item.title}」已绑定票据，AI 修改不会删除它。`],
              ok: false as const,
            }
          }
        }
      }

      const dayOrder = new Map(days.map((day) => [
        day.id,
        items
          .filter((item) => item.dayId === day.id)
          .sort((first, second) => first.sortOrder - second.sortOrder || first.createdAt - second.createdAt)
          .map((item) => item.id),
      ]))
      const affectedDayIds = new Set<string>()
      const deletedItemIds: string[] = []
      const changedItems = new Map<string, ItineraryItem>()

      for (const operation of validation.plan.operations) {
        if (operation.type === 'update_item') {
          const item = itemMap.get(operation.itemId)
          if (!item) continue
          const updated: ItineraryItem = {
            ...item,
            ...operation.changes,
            updatedAt: now,
          }
          itemMap.set(item.id, updated)
          changedItems.set(item.id, updated)
          continue
        }

        if (operation.type === 'delete_item') {
          const item = itemMap.get(operation.itemId)
          if (!item) continue
          removeFromDayOrder(dayOrder, item.dayId, item.id)
          affectedDayIds.add(item.dayId)
          itemMap.delete(item.id)
          changedItems.delete(item.id)
          deletedItemIds.push(item.id)
          continue
        }

        if (operation.type === 'move_item') {
          const item = itemMap.get(operation.itemId)
          if (!item) continue
          removeFromDayOrder(dayOrder, item.dayId, item.id)
          affectedDayIds.add(item.dayId)
          const updated: ItineraryItem = {
            ...item,
            dayId: operation.targetDayId,
            sortOrder: operation.targetSortOrder ?? item.sortOrder,
            startTime: operation.targetStartTime ?? item.startTime,
            updatedAt: now,
          }
          itemMap.set(item.id, updated)
          insertIntoDayOrder(dayOrder, operation.targetDayId, item.id, operation.targetSortOrder)
          affectedDayIds.add(operation.targetDayId)
          changedItems.set(item.id, updated)
          continue
        }

        const item: ItineraryItem = {
          address: operation.item.address,
          createdAt: now,
          dayId: operation.targetDayId,
          endTime: operation.item.endTime,
          id: createId('item'),
          locationName: operation.item.locationName,
          previousTransportDurationMinutes: operation.item.previousTransportDurationMinutes,
          previousTransportMode: operation.item.previousTransportMode,
          sortOrder: operation.targetSortOrder ?? nextSortOrder(dayOrder.get(operation.targetDayId) ?? [], itemMap),
          startTime: operation.item.startTime,
          ticketIds: [],
          title: operation.item.title,
          tripId,
          updatedAt: now,
        }
        itemMap.set(item.id, item)
        insertIntoDayOrder(dayOrder, operation.targetDayId, item.id, operation.targetSortOrder)
        affectedDayIds.add(operation.targetDayId)
        changedItems.set(item.id, item)
      }

      for (const dayId of affectedDayIds) {
        const orderedIds = dayOrder.get(dayId) ?? []
        orderedIds.forEach((itemId, index) => {
          const item = itemMap.get(itemId)
          if (!item) return
          const updated = {
            ...item,
            sortOrder: index + 1,
            updatedAt: item.updatedAt === now ? item.updatedAt : now,
          }
          itemMap.set(itemId, updated)
          changedItems.set(itemId, updated)
        })
      }

      if (deletedItemIds.length > 0) {
        await db.itineraryItems.bulkDelete(deletedItemIds)
      }
      if (changedItems.size > 0) {
        await db.itineraryItems.bulkPut(Array.from(changedItems.values()))
      }
      await db.trips.update(tripId, { updatedAt: now })

      return { appliedOperationCount: validation.plan.operations.length, ok: true as const }
    })

    if (result.ok) {
      emitTravelDataChanged()
    }
    return result
  } catch {
    return { errors: ['应用 AI 修改方案失败，旅行未完成写入。'], ok: false }
  }
}

function removeFromDayOrder(dayOrder: Map<string, string[]>, dayId: string, itemId: string) {
  const order = dayOrder.get(dayId) ?? []
  dayOrder.set(dayId, order.filter((id) => id !== itemId))
}

function insertIntoDayOrder(
  dayOrder: Map<string, string[]>,
  dayId: string,
  itemId: string,
  targetSortOrder?: number,
) {
  const order = (dayOrder.get(dayId) ?? []).filter((id) => id !== itemId)
  if (targetSortOrder === undefined) {
    order.push(itemId)
  } else {
    order.splice(Math.max(0, Math.min(order.length, targetSortOrder - 1)), 0, itemId)
  }
  dayOrder.set(dayId, order)
}

function nextSortOrder(itemIds: string[], itemMap: Map<string, ItineraryItem>) {
  const max = itemIds.reduce((currentMax, itemId) => {
    const item = itemMap.get(itemId)
    return item ? Math.max(currentMax, item.sortOrder) : currentMax
  }, 0)
  return max + 1
}
