import { db } from '../db/database'
import { createId } from '../db/ids'
import {
  getTripDisruptionEvent,
  getTripReplanRecord,
  listDaysByTrip,
  listItemsByTrip,
  listLedgerExpenses,
  listTicketsByTrip,
  updateTripReplanRecord,
} from '../db'
import { emitTravelDataChanged } from './dataEvents'
import { sortItineraryItems } from './itinerary'
import { hasValidCoordinates } from './mapLinks'
import { enqueueObjectUpsert } from './objectSyncLocal'
import { recordTripWriteForSync } from './tripSyncQueue'
import type {
  Day,
  ItineraryItem,
  LedgerExpense,
  ReplanFlexibility,
  ReplanPriority,
  TicketMeta,
  Trip,
  TripDisruptionEvent,
  TripReplanDiff,
  TripReplanItemChange,
  TripReplanLedgerImpact,
  TripReplanOption,
  TripReplanRecord,
  TripReplanRouteImpact,
  TripReplanSnapshot,
  TripReplanSourceEvidence,
  TripReplanStrategy,
  TripReplanTicketImpact,
} from '../types'

type ReplanContext = {
  days: Day[]
  event: TripDisruptionEvent
  evidence?: TripReplanSourceEvidence[]
  items: ItineraryItem[]
  ledgerExpenses?: LedgerExpense[]
  now?: Date
  routeOrderSuggestionIdsByDay?: Record<string, string[]>
  tickets?: TicketMeta[]
  trip: Trip
}

type ClassifiedItem = {
  flexibility: ReplanFlexibility
  item: ItineraryItem
  priority: ReplanPriority
  reason: string
}

type ItemPatch = TripReplanOption['itemPatches'][number]

const FIXED_TICKET_CATEGORIES = new Set<TicketMeta['ticketCategory']>([
  'flight_ticket',
  'hotel_booking',
  'restaurant_reservation',
  'train_ticket',
  'transport_booking',
])

const STRATEGY_TITLES: Record<TripReplanStrategy, string> = {
  least_change: '最少改动',
  preserve_most: '尽量保留',
  shortest_route: '最省路程',
}

export function buildTripReplanPreview({
  days,
  event,
  evidence = [],
  items,
  ledgerExpenses = [],
  now = new Date(),
  routeOrderSuggestionIdsByDay = {},
  tickets = [],
  trip,
}: ReplanContext): Omit<TripReplanRecord, 'createdAt' | 'id' | 'updatedAt'> {
  const orderedDays = [...days].sort((first, second) => first.sortOrder - second.sortOrder)
  const orderedItems = sortItineraryItems(items)
  const beforeSnapshot = buildReplanSnapshot(orderedDays, orderedItems, event)
  const ticketByItem = groupTicketsByItem(tickets)
  const classifications = new Map(orderedItems.map((item) => [
    item.id,
    classifyReplanItem(item, ticketByItem.get(item.id) ?? [], event),
  ]))
  const options = (['least_change', 'preserve_most', 'shortest_route'] as TripReplanStrategy[]).map((strategy) =>
    buildOption({
      classifications,
      days: orderedDays,
      event,
      items: orderedItems,
      ledgerExpenses,
      routeOrderSuggestionIdsByDay,
      strategy,
      ticketByItem,
    }),
  )

  return {
    baselineFingerprint: buildReplanFingerprint(beforeSnapshot),
    beforeSnapshot,
    eventId: event.id,
    evidence: normalizeEvidence(event, evidence, now),
    options,
    status: 'preview',
    tripId: trip.id,
  }
}

