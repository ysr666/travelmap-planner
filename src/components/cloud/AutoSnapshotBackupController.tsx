import { useEffect, useRef } from 'react'
import { getTrip, listTrips } from '../../db'
import {
  markTripAutoSnapshotSynced,
  type AutoSnapshotBackupEntry,
  completeTripAutoSnapshotFailure,
  completeTripAutoSnapshotSuccess,
  getTripAutoSnapshotStatus,
  hasPendingAutoSnapshotTrips,
  isAutoSnapshotBackupEnabled,
  listDirtyAutoSnapshotTrips,
  markTripAutoSnapshotDirty,
  setTripAutoSnapshotUploading,
  subscribeAutoSnapshotBackup,
  clearTripAutoSnapshotState,
} from '../../lib/autoSnapshotBackup'
import {
  getCurrentSession,
  getSupabaseConfigStatus,
  listCloudBackups,
  restoreCloudBackup,
  uploadTripCloudBackup,
} from '../../lib/cloudBackup'
import {
  compareCloudSnapshotVersions,
  groupLatestCloudBackupsByTripId,
  refreshCloudSnapshotChecks,
} from '../../lib/cloudSnapshotCheck'
import { getSupabaseClient } from '../../lib/supabaseClient'
import type { Trip } from '../../types'

const AUTO_BACKUP_DEBOUNCE_MS = 10_000
const AUTO_BACKUP_RETRY_MS = 30_000

export function AutoSnapshotBackupController() {
  const timersRef = useRef(new Map<string, number>())
  const inFlightRef = useRef(new Set<string>())

  useEffect(() => {
    const scheduleTrip = (tripId: string, delay = AUTO_BACKUP_DEBOUNCE_MS) => {
      const existingTimer = timersRef.current.get(tripId)
      if (existingTimer) {
        window.clearTimeout(existingTimer)
      }

      const timer = window.setTimeout(() => {
        timersRef.current.delete(tripId)
        void runAutoBackup(tripId, scheduleTrip, inFlightRef.current)
      }, delay)
      timersRef.current.set(tripId, timer)
    }

    const cancelTrip = (tripId: string) => {
      const existingTimer = timersRef.current.get(tripId)
      if (existingTimer) {
        window.clearTimeout(existingTimer)
        timersRef.current.delete(tripId)
      }
    }

    const scheduleDirtyTrips = (delay = AUTO_BACKUP_DEBOUNCE_MS) => {
      if (!isAutoSnapshotBackupEnabled()) {
        return
      }

      for (const entry of listDirtyAutoSnapshotTrips()) {
        if (entry?.tripId) {
          scheduleTrip(entry.tripId, delay)
        }
      }
    }

    const scanAndScheduleEligibleTrips = () => {
      scheduleDirtyTrips(0)
      void markEligibleTripsDirtyAndSchedule(scheduleTrip)
    }

    const cancelAll = () => {
      for (const timer of timersRef.current.values()) {
        window.clearTimeout(timer)
      }
      timersRef.current.clear()
    }

    const unsubscribe = subscribeAutoSnapshotBackup((detail) => {
      if (detail.kind === 'clear' && detail.tripId) {
        cancelTrip(detail.tripId)
        return
      }

      if (detail.kind === 'settings') {
        if (isAutoSnapshotBackupEnabled()) {
          scanAndScheduleEligibleTrips()
        } else {
          cancelAll()
        }
        return
      }

      if (detail.kind === 'dirty' && detail.tripId) {
        if (isAutoSnapshotBackupEnabled()) {
          scheduleTrip(detail.tripId)
        }
      }
    })

    const flushPending = () => {
      if (!isAutoSnapshotBackupEnabled()) {
        return
      }
      cancelAll()
      for (const entry of listDirtyAutoSnapshotTrips()) {
        if (entry?.tripId) {
          void runAutoBackup(entry.tripId, scheduleTrip, inFlightRef.current)
        }
      }
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasPendingAutoSnapshotTrips() && timersRef.current.size === 0 && inFlightRef.current.size === 0) {
        return
      }
      flushPending()
      event.preventDefault()
      event.returnValue = ''
    }

    const handlePageHide = () => flushPending()
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushPending()
      }
    }

    const handleOnline = () => scanAndScheduleEligibleTrips()
    window.addEventListener('online', handleOnline)
    window.addEventListener('beforeunload', handleBeforeUnload)
    window.addEventListener('pagehide', handlePageHide)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    const client = getSupabaseClient()
    const authSubscription = client?.auth.onAuthStateChange(() => {
      scanAndScheduleEligibleTrips()
    }).data.subscription

    const initialTimer = window.setTimeout(scanAndScheduleEligibleTrips, 0)

    return () => {
      window.clearTimeout(initialTimer)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      window.removeEventListener('pagehide', handlePageHide)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      authSubscription?.unsubscribe()
      unsubscribe()
      cancelAll()
    }
  }, [])

  return null
}

