import { useEffect } from 'react'
import { listTrips } from '../../db'
import {
  getTripAutoSnapshotStatus,
  markTripAutoSnapshotSynced,
  subscribeAutoSnapshotBackup,
} from '../../lib/autoSnapshotBackup'
import {
  getCurrentSession,
  getSupabaseConfigStatus,
  listCloudBackups,
  restoreCloudBackup,
} from '../../lib/cloudBackup'
import {
  buildCloudSnapshotCheckResults,
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
      const remainingResults = []

      for (const result of results) {
        if (result.status !== 'cloud_newer') {
          remainingResults.push(result)
          continue
        }

        try {
          const restoreResult = await restoreCloudBackup(result.backupId)
          const exportedAt = Date.parse(restoreResult.exportedAt)
          markTripAutoSnapshotSynced(result.tripId, Number.isFinite(exportedAt) ? exportedAt : Date.now())
          suppressCloudSnapshotPrompt(result.signature)
        } catch {
          remainingResults.push(result)
        }
      }

      return remainingResults
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

function canAttemptStartupCloudCheck() {
  if (!getSupabaseConfigStatus().configured) {
    return false
  }

  if (typeof navigator !== 'undefined' && 'onLine' in navigator && !navigator.onLine) {
    return false
  }

  return true
}