export async function createTripReplanPreviewForEvent(eventId: string) {
  const event = await getTripDisruptionEvent(eventId)
  if (!event) throw new Error('没有找到突发事件。')
  const trip = await db.trips.get(event.tripId)
  if (!trip) throw new Error('没有找到旅行。')
  const [days, items, tickets, ledgerExpenses] = await Promise.all([
    listDaysByTrip(trip.id),
    listItemsByTrip(trip.id),
    listTicketsByTrip(trip.id),
    listLedgerExpenses(trip.id),
  ])
  const preview = buildTripReplanPreview({ days, event, items, ledgerExpenses, tickets, trip })
  const now = Date.now()
  const record: TripReplanRecord = {
    ...preview,
    createdAt: now,
    id: createId('replan_record'),
    updatedAt: now,
  }
  await db.transaction('rw', db.tripReplanRecords, db.tripReplanEvents, db.trips, async () => {
    await db.tripReplanRecords.add(record)
    await db.tripReplanEvents.update(event.id, { status: 'planned', updatedAt: now })
    await db.trips.update(event.tripId, { updatedAt: now })
  })
  await Promise.all([
    enqueueObjectUpsert({ object: { ...event, status: 'planned', updatedAt: now }, objectType: 'replan_event' }),
    enqueueObjectUpsert({ object: record, objectType: 'replan_record' }),
  ])
  recordTripWriteForSync(record.tripId, 'replan-preview-created', { emitChangeEvent: false })
  emitTravelDataChanged()
  return record
}

export async function applyTripReplanOption(recordId: string, optionId: string) {
  const record = await getTripReplanRecord(recordId)
  if (!record) throw new Error('没有找到重排记录。')
  if (record.status !== 'preview') throw new Error('这次重排已经处理过。')
  const option = record.options.find((candidate) => candidate.id === optionId)
  if (!option) throw new Error('没有找到要应用的方案。')

  const [days, currentItems] = await Promise.all([
    listDaysByTrip(record.tripId),
    listItemsByTrip(record.tripId),
  ])
  const currentBaseline = buildReplanFingerprint(buildScopedSnapshot(days, currentItems, record.beforeSnapshot.items.map((item) => item.id)))
  if (currentBaseline !== record.baselineFingerprint) {
    await updateTripReplanRecord(record.id, { status: 'conflict' })
    throw new Error('行程已变化，请重新生成重排方案。')
  }

  const now = Date.now()
  const itemById = new Map(currentItems.map((item) => [item.id, item]))
  const updatedItems = option.itemPatches.flatMap((patch) => {
    const item = itemById.get(patch.itemId)
    if (!item) return []
    return [{
      ...item,
      ...patch.patch,
      updatedAt: now,
    }]
  })
  const afterItemsById = new Map(currentItems.map((item) => [item.id, item]))
  for (const item of updatedItems) afterItemsById.set(item.id, item)
  const afterSnapshot = buildScopedSnapshot(days, [...afterItemsById.values()], record.beforeSnapshot.items.map((item) => item.id))
  const appliedFingerprint = buildReplanFingerprint(afterSnapshot)

  await db.transaction('rw', db.itineraryItems, db.tripReplanRecords, db.tripReplanEvents, db.trips, async () => {
    if (updatedItems.length > 0) await db.itineraryItems.bulkPut(updatedItems)
    await db.tripReplanRecords.update(record.id, {
      afterSnapshot,
      appliedFingerprint,
      selectedDiff: option.diff,
      selectedOptionId: option.id,
      status: 'applied',
      updatedAt: now,
    })
    await db.tripReplanEvents.update(record.eventId, { status: 'applied', updatedAt: now })
    await db.trips.update(record.tripId, { updatedAt: now })
  })

  await Promise.all([
    ...updatedItems.map((item) => enqueueObjectUpsert({ object: item, objectType: 'item' as const })),
    enqueueObjectUpsert({
      object: {
        ...record,
        afterSnapshot,
        appliedFingerprint,
        selectedDiff: option.diff,
        selectedOptionId: option.id,
        status: 'applied',
        updatedAt: now,
      },
      objectType: 'replan_record',
    }),
    getTripDisruptionEvent(record.eventId).then((event) =>
      event ? enqueueObjectUpsert({ object: { ...event, status: 'applied', updatedAt: now }, objectType: 'replan_event' }) : undefined,
    ),
  ])
  recordTripWriteForSync(record.tripId, 'replan-applied', { emitChangeEvent: false })
  emitTravelDataChanged()
  return { ...record, afterSnapshot, appliedFingerprint, selectedDiff: option.diff, selectedOptionId: option.id, status: 'applied' as const, updatedAt: now }
}

