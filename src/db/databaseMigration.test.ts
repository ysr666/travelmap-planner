import 'fake-indexeddb/auto'
import { Blob as NodeBlob } from 'node:buffer'
import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './database'
import type { TicketBlob, TicketMeta, Trip } from '../types'

const legacyStores = {
  days: 'id, tripId, [tripId+sortOrder], date',
  itineraryItems: 'id, tripId, dayId, [dayId+sortOrder], [dayId+startTime]',
  ticketBlobs: 'ticketId',
  ticketMetas: 'id, tripId, itemId, createdAt',
  trips: 'id, updatedAt',
}

beforeEach(async () => {
  db.close()
  await db.delete()
})

describe('TravelConsoleDB migrations', () => {
  it('creates ticket blob sync states for legacy copy tickets', async () => {
    const legacyDb = new Dexie('TravelConsoleDB')
    legacyDb.version(1).stores(legacyStores)
    await legacyDb.open()

    const trip: Trip = {
      createdAt: 100,
      destination: '日本东京',
      endDate: '2026-04-03',
      id: 'trip_legacy',
      startDate: '2026-04-01',
      title: '东京',
      updatedAt: 100,
    }
    const cachedTicket: TicketMeta = {
      createdAt: 100,
      fileName: 'cached.pdf',
      fileType: 'pdf',
      id: 'ticket_cached',
      mimeType: 'application/pdf',
      size: 6,
      storageMode: 'copy',
      title: '已缓存票据',
      tripId: trip.id,
      updatedAt: 100,
    }
    const missingTicket: TicketMeta = {
      ...cachedTicket,
      fileName: 'missing.pdf',
      id: 'ticket_missing',
      size: 8,
      title: '缺文件票据',
    }
    const referenceTicket: TicketMeta = {
      ...cachedTicket,
      fileName: 'reference.pdf',
      id: 'ticket_reference',
      referenceLocation: '邮箱',
      storageMode: 'reference',
      title: '位置票据',
    }

    await legacyDb.table<Trip, string>('trips').put(trip)
    await legacyDb.table<TicketMeta, string>('ticketMetas').bulkPut([cachedTicket, missingTicket, referenceTicket])
    await legacyDb.table<TicketBlob, string>('ticketBlobs').put({
      blob: new NodeBlob(['cached'], { type: 'application/pdf' }) as Blob,
      ticketId: cachedTicket.id,
    })
    legacyDb.close()

    await db.open()

    await expect(db.ticketBlobSyncStates.get(cachedTicket.id)).resolves.toMatchObject({
      cacheStatus: 'cached',
      ticketId: cachedTicket.id,
      uploadStatus: 'pending',
    })
    await expect(db.ticketBlobSyncStates.get(missingTicket.id)).resolves.toMatchObject({
      cacheStatus: 'missing',
      ticketId: missingTicket.id,
      uploadStatus: 'missing',
    })
    await expect(db.ticketBlobSyncStates.get(referenceTicket.id)).resolves.toBeUndefined()
  })
})
