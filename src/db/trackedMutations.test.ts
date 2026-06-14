import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './database'
import {
  createDay,
  createItineraryItem,
  createLedgerBudget,
  createLedgerExpense,
  createLedgerParticipant,
  createLedgerSettings,
  createTicketMeta,
  createTrip,
  deleteTripCascade,
  getTicketMeta,
  importTripPlanRecords,
  saveTicketBlob,
  setItineraryItemExecutionState,
  updateItineraryItem,
} from './index'
import {
  getTripAutoSnapshotStatus,
  resetAutoSnapshotBackupForTests,
} from '../lib/autoSnapshotBackup'
import type { Day, ItineraryItem, TicketMeta, Trip } from '../types'

beforeEach(async () => {
  resetAutoSnapshotBackupForTests()
  await db.delete()
  await db.open()
})

describe('tracked db mutations', () => {
  it('marks trips dirty after local trip, day and item mutations', async () => {
    const trip = await createTrip({
      destination: '日本东京',
      endDate: '2026-04-03',
      startDate: '2026-04-01',
      title: '东京',
    })
    expect(getTripAutoSnapshotStatus(trip.id)).toMatchObject({ status: 'dirty' })

    const day = await createDay({
      date: '2026-04-01',
      sortOrder: 1,
      title: '第一天',
      tripId: trip.id,
    })
    expect(getTripAutoSnapshotStatus(trip.id)?.reason).toBe('day-created')

    const item = await createItineraryItem({
      dayId: day.id,
      sortOrder: 1,
      ticketIds: [],
      title: '涩谷',
      tripId: trip.id,
    })
    await updateItineraryItem(item.id, { title: '涩谷 Sky' })
    expect(getTripAutoSnapshotStatus(trip.id)?.reason).toBe('item-updated')
  })

  it('marks ticket blob changes dirty through ticket metadata lookup', async () => {
    const trip = await createTrip({
      destination: '日本东京',
      endDate: '2026-04-03',
      startDate: '2026-04-01',
      title: '东京',
    })
    const ticket = await createTicketMeta({
      fileName: 'order.pdf',
      fileType: 'pdf',
      mimeType: 'application/pdf',
      size: 3,
      storageMode: 'copy',
      title: '订单',
      tripId: trip.id,
    })

    await saveTicketBlob(ticket.id, new Blob(['pdf'], { type: 'application/pdf' }))
    expect(await getTicketMeta(ticket.id)).toBeTruthy()
    expect(getTripAutoSnapshotStatus(trip.id)?.reason).toBe('ticket-blob-saved')
    await expect(db.syncOutbox.toArray()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'trip' }),
      expect.objectContaining({ objectType: 'ticket_meta' }),
    ]))
    await expect(db.ticketBlobSyncStates.get(ticket.id)).resolves.toMatchObject({
      cacheStatus: 'cached',
      ticketId: ticket.id,
      uploadStatus: 'pending',
    })
  })

  it('queues object upserts for trip, day and item writes', async () => {
    const trip = await createTrip({
      destination: '日本东京',
      endDate: '2026-04-03',
      startDate: '2026-04-01',
      title: '东京',
    })
    const day = await createDay({
      date: '2026-04-01',
      sortOrder: 1,
      title: '第一天',
      tripId: trip.id,
    })
    await createItineraryItem({
      dayId: day.id,
      sortOrder: 1,
      ticketIds: [],
      title: '涩谷',
      tripId: trip.id,
    })

    const outbox = await db.syncOutbox.toArray()
    expect(outbox.map((entry) => entry.objectType).sort()).toEqual(['day', 'item', 'trip'])
    expect(outbox.every((entry) => entry.status === 'pending')).toBe(true)
  })

  it('persists live execution state and queues an item upsert', async () => {
    const trip = await createTrip({ destination: '东京', endDate: '2026-06-13', startDate: '2026-06-13', title: '东京' })
    const day = await createDay({ date: '2026-06-13', sortOrder: 1, title: '第一天', tripId: trip.id })
    const item = await createItineraryItem({ dayId: day.id, sortOrder: 1, ticketIds: [], title: '浅草寺', tripId: trip.id })
    await db.syncOutbox.clear()

    const updated = await setItineraryItemExecutionState(item.id, 'completed', 123)

    expect(updated?.executionState).toEqual({ status: 'completed', updatedAt: 123 })
    const outbox = await db.syncOutbox.toArray()
    expect(outbox).toHaveLength(1)
    expect(outbox[0]).toMatchObject({ objectId: item.id, objectType: 'item', operation: 'upsert' })
    expect(outbox[0].payload).toMatchObject({ executionState: { status: 'completed', updatedAt: 123 } })
  })

  it('tracks every owner-only ledger object and cascades it with the trip', async () => {
    const trip = await createTrip({ destination: '东京', endDate: '2026-04-03', startDate: '2026-04-01', title: '东京账本' })
    await db.syncOutbox.clear()
    const settings = await createLedgerSettings({ homeCurrency: 'CNY', settlementCurrency: 'CNY', tripCurrency: 'JPY', tripId: trip.id })
    const participant = await createLedgerParticipant({ displayName: '我', isSelf: true, source: 'manual', tripId: trip.id })
    const budget = await createLedgerBudget({ amountMinor: 100000, currency: 'JPY', scope: 'trip', tripId: trip.id })
    const expense = await createLedgerExpense({ amountMinor: 1200, category: 'food', currency: 'JPY', date: '2026-04-01', payerParticipantId: participant.id, source: { kind: 'manual' }, splitMode: 'equal', splitShares: [{ participantId: participant.id, weight: 1 }], status: 'confirmed', title: '晚餐', tripId: trip.id })

    expect((await db.syncOutbox.toArray()).map((entry) => entry.objectType).sort()).toEqual([
      'ledger_budget',
      'ledger_expense',
      'ledger_participant',
      'ledger_settings',
    ])
    expect(settings.tripId).toBe(trip.id)
    expect(budget.tripId).toBe(trip.id)
    expect(expense.tripId).toBe(trip.id)

    await deleteTripCascade(trip.id)
    await expect(db.ledgerSettings.where('tripId').equals(trip.id).count()).resolves.toBe(0)
    await expect(db.ledgerParticipants.where('tripId').equals(trip.id).count()).resolves.toBe(0)
    await expect(db.ledgerBudgets.where('tripId').equals(trip.id).count()).resolves.toBe(0)
    await expect(db.ledgerExpenses.where('tripId').equals(trip.id).count()).resolves.toBe(0)
  })

  it('clears live execution state when restoring an item', async () => {
    const trip = await createTrip({ destination: '东京', endDate: '2026-06-13', startDate: '2026-06-13', title: '东京' })
    const day = await createDay({ date: '2026-06-13', sortOrder: 1, title: '第一天', tripId: trip.id })
    const item = await createItineraryItem({ dayId: day.id, executionState: { status: 'skipped', updatedAt: 100 }, sortOrder: 1, ticketIds: [], title: '浅草寺', tripId: trip.id })

    const restored = await setItineraryItemExecutionState(item.id, null, 200)
    expect(restored?.executionState).toBeUndefined()
  })

  it('clears local auto backup state when a local trip is deleted', async () => {
    const trip = await createTrip({
      destination: '日本东京',
      endDate: '2026-04-03',
      startDate: '2026-04-01',
      title: '东京',
    })

    await deleteTripCascade(trip.id)
    expect(getTripAutoSnapshotStatus(trip.id)).toBeNull()
  })

  it('marks imports dirty only when requested', async () => {
    const records = buildImportRecords('trip_imported')
    const result = await importTripPlanRecords(records)
    expect(getTripAutoSnapshotStatus(result.tripId)).toMatchObject({ status: 'dirty' })

    const cloudRecords = buildImportRecords('trip_cloud_restore')
    cloudRecords.trip.restoredAt = Date.parse('2026-04-02T00:00:00.000Z')
    cloudRecords.trip.restoredFromCloudBackupId = 'backup_1'
    cloudRecords.trip.restoredFromCloudExportedAt = '2026-04-01T00:00:00.000Z'
    cloudRecords.trip.restoredFromCloudOriginalTripId = 'trip_original'
    const cloudResult = await importTripPlanRecords(cloudRecords, { markDirty: false })
    expect(getTripAutoSnapshotStatus(cloudResult.tripId)).toBeNull()
  })
})

function buildImportRecords(tripId: string): {
  trip: Trip
  days: Day[]
  itineraryItems: ItineraryItem[]
  ticketMetas: TicketMeta[]
  ticketBlobs: []
} {
  const now = Date.now()
  const dayId = `${tripId}_day`
  return {
    days: [
      {
        date: '2026-04-01',
        id: dayId,
        sortOrder: 1,
        title: '第一天',
        tripId,
      },
    ],
    itineraryItems: [
      {
        createdAt: now,
        dayId,
        id: `${tripId}_item`,
        sortOrder: 1,
        ticketIds: [],
        title: '涩谷',
        tripId,
        updatedAt: now,
      },
    ],
    ticketBlobs: [],
    ticketMetas: [],
    trip: {
      createdAt: now,
      destination: '日本东京',
      endDate: '2026-04-03',
      id: tripId,
      startDate: '2026-04-01',
      title: '导入旅行',
      updatedAt: now,
    },
  }
}
