import { db } from './database'
import Dexie from 'dexie'
import { createId } from './ids'
import { sortItineraryItems, sortItineraryItemsByPlanOrder } from '../lib/itinerary'
import { buildTripOperationSnapshotFingerprint } from '../lib/tripOperationSnapshots'
import type {
  Day,
  ItineraryItem,
  LedgerBudget,
  LedgerExpense,
  LedgerParticipant,
  LedgerSettings,
  TicketBlob,
  TicketMeta,
  TicketScope,
  TripDisruptionEvent,
  TripReplanRecord,
  Trip,
} from '../types'

type CreateTripInput = Omit<Trip, 'id' | 'createdAt' | 'updatedAt'>
type UpdateTripPatch = Partial<Omit<Trip, 'id' | 'createdAt' | 'updatedAt'>>
type ParentTripTouchOptions = { touchTrip?: boolean }

type CreateDayInput = Omit<Day, 'id'>
type UpdateDayPatch = Partial<Omit<Day, 'id' | 'tripId'>>

type CreateItineraryItemInput = Omit<ItineraryItem, 'id' | 'createdAt' | 'updatedAt'>
type UpdateItineraryItemPatch = Partial<
  Omit<ItineraryItem, 'id' | 'tripId' | 'dayId' | 'createdAt' | 'updatedAt'>
>

export type DayItemsReorderPlan = {
  afterItems: ItineraryItem[]
  beforeItems: ItineraryItem[]
  changedItems: ItineraryItem[]
  day: Day
  dayId: string
  orderedItemIds: string[]
  tripId: string
  updatedAt: number
}

export type ItineraryItemMovePlan = {
  afterItems: ItineraryItem[]
  beforeDestinationItems: ItineraryItem[]
  beforeSourceItems: ItineraryItem[]
  changedItems: ItineraryItem[]
  destinationDay: Day
  destinationDayId: string
  destinationItemIds: string[]
  itemId: string
  movedItem: ItineraryItem
  nextDestinationItemIds: string[]
  sourceDay: Day
  sourceDayId: string
  sourceItemIds: string[]
  tripId: string
  updatedAt: number
}

type StructuralItemCommitOptions = {
  touchTrip?: boolean
}

export class ItineraryBaselineConflictError extends Error {}
export class TicketBaselineConflictError extends Error {}

type CreateTicketMetaInput = Omit<TicketMeta, 'id' | 'createdAt' | 'updatedAt'>
type UpdateTicketMetaInput = {
  expectedBinding?: {
    currentItem?: {
      id: string
      ticketIds: string[]
      updatedAt: number
    }
    itemId?: string
    targetItem: {
      id: string
      ticketIds: string[]
      updatedAt: number
    }
    ticketUpdatedAt: number
  }
  itemId?: string
  note?: string
  sharedVisibility?: TicketMeta['sharedVisibility']
  scope: TicketScope
  structuredFields?: TicketMeta['structuredFields']
  ticketCategory?: TicketMeta['ticketCategory']
  title?: string
}
type UpdateTicketMetaResult = {
  changedItems: ItineraryItem[]
  ticket: TicketMeta
}
export type TicketMetaUpdatePlan = {
  afterRelationshipItems: ItineraryItem[]
  afterTicket: TicketMeta
  beforeRelationshipItems: ItineraryItem[]
  beforeTicket: TicketMeta
  changedItems: ItineraryItem[]
  targetItemId?: string
  ticketId: string
  tripId: string
  updatedAt: number
}
type CreateTripDisruptionEventInput = Omit<TripDisruptionEvent, 'id' | 'createdAt' | 'updatedAt'>
type UpdateTripDisruptionEventPatch = Partial<Omit<TripDisruptionEvent, 'id' | 'tripId' | 'createdAt' | 'updatedAt'>>
type CreateTripReplanRecordInput = Omit<TripReplanRecord, 'id' | 'createdAt' | 'updatedAt'>
type UpdateTripReplanRecordPatch = Partial<Omit<TripReplanRecord, 'id' | 'tripId' | 'eventId' | 'createdAt' | 'updatedAt'>>

export type DeleteItineraryItemReversibleOptions = {
  expectedBaselineFingerprint?: string
  expectedCurrentItemIds?: string[]
  expectedItemUpdatedAt?: number
  now?: number
  operationFingerprint?: string
  operationRecordId?: string
  tripId?: string
}

export type RestoreItineraryItemDeletionOptions = {
  expectedAppliedFingerprint?: string
  now?: number
  tripId?: string
  undoOperationFingerprint?: string
}

export type ReversibleItemDeletionResult = {
  changedItems: ItineraryItem[]
  deleted: boolean
  deletedItem: ItineraryItem
  operationRecord: TripReplanRecord
}

export type RestoredItemDeletionResult = {
  changedItems: ItineraryItem[]
  operationRecord: TripReplanRecord
  restored: boolean
  restoredItem: ItineraryItem
}

export type ImportTripBackupRecordsInput = {
  trip: Trip
  days: Day[]
  itineraryItems: ItineraryItem[]
  ticketMetas: TicketMeta[]
  ticketBlobs: TicketBlob[]
  ledgerSettings?: LedgerSettings[]
  ledgerParticipants?: LedgerParticipant[]
  ledgerBudgets?: LedgerBudget[]
  ledgerExpenses?: LedgerExpense[]
  importedTitleSuffix: string
}

export type ImportTripPlanRecordsInput = {
  trip: Trip
  days: Day[]
  itineraryItems: ItineraryItem[]
  ticketMetas: TicketMeta[]
  ticketBlobs: TicketBlob[]
  ledgerSettings?: LedgerSettings[]
  ledgerParticipants?: LedgerParticipant[]
  ledgerBudgets?: LedgerBudget[]
  ledgerExpenses?: LedgerExpense[]
}

export async function createTrip(input: CreateTripInput) {
  const now = Date.now()
  const trip: Trip = {
    ...input,
    id: createId('trip'),
    createdAt: now,
    updatedAt: now,
  }

  await db.trips.add(trip)
  return trip
}

export async function listTrips() {
  return db.trips.orderBy('updatedAt').reverse().toArray()
}

export async function getTrip(tripId: string) {
  return db.trips.get(tripId)
}

export async function updateTrip(tripId: string, patch: UpdateTripPatch) {
  await db.trips.update(tripId, {
    ...patch,
    updatedAt: Date.now(),
  })
  return getTrip(tripId)
}

export async function deleteTripCascade(tripId: string) {
  await db.transaction(
    'rw',
    [
      db.trips,
      db.days,
      db.itineraryItems,
      db.ticketMetas,
      db.ticketBlobs,
      db.ledgerSettings,
      db.ledgerParticipants,
      db.ledgerBudgets,
      db.ledgerExpenses,
      db.tripReplanEvents,
      db.tripReplanRecords,
    ],
    async () => {
      const [items, ticketMetas] = await Promise.all([
        db.itineraryItems.where('tripId').equals(tripId).toArray(),
        db.ticketMetas.where('tripId').equals(tripId).toArray(),
      ])
      const itemIds = items.map((item) => item.id)
      const ticketIds = ticketMetas.map((ticket) => ticket.id)

      await Promise.all([
        db.trips.delete(tripId),
        db.days.where('tripId').equals(tripId).delete(),
        itemIds.length > 0 ? db.itineraryItems.bulkDelete(itemIds) : Promise.resolve(),
        ticketIds.length > 0 ? db.ticketMetas.bulkDelete(ticketIds) : Promise.resolve(),
        ticketIds.length > 0 ? db.ticketBlobs.bulkDelete(ticketIds) : Promise.resolve(),
        db.ledgerSettings.where('tripId').equals(tripId).delete(),
        db.ledgerParticipants.where('tripId').equals(tripId).delete(),
        db.ledgerBudgets.where('tripId').equals(tripId).delete(),
        db.ledgerExpenses.where('tripId').equals(tripId).delete(),
        db.tripReplanEvents.where('tripId').equals(tripId).delete(),
        db.tripReplanRecords.where('tripId').equals(tripId).delete(),
      ])
    },
  )
}

