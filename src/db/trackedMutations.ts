import {
  clearTripAutoSnapshotState,
  markTripAutoSnapshotDirty,
} from '../lib/autoSnapshotBackup'
import * as repo from './repositories'
import { createDemoTrip as createSeedDemoTrip } from './seed'

type MarkDirtyOptions = {
  markDirty?: boolean
}

export async function createDemoTrip() {
  const trip = await createSeedDemoTrip()
  markTripAutoSnapshotDirty(trip.id, 'demo-trip-created')
  return trip
}

export async function createTrip(input: Parameters<typeof repo.createTrip>[0]) {
  const trip = await repo.createTrip(input)
  markTripAutoSnapshotDirty(trip.id, 'trip-created')
  return trip
}

export async function updateTrip(tripId: string, patch: Parameters<typeof repo.updateTrip>[1]) {
  const trip = await repo.updateTrip(tripId, patch)
  if (trip) {
    markTripAutoSnapshotDirty(trip.id, 'trip-updated')
  }
  return trip
}

export async function deleteTripCascade(tripId: string) {
  await repo.deleteTripCascade(tripId)
  clearTripAutoSnapshotState(tripId)
}

export async function createDay(input: Parameters<typeof repo.createDay>[0]) {
  const day = await repo.createDay(input)
  markTripAutoSnapshotDirty(day.tripId, 'day-created')
  return day
}

export async function updateDay(dayId: string, patch: Parameters<typeof repo.updateDay>[1]) {
  const day = await repo.updateDay(dayId, patch)
  if (day) {
    markTripAutoSnapshotDirty(day.tripId, 'day-updated')
  }
  return day
}

export async function deleteDayCascade(dayId: string) {
  const day = await repo.getDay(dayId)
  await repo.deleteDayCascade(dayId)
  if (day) {
    markTripAutoSnapshotDirty(day.tripId, 'day-deleted')
  }
}

export async function createItineraryItem(input: Parameters<typeof repo.createItineraryItem>[0]) {
  const item = await repo.createItineraryItem(input)
  markTripAutoSnapshotDirty(item.tripId, 'item-created')
  return item
}

export async function updateItineraryItem(
  itemId: string,
  patch: Parameters<typeof repo.updateItineraryItem>[1],
) {
  const item = await repo.updateItineraryItem(itemId, patch)
  if (item) {
    markTripAutoSnapshotDirty(item.tripId, 'item-updated')
  }
  return item
}

export async function deleteItineraryItemCascade(itemId: string) {
  const item = await repo.getItineraryItem(itemId)
  await repo.deleteItineraryItemCascade(itemId)
  if (item) {
    markTripAutoSnapshotDirty(item.tripId, 'item-deleted')
  }
}

export async function createTicketMeta(input: Parameters<typeof repo.createTicketMeta>[0]) {
  const ticket = await repo.createTicketMeta(input)
  markTripAutoSnapshotDirty(ticket.tripId, 'ticket-created')
  return ticket
}

export async function saveTicketBlob(ticketId: string, blob: Blob) {
  const record = await repo.saveTicketBlob(ticketId, blob)
  const ticket = await repo.getTicketMeta(ticketId)
  if (ticket) {
    markTripAutoSnapshotDirty(ticket.tripId, 'ticket-blob-saved')
  }
  return record
}

export async function deleteTicket(ticketId: string) {
  const ticket = await repo.getTicketMeta(ticketId)
  await repo.deleteTicket(ticketId)
  if (ticket) {
    markTripAutoSnapshotDirty(ticket.tripId, 'ticket-deleted')
  }
}

export async function importTripBackupRecords(
  input: Parameters<typeof repo.importTripBackupRecords>[0],
  options: MarkDirtyOptions = {},
) {
  const result = await repo.importTripBackupRecords(input)
  if (options.markDirty !== false) {
    markTripAutoSnapshotDirty(result.tripId, 'zip-backup-imported')
  }
  return result
}

export async function importTripPlanRecords(
  input: Parameters<typeof repo.importTripPlanRecords>[0],
  options: MarkDirtyOptions = {},
) {
  const result = await repo.importTripPlanRecords(input)
  if (options.markDirty !== false) {
    markTripAutoSnapshotDirty(result.tripId, 'trip-plan-imported')
  }
  return result
}
