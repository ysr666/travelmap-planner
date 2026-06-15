import 'fake-indexeddb/auto'
import { Blob as NodeBlob } from 'node:buffer'
import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './database'
import type { Day, ItineraryItem, LedgerExpense, TicketBlob, TicketMeta, Trip } from '../types'

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
  it('upgrades v7 ledger expenses to canonical v8 bill defaults', async () => {
    const legacyDb = new Dexie('TravelConsoleDB')
    legacyDb.version(7).stores({
      ledgerExpenses: 'id, tripId, status, date, category, [tripId+date], [tripId+status], updatedAt',
      trips: 'id, updatedAt',
    })
    await legacyDb.open()
    const trip: Trip = { createdAt: 1, destination: '东京', endDate: '2026-06-02', id: 'trip-v7', startDate: '2026-06-01', title: '东京', updatedAt: 1 }
    const expense: LedgerExpense = {
      amountMinor: 10000,
      category: 'lodging',
      createdAt: 1,
      currency: 'CNY',
      date: '2026-06-01',
      id: 'expense-v7',
      source: { kind: 'ticket', sourceId: 'ticket-v7' },
      splitMode: 'equal',
      splitShares: [],
      status: 'confirmed',
      title: '旧酒店费用',
      tripId: trip.id,
      updatedAt: 1,
    }
    await legacyDb.table<Trip, string>('trips').put(trip)
    await legacyDb.table<LedgerExpense, string>('ledgerExpenses').put(expense)
    legacyDb.close()

    await db.open()
    await expect(db.ledgerExpenses.get(expense.id)).resolves.toMatchObject({
      itemIds: [],
      lineItems: [],
      orderStatus: 'active',
      paymentStatus: 'paid',
      reviewStatus: 'reviewed',
      sourceLinks: [expect.objectContaining({ role: 'other', sourceId: 'ticket-v7' })],
    })
  })

  it('creates ticket blob sync states and object bases for legacy data', async () => {
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
    const day: Day = {
      date: '2026-04-01',
      id: 'day_legacy',
      sortOrder: 1,
      title: '第一天',
      tripId: trip.id,
    }
    const item: ItineraryItem = {
      createdAt: 100,
      dayId: day.id,
      id: 'item_legacy',
      ticketIds: [],
      sortOrder: 1,
      title: '涩谷',
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
    await legacyDb.table<Day, string>('days').put(day)
    await legacyDb.table<ItineraryItem, string>('itineraryItems').put(item)
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
    await expect(db.objectSyncBases.get(`trip:${trip.id}`)).resolves.toMatchObject({
      objectId: trip.id,
      objectType: 'trip',
      payload: trip,
      tripId: trip.id,
    })
    await expect(db.objectSyncBases.get(`day:${day.id}`)).resolves.toMatchObject({
      objectId: day.id,
      objectType: 'day',
      tripId: trip.id,
    })
    await expect(db.objectSyncBases.get(`item:${item.id}`)).resolves.toMatchObject({
      objectId: item.id,
      objectType: 'item',
      tripId: trip.id,
    })
    await expect(db.objectSyncBases.get(`ticket_meta:${cachedTicket.id}`)).resolves.toMatchObject({
      objectId: cachedTicket.id,
      objectType: 'ticket_meta',
      tripId: trip.id,
    })
    await expect(db.travelInboxEntries.toArray()).resolves.toEqual([])
    await expect(db.travelInboxBlobs.toArray()).resolves.toEqual([])
    await expect(db.travelInboxPreviews.toArray()).resolves.toEqual([])
    expect(db.tables.map((table) => table.name)).toEqual(expect.arrayContaining([
      'ledgerSettings',
      'ledgerParticipants',
      'ledgerBudgets',
      'ledgerExpenses',
      'exchangeRateCache',
      'ledgerArchiveQueue',
    ]))
    await expect(db.ledgerExpenses.toArray()).resolves.toEqual([])
  })
})
