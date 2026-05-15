import { useEffect, useRef } from 'react'
import { getTrip } from '../../db'
import {
  completeTripAutoSnapshotFailure,
  completeTripAutoSnapshotSuccess,
  getTripAutoSnapshotStatus,
  isAutoSnapshotBackupEnabled,
  listDirtyAutoSnapshotTrips,
  setTripAutoSnapshotUploading,
  subscribeAutoSnapshotBackup,
  clearTripAutoSnapshotState,
} from '../../lib/autoSnapshotBackup'
import { getCurrentSession, getSupabaseConfigStatus, uploadTripCloudBackup } from '../../lib/cloudBackup'
import { getSupabaseClient } from '../../lib/supabaseClient'

const AUTO_BACKUP_DEBOUNCE_MS = 10_000

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

    const scheduleAllDirty = () => {
      if (!isAutoSnapshotBackupEnabled()) {
        return
      }

      for (const entry of listDirtyAutoSnapshotTrips()) {
        if (entry?.tripId) {
          scheduleTrip(entry.tripId)
        }
      }
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
          scheduleAllDirty()
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

    const handleOnline = () => scheduleAllDirty()
    window.addEventListener('online', handleOnline)

    const client = getSupabaseClient()
    const authSubscription = client?.auth.onAuthStateChange(() => {
      scheduleAllDirty()
    }).data.subscription

    const initialTimer = window.setTimeout(scheduleAllDirty, 0)

    return () => {
      window.clearTimeout(initialTimer)
      window.removeEventListener('online', handleOnline)
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
  setTripAutoSnapshotUploading(tripId, dirtyAt)
  try {
    await uploadTripCloudBackup(tripId)
    const cleared = completeTripAutoSnapshotSuccess(tripId, dirtyAt)
    if (!cleared) {
      scheduleTrip(tripId, 0)
    }
  } catch (caught) {
    completeTripAutoSnapshotFailure(
      tripId,
      dirtyAt,
      caught instanceof Error ? caught.message : '云端备份失败，可稍后重试。',
    )
  } finally {
    inFlight.delete(tripId)
    const latestEntry = getTripAutoSnapshotStatus(tripId)
    if (latestEntry?.dirtyAt && latestEntry.dirtyAt !== dirtyAt && canAttemptAutoBackup()) {
      scheduleTrip(tripId)
    }
  }
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