export async function undoTripReplan(recordId: string) {
  const record = await getTripReplanRecord(recordId)
  if (!record) throw new Error('没有找到重排记录。')
  if (record.status !== 'applied' || !record.appliedFingerprint || !record.afterSnapshot) {
    throw new Error('这次重排不能撤销。')
  }
  const [days, currentItems] = await Promise.all([
    listDaysByTrip(record.tripId),
    listItemsByTrip(record.tripId),
  ])
  const currentApplied = buildReplanFingerprint(buildScopedSnapshot(days, currentItems, record.afterSnapshot.items.map((item) => item.id)))
  if (currentApplied !== record.appliedFingerprint) {
    await updateTripReplanRecord(record.id, { status: 'conflict' })
    throw new Error('当前行程已和应用后的快照不一致，不能整次撤销。')
  }

  const now = Date.now()
  const restoredItems = record.beforeSnapshot.items.map((item) => ({ ...item, updatedAt: now }))
  await db.transaction('rw', db.itineraryItems, db.tripReplanRecords, db.trips, async () => {
    if (restoredItems.length > 0) await db.itineraryItems.bulkPut(restoredItems)
    await db.tripReplanRecords.update(record.id, { status: 'undone', undoneAt: now, updatedAt: now })
    await db.trips.update(record.tripId, { updatedAt: now })
  })
  await Promise.all([
    ...restoredItems.map((item) => enqueueObjectUpsert({ object: item, objectType: 'item' as const })),
    enqueueObjectUpsert({ object: { ...record, status: 'undone', undoneAt: now, updatedAt: now }, objectType: 'replan_record' }),
  ])
  recordTripWriteForSync(record.tripId, 'replan-undone', { emitChangeEvent: false })
  emitTravelDataChanged()
  return { ...record, status: 'undone' as const, undoneAt: now, updatedAt: now }
}

export function classifyReplanItem(
  item: ItineraryItem,
  tickets: TicketMeta[],
  event?: Pick<TripDisruptionEvent, 'itemId' | 'kind'>,
): ClassifiedItem {
  const explicitFlexibility = item.replanPreference?.flexibility
  const explicitPriority = item.replanPreference?.priority
  const fixedTicket = tickets.some((ticket) => ticket.ticketCategory && FIXED_TICKET_CATEGORIES.has(ticket.ticketCategory))
  const hasTicket = tickets.length > 0 || item.ticketIds.length > 0
  const priority: ReplanPriority = explicitPriority ?? (
    fixedTicket ? 'must_keep'
      : hasTicket ? 'high'
        : item.startTime ? 'normal'
          : 'low'
  )
  if (item.executionState?.status === 'completed') {
    return { flexibility: 'fixed', item, priority, reason: '已完成的行程不会被重排。' }
  }
  if (explicitFlexibility) {
    return { flexibility: explicitFlexibility, item, priority, reason: '使用用户设置的重排偏好。' }
  }
  if (fixedTicket) {
    return { flexibility: 'fixed', item, priority, reason: '绑定了不可移动票据或预约。' }
  }
  if (event?.itemId === item.id && (event.kind === 'cancelled' || event.kind === 'skip')) {
    return { flexibility: 'optional', item, priority: priority === 'must_keep' ? 'high' : priority, reason: '用户临时取消或跳过。' }
  }
  if (priority === 'low' && !hasTicket) {
    return { flexibility: 'optional', item, priority, reason: '低优先级且无票据绑定。' }
  }
  return { flexibility: 'movable', item, priority, reason: hasTicket ? '有票据影响，默认尽量保留。' : '可移动行程点。' }
}

