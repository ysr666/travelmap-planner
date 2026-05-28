import { createId } from '../../db/ids'
import { db } from '../../db/database'
import { emitTravelDataChanged } from '../dataEvents'
import { buildAiTripEditContext, type AiTripEditContext } from './aiTripEditContext'
import {
  buildAiTripEditPatchPreview,
  validateAiTripEditPatchPlan,
  type AiTripEditPatchPlan,
  type AiTripEditPatchPreview,
} from './aiTripEditPatch'
import type { Day, ItineraryItem, Trip } from '../../types'

export type AiTripEditLocalStateFingerprintInput = {
  trip: Trip
  days: Day[]
  items: ItineraryItem[]
}

export type AiTripEditApplyPayload = {
  plan: AiTripEditPatchPlan
  preview: AiTripEditPatchPreview
  writeOperationCount: number
}

export type BuildAiTripEditApplyPayloadResult =
  | { ok: true; payload: AiTripEditApplyPayload }
  | { ok: false; errors: string[] }

export type ApplyAiTripEditPatchResult =
  | { ok: true; appliedOperationCount: number }
  | { ok: false; errors: string[] }

export function buildAiTripEditApplyPayload(
  plan: AiTripEditPatchPlan,
  context: AiTripEditContext,
): BuildAiTripEditApplyPayloadResult {
  const validation = validateAiTripEditPatchPlan(plan, context)
  if (!validation.ok) {
    return { errors: validation.errors.map((error) => `${error.path}: ${error.message}`), ok: false }
  }

  for (const operation of validation.plan.operations) {
    if (operation.type !== 'remove_item') continue
    const item = context.days.flatMap((day) => day.items).find((candidate) => candidate.id === operation.itemId)
    if (item?.ticketBoundState === 'item_bound' || item?.hasTicketBindings || (item?.ticketCount ?? 0) > 0) {
      return {
        errors: [`项目「${item?.title ?? operation.itemId}」已绑定票据，AI 修改不会删除它。`],
        ok: false,
      }
    }
  }

  return {
    ok: true,
    payload: {
      plan: validation.plan,
      preview: buildAiTripEditPatchPreview(validation.plan, context),
      writeOperationCount: validation.plan.operations.length,
    },
  }
}

export function buildAiTripEditLocalStateFingerprint({
  days,
  items,
  trip,
}: AiTripEditLocalStateFingerprintInput): string {
  const normalized = {
    days: [...days]
      .filter((day) => day.tripId === trip.id)
      .sort((first, second) => first.sortOrder - second.sortOrder || first.id.localeCompare(second.id))
      .map((day) => ({
        date: day.date,
        id: day.id,
        sortOrder: day.sortOrder,
        title: day.title,
      })),
    items: [...items]
      .filter((item) => item.tripId === trip.id)
      .sort((first, second) =>
        first.dayId.localeCompare(second.dayId) ||
        first.sortOrder - second.sortOrder ||
        first.id.localeCompare(second.id),
      )
      .map((item) => ({
        address: item.address ?? '',
        dayId: item.dayId,
        endTime: item.endTime ?? '',
        id: item.id,
        lat: finiteNumberOrNull(item.lat),
        lng: finiteNumberOrNull(item.lng),
        locationName: item.locationName ?? '',
        notes: item.notes ?? '',
        previousTransportDurationMinutes: finiteNumberOrNull(item.previousTransportDurationMinutes),
        previousTransportMode: item.previousTransportMode ?? '',
        previousTransportNote: item.previousTransportNote ?? '',
        sortOrder: item.sortOrder,
        startTime: item.startTime ?? '',
        ticketIds: [...item.ticketIds].sort(),
        title: item.title,
        transportMode: item.transportMode ?? '',
      })),
    trip: {
      destination: trip.destination,
      endDate: trip.endDate,
      id: trip.id,
      notes: trip.notes ?? '',
      startDate: trip.startDate,
      title: trip.title,
    },
  }

  return stableHash(JSON.stringify(normalized))
}

