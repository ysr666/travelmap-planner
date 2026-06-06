import {
  clearTripAutoSnapshotState,
} from '../lib/autoSnapshotBackup'
import {
  enqueueObjectDelete,
  enqueueObjectUpsert,
  markTicketBlobMissing,
  markTicketBlobDeleted,
  markTicketBlobPendingUpload,
} from '../lib/objectSyncLocal'
import { recordTripWriteForSync } from '../lib/tripSyncQueue'
import * as repo from './repositories'
import { createDemoTrip as createSeedDemoTrip } from './seed'

type MarkDirtyOptions = {
  markDirty?: boolean
}

export async function createDemoTrip() {
  const trip = await createSeedDemoTrip()
  recordTripWriteForSync(trip.id, 'demo-trip-created', { emitChangeEvent: false })
  return trip
}

export async function createTrip(input: Parameters<typeof repo.createTrip>[0]) {
  const trip = await repo.createTrip(input)
  await enqueueObjectUpsert({ object: trip, objectType: 'trip' })
  recordTripWriteForSync(trip.id, 'trip-created', { emitChangeEvent: false })
  return trip
}

export async function updateTrip(tripId: string, patch: Parameters<typeof repo.updateTrip>[1]) {
  const trip = await repo.updateTrip(tripId, patch)
  if (trip) {
    await enqueueObjectUpsert({ object: trip, objectType: 'trip' })
    recordTripWriteForSync(trip.id, 'trip-updated', { emitChangeEvent: false })
  }
  return trip
}

export async function deleteTripCascade(tripId: string) {
  await repo.deleteTripCascade(tripId)
  clearTripAutoSnapshotState(tripId)
}

export async function createDay(input: Parameters<typeof repo.createDay>[0]) {
  const day = await repo.createDay(input)
  await enqueueObjectUpsert({ object: day, objectType: 'day' })
  recordTripWriteForSync(day.tripId, 'day-created', { emitChangeEvent: false })
  return day
}

export async function updateDay(dayId: string, patch: Parameters<typeof repo.updateDay>[1]) {
  const day = await repo.updateDay(dayId, patch)
  if (day) {
    await enqueueObjectUpsert({ object: day, objectType: 'day' })
    recordTripWriteForSync(day.tripId, 'day-updated', { emitChangeEvent: false })
  }
  return day
}

export async function deleteDayCascade(dayId: string) {
  const day = await repo.getDay(dayId)
  await repo.deleteDayCascade(dayId)
  if (day) {
    await enqueueObjectDelete({ objectId: day.id, objectType: 'day', tripId: day.tripId })
    recordTripWriteForSync(day.tripId, 'day-deleted', { emitChangeEvent: false })
  }
}

export async function createItineraryItem(input: Parameters<typeof repo.createItineraryItem>[0]) {
  const item = await repo.createItineraryItem(input)
  await enqueueObjectUpsert({ object: item, objectType: 'item' })
  recordTripWriteForSync(item.tripId, 'item-created', { emitChangeEvent: false })
  return item
}

export async function updateItineraryItem(
  itemId: string,
  patch: Parameters<typeof repo.updateItineraryItem>[1],
) {
  const item = await repo.updateItineraryItem(itemId, patch)
  if (item) {
    await enqueueObjectUpsert({ object: item, objectType: 'item' })
    recordTripWriteForSync(item.tripId, 'item-updated', { emitChangeEvent: false })
  }
  return item
}

export async function deleteItineraryItemCascade(itemId: string) {
  const item = await repo.getItineraryItem(itemId)
  await repo.deleteItineraryItemCascade(itemId)
  if (item) {
    await enqueueObjectDelete({ objectId: item.id, objectType: 'item', tripId: item.tripId })
    recordTripWriteForSync(item.tripId, 'item-deleted', { emitChangeEvent: false })
  }
}

export async function createTicketMeta(input: Parameters<typeof repo.createTicketMeta>[0]) {
  const ticket = await repo.createTicketMeta(input)
  await enqueueObjectUpsert({ object: ticket, objectType: 'ticket_meta' })
  recordTripWriteForSync(ticket.tripId, 'ticket-created', { emitChangeEvent: false })
  return ticket
}

export async function saveTicketBlob(ticketId: string, blob: Blob) {
  const record = await repo.saveTicketBlob(ticketId, blob)
  const ticket = await repo.getTicketMeta(ticketId)
  if (ticket) {
    await markTicketBlobPendingUpload({ blob, ticket })
    recordTripWriteForSync(ticket.tripId, 'ticket-blob-saved', { emitChangeEvent: false })
  }
  return record
}

export async function deleteTicket(ticketId: string) {
  const ticket = await repo.getTicketMeta(ticketId)
  await repo.deleteTicket(ticketId)
  if (ticket) {
    await markTicketBlobDeleted(ticket)
    await enqueueObjectDelete({ objectId: ticket.id, objectType: 'ticket_meta', tripId: ticket.tripId })
    recordTripWriteForSync(ticket.tripId, 'ticket-deleted', { emitChangeEvent: false })
  }
}

export async function importTripBackupRecords(
  input: Parameters<typeof repo.importTripBackupRecords>[0],
  options: MarkDirtyOptions = {},
) {
  const result = await repo.importTripBackupRecords(input)
  if (options.markDirty !== false) {
    await enqueueTripGraph(result.tripId)
    recordTripWriteForSync(result.tripId, 'zip-backup-imported', { emitChangeEvent: false })
  }
  return result
}

export async function importTripPlanRecords(
  input: Parameters<typeof repo.importTripPlanRecords>[0],
  options: MarkDirtyOptions = {},
) {
  const result = await repo.importTripPlanRecords(input)
  if (options.markDirty !== false) {
    await enqueueTripGraph(result.tripId)
    recordTripWriteForSync(result.tripId, 'trip-plan-imported', { emitChangeEvent: false })
  }
  return result
}

export async function replaceTripPlanRecords(
  input: Parameters<typeof repo.replaceTripPlanRecords>[0],
  options: MarkDirtyOptions = {},
) {
  const result = await repo.replaceTripPlanRecords(input)
  if (options.markDirty !== false) {
    recordTripWriteForSync(result.tripId, 'cloud-backup-restored', { emitChangeEvent: false })
  }
  return result
}

async function enqueueTripGraph(tripId: string) {
  const [trip, days, items, tickets] = await Promise.all([
    repo.getTrip(tripId),
    repo.listDaysByTrip(tripId),
    repo.listItemsByTrip(tripId),
    repo.listTicketsByTrip(tripId),
  ])
  if (trip) {
    await enqueueObjectUpsert({ object: trip, objectType: 'trip' })
  }
  await Promise.all([
    ...days.map((day) => enqueueObjectUpsert({ object: day, objectType: 'day' as const })),
    ...items.map((item) => enqueueObjectUpsert({ object: item, objectType: 'item' as const })),
    ...tickets.map((ticket) => enqueueObjectUpsert({ object: ticket, objectType: 'ticket_meta' as const })),
    ...tickets
      .filter((ticket) => (ticket.storageMode ?? 'copy') === 'copy')
      .map(async (ticket) => {
        const ticketBlob = await repo.getTicketBlob(ticket.id)
        if (ticketBlob?.blob) {
          await markTicketBlobPendingUpload({ blob: ticketBlob.blob, ticket })
        } else {
          await markTicketBlobMissing(ticket)
        }
      }),
  ])
}