export async function createDay(input: CreateDayInput, options: ParentTripTouchOptions = {}) {
  const day: Day = {
    ...input,
    id: createId('day'),
  }

  await db.days.add(day)
  if (options.touchTrip !== false) {
    await db.trips.update(day.tripId, { updatedAt: Date.now() })
  }
  return day
}

export async function listDaysByTrip(tripId: string) {
  return db.days.where('[tripId+sortOrder]').between([tripId, DexieMinKey], [tripId, DexieMaxKey]).toArray()
}

export async function getDay(dayId: string) {
  return db.days.get(dayId)
}

export async function updateDay(
  dayId: string,
  patch: UpdateDayPatch,
  options: ParentTripTouchOptions = {},
) {
  const day = await db.days.get(dayId)
  if (!day) {
    return undefined
  }

  await db.transaction('rw', db.days, db.trips, async () => {
    await db.days.update(dayId, patch)
    if (options.touchTrip !== false) {
      await db.trips.update(day.tripId, { updatedAt: Date.now() })
    }
  })

  return getDay(dayId)
}

export async function deleteDayCascade(dayId: string) {
  await db.transaction(
    'rw',
    [db.days, db.itineraryItems, db.ticketMetas, db.ticketBlobs, db.trips],
    async () => {
      const day = await db.days.get(dayId)
      if (!day) {
        return
      }

      const items = await db.itineraryItems.where('dayId').equals(dayId).toArray()
      const itemIds = items.map((item) => item.id)
      const itemIdSet = new Set(itemIds)
      const ticketMetas = await db.ticketMetas
        .where('tripId')
        .equals(day.tripId)
        .filter((ticket) => Boolean(ticket.itemId && itemIdSet.has(ticket.itemId)))
        .toArray()
      const ticketIds = ticketMetas.map((ticket) => ticket.id)

      await Promise.all([
        db.days.delete(dayId),
        itemIds.length > 0 ? db.itineraryItems.bulkDelete(itemIds) : Promise.resolve(),
        ticketIds.length > 0 ? db.ticketMetas.bulkDelete(ticketIds) : Promise.resolve(),
        ticketIds.length > 0 ? db.ticketBlobs.bulkDelete(ticketIds) : Promise.resolve(),
        db.trips.update(day.tripId, { updatedAt: Date.now() }),
      ])
    },
  )
}

export async function createItineraryItem(
  input: CreateItineraryItemInput,
  options: ParentTripTouchOptions = {},
) {
  const now = Date.now()
  const item: ItineraryItem = {
    ...input,
    id: createId('item'),
    createdAt: now,
    updatedAt: now,
  }

  await db.transaction('rw', db.itineraryItems, db.trips, async () => {
    await db.itineraryItems.add(item)
    if (options.touchTrip !== false) {
      await db.trips.update(item.tripId, { updatedAt: now })
    }
  })

  return item
}

export async function createItineraryItemIdempotent(
  input: CreateItineraryItemInput,
  options: {
    expectedCurrentItemIds: string[]
    id: string
  },
) {
  return db.transaction('rw', db.days, db.itineraryItems, db.trips, async () => {
    const existing = await db.itineraryItems.get(options.id)
    if (existing) {
      if (!matchesIdempotentItemInput(existing, input)) {
        throw new Error('幂等新增目标与现有行程点不一致。')
      }
      return { created: false, item: existing }
    }

    const day = await db.days.get(input.dayId)
    if (!day || day.tripId !== input.tripId) {
      throw new Error('目标日期已不存在。')
    }
    const currentItems = sortItineraryItemsByPlanOrder(
      await db.itineraryItems.where('dayId').equals(input.dayId).toArray(),
    )
    if (
      options.expectedCurrentItemIds.length !== currentItems.length
      || options.expectedCurrentItemIds.some((itemId, index) => itemId !== currentItems[index]?.id)
    ) {
      throw new ItineraryBaselineConflictError('当天行程已变化，请重新生成预览。')
    }

    const now = Date.now()
    const item: ItineraryItem = {
      ...input,
      id: options.id,
      createdAt: now,
      updatedAt: now,
    }
    await db.itineraryItems.add(item)
    await db.trips.update(item.tripId, { updatedAt: now })
    return { created: true, item }
  })
}

export async function listItemsByDay(dayId: string) {
  const items = await db.itineraryItems
    .where('[dayId+sortOrder]')
    .between([dayId, DexieMinKey], [dayId, DexieMaxKey])
    .toArray()
  return sortItineraryItemsByPlanOrder(items)
}

export async function listItemsByTrip(tripId: string) {
  const items = await db.itineraryItems.where('tripId').equals(tripId).toArray()
  return sortItineraryItems(items)
}

export async function getItineraryItem(itemId: string) {
  return db.itineraryItems.get(itemId)
}

export async function updateItineraryItem(
  itemId: string,
  patch: UpdateItineraryItemPatch,
  options: ParentTripTouchOptions = {},
) {
  const item = await db.itineraryItems.get(itemId)
  if (!item) {
    return undefined
  }

  const updatedAt = Date.now()
  await db.transaction('rw', db.itineraryItems, db.trips, async () => {
    await db.itineraryItems.update(itemId, {
      ...patch,
      updatedAt,
    })
    if (options.touchTrip !== false) {
      await db.trips.update(item.tripId, { updatedAt })
    }
  })

  return getItineraryItem(itemId)
}

export async function reorderDayItems(
  dayId: string,
  orderedItemIds: string[],
  expectedCurrentItemIds?: string[],
) {
  const plan = await prepareDayItemsReorder(
    dayId,
    orderedItemIds,
    expectedCurrentItemIds,
  )
  return applyDayItemsReorderPlan(plan)
}

export async function prepareDayItemsReorder(
  dayId: string,
  orderedItemIds: string[],
  expectedCurrentItemIds?: string[],
  updatedAt = Date.now(),
): Promise<DayItemsReorderPlan> {
  if (new Set(orderedItemIds).size !== orderedItemIds.length) {
    throw new Error('排序列表包含重复行程点。')
  }
  if (expectedCurrentItemIds && new Set(expectedCurrentItemIds).size !== expectedCurrentItemIds.length) {
    throw new Error('排序基线包含重复行程点。')
  }

  const day = await db.days.get(dayId)
  if (!day) throw new Error('当天行程不存在。')
  const currentItems = sortItineraryItemsByPlanOrder(
    await db.itineraryItems.where('dayId').equals(dayId).toArray(),
  )
  return buildDayItemsReorderPlan({
    currentItems,
    day,
    dayId,
    expectedCurrentItemIds,
    orderedItemIds,
    tripId: day.tripId,
    updatedAt,
  })
}

export async function applyDayItemsReorderPlan(
  plan: DayItemsReorderPlan,
  options: StructuralItemCommitOptions = {},
) {
  const tables = options.touchTrip === false
    ? [db.days, db.itineraryItems]
    : [db.days, db.itineraryItems, db.trips]
  return db.transaction('rw', tables, async () => {
    const [currentDay, currentItems] = await Promise.all([
      db.days.get(plan.dayId),
      db.itineraryItems.where('dayId').equals(plan.dayId).toArray()
        .then(sortItineraryItemsByPlanOrder),
    ])
    if (
      !currentDay
      || !sameRecord(currentDay, plan.day)
      || currentDay.tripId !== plan.tripId
      || currentItems.some((item) => item.dayId !== plan.dayId || item.tripId !== plan.tripId)
      || !sameRecords(currentItems, plan.beforeItems)
    ) {
      throw new ItineraryBaselineConflictError('当天顺序已在其他位置更新，请刷新后重试。')
    }
    const verified = buildDayItemsReorderPlan({
      currentItems,
      day: currentDay,
      dayId: plan.dayId,
      expectedCurrentItemIds: plan.beforeItems.map((item) => item.id),
      orderedItemIds: plan.orderedItemIds,
      tripId: plan.tripId,
      updatedAt: plan.updatedAt,
    })
    if (!sameRecords(verified.afterItems, plan.afterItems)) {
      throw new ItineraryBaselineConflictError('排序计划已变化，请重新生成预览。')
    }
    if (verified.changedItems.length > 0) {
      await db.itineraryItems.bulkPut(verified.changedItems)
      if (options.touchTrip !== false) {
        await db.trips.update(plan.tripId, { updatedAt: plan.updatedAt })
      }
    }
    return verified.changedItems
  })
}