export function buildReplanFingerprint(snapshot: TripReplanSnapshot) {
  return stableStringify({
    days: snapshot.days.map((day) => ({
      date: day.date,
      id: day.id,
      sortOrder: day.sortOrder,
      title: day.title,
    })).sort(compareById),
    items: snapshot.items.map((item) => ({
      dayId: item.dayId,
      endTime: item.endTime,
      executionState: item.executionState,
      id: item.id,
      sortOrder: item.sortOrder,
      startTime: item.startTime,
      title: item.title,
      updatedAt: item.updatedAt,
    })).sort(compareById),
  })
}

function buildOption({
  classifications,
  days,
  event,
  items,
  ledgerExpenses,
  routeOrderSuggestionIdsByDay,
  strategy,
  ticketByItem,
}: {
  classifications: Map<string, ClassifiedItem>
  days: Day[]
  event: TripDisruptionEvent
  items: ItineraryItem[]
  ledgerExpenses: LedgerExpense[]
  routeOrderSuggestionIdsByDay: Record<string, string[]>
  strategy: TripReplanStrategy
  ticketByItem: Map<string, TicketMeta[]>
}) {
  const patches = buildStrategyPatches({
    classifications,
    days,
    event,
    items,
    routeOrderSuggestionIdsByDay,
    strategy,
  })
  const diff = buildDiff({
    event,
    items,
    ledgerExpenses,
    patches,
    strategy,
    ticketByItem,
  })
  const changedCount = diff.itemChanges.filter((change) => change.changeType !== 'unchanged').length
  const preservedCount = items.length - diff.itemChanges.filter((change) => change.after.executionState?.status === 'skipped').length
  const routeMinutes = diff.routeImpacts.reduce((total, impact) => total + Math.max(0, impact.afterTravelMinutes ?? 0), 0)
  const score = strategy === 'least_change'
    ? 1000 - changedCount * 30
    : strategy === 'preserve_most'
      ? preservedCount * 40 - changedCount * 10
      : 800 - routeMinutes - changedCount * 8

  return {
    diff,
    id: createId(`replan_${strategy}`),
    itemPatches: patches,
    score,
    strategy,
    summary: summarizeOption(strategy, diff),
    title: STRATEGY_TITLES[strategy],
  } satisfies TripReplanOption
}

function buildStrategyPatches({
  classifications,
  days,
  event,
  items,
  routeOrderSuggestionIdsByDay,
  strategy,
}: {
  classifications: Map<string, ClassifiedItem>
  days: Day[]
  event: TripDisruptionEvent
  items: ItineraryItem[]
  routeOrderSuggestionIdsByDay: Record<string, string[]>
  strategy: TripReplanStrategy
}): ItemPatch[] {
  const affected = getAffectedItems({ days, event, items })
  const delayMinutes = Math.max(0, event.delayMinutes ?? defaultDelayMinutes(event))
  const patches = new Map<string, ItemPatch>()

  for (const item of affected) {
    const classification = classifications.get(item.id)
    if (!classification || classification.flexibility === 'fixed') continue

    if (item.id === event.itemId && (event.kind === 'skip' || event.kind === 'cancelled')) {
      patches.set(item.id, {
        itemId: item.id,
        patch: { executionState: { status: 'skipped', updatedAt: Date.now() } },
      })
      continue
    }

    if (item.id === event.itemId && event.kind === 'closure') {
      if (strategy === 'preserve_most' && classification.priority !== 'low') {
        const nextDay = findNextDay(days, item.dayId)
        if (nextDay) {
          patches.set(item.id, {
            itemId: item.id,
            patch: { dayId: nextDay.id, sortOrder: getNextSortOrder(items, nextDay.id) },
          })
          continue
        }
      }
      patches.set(item.id, {
        itemId: item.id,
        patch: { executionState: { status: 'skipped', updatedAt: Date.now() } },
      })
      continue
    }

    if (delayMinutes > 0 && (event.kind === 'delay' || event.kind === 'late')) {
      const shifted = shiftItemTime(item, delayMinutes)
      if (shifted) {
        patches.set(item.id, { itemId: item.id, patch: shifted })
      }
    }
  }

  if (strategy === 'shortest_route') {
    for (const day of days) {
      const dayAffected = affected.filter((item) => item.dayId === day.id)
      const reorderPatches = buildShortestRouteSortPatches({
        classifications,
        items: sortItineraryItems(dayAffected.length > 0 ? dayAffected : items.filter((item) => item.dayId === day.id)),
        suggestedIds: routeOrderSuggestionIdsByDay[day.id],
      })
      for (const patch of reorderPatches) {
        const existing = patches.get(patch.itemId)
        patches.set(patch.itemId, {
          itemId: patch.itemId,
          patch: { ...existing?.patch, ...patch.patch },
        })
      }
    }
  }

  return [...patches.values()]
}

