import { describe, expect, it } from 'vitest'
import { buildRestoredTripSourceLabel, getRestoredTripSource } from './tripRestoreSource'
import type { Trip } from '../types'

const restoredTrip: Trip = {
  createdAt: Date.parse('2026-04-02T12:00:00.000Z'),
  destination: '东京',
  endDate: '2026-04-04',
  id: 'trip_restored',
  restoredAt: Date.parse('2026-04-02T12:30:00.000Z'),
  restoredFromCloudBackupId: 'backup_1',
  restoredFromCloudExportedAt: '2026-04-02T10:00:00.000Z',
  restoredFromCloudOriginalTripId: 'trip_original',
  startDate: '2026-04-01',
  title: '东京春日旅行',
  updatedAt: Date.parse('2026-04-02T12:30:00.000Z'),
}

describe('restored trip source labels', () => {
  it('extracts complete restored-source metadata', () => {
    expect(getRestoredTripSource(restoredTrip)).toEqual({
      backupId: 'backup_1',
      exportedAt: '2026-04-02T10:00:00.000Z',
      originalTripId: 'trip_original',
      restoredAt: Date.parse('2026-04-02T12:30:00.000Z'),
    })
  })

  it('formats compact and full source labels without mutating the title', () => {
    expect(buildRestoredTripSourceLabel(restoredTrip, 'compact')).toBe(
      '由云端快照恢复 · 恢复于 2026-04-02 20:30',
    )
    expect(buildRestoredTripSourceLabel(restoredTrip, 'full')).toBe(
      '由云端快照恢复 · 恢复于 2026-04-02 20:30 · 来自 2026-04-02 18:00 的云端快照',
    )
    expect(restoredTrip.title).toBe('东京春日旅行')
  })

  it('returns null when metadata is incomplete', () => {
    expect(buildRestoredTripSourceLabel({ ...restoredTrip, restoredFromCloudBackupId: undefined })).toBeNull()
  })
})