export async function moveItineraryItemBetweenDays(
  itemId: string,
  destinationDayId: string,
  nextDestinationItemIds: string[],
  options: {
    expectedDestinationItemIds: string[]
    expectedSourceItemIds: string[]
    sourceDayId: string
  },
) {
  const plan = await prepareItineraryItemMove(
    itemId,
    destinationDayId,
    nextDestinationItemIds,
    options,
  )
  return applyItineraryItemMovePlan(plan)
}

export async function prepareItineraryItemMove(
  itemId: string,
  destinationDayId: string,
  nextDestinationItemIds: string[],
  options: {
    expectedDestinationItemIds: string[]
    expectedSourceItemIds: string[]
    sourceDayId: string
  },
  updatedAt = Date.now(),
): Promise<ItineraryItemMovePlan> {
  if (options.sourceDayId === destinationDayId) {
    throw new Error('跨日移动的来源日期与目标日期不能相同。')
  }
  for (const [label, itemIds] of [
    ['来源日期基线', options.expectedSourceItemIds],
    ['目标日期基线', options.expectedDestinationItemIds],
    ['目标日期顺序', nextDestinationItemIds],
  ] as const) {
    if (new Set(itemIds).size !== itemIds.length) {
      throw new Error(`${label}包含重复行程点。`)
    }
  }

  const [item, sourceDay, destinationDay] = await Promise.all([
    db.itineraryItems.get(itemId),
    db.days.get(options.sourceDayId),
    db.days.get(destinationDayId),
  ])
  if (!item || item.dayId !== options.sourceDayId) {
    throw new ItineraryBaselineConflictError('行程点所在日期已变化，请重新生成预览。')
  }
  if (!sourceDay || !destinationDay) {
    throw new ItineraryBaselineConflictError('来源日期或目标日期已不存在，请重新生成预览。')
  }
  if (sourceDay.tripId !== destinationDay.tripId || item.tripId !== sourceDay.tripId) {
    throw new ItineraryBaselineConflictError('日期归属已变化，请重新生成预览。')
  }
  const [currentSourceItems, currentDestinationItems] = await Promise.all([
    db.itineraryItems.where('dayId').equals(sourceDay.id).toArray()
      .then(sortItineraryItemsByPlanOrder),
    db.itineraryItems.where('dayId').equals(destinationDay.id).toArray()
      .then(sortItineraryItemsByPlanOrder),
  ])
  return buildItineraryItemMovePlan({
    currentDestinationItems,
    currentSourceItems,
    destinationDay,
    destinationDayId,
    expectedDestinationItemIds: options.expectedDestinationItemIds,
    expectedSourceItemIds: options.expectedSourceItemIds,
    item,
    nextDestinationItemIds,
    sourceDay,
    sourceDayId: options.sourceDayId,
    tripId: item.tripId,
    updatedAt,
  })
}

export async function applyItineraryItemMovePlan(
  plan: ItineraryItemMovePlan,
  options: StructuralItemCommitOptions = {},
) {
  const tables = options.touchTrip === false
    ? [db.days, db.itineraryItems]
    : [db.days, db.itineraryItems, db.trips]
  return db.transaction('rw', tables, async () => {
    const [currentSourceDay, currentDestinationDay, currentSourceItems, currentDestinationItems] = await Promise.all([
      db.days.get(plan.sourceDayId),
      db.days.get(plan.destinationDayId),
      db.itineraryItems.where('dayId').equals(plan.sourceDayId).toArray()
        .then(sortItineraryItemsByPlanOrder),
      db.itineraryItems.where('dayId').equals(plan.destinationDayId).toArray()
        .then(sortItineraryItemsByPlanOrder),
    ])
    if (
      !currentSourceDay
      || !currentDestinationDay
      || !sameRecord(currentSourceDay, plan.sourceDay)
      || !sameRecord(currentDestinationDay, plan.destinationDay)
      || currentSourceDay.tripId !== plan.tripId
      || currentDestinationDay.tripId !== plan.tripId
      || currentSourceItems.some((item) => (
        item.dayId !== plan.sourceDayId || item.tripId !== plan.tripId
      ))
      || currentDestinationItems.some((item) => (
        item.dayId !== plan.destinationDayId || item.tripId !== plan.tripId
      ))
      || !sameRecords(currentSourceItems, plan.beforeSourceItems)
      || !sameRecords(currentDestinationItems, plan.beforeDestinationItems)
    ) {
      throw new ItineraryBaselineConflictError('来源日期或目标日期行程已变化，请重新生成预览。')
    }
    const item = currentSourceItems.find((candidate) => candidate.id === plan.itemId)
    if (!item) throw new ItineraryBaselineConflictError('行程点所在日期已变化，请重新生成预览。')
    const verified = buildItineraryItemMovePlan({
      currentDestinationItems,
      currentSourceItems,
      destinationDay: currentDestinationDay,
      destinationDayId: plan.destinationDayId,
      expectedDestinationItemIds: plan.beforeDestinationItems.map((candidate) => candidate.id),
      expectedSourceItemIds: plan.beforeSourceItems.map((candidate) => candidate.id),
      item,
      nextDestinationItemIds: plan.nextDestinationItemIds,
      sourceDay: currentSourceDay,
      sourceDayId: plan.sourceDayId,
      tripId: plan.tripId,
      updatedAt: plan.updatedAt,
    })
    if (!sameRecords(verified.afterItems, plan.afterItems)) {
      throw new ItineraryBaselineConflictError('跨日移动计划已变化，请重新生成预览。')
    }
    await db.itineraryItems.bulkPut(verified.changedItems)
    if (options.touchTrip !== false) {
      await db.trips.update(plan.tripId, { updatedAt: plan.updatedAt })
    }
    return {
      changedItems: verified.changedItems,
      destinationItemIds: verified.destinationItemIds,
      movedItem: verified.movedItem,
      sourceItemIds: verified.sourceItemIds,
    }
  })
}

function buildDayItemsReorderPlan({
  currentItems,
  day,
  dayId,
  expectedCurrentItemIds,
  orderedItemIds,
  tripId,
  updatedAt,
}: {
  currentItems: ItineraryItem[]
  day: Day
  dayId: string
  expectedCurrentItemIds?: string[]
  orderedItemIds: string[]
  tripId: string
  updatedAt: number
}): DayItemsReorderPlan {
  const currentItemIds = currentItems.map((item) => item.id)
  if (
    currentItems.length !== orderedItemIds.length
    || !sameIdMembers(currentItemIds, orderedItemIds)
  ) {
    throw new ItineraryBaselineConflictError('排序列表与当前行程不一致，请刷新后重试。')
  }
  if (expectedCurrentItemIds && !sameOrderedIds(currentItemIds, expectedCurrentItemIds)) {
    throw new ItineraryBaselineConflictError('当天顺序已在其他位置更新，请刷新后重试。')
  }
  const itemById = new Map(currentItems.map((item) => [item.id, item]))
  const afterItems = orderedItemIds.map((itemId, index) => {
    const item = itemById.get(itemId)
    if (!item) throw new ItineraryBaselineConflictError('排序列表与当前行程不一致，请刷新后重试。')
    return item.sortOrder === index + 1
      ? item
      : { ...item, sortOrder: index + 1, updatedAt }
  })
  const changedItems = afterItems.filter((item) => {
    const previous = itemById.get(item.id)
    return previous?.sortOrder !== item.sortOrder
  })
  return {
    afterItems,
    beforeItems: currentItems,
    changedItems,
    day,
    dayId,
    orderedItemIds: [...orderedItemIds],
    tripId,
    updatedAt,
  }
}