function getAffectedItems({
  days,
  event,
  items,
}: {
  days: Day[]
  event: TripDisruptionEvent
  items: ItineraryItem[]
}) {
  const itemById = new Map(items.map((item) => [item.id, item]))
  const targetItem = event.itemId ? itemById.get(event.itemId) : undefined
  const affectedDayId = event.dayId ?? targetItem?.dayId ?? days[0]?.id
  const dayById = new Map(days.map((day) => [day.id, day]))
  const affectedDay = affectedDayId ? dayById.get(affectedDayId) : undefined
  const affectedSortOrder = targetItem?.sortOrder ?? 0
  if (!affectedDay) return []
  const affectedDayOrder = affectedDay.sortOrder
  return sortItineraryItems(items).filter((item) => {
    const day = dayById.get(item.dayId)
    if (!day) return false
    if (day.sortOrder > affectedDayOrder) return true
    if (day.sortOrder < affectedDayOrder) return false
    return item.sortOrder >= affectedSortOrder
  })
}

function shiftItemTime(item: ItineraryItem, minutes: number) {
  const patch: ItemPatch['patch'] = {}
  const startTime = item.startTime ? addMinutesToTime(item.startTime, minutes) : undefined
  const endTime = item.endTime ? addMinutesToTime(item.endTime, minutes) : undefined
  if (startTime && startTime !== item.startTime) patch.startTime = startTime
  if (endTime && endTime !== item.endTime) patch.endTime = endTime
  return Object.keys(patch).length > 0 ? patch : null
}

function buildShortestRouteSortPatches({
  classifications,
  items,
  suggestedIds,
}: {
  classifications: Map<string, ClassifiedItem>
  items: ItineraryItem[]
  suggestedIds?: string[]
}): ItemPatch[] {
  const orderedItems = sortItineraryItems(items)
  const movableCoordinateItems = orderedItems.filter((item) => {
    const classification = classifications.get(item.id)
    return hasValidCoordinates(item) && classification?.flexibility !== 'fixed'
  })
  if (movableCoordinateItems.length < 2) return []
  const orderedMovableIds = suggestedIds && hasSameSet(suggestedIds, movableCoordinateItems.map((item) => item.id))
    ? suggestedIds
    : nearestNeighborOrder(movableCoordinateItems).map((item) => item.id)
  const queue = [...orderedMovableIds]
  const nextOrder = orderedItems.map((item) => {
    const classification = classifications.get(item.id)
    if (hasValidCoordinates(item) && classification?.flexibility !== 'fixed') {
      return queue.shift() ?? item.id
    }
    return item.id
  })
  return nextOrder.flatMap((itemId, index) => {
    const item = orderedItems.find((candidate) => candidate.id === itemId)
    const sortOrder = index + 1
    if (!item || item.sortOrder === sortOrder) return []
    return [{ itemId: item.id, patch: { sortOrder } }]
  })
}

