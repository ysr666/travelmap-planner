import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './database'
import {
  createDay,
  createItineraryItem,
  createLedgerBudget,
  createLedgerExpense,
  bulkReviewLedgerExpenses,
  createLedgerParticipant,
  createLedgerSettings,
  createTicketMeta,
  createTrip,
  deleteTripCascade,
  getTicketMeta,
  getItineraryItem,
  importTripPlanRecords,
  reorderDayItems,
  saveTicketBlob,
  setItineraryItemExecutionState,
  updateTicketMeta,
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

  it('queues ticket and item upserts after a metadata rebind', async () => {
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
    const first = await createItineraryItem({
      dayId: day.id,
      sortOrder: 1,
      ticketIds: [],
      title: '浅草寺',
      tripId: trip.id,
    })
    const second = await createItineraryItem({
      dayId: day.id,
      sortOrder: 2,
      ticketIds: [],
      title: '东京塔',
      tripId: trip.id,
    })
    const ticket = await createTicketMeta({
      fileName: 'order.pdf',
      fileType: 'pdf',
      itemId: first.id,
      mimeType: 'application/pdf',
      scope: 'item',
      size: 3,
      storageMode: 'reference',
      title: '旧订单',
      tripId: trip.id,
    })
    await updateItineraryItem(first.id, { ticketIds: [ticket.id] })
    await db.syncOutbox.clear()

    const result = await updateTicketMeta(ticket.id, {
      itemId: second.id,
      note: '改绑到东京塔',
      scope: 'item',
      ticketCategory: 'admission_ticket',
      title: '东京塔门票',
    })

    expect(result?.ticket).toMatchObject({
      id: ticket.id,
      itemId: second.id,
      note: '改绑到东京塔',
      title: '东京塔门票',
    })
    await expect(getItineraryItem(first.id)).resolves.toMatchObject({ ticketIds: [] })
    await expect(getItineraryItem(second.id)).resolves.toMatchObject({ ticketIds: [ticket.id] })
    expect(getTripAutoSnapshotStatus(trip.id)?.reason).toBe('ticket-updated')
    const outbox = await db.syncOutbox.toArray()
    expect(outbox).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectId: ticket.id, objectType: 'ticket_meta', operation: 'upsert' }),
      expect.objectContaining({ objectId: first.id, objectType: 'item', operation: 'upsert' }),
      expect.objectContaining({ objectId: second.id, objectType: 'item', operation: 'upsert' }),
    ]))
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

  it('queues changed items after an atomic day reorder and records one trip write', async () => {
    const trip = await createTrip({ destination: '东京', endDate: '2026-06-13', startDate: '2026-06-13', title: '东京' })
    const day = await createDay({ date: '2026-06-13', sortOrder: 1, title: '第一天', tripId: trip.id })
    const first = await createItineraryItem({ dayId: day.id, sortOrder: 1, ticketIds: [], title: '浅草寺', tripId: trip.id })
    const second = await createItineraryItem({ dayId: day.id, sortOrder: 2, ticketIds: [], title: '东京塔', tripId: trip.id })
    const third = await createItineraryItem({ dayId: day.id, sortOrder: 3, ticketIds: [], title: '银座', tripId: trip.id })
    await db.syncOutbox.clear()

    const changed = await reorderDayItems(day.id, [third.id, first.id, second.id])

    expect(changed.map((item) => item.id).sort()).toEqual([first.id, second.id, third.id].sort())
    expect(getTripAutoSnapshotStatus(trip.id)?.reason).toBe('items-reordered')
    const outbox = await db.syncOutbox.toArray()
    expect(outbox).toHaveLength(3)
    expect(outbox.every((entry) => entry.objectType === 'item' && entry.operation === 'upsert')).toBe(true)
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

  it('bulk confirms eligible ledger expenses atomically and rejects stale records', async () => {
    const trip = await createTrip({ destination: '东京', endDate: '2026-04-03', startDate: '2026-04-01', title: '东京账本' })
    const participant = await createLedgerParticipant({ displayName: '我', isSelf: true, source: 'manual', tripId: trip.id })
    const first = await createLedgerExpense({
      amountMinor: 1200,
      category: 'food',
      currency: 'JPY',
      date: '2026-04-01',
      itemIds: [],
      paymentStatus: 'paid',
      reviewStatus: 'needs_review',
      source: { kind: 'inbox', sourceId: 'source-1' },
      sourceLinks: [{ available: true, id: 'inbox:source-1', kind: 'inbox', role: 'payment_receipt', sourceId: 'source-1' }],
      splitMode: 'equal',
      splitShares: [{ participantId: participant.id, weight: 1 }],
      status: 'draft',
      title: '晚餐',
      tripId: trip.id,
    })
    await db.syncOutbox.clear()

    const updated = await bulkReviewLedgerExpenses({ action: 'confirm', records: [{ expectedUpdatedAt: first.updatedAt, id: first.id }], tripId: trip.id })
    expect(updated[0]).toMatchObject({ reviewStatus: 'reviewed', status: 'confirmed' })
    await expect(db.syncOutbox.toArray()).resolves.toEqual([
      expect.objectContaining({ objectId: first.id, objectType: 'ledger_expense' }),
    ])

    await expect(bulkReviewLedgerExpenses({ action: 'mark_reviewed', records: [{ expectedUpdatedAt: first.updatedAt, id: first.id }], tripId: trip.id })).rejects.toThrow('已在其他位置更新')
    await expect(bulkReviewLedgerExpenses({ action: 'mark_reviewed', records: [{ expectedUpdatedAt: updated[0].updatedAt, id: first.id }, { expectedUpdatedAt: updated[0].updatedAt, id: first.id }], tripId: trip.id })).rejects.toThrow('重复账单')
    await expect(db.ledgerExpenses.get(first.id)).resolves.toMatchObject({ status: 'confirmed' })
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