function buildItineraryItemMovePlan({
  currentDestinationItems,
  currentSourceItems,
  destinationDay,
  destinationDayId,
  expectedDestinationItemIds,
  expectedSourceItemIds,
  item,
  nextDestinationItemIds,
  sourceDay,
  sourceDayId,
  tripId,
  updatedAt,
}: {
  currentDestinationItems: ItineraryItem[]
  currentSourceItems: ItineraryItem[]
  destinationDay: Day
  destinationDayId: string
  expectedDestinationItemIds: string[]
  expectedSourceItemIds: string[]
  item: ItineraryItem
  nextDestinationItemIds: string[]
  sourceDay: Day
  sourceDayId: string
  tripId: string
  updatedAt: number
}): ItineraryItemMovePlan {
  const currentSourceItemIds = currentSourceItems.map((candidate) => candidate.id)
  const currentDestinationItemIds = currentDestinationItems.map((candidate) => candidate.id)
  if (!sameOrderedIds(currentSourceItemIds, expectedSourceItemIds)) {
    throw new ItineraryBaselineConflictError('来源日期行程已变化，请重新生成预览。')
  }
  if (!sameOrderedIds(currentDestinationItemIds, expectedDestinationItemIds)) {
    throw new ItineraryBaselineConflictError('目标日期行程已变化，请重新生成预览。')
  }
  if (!currentSourceItemIds.includes(item.id) || currentDestinationItemIds.includes(item.id)) {
    throw new ItineraryBaselineConflictError('行程点所在日期已变化，请重新生成预览。')
  }
  const expectedDestinationMembers = [...currentDestinationItemIds, item.id]
  if (!sameIdMembers(nextDestinationItemIds, expectedDestinationMembers)) {
    throw new ItineraryBaselineConflictError('目标日期顺序与当前行程不一致，请重新生成预览。')
  }
  const nextSourceItems = currentSourceItems
    .filter((candidate) => candidate.id !== item.id)
    .map((candidate, index) => candidate.sortOrder === index + 1
      ? candidate
      : { ...candidate, sortOrder: index + 1, updatedAt })
  const destinationItemById = new Map(
    currentDestinationItems.map((candidate) => [candidate.id, candidate]),
  )
  const nextDestinationItems = nextDestinationItemIds.map((candidateId, index) => {
    const candidate = candidateId === item.id ? item : destinationItemById.get(candidateId)
    if (!candidate) {
      throw new ItineraryBaselineConflictError('目标日期顺序与当前行程不一致，请重新生成预览。')
    }
    if (candidate.dayId === destinationDayId && candidate.sortOrder === index + 1) return candidate
    return {
      ...candidate,
      dayId: destinationDayId,
      ...(candidateId === item.id ? { executionState: undefined } : {}),
      sortOrder: index + 1,
      updatedAt,
    }
  })
  const afterItems = [...nextSourceItems, ...nextDestinationItems]
  const beforeById = new Map(
    [...currentSourceItems, ...currentDestinationItems].map((candidate) => [candidate.id, candidate]),
  )
  const changedItems = afterItems.filter((candidate) => !sameRecord(beforeById.get(candidate.id), candidate))
  const movedItem = nextDestinationItems.find((candidate) => candidate.id === item.id)
  if (!movedItem) throw new ItineraryBaselineConflictError('目标日期顺序缺少待移动行程点。')
  return {
    afterItems,
    beforeDestinationItems: currentDestinationItems,
    beforeSourceItems: currentSourceItems,
    changedItems,
    destinationDay,
    destinationDayId,
    destinationItemIds: [...nextDestinationItemIds],
    itemId: item.id,
    movedItem,
    nextDestinationItemIds: [...nextDestinationItemIds],
    sourceDay,
    sourceDayId,
    sourceItemIds: nextSourceItems.map((candidate) => candidate.id),
    tripId,
    updatedAt,
  }
}

function sameOrderedIds(first: string[], second: string[]) {
  return first.length === second.length
    && first.every((itemId, index) => itemId === second[index])
}

function sameIdMembers(first: string[], second: string[]) {
  return first.length === second.length
    && first.every((itemId) => second.includes(itemId))
}

function sameRecords(first: ItineraryItem[], second: ItineraryItem[]) {
  return first.length === second.length
    && first.every((record, index) => sameRecord(record, second[index]))
}

function sameRecord(first: unknown, second: unknown) {
  return JSON.stringify(first) === JSON.stringify(second)
}

async function listOrderedDayItems(dayId: string) {
  return (await db.itineraryItems.where('dayId').equals(dayId).toArray())
    .sort((first, second) =>
      first.sortOrder - second.sortOrder || first.id.localeCompare(second.id),
    )
}

async function findItemDeletionRecord(
  options: DeleteItineraryItemReversibleOptions,
) {
  if (options.operationRecordId) {
    const byId = await db.tripReplanRecords.get(options.operationRecordId)
    if (byId) return byId
  }
  if (!options.operationFingerprint) return undefined
  const records = options.tripId
    ? await db.tripReplanRecords.where('tripId').equals(options.tripId).toArray()
    : await db.tripReplanRecords.toArray()
  return records.find((record) =>
    record.operationKind === 'item_delete'
    && record.operationFingerprint === options.operationFingerprint,
  )
}

async function readPersistedItemDeletionResult(
  record: TripReplanRecord,
  itemId: string,
  options: DeleteItineraryItemReversibleOptions,
): Promise<ReversibleItemDeletionResult> {
  if (
    record.operationKind !== 'item_delete'
    || (options.operationFingerprint
      && record.operationFingerprint !== options.operationFingerprint)
    || (options.tripId && record.tripId !== options.tripId)
  ) {
    throw new ItineraryBaselineConflictError('删除操作记录与当前请求不一致。')
  }
  if (
    record.status !== 'applied'
    || !record.afterSnapshot
    || !record.appliedFingerprint
  ) {
    throw new ItineraryBaselineConflictError(
      record.status === 'undone'
        ? '这次删除已经撤销，不能重复删除。'
        : '删除操作记录不能继续执行。',
    )
  }
  const deletedItem = getDeletedItemFromRecord(record)
  if (deletedItem.id !== itemId || await db.itineraryItems.get(itemId)) {
    throw new ItineraryBaselineConflictError('删除操作记录与当前行程不一致。')
  }
  const day = record.afterSnapshot.days[0] ?? record.beforeSnapshot.days[0]
  if (!day) {
    throw new ItineraryBaselineConflictError('删除记录缺少日期快照。')
  }
  const currentDay = await db.days.get(day.id)
  if (!currentDay) {
    throw new ItineraryBaselineConflictError('删除记录对应的日期已不存在。')
  }
  const currentSnapshot = {
    days: [currentDay],
    items: await listOrderedDayItems(day.id),
  }
  if (
    buildTripOperationSnapshotFingerprint(currentSnapshot)
    !== record.appliedFingerprint
  ) {
    throw new ItineraryBaselineConflictError('删除后的行程已变化，请重新生成预览。')
  }
  return {
    changedItems: [],
    deleted: false,
    deletedItem,
    operationRecord: record,
  }
}

function getDeletedItemFromRecord(record: TripReplanRecord) {
  const afterIds = new Set(record.afterSnapshot?.items.map((item) => item.id) ?? [])
  const deletedItems = record.beforeSnapshot.items
    .filter((item) => !afterIds.has(item.id))
  if (deletedItems.length !== 1) {
    throw new ItineraryBaselineConflictError('删除记录缺少唯一行程点快照。')
  }
  return deletedItems[0]
}

function matchesIdempotentItemInput(existing: ItineraryItem, input: CreateItineraryItemInput) {
  return existing.tripId === input.tripId
    && existing.dayId === input.dayId
    && existing.title === input.title
    && existing.startTime === input.startTime
    && existing.endTime === input.endTime
    && existing.locationName === input.locationName
    && existing.sortOrder === input.sortOrder
    && existing.ticketIds.length === input.ticketIds.length
    && existing.ticketIds.every((ticketId, index) => ticketId === input.ticketIds[index])
}

