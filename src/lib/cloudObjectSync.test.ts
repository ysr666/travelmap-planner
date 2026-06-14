// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { Blob as NodeBlob } from 'node:buffer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createDay,
  createItineraryItem,
  createLedgerBudget,
  createLedgerExpense,
  createLedgerParticipant,
  createLedgerSettings,
  createTicketMeta,
  createTrip,
  getTicketBlob,
  getItineraryItem,
  getLedgerExpense,
  saveTicketBlob,
  updateItineraryItem,
  updateLedgerExpense,
} from '../db'
import { db } from '../db/database'
import { resetAutoSnapshotBackupForTests } from './autoSnapshotBackup'
import { uploadTripCloudBackup } from './cloudBackup'
import {
  clearSyncedTicketBlobCache,
  getTicketBlobCacheSummary,
  listPendingObjectSyncConflicts,
  resolveObjectSyncConflict,
  restoreTicketBlobCacheFromCloud,
} from './cloudObjectSync'

const fixtureKey = 'tripmap:e2e:cloud-fixture'

beforeEach(async () => {
  vi.stubGlobal('__APP_VERSION__', '0.3.0-test')
  resetAutoSnapshotBackupForTests()
  window.localStorage.clear()
  await db.delete()
  await db.open()
})

describe('cloud object sync ticket blob cache', () => {
  it('uploads object rows and ticket blob refs through the e2e fixture', async () => {
    const { ticket, trip } = await seedCopyTicket()
    window.localStorage.setItem(fixtureKey, JSON.stringify({ user: { email: 'qa@example.com', id: 'user_1' } }))

    await uploadTripCloudBackup(trip.id)

    const fixture = JSON.parse(window.localStorage.getItem(fixtureKey) ?? '{}') as {
      files?: Record<string, unknown>
      objectRows?: Array<{ object_id: string; object_type: string }>
      ticketBlobRows?: Array<{ storage_path: string; ticket_id: string }>
    }
    expect(fixture.objectRows?.some((row) => row.object_type === 'trip' && row.object_id === trip.id)).toBe(true)
    expect(fixture.objectRows?.some((row) => row.object_type === 'ticket_meta' && row.object_id === ticket.id)).toBe(true)
    expect(fixture.ticketBlobRows?.[0]).toMatchObject({ ticket_id: ticket.id })
    expect(fixture.files?.[fixture.ticketBlobRows![0].storage_path]).toBeTruthy()

    await expect(db.ticketBlobSyncStates.get(ticket.id)).resolves.toMatchObject({
      cacheStatus: 'cached',
      cloudStoragePath: fixture.ticketBlobRows![0].storage_path,
      uploadStatus: 'synced',
    })
  })

  it('clears only synced local caches and can redownload from the cloud ref', async () => {
    const { ticket, trip } = await seedCopyTicket()
    window.localStorage.setItem(fixtureKey, JSON.stringify({ user: { email: 'qa@example.com', id: 'user_1' } }))
    await uploadTripCloudBackup(trip.id)

    await clearSyncedTicketBlobCache(ticket.id)
    await expect(getTicketBlob(ticket.id)).resolves.toBeUndefined()
    await expect(getTicketBlobCacheSummary(trip.id)).resolves.toMatchObject({
      cachedCount: 0,
      clearableCount: 0,
      totalCopyTickets: 1,
    })

    await restoreTicketBlobCacheFromCloud(ticket.id)
    await expect(getTicketBlob(ticket.id)).resolves.toMatchObject({ ticketId: ticket.id })
    await expect(db.ticketBlobSyncStates.get(ticket.id)).resolves.toMatchObject({
      cacheStatus: 'cached',
      uploadStatus: 'synced',
    })
  })

  it('pulls before pushing and auto merges different item fields', async () => {
    const { item, trip } = await seedTripWithItem()
    window.localStorage.setItem(fixtureKey, JSON.stringify({ user: { email: 'qa@example.com', id: 'user_1' } }))
    await uploadTripCloudBackup(trip.id)

    await updateItineraryItem(item.id, { title: '此设备标题' })
    mutateFixtureItemRow(item.id, { startTime: '10:30' }, 50_000)

    await uploadTripCloudBackup(trip.id)

    await expect(getItineraryItem(item.id)).resolves.toMatchObject({
      startTime: '10:30',
      title: '此设备标题',
    })
    const fixture = JSON.parse(window.localStorage.getItem(fixtureKey) ?? '{}') as {
      objectRows?: Array<{ object_id: string; payload?: Record<string, unknown> }>
    }
    const remoteItem = fixture.objectRows?.find((row) => row.object_id === item.id)
    expect(remoteItem?.payload).toMatchObject({
      startTime: '10:30',
      title: '此设备标题',
    })
    await expect(listPendingObjectSyncConflicts(trip.id)).resolves.toHaveLength(0)
  })

  it('uploads and merges owner-only ledger objects through the cloud object fixture', async () => {
    const trip = await createTrip({ destination: '日本东京', endDate: '2026-04-03', startDate: '2026-04-01', title: '东京账本' })
    await createLedgerSettings({ homeCurrency: 'CNY', settlementCurrency: 'CNY', tripCurrency: 'JPY', tripId: trip.id })
    const participant = await createLedgerParticipant({ displayName: '我', isSelf: true, source: 'manual', tripId: trip.id })
    await createLedgerBudget({ amountMinor: 10000, currency: 'JPY', scope: 'trip', tripId: trip.id })
    const expense = await createLedgerExpense({ amountMinor: 1200, category: 'food', currency: 'JPY', date: '2026-04-01', payerParticipantId: participant.id, source: { kind: 'manual' }, splitMode: 'equal', splitShares: [{ participantId: participant.id, weight: 1 }], status: 'confirmed', title: '晚餐', tripId: trip.id })
    window.localStorage.setItem(fixtureKey, JSON.stringify({ user: { email: 'qa@example.com', id: 'user_1' } }))

    await uploadTripCloudBackup(trip.id)
    const firstFixture = JSON.parse(window.localStorage.getItem(fixtureKey) ?? '{}') as { objectRows?: Array<{ object_id: string; object_type: string }> }
    expect(firstFixture.objectRows?.map((row) => row.object_type)).toEqual(expect.arrayContaining(['ledger_settings', 'ledger_participant', 'ledger_budget', 'ledger_expense']))

    await updateLedgerExpense(expense.id, { title: '此设备晚餐' })
    mutateFixtureObjectRow('ledger_expense', expense.id, { category: 'other' }, 50_000)
    await uploadTripCloudBackup(trip.id)
    await expect(getLedgerExpense(expense.id)).resolves.toMatchObject({ category: 'other', title: '此设备晚餐' })
  })

  it('keeps same-field conflicts pending until the user resolves them', async () => {
    const { item, trip } = await seedTripWithItem()
    window.localStorage.setItem(fixtureKey, JSON.stringify({ user: { email: 'qa@example.com', id: 'user_1' } }))
    await uploadTripCloudBackup(trip.id)

    await updateItineraryItem(item.id, { title: '此设备标题' })
    mutateFixtureItemRow(item.id, { title: '账号标题' }, 50_000)

    await uploadTripCloudBackup(trip.id)

    await expect(getItineraryItem(item.id)).resolves.toMatchObject({ title: '此设备标题' })
    const conflicts = await listPendingObjectSyncConflicts(trip.id)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({
      objectId: item.id,
      fields: [expect.objectContaining({ fieldPath: 'title' })],
    })

    await resolveObjectSyncConflict(conflicts[0].id, {
      fieldResolutions: { title: 'remote' },
    })
    await expect(getItineraryItem(item.id)).resolves.toMatchObject({ title: '账号标题' })
    await expect(listPendingObjectSyncConflicts(trip.id)).resolves.toHaveLength(0)
  })
})

