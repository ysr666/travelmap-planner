import { db } from './database'
import Dexie from 'dexie'
import { createId } from './ids'
import { sortItineraryItems } from '../lib/itinerary'
import type {
  Day,
  ItineraryItem,
  LedgerBudget,
  LedgerExpense,
  LedgerParticipant,
  LedgerSettings,
  TicketBlob,
  TicketMeta,
  Trip,
} from '../types'

type CreateTripInput = Omit<Trip, 'id' | 'createdAt' | 'updatedAt'>
type UpdateTripPatch = Partial<Omit<Trip, 'id' | 'createdAt' | 'updatedAt'>>

type CreateDayInput = Omit<Day, 'id'>
type UpdateDayPatch = Partial<Omit<Day, 'id' | 'tripId'>>

type CreateItineraryItemInput = Omit<ItineraryItem, 'id' | 'createdAt' | 'updatedAt'>
type UpdateItineraryItemPatch = Partial<
  Omit<ItineraryItem, 'id' | 'tripId' | 'dayId' | 'createdAt' | 'updatedAt'>
>

type CreateTicketMetaInput = Omit<TicketMeta, 'id' | 'createdAt' | 'updatedAt'>

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
      ])
    },
  )
}

export async function createDay(input: CreateDayInput) {
  const day: Day = {
    ...input,
    id: createId('day'),
  }

  await db.days.add(day)
  await db.trips.update(day.tripId, { updatedAt: Date.now() })
  return day
}

export async function listDaysByTrip(tripId: string) {
  return db.days.where('[tripId+sortOrder]').between([tripId, DexieMinKey], [tripId, DexieMaxKey]).toArray()
}

export async function getDay(dayId: string) {
  return db.days.get(dayId)
}

export async function updateDay(dayId: string, patch: UpdateDayPatch) {
  const day = await db.days.get(dayId)
  if (!day) {
    return undefined
  }

  await db.transaction('rw', db.days, db.trips, async () => {
    await db.days.update(dayId, patch)
    await db.trips.update(day.tripId, { updatedAt: Date.now() })
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

export async function createItineraryItem(input: CreateItineraryItemInput) {
  const now = Date.now()
  const item: ItineraryItem = {
    ...input,
    id: createId('item'),
    createdAt: now,
    updatedAt: now,
  }

  await db.transaction('rw', db.itineraryItems, db.trips, async () => {
    await db.itineraryItems.add(item)
    await db.trips.update(item.tripId, { updatedAt: now })
  })

  return item
}

export async function listItemsByDay(dayId: string) {
  const items = await db.itineraryItems
    .where('[dayId+sortOrder]')
    .between([dayId, DexieMinKey], [dayId, DexieMaxKey])
    .toArray()
  return sortItineraryItems(items)
}

export async function listItemsByTrip(tripId: string) {
  const items = await db.itineraryItems.where('tripId').equals(tripId).toArray()
  return sortItineraryItems(items)
}

export async function getItineraryItem(itemId: string) {
  return db.itineraryItems.get(itemId)
}

export async function updateItineraryItem(itemId: string, patch: UpdateItineraryItemPatch) {
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
    await db.trips.update(item.tripId, { updatedAt })
  })

  return getItineraryItem(itemId)
}

export async function deleteItineraryItemCascade(itemId: string) {
  await db.transaction(
    'rw',
    db.itineraryItems,
    db.ticketMetas,
    db.ticketBlobs,
    db.trips,
    async () => {
      const item = await db.itineraryItems.get(itemId)
      if (!item) {
        return
      }

      const ticketMetas = await db.ticketMetas.where('itemId').equals(itemId).toArray()
      const ticketIds = ticketMetas.map((ticket) => ticket.id)

      await Promise.all([
        db.itineraryItems.delete(itemId),
        ticketIds.length > 0 ? db.ticketMetas.bulkDelete(ticketIds) : Promise.resolve(),
        ticketIds.length > 0 ? db.ticketBlobs.bulkDelete(ticketIds) : Promise.resolve(),
        db.trips.update(item.tripId, { updatedAt: Date.now() }),
      ])
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
