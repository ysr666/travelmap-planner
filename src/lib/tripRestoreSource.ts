import { formatVersionTimestamp } from './cloudSnapshotCheck'
import type { Trip } from '../types'

export type RestoredTripSource = {
  backupId: string
  exportedAt: string
  originalTripId: string
  restoredAt: number
}

export function getRestoredTripSource(trip: Trip): RestoredTripSource | null {
  if (
    !trip.restoredFromCloudBackupId ||
    !trip.restoredFromCloudOriginalTripId ||
    !trip.restoredFromCloudExportedAt ||
    typeof trip.restoredAt !== 'number'
  ) {
    return null
  }

  return {
    backupId: trip.restoredFromCloudBackupId,
    exportedAt: trip.restoredFromCloudExportedAt,
    originalTripId: trip.restoredFromCloudOriginalTripId,
    restoredAt: trip.restoredAt,
  }
}

export function buildRestoredTripSourceLabel(
  trip: Trip,
  variant: 'compact' | 'full' = 'compact',
) {
  const source = getRestoredTripSource(trip)
  if (!source) {
    return null
  }

  const restoredAt = formatVersionTimestamp(source.restoredAt)
  const exportedAt = formatVersionTimestamp(Date.parse(source.exportedAt))

  if (variant === 'compact') {
    if (restoredAt) {
      return `由云端快照恢复 · 恢复于 ${restoredAt}`
    }
    if (exportedAt) {
      return `由云端快照恢复 · 来自 ${exportedAt}`
    }
    return '由云端快照恢复'
  }

  const parts = ['由云端快照恢复']
  if (restoredAt) {
    parts.push(`恢复于 ${restoredAt}`)
  }
  if (exportedAt) {
    parts.push(`来自 ${exportedAt} 的云端快照`)
  }

  return parts.join(' · ')
}
