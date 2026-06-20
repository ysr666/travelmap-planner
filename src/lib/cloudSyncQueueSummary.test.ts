import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTicketMeta, createTrip, db } from '../db'
import { resetAutoSnapshotBackupForTests, markTripAutoSnapshotSynced } from './autoSnapshotBackup'
import {
  getCloudLoginOnboardingCopy,
  getCloudSyncQueueSummary,
  getObjectTypeSyncLabel,
} from './cloudSyncQueueSummary'
import { putTicketBlobSyncState } from './objectSyncLocal'

beforeEach(async () => {
  vi.stubGlobal('__APP_VERSION__', '0.3.0-test')
  resetAutoSnapshotBackupForTests()
  await db.delete()
  await db.open()
})

describe('cloud sync queue summary', () => {
  it('summarizes object outbox, ticket uploads and last sync time', async () => {
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
      size: 10,
      storageMode: 'copy',
      title: '订单',
      tripId: trip.id,
    })
    await putTicketBlobSyncState({
      cacheStatus: 'cached',
      fileName: ticket.fileName,
      mimeType: ticket.mimeType,
      size: ticket.size,
      ticketId: ticket.id,
      tripId: trip.id,
      updatedAt: 2000,
      uploadStatus: 'pending',
    })
    markTripAutoSnapshotSynced(trip.id, 1000)

    const summary = await getCloudSyncQueueSummary(trip.id)

    expect(summary.pendingObjectCount).toBeGreaterThanOrEqual(2)
    expect(summary.ticketPendingCount).toBe(1)
    expect(summary.syncItemCount).toBeGreaterThanOrEqual(3)
    expect(summary.lastSuccessAt).toBe(1000)
    expect(summary.tickets[0]).toMatchObject({
      label: '等待上传',
      title: '订单',
    })
  })

  it('builds login onboarding copy by local and account data direction', () => {
    expect(getCloudLoginOnboardingCopy({ accountTripCount: 0, localTripCount: 2 })).toMatchObject({
      title: '正在同步到账号',
    })
    expect(getCloudLoginOnboardingCopy({ accountTripCount: 3, localTripCount: 0 })).toMatchObject({
      title: '正在同步到此设备',
    })
    expect(getCloudLoginOnboardingCopy({ accountTripCount: 1, localTripCount: 1 })).toMatchObject({
      detail: expect.stringContaining('正在比对'),
      tone: 'warning',
    })
  })

  it('labels intelligence sync objects without exposing their contents', () => {
    expect(getObjectTypeSyncLabel('trip_intelligence_applied_change')).toBe('智能记录')
    expect(getObjectTypeSyncLabel('trip_intelligence_suggestion_state')).toBe('建议状态')
  })
})