async function runAutoBackup(
  tripId: string,
  scheduleTrip: (tripId: string, delay?: number) => void,
  inFlight: Set<string>,
) {
  if (inFlight.has(tripId) || !canAttemptAutoBackup()) {
    return
  }

  const entry = getTripAutoSnapshotStatus(tripId)
  const dirtyAt = entry?.dirtyAt
  if (!dirtyAt) {
    return
  }

  const trip = await getTrip(tripId)
  if (!trip) {
    clearTripAutoSnapshotState(tripId)
    return
  }

  const session = await getCurrentSession().catch(() => null)
  if (!session) {
    return
  }

  inFlight.add(tripId)
  try {
    const preflight = await checkAutoSyncDirection(trip, entry)
    if (preflight.action === 'restore') {
      setTripAutoSnapshotUploading(tripId, dirtyAt)
      const result = await restoreCloudBackup(preflight.backupId)
      const exportedAt = Date.parse(result.exportedAt)
      markTripAutoSnapshotSynced(
        result.tripId,
        Number.isFinite(exportedAt) ? exportedAt : Date.now(),
      )
      await refreshCloudSnapshotChecks()
      return
    }

    setTripAutoSnapshotUploading(tripId, dirtyAt)
    const result = await uploadTripCloudBackup(tripId)
    const exportedAt = Date.parse(result.exportedAt)
    const cleared = completeTripAutoSnapshotSuccess(
      tripId,
      dirtyAt,
      Number.isFinite(exportedAt) ? exportedAt : Date.now(),
    )
    if (!cleared) {
      scheduleTrip(tripId, 0)
    }
  } catch (caught) {
    completeTripAutoSnapshotFailure(
      tripId,
      dirtyAt,
      caught instanceof Error ? caught.message : '云端保存失败，可稍后重试。',
    )
    if (canAttemptAutoBackup()) {
      scheduleTrip(tripId, AUTO_BACKUP_RETRY_MS)
    }
  } finally {
    inFlight.delete(tripId)
    const latestEntry = getTripAutoSnapshotStatus(tripId)
    if (latestEntry?.dirtyAt && latestEntry.dirtyAt !== dirtyAt && canAttemptAutoBackup()) {
      scheduleTrip(tripId)
    }
  }
}

async function markEligibleTripsDirtyAndSchedule(scheduleTrip: (tripId: string, delay?: number) => void) {
  if (!canAttemptAutoBackup()) {
    return
  }

  const session = await getCurrentSession().catch(() => null)
  if (!session) {
    return
  }

  let syncInputs: [
    Awaited<ReturnType<typeof listTrips>>,
    Awaited<ReturnType<typeof listCloudBackups>>,
  ]
  try {
    syncInputs = await Promise.all([listTrips(), listCloudBackups()])
  } catch {
    return
  }
  const [trips, backups] = syncInputs
  const backupByTripId = groupLatestCloudBackupsByTripId(backups)

  for (const trip of trips) {
    const entry = getTripAutoSnapshotStatus(trip.id)
    if (entry?.dirtyAt) {
      scheduleTrip(trip.id)
      continue
    }

    const backup = backupByTripId.get(trip.id)
    if (!backup) {
      markTripAutoSnapshotDirty(trip.id, 'cloud-backup-missing', Date.now(), { cloudVersionAtDirty: null })
      scheduleTrip(trip.id, 0)
      continue
    }

    const comparison = compareCloudSnapshotVersions({
      autoStatus: entry,
      backup,
      trip,
    })
    if (comparison.status === 'local_newer') {
      markTripAutoSnapshotDirty(trip.id, 'local-newer-than-cloud', Date.now(), {
        cloudVersionAtDirty: comparison.cloudVersion,
      })
      scheduleTrip(trip.id, 0)
    }
  }
}

async function checkAutoSyncDirection(trip: Trip, entry: AutoSnapshotBackupEntry) {
  const backups = await listCloudBackups()
  const backup = groupLatestCloudBackupsByTripId(backups).get(trip.id)

  if (!backup) {
    return { action: 'upload' as const }
  }

  const comparison = compareCloudSnapshotVersions({
    autoStatus: entry,
    backup,
    trip,
  })

  if (comparison.status === 'cloud_newer') {
    return {
      action: 'restore' as const,
      backupId: backup.id,
    }
  }

  if (
    comparison.status === 'possible_conflict' &&
    comparison.cloudVersion !== null &&
    comparison.localVersion !== null &&
    comparison.cloudVersion > comparison.localVersion
  ) {
    return {
      action: 'restore' as const,
      backupId: backup.id,
    }
  }

  return { action: 'upload' as const }
}

function canAttemptAutoBackup() {
  if (!isAutoSnapshotBackupEnabled() || !getSupabaseConfigStatus().configured) {
    return false
  }

  if (typeof navigator !== 'undefined' && 'onLine' in navigator && !navigator.onLine) {
    return false
  }

  return true
}
