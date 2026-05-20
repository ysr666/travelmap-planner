import { describe, expect, it } from 'vitest'
import {
  getCloudBackupDisplayGroupKey,
  groupCloudBackupsForDisplay,
} from './cloudBackupDisplay'
import type { CloudBackupSummary } from './cloudBackup'

describe('cloud backup snapshot display grouping', () => {
  it('groups snapshots by originalTripId and sorts newest first', () => {
    const groups = groupCloudBackupsForDisplay([
      createBackup({ exportedAt: '2026-04-02T10:00:00.000Z', id: 'older' }),
      createBackup({ exportedAt: '2026-04-03T10:00:00.000Z', id: 'newer' }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].title).toBe('东京春日旅行')
    expect(groups[0].backups.map((backup) => backup.id)).toEqual(['newer', 'older'])
  })

  it('falls back to legacy tripId without forcing incomplete backups into a misleading group', () => {
    const legacy = createBackup({ originalTripId: undefined, tripId: 'legacy_trip' })
    const incomplete = createBackup({ id: 'incomplete', originalTripId: undefined, tripId: undefined })
    const groups = groupCloudBackupsForDisplay([legacy, incomplete])

    expect(getCloudBackupDisplayGroupKey(legacy)).toBe('legacy_trip')
    expect(getCloudBackupDisplayGroupKey(incomplete)).toBeNull()
    expect(groups.map((group) => group.groupKey).sort()).toEqual(['backup:incomplete', 'legacy_trip'])
  })
})

function createBackup(
  patch: Partial<CloudBackupSummary> & { tripId?: string } = {},
): CloudBackupSummary & { tripId?: string } {
  return {
    appVersion: '0.3.0.2',
    createdAt: '2026-04-02T09:00:00.000Z',
    destination: '东京',
    exportedAt: '2026-04-02T09:00:00.000Z',
    filesCount: 0,
    id: 'backup_1',
    originalTripId: 'trip_1',
    schemaVersion: 1,
    snapshotPath: 'user_1/backup_1/snapshot.json',
    title: '东京春日旅行',
    totalSizeBytes: 0,
    updatedAt: '2026-04-02T09:00:00.000Z',
    userId: 'user_1',
    warnings: [],
    ...patch,
  }
}