async function seedCopyTicket() {
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
  await saveTicketBlob(ticket.id, new NodeBlob(['pdf'], { type: 'application/pdf' }) as Blob)
  return { ticket, trip }
}

async function seedTripWithItem() {
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
  const item = await createItineraryItem({
    dayId: day.id,
    startTime: '09:00',
    ticketIds: [],
    sortOrder: 1,
    title: '涩谷散步',
    tripId: trip.id,
  })
  return { day, item, trip }
}

function mutateFixtureItemRow(itemId: string, patch: Record<string, unknown>, timestamp: number) {
  mutateFixtureObjectRow('item', itemId, patch, timestamp)
}

function mutateFixtureObjectRow(objectType: string, objectId: string, patch: Record<string, unknown>, timestamp: number) {
  const fixture = JSON.parse(window.localStorage.getItem(fixtureKey) ?? '{}') as {
    objectRows?: Array<{
      object_id: string
      object_type: string
      payload?: Record<string, unknown>
      updated_at_ms: number
    }>
  }
  const row = fixture.objectRows?.find((candidate) => candidate.object_type === objectType && candidate.object_id === objectId)
  if (!row || !row.payload) {
    throw new Error('fixture object row not found')
  }
  row.payload = {
    ...row.payload,
    ...patch,
    updatedAt: timestamp,
  }
  row.updated_at_ms = timestamp
  window.localStorage.setItem(fixtureKey, JSON.stringify(fixture))
}