function nearestNeighborOrder(items: ItineraryItem[]) {
  const remaining = [...items]
  const result: ItineraryItem[] = []
  let current = remaining.shift()
  if (!current) return result
  result.push(current)
  while (remaining.length > 0) {
    const nextIndex = remaining.reduce((bestIndex, candidate, index) => {
      const best = remaining[bestIndex]
      return distanceBetweenItems(current!, candidate) < distanceBetweenItems(current!, best) ? index : bestIndex
    }, 0)
    current = remaining.splice(nextIndex, 1)[0]
    result.push(current)
  }
  return result
}

function buildDiff({
  event,
  items,
  ledgerExpenses,
  patches,
  strategy,
  ticketByItem,
}: {
  event: TripDisruptionEvent
  items: ItineraryItem[]
  ledgerExpenses: LedgerExpense[]
  patches: ItemPatch[]
  strategy: TripReplanStrategy
  ticketByItem: Map<string, TicketMeta[]>
}): TripReplanDiff {
  const itemById = new Map(items.map((item) => [item.id, item]))
  const patchById = new Map(patches.map((patch) => [patch.itemId, patch.patch]))
  const changedItems = patches.flatMap((patch) => {
    const item = itemById.get(patch.itemId)
    if (!item) return []
    const after = { ...item, ...patch.patch }
    return [buildItemChange(item, after, event, strategy)]
  })
  const affectedDayIds = new Set(changedItems.flatMap((change) => [change.before.dayId, change.after.dayId]))
  const routeImpacts = [...affectedDayIds].map((dayId) => buildRouteImpact(dayId, items, patchById))
  const ticketImpacts = changedItems.flatMap((change) =>
    (ticketByItem.get(change.itemId) ?? []).map((ticket) => buildTicketImpact(ticket, change)),
  )
  const ledgerImpacts = buildLedgerImpacts(ledgerExpenses, changedItems)
  const companionImpacts = buildCompanionImpacts(changedItems)
  const warnings = [
    ...routeImpacts.filter((impact) => impact.staleRouteCache).map((impact) => impact.summary),
    ...ticketImpacts.filter((impact) => impact.impact !== 'unaffected').map((impact) => impact.summary),
    ...ledgerImpacts.filter((impact) => impact.impact !== 'unaffected').map((impact) => impact.summary),
  ]
  if (event.evidence.length === 0) {
    warnings.push('当前突发情况仅来自用户报告，没有实时来源证明。')
  }

  return {
    companionImpacts,
    itemChanges: changedItems,
    ledgerImpacts,
    routeImpacts,
    ticketImpacts,
    warnings: [...new Set(warnings)],
  }
}

function buildItemChange(
  before: ItineraryItem,
  after: ItineraryItem,
  event: TripDisruptionEvent,
  strategy: TripReplanStrategy,
): TripReplanItemChange {
  const changeType: TripReplanItemChange['changeType'] = after.executionState?.status === 'skipped' && before.executionState?.status !== 'skipped'
    ? 'skipped'
    : before.dayId !== after.dayId
      ? 'day_changed'
      : before.sortOrder !== after.sortOrder
        ? 'reordered'
        : before.startTime !== after.startTime || before.endTime !== after.endTime
          ? 'time_changed'
          : 'unchanged'
  return {
    after: pickItemSchedule(after),
    before: pickItemSchedule(before),
    changeType,
    itemId: before.id,
    reason: buildChangeReason(changeType, event, strategy),
    title: before.title,
  }
}

function buildRouteImpact(dayId: string, items: ItineraryItem[], patchById: Map<string, ItemPatch['patch']>): TripReplanRouteImpact {
  const dayItems = sortItineraryItems(items.filter((item) => item.dayId === dayId))
  const changed = dayItems.filter((item) => patchById.has(item.id))
  const beforeTravelMinutes = sumTravelMinutes(dayItems)
  const afterTravelMinutes = sumTravelMinutes(dayItems.map((item) => ({ ...item, ...patchById.get(item.id) })))
  return {
    afterTravelMinutes,
    beforeTravelMinutes,
    dayId,
    deltaMinutes: afterTravelMinutes - beforeTravelMinutes,
    itemIds: changed.map((item) => item.id),
    staleRouteCache: changed.length > 0,
    summary: changed.length > 0 ? '当天路线缓存需要在确认后重新生成。' : '路线无变化。',
  }
}