export async function deleteItineraryItemReversible(
  itemId: string,
  options: DeleteItineraryItemReversibleOptions = {},
): Promise<ReversibleItemDeletionResult | undefined> {
  return db.transaction(
    'rw',
    db.days,
    db.itineraryItems,
    db.tripReplanRecords,
    db.trips,
    async () => {
      const item = await db.itineraryItems.get(itemId)
      const existingRecord = await findItemDeletionRecord(options)
      const tripId = options.tripId ?? item?.tripId ?? existingRecord?.tripId
      if (!tripId) return undefined
      if (item && item.tripId !== tripId) {
        throw new ItineraryBaselineConflictError('目标行程点不属于当前旅行。')
      }
      if (existingRecord) {
        return readPersistedItemDeletionResult(existingRecord, itemId, options)
      }
      if (!item) return undefined

      const day = await db.days.get(item.dayId)
      if (!day || day.tripId !== tripId) {
        throw new ItineraryBaselineConflictError('目标日期已不存在。')
      }
      const currentItems = await listOrderedDayItems(day.id)
      const currentItemIds = currentItems.map((candidate) => candidate.id)
      if (
        options.expectedCurrentItemIds
        && !sameOrderedIds(currentItemIds, options.expectedCurrentItemIds)
      ) {
        throw new ItineraryBaselineConflictError('当天顺序已变化，请重新确认删除。')
      }
      if (
        options.expectedItemUpdatedAt !== undefined
        && item.updatedAt !== options.expectedItemUpdatedAt
      ) {
        throw new ItineraryBaselineConflictError('行程点内容已变化，请重新确认删除。')
      }
      const beforeSnapshot = { days: [day], items: currentItems }
      const baselineFingerprint = buildTripOperationSnapshotFingerprint(beforeSnapshot)
      if (
        options.expectedBaselineFingerprint
        && baselineFingerprint !== options.expectedBaselineFingerprint
      ) {
        throw new ItineraryBaselineConflictError('行程内容已变化，请重新确认删除。')
      }

      const now = options.now ?? Date.now()
      const remainingItems = currentItems.filter((candidate) => candidate.id !== itemId)
      const nextItems = remainingItems.map((candidate, index) => (
        candidate.sortOrder === index + 1
          ? candidate
          : { ...candidate, sortOrder: index + 1, updatedAt: now }
      ))
      const changedItems = nextItems.filter((candidate) => {
        const previous = remainingItems.find((entry) => entry.id === candidate.id)
        return previous?.sortOrder !== candidate.sortOrder
      })
      const afterSnapshot = { days: [day], items: nextItems }
      const operationRecordId = options.operationRecordId ?? createId('replan_record')
      const operationFingerprint = options.operationFingerprint
        ?? `item-delete:${operationRecordId}`
      const operationRecord: TripReplanRecord = {
        afterSnapshot,
        appliedFingerprint: buildTripOperationSnapshotFingerprint(afterSnapshot),
        baselineFingerprint,
        beforeSnapshot,
        createdAt: now,
        eventId: `item-delete:${operationRecordId}`,
        evidence: [],
        id: operationRecordId,
        operationFingerprint,
        operationKind: 'item_delete',
        options: [],
        scopeItemIds: currentItemIds,
        status: 'applied',
        tripId,
        updatedAt: now,
      }

      await db.itineraryItems.delete(itemId)
      if (changedItems.length > 0) await db.itineraryItems.bulkPut(changedItems)
      await db.tripReplanRecords.add(operationRecord)
      await db.trips.update(tripId, { updatedAt: now })
      return { changedItems, deleted: true, deletedItem: item, operationRecord }
    },
  )
}

export async function restoreItineraryItemDeletion(
  recordId: string,
  options: RestoreItineraryItemDeletionOptions = {},
): Promise<RestoredItemDeletionResult> {
  return db.transaction(
    'rw',
    db.days,
    db.itineraryItems,
    db.tripReplanRecords,
    db.trips,
    async () => {
      const record = await db.tripReplanRecords.get(recordId)
      if (!record || record.operationKind !== 'item_delete') {
        throw new ItineraryBaselineConflictError('没有找到可撤销的行程点删除记录。')
      }
      if (options.tripId && record.tripId !== options.tripId) {
        throw new ItineraryBaselineConflictError('删除记录不属于当前旅行。')
      }
      const deletedItem = getDeletedItemFromRecord(record)
      const day = record.afterSnapshot?.days[0] ?? record.beforeSnapshot.days[0]
      if (!day) {
        throw new ItineraryBaselineConflictError('删除记录缺少日期快照。')
      }
      const currentDay = await db.days.get(day.id)
      if (!currentDay) {
        throw new ItineraryBaselineConflictError('删除记录对应的日期已不存在。')
      }
      const currentItems = await listOrderedDayItems(day.id)
      const currentSnapshot = { days: [currentDay], items: currentItems }
      const currentFingerprint = buildTripOperationSnapshotFingerprint(currentSnapshot)

      if (record.status === 'undone') {
        if (!record.undoFingerprint || record.undoFingerprint !== currentFingerprint) {
          throw new ItineraryBaselineConflictError('撤销后的行程已变化，请重新检查。')
        }
        const restoredItem = currentItems.find((item) => item.id === deletedItem.id)
        if (!restoredItem) {
          throw new ItineraryBaselineConflictError('撤销记录与当前行程不一致。')
        }
        return {
          changedItems: [],
          operationRecord: record,
          restored: false,
          restoredItem,
        }
      }
      if (
        record.status !== 'applied'
        || !record.afterSnapshot
        || !record.appliedFingerprint
      ) {
        throw new ItineraryBaselineConflictError('这次删除不能撤销。')
      }
      if (
        options.expectedAppliedFingerprint
        && options.expectedAppliedFingerprint !== record.appliedFingerprint
      ) {
        throw new ItineraryBaselineConflictError('删除记录已变化，请重新生成预览。')
      }
      if (currentFingerprint !== record.appliedFingerprint) {
        throw new ItineraryBaselineConflictError('删除后的行程已变化，不能直接撤销。')
      }

      const now = options.now ?? Date.now()
      const restoredItems = record.beforeSnapshot.items.map((item) => ({
        ...item,
        updatedAt: now,
      }))
      const restoredSnapshot = {
        days: [currentDay],
        items: restoredItems,
      }
      const operationRecord: TripReplanRecord = {
        ...record,
        status: 'undone',
        undoneAt: now,
        undoFingerprint: buildTripOperationSnapshotFingerprint(restoredSnapshot),
        updatedAt: now,
      }

      if (restoredItems.length > 0) await db.itineraryItems.bulkPut(restoredItems)
      await db.tripReplanRecords.put(operationRecord)
      await db.trips.update(record.tripId, { updatedAt: now })
      return {
        changedItems: restoredItems,
        operationRecord,
        restored: true,
        restoredItem: restoredItems.find((item) => item.id === deletedItem.id) ?? deletedItem,
      }
    },
  )
}

export async function createTicketMeta(input: CreateTicketMetaInput) {
  const now = Date.now()
  const ticket: TicketMeta = {
    ...input,
    id: createId('ticket'),
    createdAt: now,
    updatedAt: now,
  }

  await db.transaction('rw', db.ticketMetas, db.trips, async () => {
    await db.ticketMetas.add(ticket)
    await db.trips.update(ticket.tripId, { updatedAt: now })
  })

  return ticket
}

export async function saveTicketBlob(ticketId: string, blob: Blob) {
  const record: TicketBlob = { ticketId, blob }
  await db.ticketBlobs.put(record)
  return record
}

export async function getTicketMeta(ticketId: string) {
  return db.ticketMetas.get(ticketId)
}

export async function getTicketBlob(ticketId: string) {
  return db.ticketBlobs.get(ticketId)
}

export async function deleteTicketBlob(ticketId: string) {
  await db.ticketBlobs.delete(ticketId)
}

export async function listTicketsByTrip(tripId: string) {
  const tickets = await db.ticketMetas.where('tripId').equals(tripId).toArray()
  return tickets.sort((first, second) => second.createdAt - first.createdAt)
}

