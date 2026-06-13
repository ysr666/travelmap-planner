import 'fake-indexeddb/auto'
import JSZip from 'jszip'
import { beforeEach, describe, expect, it } from 'vitest'
import { createDay, createItineraryItem, createTrip, db, setItineraryItemExecutionState } from '../db'
import { exportTripBackup } from './backup'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('zip backup serialization', () => {
  it('preserves optional restored-source trip metadata without changing the manifest schema', async () => {
    const trip = await createTrip({
      destination: '东京',
      endDate: '2026-04-04',
      restoredAt: Date.parse('2026-04-02T12:30:00.000Z'),
      restoredFromCloudBackupId: 'backup_1',
      restoredFromCloudExportedAt: '2026-04-02T10:00:00.000Z',
      restoredFromCloudOriginalTripId: 'trip_original',
      startDate: '2026-04-01',
      title: '东京春日旅行',
    })

    const backupBlob = await exportTripBackup(trip.id)
    const zip = await JSZip.loadAsync(await backupBlob.arrayBuffer())
    const exportedTrip = JSON.parse(await zip.file('data/trip.json')!.async('string')) as typeof trip
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as { schemaVersion: number }

    expect(manifest.schemaVersion).toBe(1)
    expect(exportedTrip.restoredAt).toBe(Date.parse('2026-04-02T12:30:00.000Z'))
    expect(exportedTrip.restoredFromCloudBackupId).toBe('backup_1')
    expect(exportedTrip.restoredFromCloudOriginalTripId).toBe('trip_original')
  })

  it('exports live execution state without changing the backup schema', async () => {
    const trip = await createTrip({ destination: '东京', endDate: '2026-04-01', startDate: '2026-04-01', title: '东京' })
    const day = await createDay({ date: '2026-04-01', sortOrder: 1, title: '第一天', tripId: trip.id })
    const item = await createItineraryItem({ dayId: day.id, sortOrder: 1, ticketIds: [], title: '浅草寺', tripId: trip.id })
    await setItineraryItemExecutionState(item.id, 'completed', 123)

    const zip = await JSZip.loadAsync(await (await exportTripBackup(trip.id)).arrayBuffer())
    const exportedItems = JSON.parse(await zip.file('data/itineraryItems.json')!.async('string')) as Array<{ executionState?: unknown }>
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as { schemaVersion: number }
    expect(manifest.schemaVersion).toBe(1)
    expect(exportedItems[0].executionState).toEqual({ status: 'completed', updatedAt: 123 })
  })
})
