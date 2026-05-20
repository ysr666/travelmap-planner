import 'fake-indexeddb/auto'
import JSZip from 'jszip'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTrip, db } from '../db'
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
})