export async function listTicketsByItem(itemId: string) {
  const tickets = await db.ticketMetas.where('itemId').equals(itemId).toArray()
  return tickets.sort((first, second) => second.createdAt - first.createdAt)
}

export async function updateTicketMeta(
  ticketId: string,
  input: UpdateTicketMetaInput,
): Promise<UpdateTicketMetaResult | undefined> {
  const plan = await prepareTicketMetaUpdate(ticketId, input)
  if (!plan) return undefined
  return applyTicketMetaUpdatePlan(plan)
}

export async function prepareTicketMetaUpdate(
  ticketId: string,
  input: UpdateTicketMetaInput,
): Promise<TicketMetaUpdatePlan | undefined> {
  const ticket = await db.ticketMetas.get(ticketId)
  if (!ticket) return undefined

  if (
    input.expectedBinding
    && (
      ticket.updatedAt !== input.expectedBinding.ticketUpdatedAt
      || ticket.itemId !== input.expectedBinding.itemId
    )
  ) {
    throw new TicketBaselineConflictError('票据绑定已变化，请重新生成预览。')
  }

  const targetItemId = input.scope === 'item' ? input.itemId : undefined

  if (input.scope === 'item' && !targetItemId) {
    throw new Error('请选择要绑定的行程点。')
  }

  const tripItems = await db.itineraryItems.where('tripId').equals(ticket.tripId).toArray()
  const updatedAt = tripItems.reduce(
    (latest, item) => Math.max(latest, item.updatedAt + 1),
    Math.max(Date.now(), ticket.updatedAt + 1),
  )
  const targetItem = targetItemId
    ? tripItems.find((item) => item.id === targetItemId)
    : undefined
  if (targetItemId && !targetItem) {
    throw new Error('绑定的行程点不存在。')
  }
  if (input.expectedBinding) {
    const expectedTarget = input.expectedBinding.targetItem
    const currentItem = input.expectedBinding.currentItem
      ? tripItems.find((item) => item.id === input.expectedBinding?.currentItem?.id)
      : undefined
    if (
      !targetItem
      || targetItem.id !== expectedTarget.id
      || targetItem.updatedAt !== expectedTarget.updatedAt
      || !sameStringSet(targetItem.ticketIds ?? [], expectedTarget.ticketIds)
      || (
        input.expectedBinding.currentItem
        && (
          !currentItem
          || currentItem.updatedAt !== input.expectedBinding.currentItem.updatedAt
          || !sameStringSet(currentItem.ticketIds ?? [], input.expectedBinding.currentItem.ticketIds)
        )
      )
    ) {
      throw new TicketBaselineConflictError('票据关联目标已变化，请重新生成预览。')
    }
  }

  const beforeRelationshipItems = tripItems
    .filter((item) => item.id === targetItemId || (item.ticketIds ?? []).includes(ticket.id))
    .sort((first, second) => first.id.localeCompare(second.id))
  const afterRelationshipItems = beforeRelationshipItems.map((item) => {
    const ticketIds = item.ticketIds ?? []
    const hasTicket = ticketIds.includes(ticket.id)
    const shouldHaveTicket = item.id === targetItemId
    if (hasTicket === shouldHaveTicket) return item
    return {
      ...item,
      ticketIds: shouldHaveTicket
        ? [...ticketIds, ticket.id]
        : ticketIds.filter((id) => id !== ticket.id),
      updatedAt,
    }
  })
  const changedItems = afterRelationshipItems.filter((item, index) => (
    !sameRecord(item, beforeRelationshipItems[index])
  ))
  const afterTicket: TicketMeta = {
    ...ticket,
    itemId: targetItemId,
    note: input.note,
    scope: input.scope,
    sharedVisibility: input.sharedVisibility,
    structuredFields: Object.prototype.hasOwnProperty.call(input, 'structuredFields')
      ? input.structuredFields
      : ticket.structuredFields,
    ticketCategory: input.ticketCategory,
    title: input.title,
    updatedAt,
  }

  return {
    afterRelationshipItems,
    afterTicket,
    beforeRelationshipItems,
    beforeTicket: ticket,
    changedItems,
    targetItemId,
    ticketId,
    tripId: ticket.tripId,
    updatedAt,
  }
}

export async function applyTicketMetaUpdatePlan(
  plan: TicketMetaUpdatePlan,
  options: ParentTripTouchOptions = {},
): Promise<UpdateTicketMetaResult> {
  const touchTrip = options.touchTrip ?? true
  return db.transaction(
    'rw',
    touchTrip
      ? [db.ticketMetas, db.itineraryItems, db.trips]
      : [db.ticketMetas, db.itineraryItems],
    async () => {
      const ticket = await db.ticketMetas.get(plan.ticketId)
      if (!ticket || !sameRecord(ticket, plan.beforeTicket)) {
        throw new TicketBaselineConflictError('票据绑定已变化，请重新生成预览。')
      }
      const tripItems = await db.itineraryItems.where('tripId').equals(plan.tripId).toArray()
      const currentRelationshipItems = tripItems
        .filter((item) => item.id === plan.targetItemId || (item.ticketIds ?? []).includes(plan.ticketId))
        .sort((first, second) => first.id.localeCompare(second.id))
      if (!sameRecords(currentRelationshipItems, plan.beforeRelationshipItems)) {
        throw new TicketBaselineConflictError('票据关联目标已变化，请重新生成预览。')
      }

      await db.ticketMetas.put(plan.afterTicket)
      if (plan.changedItems.length > 0) {
        await db.itineraryItems.bulkPut(plan.changedItems)
      }
      if (touchTrip) {
        await db.trips.update(plan.tripId, { updatedAt: plan.updatedAt })
      }

      return { changedItems: plan.changedItems, ticket: plan.afterTicket }
    },
  )
}

function sameStringSet(first: string[], second: string[]) {
  const sortedFirst = [...first].sort()
  const sortedSecond = [...second].sort()
  return sortedFirst.length === sortedSecond.length
    && sortedFirst.every((value, index) => value === sortedSecond[index])
}

export async function deleteTicket(ticketId: string) {
  await db.transaction(
    'rw',
    db.ticketMetas,
    db.ticketBlobs,
    db.itineraryItems,
    db.trips,
    async () => {
      const ticket = await db.ticketMetas.get(ticketId)
      const now = Date.now()

      await Promise.all([db.ticketMetas.delete(ticketId), db.ticketBlobs.delete(ticketId)])

      if (ticket) {
        const tripItems = await db.itineraryItems
          .where('tripId')
          .equals(ticket.tripId)
          .toArray()
        const itemUpdates = tripItems.filter((item) => item.ticketIds.includes(ticketId))

        await Promise.all([
          ...itemUpdates.map((item) =>
            db.itineraryItems.update(item.id, {
              ticketIds: item.ticketIds.filter((id) => id !== ticketId),
              updatedAt: now,
            }),
          ),
          db.trips.update(ticket.tripId, { updatedAt: now }),
        ])
      }
    },
  )
}

export async function createTripDisruptionEvent(input: CreateTripDisruptionEventInput) {
  const now = Date.now()
  const event: TripDisruptionEvent = {
    ...input,
    id: createId('replan_event'),
    createdAt: now,
    updatedAt: now,
  }

  await db.transaction('rw', db.tripReplanEvents, db.trips, async () => {
    await db.tripReplanEvents.add(event)
    await db.trips.update(event.tripId, { updatedAt: now })
  })
  return event
}

export async function getTripDisruptionEvent(eventId: string) {
  return db.tripReplanEvents.get(eventId)
}

export async function listTripDisruptionEventsByTrip(tripId: string) {
  return db.tripReplanEvents.where('tripId').equals(tripId).reverse().sortBy('createdAt')
}

export async function listTripDisruptionEventsByStatus(tripId: string, status: TripDisruptionEvent['status']) {
  return db.tripReplanEvents.where('[tripId+status]').equals([tripId, status]).reverse().sortBy('createdAt')
}

