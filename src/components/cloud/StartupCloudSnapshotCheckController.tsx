import { useEffect } from 'react'
import { listTrips } from '../../db'
import {
  completeTripAutoSnapshotSuccess,
  getTripAutoSnapshotStatus,
  isAutoSnapshotBackupEnabled,
  markTripAutoSnapshotSynced,
  subscribeAutoSnapshotBackup,
} from '../../lib/autoSnapshotBackup'
import {
  getCurrentSession,
  getSupabaseConfigStatus,
  listCloudBackups,
  restoreCloudBackup,
  uploadTripCloudBackup,
} from '../../lib/cloudBackup'
import {
  buildCloudSnapshotCheckResults,
  groupLatestCloudBackupsByTripId,
  refreshCloudSnapshotChecks,
  setCloudSnapshotCheckRefreshProvider,
  suppressCloudSnapshotPrompt,
} from '../../lib/cloudSnapshotCheck'
import { getSupabaseClient } from '../../lib/supabaseClient'

export function StartupCloudSnapshotCheckController() {
  useEffect(() => {
    setCloudSnapshotCheckRefreshProvider(async () => {
      if (!canAttemptStartupCloudCheck()) {
        return []
      }

      const session = await getCurrentSession().catch(() => null)
      if (!session) {
        return []
      }

      const [trips, backups] = await Promise.all([
        listTrips(),
        listCloudBackups(),
      ])
      const autoStatusByTripId = Object.fromEntries(
        trips.map((trip) => [trip.id, getTripAutoSnapshotStatus(trip.id)]),
      )

      const results = buildCloudSnapshotCheckResults({
        autoStatusByTripId,
        backups,
        trips,
      })
      const localTripIds = new Set(trips.map((trip) => trip.id))

      for (const result of results) {
        if (shouldUploadLocalVersion(result)) {
          const uploadResult = await uploadTripCloudBackup(result.tripId)
          const autoStatus = getTripAutoSnapshotStatus(result.tripId)
          const exportedAt = Date.parse(uploadResult.exportedAt)
          if (autoStatus?.dirtyAt) {
            completeTripAutoSnapshotSuccess(
              result.tripId,
              autoStatus.dirtyAt,
              Number.isFinite(exportedAt) ? exportedAt : Date.now(),
            )
          } else {
            markTripAutoSnapshotSynced(result.tripId, Number.isFinite(exportedAt) ? exportedAt : Date.now())
          }
        } else {
          const restoreResult = await restoreCloudBackup(result.backupId)
          const exportedAt = Date.parse(restoreResult.exportedAt)
          markTripAutoSnapshotSynced(result.tripId, Number.isFinite(exportedAt) ? exportedAt : Date.now())
        }
        suppressCloudSnapshotPrompt(result.signature)
      }

      const latestBackupByTripId = groupLatestCloudBackupsByTripId(backups)
      for (const [tripId, backup] of latestBackupByTripId) {
        if (localTripIds.has(tripId)) {
          continue
        }

        const restoreResult = await restoreCloudBackup(backup.id)
        const exportedAt = Date.parse(restoreResult.exportedAt)
        markTripAutoSnapshotSynced(
          restoreResult.tripId,
          Number.isFinite(exportedAt) ? exportedAt : Date.now(),
        )
      }

      return []
    })

    const requestRefresh = () => {
      void refreshCloudSnapshotChecks()
    }

    const autoSnapshotUnsubscribe = subscribeAutoSnapshotBackup((detail) => {
      if (detail.kind === 'status' || detail.kind === 'dirty' || detail.kind === 'clear') {
        requestRefresh()
      }
    })
    const client = getSupabaseClient()
    const authSubscription = client?.auth.onAuthStateChange(() => {
      requestRefresh()
    }).data.subscription

    window.addEventListener('online', requestRefresh)
    const initialTimer = window.setTimeout(requestRefresh, 0)

    return () => {
      window.clearTimeout(initialTimer)
      window.removeEventListener('online', requestRefresh)
      authSubscription?.unsubscribe()
      autoSnapshotUnsubscribe()
      setCloudSnapshotCheckRefreshProvider(null)
    }
  }, [])

  return null
}

function shouldUploadLocalVersion(result: {
  cloudVersion: number
  localVersion: number
  status: string
}) {
  return (
    result.status === 'local_newer' ||
    (result.status === 'possible_conflict' && result.localVersion >= result.cloudVersion)
  )
}

function canAttemptStartupCloudCheck() {
  if (!isAutoSnapshotBackupEnabled() || !getSupabaseConfigStatus().configured) {
    return false
  }

  if (typeof navigator !== 'undefined' && 'onLine' in navigator && !navigator.onLine) {
    return false
  }

  return true
}
