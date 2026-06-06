import { markTripAutoSnapshotDirty } from './autoSnapshotBackup'
import { emitTravelDataChanged } from './dataEvents'

export type TripSyncQueueReason =
  | 'ai-trip-edit-applied'
  | 'existing-trip-imported'
  | 'smart-trip-workspace-applied'
  | 'trip-content-enrichment-applied'
  | 'trip-content-source-refresh-applied'
  | 'trip-daily-tip-saved'
  | string

export type RecordTripWriteForSyncOptions = {
  cloudVersionAtDirty?: number | null
  emitChangeEvent?: boolean
  now?: number
}

export const SYNC_QUEUE_SUCCESS_COPY = '已保存，登录后会自动同步。'

export function recordTripWriteForSync(
  tripId: string,
  reason: TripSyncQueueReason,
  options: RecordTripWriteForSyncOptions = {},
) {
  markTripAutoSnapshotDirty(tripId, reason, options.now ?? Date.now(), {
    cloudVersionAtDirty: options.cloudVersionAtDirty,
  })

  if (options.emitChangeEvent !== false) {
    emitTravelDataChanged()
  }
}