function buildTicketImpact(ticket: TicketMeta, change: TripReplanItemChange): TripReplanTicketImpact {
  const title = ticket.title || ticket.fileName
  if (change.changeType === 'skipped') {
    return {
      impact: 'skip_warning',
      itemId: change.itemId,
      summary: `${title} 绑定的行程被跳过，请人工确认是否退改。`,
      ticketId: ticket.id,
      title,
    }
  }
  if (change.changeType === 'time_changed' || change.changeType === 'day_changed') {
    return {
      impact: 'time_warning',
      itemId: change.itemId,
      summary: `${title} 绑定行程时间变化，请核对票面时间。`,
      ticketId: ticket.id,
      title,
    }
  }
  return { impact: 'unaffected', itemId: change.itemId, summary: `${title} 不受影响。`, ticketId: ticket.id, title }
}

function buildLedgerImpacts(expenses: LedgerExpense[], changes: TripReplanItemChange[]): TripReplanLedgerImpact[] {
  const changedByItem = new Map(changes.map((change) => [change.itemId, change]))
  return expenses.flatMap((expense) => {
    const itemIds = expense.itemIds ?? []
    const relatedChanges = itemIds.flatMap((itemId) => changedByItem.get(itemId) ? [changedByItem.get(itemId)!] : [])
    if (relatedChanges.length === 0) return []
    const skipped = relatedChanges.some((change) => change.changeType === 'skipped')
    return [{
      expenseId: expense.id,
      impact: skipped ? 'possible_refund' : 'review_needed',
      itemIds,
      summary: skipped ? `${expense.title} 可能需要退款或作废复核。` : `${expense.title} 关联行程已变化，需要复核账本。`,
      title: expense.title,
    } satisfies TripReplanLedgerImpact]
  })
}

function buildCompanionImpacts(changes: TripReplanItemChange[]) {
  return changes
    .filter((change) => change.changeType !== 'unchanged')
    .slice(0, 5)
    .map((change) => ({
      itemId: change.itemId,
      meetingTime: change.after.startTime,
      summary: change.after.startTime
        ? `${change.title} 的集合时间更新为 ${change.after.startTime}。`
        : `${change.title} 已更新，请查看共享行程。`,
      title: change.title,
    }))
}

function buildReplanSnapshot(days: Day[], items: ItineraryItem[], event: TripDisruptionEvent): TripReplanSnapshot {
  const scopedItems = getAffectedItems({ days, event, items })
  return buildScopedSnapshot(days, scopedItems, scopedItems.map((item) => item.id))
}

function buildScopedSnapshot(days: Day[], items: ItineraryItem[], itemIds: string[]): TripReplanSnapshot {
  const itemIdSet = new Set(itemIds)
  const scopedItems = sortItineraryItems(items.filter((item) => itemIdSet.has(item.id))).map((item) => ({ ...item }))
  const dayIds = new Set(scopedItems.map((item) => item.dayId))
  return {
    days: days.filter((day) => dayIds.has(day.id)).map((day) => ({ ...day })),
    items: scopedItems,
  }
}

function normalizeEvidence(event: TripDisruptionEvent, evidence: TripReplanSourceEvidence[], now: Date) {
  const reportedAt = event.occurredAt || now.toISOString()
  const userEvidence: TripReplanSourceEvidence = {
    id: `user-report:${event.id}`,
    kind: 'user_report',
    label: '用户报告',
    retrievedAt: reportedAt,
    snippet: event.notes,
    sourceType: 'unknown',
  }
  return [userEvidence, ...event.evidence, ...evidence].filter((entry, index, all) =>
    all.findIndex((candidate) => candidate.id === entry.id) === index,
  )
}