export async function updateTripDisruptionEvent(eventId: string, patch: UpdateTripDisruptionEventPatch) {
  const event = await db.tripReplanEvents.get(eventId)
  if (!event) return undefined
  const updatedAt = Date.now()
  await db.transaction('rw', db.tripReplanEvents, db.trips, async () => {
    await db.tripReplanEvents.update(eventId, { ...patch, updatedAt })
    await db.trips.update(event.tripId, { updatedAt })
  })
  return getTripDisruptionEvent(eventId)
}

export async function createTripReplanRecord(input: CreateTripReplanRecordInput) {
  const now = Date.now()
  const record: TripReplanRecord = {
    ...input,
    id: createId('replan_record'),
    createdAt: now,
    updatedAt: now,
  }

  await db.transaction('rw', db.tripReplanRecords, db.trips, async () => {
    await db.tripReplanRecords.add(record)
    await db.trips.update(record.tripId, { updatedAt: now })
  })
  return record
}

export async function getTripReplanRecord(recordId: string) {
  return db.tripReplanRecords.get(recordId)
}

export async function listTripReplanRecordsByTrip(tripId: string) {
  return db.tripReplanRecords.where('tripId').equals(tripId).reverse().sortBy('createdAt')
}

export async function listTripReplanRecordsByEvent(eventId: string) {
  return db.tripReplanRecords.where('eventId').equals(eventId).reverse().sortBy('createdAt')
}

export async function updateTripReplanRecord(recordId: string, patch: UpdateTripReplanRecordPatch) {
  const record = await db.tripReplanRecords.get(recordId)
  if (!record) return undefined
  const updatedAt = Date.now()
  await db.transaction('rw', db.tripReplanRecords, db.trips, async () => {
    await db.tripReplanRecords.update(recordId, { ...patch, updatedAt })
    await db.trips.update(record.tripId, { updatedAt })
  })
  return getTripReplanRecord(recordId)
}

export async function importTripBackupRecords({
  trip,
  days,
  itineraryItems,
  ticketMetas,
  ticketBlobs,
  ledgerSettings = [],
  ledgerParticipants = [],
  ledgerBudgets = [],
  ledgerExpenses = [],
  importedTitleSuffix,
}: ImportTripBackupRecordsInput): Promise<{ remapped: boolean; title: string; tripId: string }> {
  assertUniqueIds('Day', days.map((day) => day.id))
  assertUniqueIds('ItineraryItem', itineraryItems.map((item) => item.id))
  assertUniqueIds('Ticket', ticketMetas.map((ticket) => ticket.id))
  assertUniqueIds('LedgerParticipant', ledgerParticipants.map((participant) => participant.id))
  assertUniqueIds('LedgerBudget', ledgerBudgets.map((budget) => budget.id))
  assertUniqueIds('LedgerExpense', ledgerExpenses.map((expense) => expense.id))

  const result = await db.transaction(
    'rw',
    [db.trips, db.days, db.itineraryItems, db.ticketMetas, db.ticketBlobs, db.ledgerSettings, db.ledgerParticipants, db.ledgerBudgets, db.ledgerExpenses],
    async () => {
      const dayIds = days.map((day) => day.id)
      const itemIds = itineraryItems.map((item) => item.id)
      const ticketIds = ticketMetas.map((ticket) => ticket.id)
      const participantIds = ledgerParticipants.map((participant) => participant.id)
      const budgetIds = ledgerBudgets.map((budget) => budget.id)
      const expenseIds = ledgerExpenses.map((expense) => expense.id)

      const [existingTrip, existingDays, existingItems, existingTicketMetas, existingTicketBlobs, existingSettings, existingParticipants, existingBudgets, existingExpenses] =
        await Promise.all([
          db.trips.get(trip.id),
          dayIds.length > 0 ? db.days.bulkGet(dayIds) : Promise.resolve([]),
          itemIds.length > 0 ? db.itineraryItems.bulkGet(itemIds) : Promise.resolve([]),
          ticketIds.length > 0 ? db.ticketMetas.bulkGet(ticketIds) : Promise.resolve([]),
          ticketIds.length > 0 ? db.ticketBlobs.bulkGet(ticketIds) : Promise.resolve([]),
          ledgerSettings.length > 0 ? db.ledgerSettings.bulkGet(ledgerSettings.map((settings) => settings.id)) : Promise.resolve([]),
          participantIds.length > 0 ? db.ledgerParticipants.bulkGet(participantIds) : Promise.resolve([]),
          budgetIds.length > 0 ? db.ledgerBudgets.bulkGet(budgetIds) : Promise.resolve([]),
          expenseIds.length > 0 ? db.ledgerExpenses.bulkGet(expenseIds) : Promise.resolve([]),
        ])

      const hasConflict =
        Boolean(existingTrip) ||
        existingDays.some(Boolean) ||
        existingItems.some(Boolean) ||
        existingTicketMetas.some(Boolean) ||
        existingTicketBlobs.some(Boolean) ||
        existingSettings.some(Boolean) ||
        existingParticipants.some(Boolean) ||
        existingBudgets.some(Boolean) ||
        existingExpenses.some(Boolean)

      const nextTripId = hasConflict ? createId('trip') : trip.id
      const dayIdMap = new Map(days.map((day) => [day.id, hasConflict ? createId('day') : day.id]))
      const itemIdMap = new Map(
        itineraryItems.map((item) => [item.id, hasConflict ? createId('item') : item.id]),
      )
      const ticketIdMap = new Map(
        ticketMetas.map((ticket) => [ticket.id, hasConflict ? createId('ticket') : ticket.id]),
      )
      const participantIdMap = new Map(
        ledgerParticipants.map((participant) => [participant.id, hasConflict ? createId('ledger_person') : participant.id]),
      )

      const nextTrip: Trip = {
        ...trip,
        id: nextTripId,
        title: hasConflict ? `${trip.title}（导入 ${importedTitleSuffix}）` : trip.title,
      }
      const nextDays: Day[] = days.map((day) => ({
        ...day,
        id: requireMappedId(dayIdMap, day.id),
        tripId: nextTripId,
      }))
      const nextItems: ItineraryItem[] = itineraryItems.map((item) => ({
        ...item,
        id: requireMappedId(itemIdMap, item.id),
        tripId: nextTripId,
        dayId: requireMappedId(dayIdMap, item.dayId),
        ticketIds: item.ticketIds
          .map((ticketId) => ticketIdMap.get(ticketId))
          .filter((ticketId): ticketId is string => Boolean(ticketId)),
      }))
      const nextTicketMetas: TicketMeta[] = ticketMetas.map((ticket) => ({
        ...ticket,
        id: requireMappedId(ticketIdMap, ticket.id),
        tripId: nextTripId,
        itemId: ticket.itemId ? itemIdMap.get(ticket.itemId) : undefined,
      }))
      const nextTicketBlobs: TicketBlob[] = ticketBlobs
        .map((ticketBlob) => {
          const nextTicketId = ticketIdMap.get(ticketBlob.ticketId)
          return nextTicketId ? { ...ticketBlob, ticketId: nextTicketId } : undefined
        })
        .filter((ticketBlob): ticketBlob is TicketBlob => Boolean(ticketBlob))
      const nextLedgerSettings = ledgerSettings.map((settings) => ({
        ...settings,
        id: hasConflict ? createId('ledger_settings') : settings.id,
        tripId: nextTripId,
      }))
      const nextLedgerParticipants = ledgerParticipants.map((participant) => ({
        ...participant,
        id: requireMappedId(participantIdMap, participant.id),
        tripId: nextTripId,
      }))
      const nextLedgerBudgets = ledgerBudgets.map((budget) => ({
        ...budget,
        id: hasConflict ? createId('ledger_budget') : budget.id,
        tripId: nextTripId,
      }))
      const nextLedgerExpenses = ledgerExpenses.map((expense) => ({
        ...expense,
        id: hasConflict ? createId('ledger_expense') : expense.id,
        payerParticipantId: expense.payerParticipantId ? participantIdMap.get(expense.payerParticipantId) : undefined,
        splitShares: expense.splitShares
          .map((share) => ({ ...share, participantId: participantIdMap.get(share.participantId) }))
          .filter((share): share is { participantId: string; weight: number } => Boolean(share.participantId)),
        tripId: nextTripId,
      }))

      await db.trips.add(nextTrip)
      if (nextDays.length > 0) {
        await db.days.bulkAdd(nextDays)
      }
      if (nextItems.length > 0) {
        await db.itineraryItems.bulkAdd(nextItems)
      }
      if (nextTicketMetas.length > 0) {
        await db.ticketMetas.bulkAdd(nextTicketMetas)
      }
      if (nextTicketBlobs.length > 0) {
        await db.ticketBlobs.bulkAdd(nextTicketBlobs)
      }
      if (nextLedgerSettings.length > 0) await db.ledgerSettings.bulkAdd(nextLedgerSettings)
      if (nextLedgerParticipants.length > 0) await db.ledgerParticipants.bulkAdd(nextLedgerParticipants)
      if (nextLedgerBudgets.length > 0) await db.ledgerBudgets.bulkAdd(nextLedgerBudgets)
      if (nextLedgerExpenses.length > 0) await db.ledgerExpenses.bulkAdd(nextLedgerExpenses)

      return { remapped: hasConflict, title: nextTrip.title, tripId: nextTrip.id }
    },
  )

  return result
}

