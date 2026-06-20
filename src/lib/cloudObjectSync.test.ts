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
  restoreTripObjectsFromCloud,
  restoreTicketBlobCacheFromCloud,
} from './cloudObjectSync'
import { enqueueObjectUpsert } from './objectSyncLocal'
import { clearTripIntelligenceHistory, loadTripIntelligenceLocalState, restoreTripIntelligenceSuggestionState } from './tripIntelligence/persistence'
import type { TripIntelligenceAppliedChangeRecord, TripIntelligenceSuggestionStateRecord } from '../types'

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

  it('uploads, restores, and deletes intelligence records through object sync', async () => {
    const trip = await createTrip({ destination: '日本东京', endDate: '2026-04-03', startDate: '2026-04-01', title: '东京智能记录' })
    const appliedChange = intelligenceAppliedChange(trip.id, 'change-1', 100)
    const suggestionState = intelligenceSuggestionState(trip.id, 'state-1', 100, 'completed')
    await db.tripIntelligenceAppliedChanges.put(appliedChange)
    await db.tripIntelligenceSuggestionStates.put(suggestionState)
    window.localStorage.setItem(fixtureKey, JSON.stringify({ user: { email: 'qa@example.com', id: 'user_1' } }))

    await uploadTripCloudBackup(trip.id)
    const uploadedFixture = JSON.parse(window.localStorage.getItem(fixtureKey) ?? '{}') as {
      objectRows?: Array<{ deleted_at_ms?: number | null; object_id: string; object_type: string }>
    }
    expect(uploadedFixture.objectRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ object_id: appliedChange.id, object_type: 'trip_intelligence_applied_change' }),
      expect.objectContaining({ object_id: suggestionState.id, object_type: 'trip_intelligence_suggestion_state' }),
    ]))

    await db.tripIntelligenceAppliedChanges.clear()
    await db.tripIntelligenceSuggestionStates.clear()
    await restoreTripObjectsFromCloud(trip.id)
    await expect(db.tripIntelligenceAppliedChanges.get(appliedChange.id)).resolves.toMatchObject({ dedupeKey: appliedChange.dedupeKey })
    await expect(db.tripIntelligenceSuggestionStates.get(suggestionState.id)).resolves.toMatchObject({ status: 'completed' })

    await clearTripIntelligenceHistory(trip.id)
    await restoreTripIntelligenceSuggestionState(trip.id, suggestionState.suggestionKey)
    await uploadTripCloudBackup(trip.id)
    const deletedFixture = JSON.parse(window.localStorage.getItem(fixtureKey) ?? '{}') as {
      objectRows?: Array<{ deleted_at_ms?: number | null; object_id: string }>
    }
    expect(deletedFixture.objectRows?.find((row) => row.object_id === appliedChange.id)?.deleted_at_ms).toEqual(expect.any(Number))
    expect(deletedFixture.objectRows?.find((row) => row.object_id === suggestionState.id)?.deleted_at_ms).toEqual(expect.any(Number))
  })

  it('uses latest updatedAt for suggestion states without creating conflicts', async () => {
    const trip = await createTrip({ destination: '日本东京', endDate: '2026-04-03', startDate: '2026-04-01', title: '东京建议状态' })
    const state = intelligenceSuggestionState(trip.id, 'state-latest', 100, 'completed')
    await db.tripIntelligenceSuggestionStates.put(state)
    window.localStorage.setItem(fixtureKey, JSON.stringify({ user: { email: 'qa@example.com', id: 'user_1' } }))
    await uploadTripCloudBackup(trip.id)

    const local = { ...state, status: 'completed' as const, updatedAt: 40_000 }
    await db.tripIntelligenceSuggestionStates.put(local)
    await enqueueObjectUpsert({ object: local, objectType: 'trip_intelligence_suggestion_state' })
    mutateFixtureObjectRow('trip_intelligence_suggestion_state', state.id, { status: 'ignored' }, 50_000)

    await uploadTripCloudBackup(trip.id)

    await expect(db.tripIntelligenceSuggestionStates.get(state.id)).resolves.toMatchObject({ status: 'ignored', updatedAt: 50_000 })
    await expect(listPendingObjectSyncConflicts(trip.id)).resolves.toHaveLength(0)
  })

  it('dedupes restored applied changes by dedupeKey for history display', async () => {
    const trip = await createTrip({ destination: '日本东京', endDate: '2026-04-03', startDate: '2026-04-01', title: '东京完成记录' })
    const first = intelligenceAppliedChange(trip.id, 'change-first', 100)
    await db.tripIntelligenceAppliedChanges.put(first)
    window.localStorage.setItem(fixtureKey, JSON.stringify({ user: { email: 'qa@example.com', id: 'user_1' } }))
    await uploadTripCloudBackup(trip.id)
    const fixture = JSON.parse(window.localStorage.getItem(fixtureKey) ?? '{}') as { objectRows?: Array<Record<string, unknown>> }
    const row = fixture.objectRows?.find((candidate) => candidate.object_id === first.id)
    if (!row) throw new Error('fixture intelligence row not found')
    fixture.objectRows?.push({
      ...row,
      object_id: 'change-second',
      payload: { ...(row.payload as Record<string, unknown>), id: 'change-second', occurredAt: 200, updatedAt: 200 },
      updated_at_ms: 200,
    })
    window.localStorage.setItem(fixtureKey, JSON.stringify(fixture))

    await restoreTripObjectsFromCloud(trip.id)
    const restored = await loadTripIntelligenceLocalState(trip.id, 300)

    expect(restored.localState.history).toHaveLength(1)
    expect(restored.localState.history[0].intelligenceAppliedChanges).toHaveLength(1)
    expect(restored.localState.history[0].intelligenceAppliedChanges?.[0].occurredAt).toBe(200)
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

function intelligenceAppliedChange(tripId: string, id: string, updatedAt: number): TripIntelligenceAppliedChangeRecord {
  return {
    actionType: 'generated_route',
    dedupeKey: `${tripId}:same-route-change`,
    detail: '已生成路线。',
    executionId: 'execution-route',
    executionSource: 'trip_operations',
    executionStatus: 'success',
    executionTitle: '路线已完成',
    id,
    occurredAt: updatedAt,
    privacyLevel: 'private',
    recommendationFingerprints: [],
    sourceId: 'trip-operations',
    sourceKind: 'operations',
    targetType: 'trip',
    title: '路线已完成',
    tripId,
    updatedAt,
  }
}

function intelligenceSuggestionState(
  tripId: string,
  id: string,
  updatedAt: number,
  status: TripIntelligenceSuggestionStateRecord['status'],
): TripIntelligenceSuggestionStateRecord {
  return {
    createdAt: updatedAt,
    id,
    sourceKind: 'operations',
    status,
    suggestionKey: 'operations:route',
    tripId,
    updatedAt,
  }
}