export async function applyAiTripEditPatchPlanToDb(
  tripId: string,
  plan: AiTripEditPatchPlan,
  options: { expectedBaselineFingerprint?: string; now?: number } = {},
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

      if (options.expectedBaselineFingerprint) {
        const freshFingerprint = buildAiTripEditLocalStateFingerprint({ days, items, trip })
        if (freshFingerprint !== options.expectedBaselineFingerprint) {
          return { errors: ['本地行程已变化，请重新生成 AI 修改方案。'], ok: false as const }
        }
      }

      const contextResult = buildAiTripEditContext({ days, items, trip })
      if (!contextResult.ok) {
        return { errors: contextResult.errors, ok: false as const }
      }

      const payloadResult = buildAiTripEditApplyPayload(plan, contextResult.context)
      if (!payloadResult.ok) {
        return { errors: payloadResult.errors, ok: false as const }
      }
      if (payloadResult.payload.writeOperationCount === 0) {
        return { appliedOperationCount: 0, ok: true as const }
      }

      const itemMap = new Map(items.map((item) => [item.id, { ...item }]))
      const dayMap = new Map(days.map((day) => [day.id, { ...day }]))
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
      const changedDays = new Map<string, Day>()

      for (const operation of payloadResult.payload.plan.operations) {
        if (operation.type === 'update_item_title') {
          const item = requireItem(itemMap, operation.itemId)
          const updated = { ...item, title: operation.title, updatedAt: now }
          itemMap.set(item.id, updated)
          changedItems.set(item.id, updated)
          continue
        }

        if (operation.type === 'update_item_time') {
          const item = requireItem(itemMap, operation.itemId)
          const updated = {
            ...item,
            endTime: operation.endTime ?? item.endTime,
            startTime: operation.startTime ?? item.startTime,
            updatedAt: now,
          }
          itemMap.set(item.id, updated)
          changedItems.set(item.id, updated)
          continue
        }

        if (operation.type === 'update_item_location_text') {
          const item = requireItem(itemMap, operation.itemId)
          const updated = {
            ...item,
            address: operation.address ?? item.address,
            locationName: operation.locationName ?? item.locationName,
            updatedAt: now,
          }
          itemMap.set(item.id, updated)
          changedItems.set(item.id, updated)
          continue
        }

        if (operation.type === 'update_item_note') {
          const item = requireItem(itemMap, operation.itemId)
          const updated = { ...item, notes: operation.note, updatedAt: now }
          itemMap.set(item.id, updated)
          changedItems.set(item.id, updated)
          continue
        }

        if (operation.type === 'update_item_transport') {
          const item = requireItem(itemMap, operation.itemId)
          const updated = {
            ...item,
            previousTransportDurationMinutes: operation.previousTransportDurationMinutes ?? item.previousTransportDurationMinutes,
            previousTransportMode: operation.previousTransportMode ?? item.previousTransportMode,
            updatedAt: now,
          }
          itemMap.set(item.id, updated)
          changedItems.set(item.id, updated)
          continue
        }

        if (operation.type === 'remove_item') {
          const item = requireItem(itemMap, operation.itemId)
          if (item.ticketIds.length > 0) {
            return {
              errors: [`项目「${item.title}」已绑定票据，AI 修改不会删除它。`],
              ok: false as const,
            }
          }
          removeFromDayOrder(dayOrder, item.dayId, item.id)
          affectedDayIds.add(item.dayId)
          itemMap.delete(item.id)
          changedItems.delete(item.id)
          deletedItemIds.push(item.id)
          continue
        }

        if (operation.type === 'move_item') {
          const item = requireItem(itemMap, operation.itemId)
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

        if (operation.type === 'add_item') {
          const item: ItineraryItem = {
            address: operation.item.address,
            createdAt: now,
            dayId: operation.targetDayId,
            endTime: operation.item.endTime,
            id: createId('item'),
            locationName: operation.item.locationName,
            notes: operation.item.note,
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
          continue
        }

        if (operation.type === 'reorder_day_items') {
          dayOrder.set(operation.dayId, [...operation.orderedItemIds])
          affectedDayIds.add(operation.dayId)
          continue
        }

        const day = dayMap.get(operation.dayId)
        if (!day) {
          return { errors: ['日期不存在，请重新生成 AI 修改方案。'], ok: false as const }
        }
        const updated = { ...day, title: operation.title }
        dayMap.set(day.id, updated)
        changedDays.set(day.id, updated)
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
      if (changedDays.size > 0) {
        await db.days.bulkPut(Array.from(changedDays.values()))
      }
      await db.trips.update(tripId, { updatedAt: now })

      return { appliedOperationCount: payloadResult.payload.writeOperationCount, ok: true as const }
    })

    if (result.ok && result.appliedOperationCount > 0) {
      emitTravelDataChanged()
    }
    return result
  } catch {
    return { errors: ['应用 AI 修改方案失败，旅行未完成写入。'], ok: false }
  }
}

function requireItem(itemMap: Map<string, ItineraryItem>, itemId: string) {
  const item = itemMap.get(itemId)
  if (!item) {
    throw new Error('missing item')
  }
  return item
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

function finiteNumberOrNull(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stableHash(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