export async function importTripPlanRecords({
  trip,
  days,
  itineraryItems,
  ticketMetas,
  ticketBlobs,
  ledgerSettings = [],
  ledgerParticipants = [],
  ledgerBudgets = [],
  ledgerExpenses = [],
}: ImportTripPlanRecordsInput): Promise<{ title: string; tripId: string }> {
  assertUniqueIds('Day', days.map((day) => day.id))
  assertUniqueIds('ItineraryItem', itineraryItems.map((item) => item.id))
  assertUniqueIds('Ticket', ticketMetas.map((ticket) => ticket.id))

  return db.transaction(
    'rw',
    [db.trips, db.days, db.itineraryItems, db.ticketMetas, db.ticketBlobs, db.ledgerSettings, db.ledgerParticipants, db.ledgerBudgets, db.ledgerExpenses],
    async () => {
      await db.trips.add(trip)
      if (days.length > 0) {
        await db.days.bulkAdd(days)
      }
      if (itineraryItems.length > 0) {
        await db.itineraryItems.bulkAdd(itineraryItems)
      }
      if (ticketMetas.length > 0) {
        await db.ticketMetas.bulkAdd(ticketMetas)
      }
      if (ticketBlobs.length > 0) {
        await db.ticketBlobs.bulkAdd(ticketBlobs)
      }
      if (ledgerSettings.length > 0) await db.ledgerSettings.bulkAdd(ledgerSettings)
      if (ledgerParticipants.length > 0) await db.ledgerParticipants.bulkAdd(ledgerParticipants)
      if (ledgerBudgets.length > 0) await db.ledgerBudgets.bulkAdd(ledgerBudgets)
      if (ledgerExpenses.length > 0) await db.ledgerExpenses.bulkAdd(ledgerExpenses)

      return { title: trip.title, tripId: trip.id }
    },
  )
}

export async function replaceTripPlanRecords({
  trip,
  days,
  itineraryItems,
  ticketMetas,
  ticketBlobs,
  ledgerSettings = [],
  ledgerParticipants = [],
  ledgerBudgets = [],
  ledgerExpenses = [],
}: ImportTripPlanRecordsInput): Promise<{ title: string; tripId: string }> {
  assertUniqueIds('Day', days.map((day) => day.id))
  assertUniqueIds('ItineraryItem', itineraryItems.map((item) => item.id))
  assertUniqueIds('Ticket', ticketMetas.map((ticket) => ticket.id))

  return db.transaction(
    'rw',
    [db.trips, db.days, db.itineraryItems, db.ticketMetas, db.ticketBlobs, db.ledgerSettings, db.ledgerParticipants, db.ledgerBudgets, db.ledgerExpenses],
    async () => {
      await assertIncomingRecordsBelongToTrip({
        days,
        itineraryItems,
        ticketMetas,
        tripId: trip.id,
      })

      const [existingDays, existingItems, existingTicketMetas] = await Promise.all([
        db.days.where('tripId').equals(trip.id).toArray(),
        db.itineraryItems.where('tripId').equals(trip.id).toArray(),
        db.ticketMetas.where('tripId').equals(trip.id).toArray(),
      ])
      const existingTicketIds = existingTicketMetas.map((ticket) => ticket.id)

      await Promise.all([
        db.trips.delete(trip.id),
        existingDays.length > 0 ? db.days.bulkDelete(existingDays.map((day) => day.id)) : Promise.resolve(),
        existingItems.length > 0 ? db.itineraryItems.bulkDelete(existingItems.map((item) => item.id)) : Promise.resolve(),
        existingTicketIds.length > 0 ? db.ticketMetas.bulkDelete(existingTicketIds) : Promise.resolve(),
        existingTicketIds.length > 0 ? db.ticketBlobs.bulkDelete(existingTicketIds) : Promise.resolve(),
        db.ledgerSettings.where('tripId').equals(trip.id).delete(),
        db.ledgerParticipants.where('tripId').equals(trip.id).delete(),
        db.ledgerBudgets.where('tripId').equals(trip.id).delete(),
        db.ledgerExpenses.where('tripId').equals(trip.id).delete(),
      ])

      await db.trips.put(trip)
      if (days.length > 0) {
        await db.days.bulkPut(days)
      }
      if (itineraryItems.length > 0) {
        await db.itineraryItems.bulkPut(itineraryItems)
      }
      if (ticketMetas.length > 0) {
        await db.ticketMetas.bulkPut(ticketMetas)
      }
      if (ticketBlobs.length > 0) {
        await db.ticketBlobs.bulkPut(ticketBlobs)
      }
      if (ledgerSettings.length > 0) await db.ledgerSettings.bulkPut(ledgerSettings)
      if (ledgerParticipants.length > 0) await db.ledgerParticipants.bulkPut(ledgerParticipants)
      if (ledgerBudgets.length > 0) await db.ledgerBudgets.bulkPut(ledgerBudgets)
      if (ledgerExpenses.length > 0) await db.ledgerExpenses.bulkPut(ledgerExpenses)

      return { title: trip.title, tripId: trip.id }
    },
  )
}

const DexieMinKey = Dexie.minKey
const DexieMaxKey = Dexie.maxKey

function assertUniqueIds(label: string, ids: string[]) {
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) {
      throw new Error(`${label} 备份数据存在重复 ID：${id}`)
    }
    seen.add(id)
  }
}

function requireMappedId(idMap: Map<string, string>, id: string) {
  const mappedId = idMap.get(id)
  if (!mappedId) {
    throw new Error(`备份数据引用了不存在的 ID：${id}`)
  }
  return mappedId
}

async function assertIncomingRecordsBelongToTrip({
  days,
  itineraryItems,
  ticketMetas,
  tripId,
}: {
  days: Day[]
  itineraryItems: ItineraryItem[]
  ticketMetas: TicketMeta[]
  tripId: string
}) {
  const [existingDays, existingItems, existingTicketMetas] = await Promise.all([
    days.length > 0 ? db.days.bulkGet(days.map((day) => day.id)) : Promise.resolve([]),
    itineraryItems.length > 0
      ? db.itineraryItems.bulkGet(itineraryItems.map((item) => item.id))
      : Promise.resolve([]),
    ticketMetas.length > 0 ? db.ticketMetas.bulkGet(ticketMetas.map((ticket) => ticket.id)) : Promise.resolve([]),
  ])
  const hasForeignRecord =
    existingDays.some((day) => day && day.tripId !== tripId) ||
    existingItems.some((item) => item && item.tripId !== tripId) ||
    existingTicketMetas.some((ticket) => ticket && ticket.tripId !== tripId)

  if (hasForeignRecord) {
    throw new Error('云端同步中的记录 ID 与其他本地旅行冲突，已停止恢复以避免覆盖。')
  }
}
