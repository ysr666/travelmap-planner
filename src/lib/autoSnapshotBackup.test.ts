import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AUTO_SNAPSHOT_BACKUP_STATE_KEY,
  clearTripAutoSnapshotState,
  completeTripAutoSnapshotFailure,
  completeTripAutoSnapshotSuccess,
  getTripAutoSnapshotStatus,
  hasPendingAutoSnapshotTrips,
  isAutoSnapshotBackupEnabled,
  listAutoSnapshotBackupEntries,
  listDirtyAutoSnapshotTrips,
  markTripAutoSnapshotDirty,
  markTripAutoSnapshotSynced,
  requestTripAutoSnapshotRetry,
  resetAutoSnapshotBackupForTests,
  setAutoSnapshotBackupEnabled,
  setTripAutoSnapshotUploading,
} from './autoSnapshotBackup'

beforeEach(() => {
  resetAutoSnapshotBackupForTests()
  vi.unstubAllGlobals()
})

describe('auto snapshot backup local state', () => {
  it('defaults to enabled and can be disabled locally', () => {
    expect(isAutoSnapshotBackupEnabled()).toBe(true)
    setAutoSnapshotBackupEnabled(false)
    expect(isAutoSnapshotBackupEnabled()).toBe(false)
    setAutoSnapshotBackupEnabled(true)
    expect(isAutoSnapshotBackupEnabled()).toBe(true)
  })

  it('marks trips dirty and lists pending dirty entries', () => {
    markTripAutoSnapshotDirty('trip_1', 'item-updated', 100)
    const status = getTripAutoSnapshotStatus('trip_1')

    expect(status).toMatchObject({
      dirtyAt: 100,
      reason: 'item-updated',
      status: 'dirty',
      tripId: 'trip_1',
    })
    expect(listDirtyAutoSnapshotTrips()).toHaveLength(1)
  })

  it('clears success only when dirtyAt is unchanged', () => {
    markTripAutoSnapshotDirty('trip_1', 'first', 100)
    setTripAutoSnapshotUploading('trip_1', 100, 120)
    markTripAutoSnapshotDirty('trip_1', 'second', 150)

    expect(completeTripAutoSnapshotSuccess('trip_1', 100, 200)).toBe(false)
    expect(getTripAutoSnapshotStatus('trip_1')).toMatchObject({
      dirtyAt: 150,
      status: 'dirty',
    })

    expect(completeTripAutoSnapshotSuccess('trip_1', 150, 220)).toBe(true)
    const syncedStatus = getTripAutoSnapshotStatus('trip_1')
    expect(syncedStatus?.dirtyAt).toBeUndefined()
    expect(syncedStatus).toMatchObject({
      lastSuccessAt: 220,
      status: 'synced',
    })
  })

  it('keeps dirty state when upload fails', () => {
    markTripAutoSnapshotDirty('trip_1', 'ticket-updated', 100)
    completeTripAutoSnapshotFailure('trip_1', 100, '上传失败', 130)

    expect(hasPendingAutoSnapshotTrips()).toBe(true)
    expect(getTripAutoSnapshotStatus('trip_1')).toMatchObject({
      dirtyAt: 100,
      lastAttemptAt: 130,
      lastError: '上传失败',
      status: 'error',
    })
  })

  it('stores the cloud baseline for queued uploads and can request a retry', () => {
    markTripAutoSnapshotDirty('trip_1', 'local-newer-than-cloud', 100, { cloudVersionAtDirty: 90 })
    completeTripAutoSnapshotFailure('trip_1', 100, '上传失败', 130)

    expect(listAutoSnapshotBackupEntries()).toEqual([
      expect.objectContaining({
        cloudVersionAtDirty: 90,
        dirtyAt: 100,
        lastError: '上传失败',
        status: 'error',
        tripId: 'trip_1',
      }),
    ])
    expect(requestTripAutoSnapshotRetry('trip_1')).toBe(true)
    const retryStatus = getTripAutoSnapshotStatus('trip_1')
    expect(retryStatus?.lastError).toBeUndefined()
    expect(retryStatus).toMatchObject({
      cloudVersionAtDirty: 90,
      dirtyAt: 100,
      status: 'dirty',
    })
  })

  it('can mark a trip synced without an active dirty entry', () => {
    markTripAutoSnapshotSynced('trip_1', 200)

    expect(hasPendingAutoSnapshotTrips()).toBe(false)
    expect(getTripAutoSnapshotStatus('trip_1')).toMatchObject({
      lastSuccessAt: 200,
      status: 'synced',
      tripId: 'trip_1',
    })
  })

  it('removes trip state when a local trip is deleted', () => {
    markTripAutoSnapshotDirty('trip_1', 'trip-updated', 100)
    clearTripAutoSnapshotState('trip_1')
    expect(getTripAutoSnapshotStatus('trip_1')).toBeNull()
    expect(listDirtyAutoSnapshotTrips()).toHaveLength(0)
  })

  it('resets corrupt localStorage state safely', () => {
    const storage = new Map<string, string>([[AUTO_SNAPSHOT_BACKUP_STATE_KEY, '{not json']])
    const eventTarget = new EventTarget()
    vi.stubGlobal('window', {
      addEventListener: eventTarget.addEventListener.bind(eventTarget),
      dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        removeItem: (key: string) => storage.delete(key),
        setItem: (key: string, value: string) => {
          storage.set(key, value)
        },
      },
      removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
    })

    expect(getTripAutoSnapshotStatus('trip_1')).toBeNull()
    expect(JSON.parse(storage.get(AUTO_SNAPSHOT_BACKUP_STATE_KEY) ?? '{}')).toEqual({
      trips: {},
      version: 1,
    })
  })
})