function groupTicketsByItem(tickets: TicketMeta[]) {
  const byItem = new Map<string, TicketMeta[]>()
  for (const ticket of tickets) {
    if (!ticket.itemId) continue
    byItem.set(ticket.itemId, [...(byItem.get(ticket.itemId) ?? []), ticket])
  }
  return byItem
}

function summarizeOption(strategy: TripReplanStrategy, diff: TripReplanDiff) {
  const changed = diff.itemChanges.filter((change) => change.changeType !== 'unchanged').length
  const skipped = diff.itemChanges.filter((change) => change.changeType === 'skipped').length
  if (strategy === 'least_change') return `调整 ${changed} 个行程点，尽量保持原顺序。`
  if (strategy === 'preserve_most') return `调整 ${changed} 个行程点，跳过 ${skipped} 个项目，优先保留高优先级安排。`
  return `调整 ${changed} 个行程点，优先减少同日绕路。`
}

function buildChangeReason(changeType: TripReplanItemChange['changeType'], event: TripDisruptionEvent, strategy: TripReplanStrategy) {
  if (changeType === 'skipped') return event.kind === 'closure' ? '地点不可用，暂时跳过。' : '用户报告取消或跳过。'
  if (changeType === 'day_changed') return '为了保留项目，将它移动到后续日期。'
  if (changeType === 'reordered') return strategy === 'shortest_route' ? '按本地路线估算调整顺序。' : '为适配重排更新顺序。'
  if (changeType === 'time_changed') return '根据延误或迟到时间顺延。'
  return '无变化。'
}

function pickItemSchedule(item: ItineraryItem) {
  return {
    dayId: item.dayId,
    endTime: item.endTime,
    executionState: item.executionState,
    sortOrder: item.sortOrder,
    startTime: item.startTime,
  }
}

function defaultDelayMinutes(event: TripDisruptionEvent) {
  if (event.kind === 'delay' || event.kind === 'late') return 30
  return 0
}

function findNextDay(days: Day[], dayId: string) {
  const ordered = [...days].sort((first, second) => first.sortOrder - second.sortOrder)
  const index = ordered.findIndex((day) => day.id === dayId)
  return index >= 0 ? ordered[index + 1] : undefined
}

function getNextSortOrder(items: ItineraryItem[], dayId: string) {
  return Math.max(0, ...items.filter((item) => item.dayId === dayId).map((item) => item.sortOrder)) + 1
}

function addMinutesToTime(time: string, minutes: number) {
  const [hourText, minuteText] = time.split(':')
  const hour = Number(hourText)
  const minute = Number(minuteText)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return time
  const total = Math.max(0, hour * 60 + minute + minutes)
  const nextHour = Math.floor(total / 60) % 24
  const nextMinute = total % 60
  return `${String(nextHour).padStart(2, '0')}:${String(nextMinute).padStart(2, '0')}`
}

function distanceBetweenItems(first: ItineraryItem, second: ItineraryItem) {
  if (!hasValidCoordinates(first) || !hasValidCoordinates(second)) return Number.POSITIVE_INFINITY
  const latDelta = (first.lat as number) - (second.lat as number)
  const lngDelta = (first.lng as number) - (second.lng as number)
  return latDelta * latDelta + lngDelta * lngDelta
}

function sumTravelMinutes(items: ItineraryItem[]) {
  return items.reduce((total, item) => total + Math.max(0, item.previousTransportDurationMinutes ?? 0), 0)
}

function hasSameSet(first: string[], second: string[]) {
  if (first.length !== second.length) return false
  const secondSet = new Set(second)
  return first.every((value) => secondSet.has(value))
}

function compareById(first: { id: string }, second: { id: string }) {
  return first.id.localeCompare(second.id)
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
      .map(([key, entry]) => [key, sortJson(entry)]),
  )
}
