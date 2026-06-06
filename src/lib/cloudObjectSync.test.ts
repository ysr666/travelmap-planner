// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { Blob as NodeBlob } from 'node:buffer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createTicketMeta,
  createTrip,
  getTicketBlob,
  saveTicketBlob,
} from '../db'
import { db } from '../db/database'
import { resetAutoSnapshotBackupForTests } from './autoSnapshotBackup'
import { uploadTripCloudBackup } from './cloudBackup'
import {
  clearSyncedTicketBlobCache,
  getTicketBlobCacheSummary,
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
