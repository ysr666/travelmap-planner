import Dexie, { type Table } from 'dexie'
import type { Day, ItineraryItem, TicketBlob, TicketMeta, Trip } from '../types'

class TravelConsoleDatabase extends Dexie {
  trips!: Table<Trip, string>
  days!: Table<Day, string>
  itineraryItems!: Table<ItineraryItem, string>
  ticketMetas!: Table<TicketMeta, string>
  ticketBlobs!: Table<TicketBlob, string>

  constructor() {
    super('TravelConsoleDB')

    this.version(1).stores({
      trips: 'id, updatedAt',
      days: 'id, tripId, [tripId+sortOrder], date',
      itineraryItems: 'id, tripId, dayId, [dayId+sortOrder], [dayId+startTime]',
      ticketMetas: 'id, tripId, itemId, createdAt',
      ticketBlobs: 'ticketId',
    })
  }
}

export const db = new TravelConsoleDatabase()
