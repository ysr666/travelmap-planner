import Dexie, { type Table } from 'dexie'
import type {
  Day,
  ItineraryItem,
  ObjectSyncState,
  SyncOutboxEntry,
  TicketBlob,
  TicketBlobSyncState,
  TicketMeta,
  Trip,
} from '../types'

class TravelConsoleDatabase extends Dexie {
  trips!: Table<Trip, string>
  days!: Table<Day, string>
  itineraryItems!: Table<ItineraryItem, string>
  ticketMetas!: Table<TicketMeta, string>
  ticketBlobs!: Table<TicketBlob, string>
  syncOutbox!: Table<SyncOutboxEntry, string>
  objectSyncStates!: Table<ObjectSyncState, string>
  ticketBlobSyncStates!: Table<TicketBlobSyncState, string>

  constructor() {
    super('TravelConsoleDB')

    this.version(1).stores({
      trips: 'id, updatedAt',
      days: 'id, tripId, [tripId+sortOrder], date',
      itineraryItems: 'id, tripId, dayId, [dayId+sortOrder], [dayId+startTime]',
      ticketMetas: 'id, tripId, itemId, createdAt',
      ticketBlobs: 'ticketId',
    })

    this.version(2).stores({
      trips: 'id, updatedAt',
      days: 'id, tripId, [tripId+sortOrder], date',
      itineraryItems: 'id, tripId, dayId, [dayId+sortOrder], [dayId+startTime]',
      ticketMetas: 'id, tripId, itemId, createdAt',
      ticketBlobs: 'ticketId',
      syncOutbox: 'id, tripId, objectKey, [tripId+status], [objectType+objectId], updatedAt',
      objectSyncStates: 'objectKey, tripId, [objectType+objectId], conflictAt',
      ticketBlobSyncStates: 'ticketId, tripId, [tripId+uploadStatus], [tripId+cacheStatus], updatedAt',
    }).upgrade(async (transaction) => {
      const ticketMetas = transaction.table<TicketMeta, string>('ticketMetas')
      const ticketBlobs = transaction.table<TicketBlob, string>('ticketBlobs')
      const ticketBlobSyncStates = transaction.table<TicketBlobSyncState, string>('ticketBlobSyncStates')
      const now = Date.now()
      const tickets = await ticketMetas.toArray()
      const copyTickets = tickets.filter((ticket) => (ticket.storageMode ?? 'copy') === 'copy')
      if (copyTickets.length === 0) {
        return
      }

      const states = await Promise.all(copyTickets.map(async (ticket) => {
        const blob = await ticketBlobs.get(ticket.id)
        return {
          cacheStatus: blob ? 'cached' : 'missing',
          fileName: ticket.fileName,
          lastCacheCheckedAt: now,
          mimeType: ticket.mimeType,
          size: blob?.blob.size ?? ticket.size,
          ticketId: ticket.id,
          tripId: ticket.tripId,
          updatedAt: now,
          uploadStatus: blob ? 'pending' : 'missing',
        } satisfies TicketBlobSyncState
      }))
      await ticketBlobSyncStates.bulkPut(states)
    })
  }
}

export const db = new TravelConsoleDatabase()
