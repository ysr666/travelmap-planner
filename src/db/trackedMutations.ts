import {
  clearTripAutoSnapshotState,
} from '../lib/autoSnapshotBackup'
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
  recordTripWriteForSync(trip.id, 'trip-created', { emitChangeEvent: false })
  return trip
}

export async function updateTrip(tripId: string, patch: Parameters<typeof repo.updateTrip>[1]) {
  const trip = await repo.updateTrip(tripId, patch)
  if (trip) {
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
  recordTripWriteForSync(day.tripId, 'day-created', { emitChangeEvent: false })
  return day
}

export async function updateDay(dayId: string, patch: Parameters<typeof repo.updateDay>[1]) {
  const day = await repo.updateDay(dayId, patch)
  if (day) {
    recordTripWriteForSync(day.tripId, 'day-updated', { emitChangeEvent: false })
  }
  return day
}

export async function deleteDayCascade(dayId: string) {
  const day = await repo.getDay(dayId)
  await repo.deleteDayCascade(dayId)
  if (day) {
    recordTripWriteForSync(day.tripId, 'day-deleted', { emitChangeEvent: false })
  }
}

export async function createItineraryItem(input: Parameters<typeof repo.createItineraryItem>[0]) {
  const item = await repo.createItineraryItem(input)
  recordTripWriteForSync(item.tripId, 'item-created', { emitChangeEvent: false })
  return item
}

export async function updateItineraryItem(
  itemId: string,
  patch: Parameters<typeof repo.updateItineraryItem>[1],
) {
  const item = await repo.updateItineraryItem(itemId, patch)
  if (item) {
    recordTripWriteForSync(item.tripId, 'item-updated', { emitChangeEvent: false })
  }
  return item
}

export async function deleteItineraryItemCascade(itemId: string) {
  const item = await repo.getItineraryItem(itemId)
  await repo.deleteItineraryItemCascade(itemId)
  if (item) {
    recordTripWriteForSync(item.tripId, 'item-deleted', { emitChangeEvent: false })
  }
}

export async function createTicketMeta(input: Parameters<typeof repo.createTicketMeta>[0]) {
  const ticket = await repo.createTicketMeta(input)
  recordTripWriteForSync(ticket.tripId, 'ticket-created', { emitChangeEvent: false })
  return ticket
}

export async function saveTicketBlob(ticketId: string, blob: Blob) {
  const record = await repo.saveTicketBlob(ticketId, blob)
  const ticket = await repo.getTicketMeta(ticketId)
  if (ticket) {
    recordTripWriteForSync(ticket.tripId, 'ticket-blob-saved', { emitChangeEvent: false })
  }
  return record
}

export async function deleteTicket(ticketId: string) {
  const ticket = await repo.getTicketMeta(ticketId)
  await repo.deleteTicket(ticketId)
  if (ticket) {
    recordTripWriteForSync(ticket.tripId, 'ticket-deleted', { emitChangeEvent: false })
  }
}

export async function importTripBackupRecords(
  input: Parameters<typeof repo.importTripBackupRecords>[0],
  options: MarkDirtyOptions = {},
) {
  const result = await repo.importTripBackupRecords(input)
  if (options.markDirty !== false) {
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
