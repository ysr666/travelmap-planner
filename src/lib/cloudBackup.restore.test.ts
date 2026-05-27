import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  db,
  getDay,
  getItineraryItem,
  getTicketBlob,
  getTicketMeta,
  getTrip,
  listTrips,
  replaceTripPlanRecords,
} from '../db'
import {
  buildCloudRestoreRecords,
  buildCloudSnapshotFromRecords,
  verifyRestoredCloudRecords,
} from './cloudBackup'
import type { Day, ItineraryItem, TicketMeta, Trip } from '../types'

const tripId = 'trip_restore'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('cloud restore write verification', () => {
  it('replaces local V3 with cloud V2 in place and persists after reopening IndexedDB', async () => {
    await replaceTripPlanRecords(makeLocalV3Records(), { markDirty: false })
    const cloudRecords = makeCloudV2Records()
    const snapshot = buildCloudSnapshotFromRecords({
      appVersion: '0.3.0',
      backupId: 'backup_restore',
      days: cloudRecords.days,
      exportedAt: '2026-05-27T08:00:00.000Z',
      itineraryItems: cloudRecords.itineraryItems,
      ticketBlobs: cloudRecords.ticketBlobs,
      ticketMetas: cloudRecords.ticketMetas,
      trip: cloudRecords.trip,
      userId: 'user_restore',
    }).snapshot
    const restoreRecords = buildCloudRestoreRecords(snapshot, cloudRecords.ticketBlobs)

    await replaceTripPlanRecords(restoreRecords, { markDirty: false })
    await verifyRestoredCloudRecords(restoreRecords)
    db.close()
    await db.open()

    expect((await getTrip(tripId))?.title).toBe('Cloud V2')
    expect(await listTrips()).toHaveLength(1)
    expect(await getDay('day_local_v3')).toBeUndefined()
    expect(await getItineraryItem('item_local_v3')).toBeUndefined()
    expect(await getTicketMeta('ticket_local_v3')).toBeUndefined()
    expect(await getTicketBlob('ticket_local_v3')).toBeUndefined()
    expect(await getDay('day_cloud_v2')).toBeTruthy()
    expect(await getItineraryItem('item_cloud_v2')).toBeTruthy()
    expect((await getTicketBlob('ticket_cloud_v2'))?.blob.size).toBe(8)
  })

  it('throws a clear error when the restored local records do not match the cloud snapshot', async () => {
    const cloudRecords = makeCloudV2Records()
    await replaceTripPlanRecords(cloudRecords, { markDirty: false })
    await db.trips.update(tripId, { title: 'Local V3 after restore' })

    await expect(verifyRestoredCloudRecords(cloudRecords)).rejects.toThrow('云端版本写入本地后校验失败')
  })
})

function makeLocalV3Records() {
  const trip: Trip = {
    createdAt: 100,
    destination: 'Paris',
    endDate: '2026-06-02',
    id: tripId,
    startDate: '2026-06-01',
    title: 'Local V3',
    updatedAt: 300,
  }
  const days: Day[] = [
    { date: '2026-06-01', id: 'day_local_v3', sortOrder: 1, title: 'Local day', tripId },
  ]
  const itineraryItems: ItineraryItem[] = [
    {
      createdAt: 101,
      dayId: 'day_local_v3',
      id: 'item_local_v3',
      sortOrder: 1,
      ticketIds: ['ticket_local_v3'],
      title: 'Local item',
      tripId,
      updatedAt: 301,
    },
  ]
  const ticketMetas: TicketMeta[] = [
    {
      createdAt: 102,
      fileName: 'local.png',
      fileType: 'image',
      id: 'ticket_local_v3',
      itemId: 'item_local_v3',
      mimeType: 'image/png',
      size: 5,
      storageMode: 'copy',
      title: 'Local ticket',
      tripId,
      updatedAt: 302,
    },
  ]

  return {
    days,
    itineraryItems,
    ticketBlobs: [{ blob: new Blob(['local'], { type: 'image/png' }), ticketId: 'ticket_local_v3' }],
    ticketMetas,
    trip,
  }
}

function makeCloudV2Records() {
  const trip: Trip = {
    createdAt: 100,
    destination: 'Paris',
    endDate: '2026-06-02',
    id: tripId,
    startDate: '2026-06-01',
    title: 'Cloud V2',
    updatedAt: 200,
  }
  const days: Day[] = [
    { date: '2026-06-01', id: 'day_cloud_v2', sortOrder: 1, title: 'Cloud day', tripId },
  ]
  const itineraryItems: ItineraryItem[] = [
    {
      createdAt: 101,
      dayId: 'day_cloud_v2',
      id: 'item_cloud_v2',
      sortOrder: 1,
      ticketIds: ['ticket_cloud_v2'],
      title: 'Cloud item',
      tripId,
      updatedAt: 201,
    },
  ]
  const ticketMetas: TicketMeta[] = [
    {
      createdAt: 102,
      fileName: 'cloud.png',
      fileType: 'image',
      id: 'ticket_cloud_v2',
      itemId: 'item_cloud_v2',
      mimeType: 'image/png',
      size: 8,
      storageMode: 'copy',
      title: 'Cloud ticket',
      tripId,
      updatedAt: 202,
    },
  ]

  return {
    days,
    itineraryItems,
    ticketBlobs: [{ blob: new Blob(['cloud-v2'], { type: 'image/png' }), ticketId: 'ticket_cloud_v2' }],
    ticketMetas,
    trip,
  }
}
