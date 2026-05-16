import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildCloudSnapshotCheckResults,
  buildCloudSnapshotCheckSignature,
  compareCloudSnapshotVersions,
  dismissCloudSnapshotPrompt,
  getCloudSnapshotCheckState,
  groupLatestCloudBackupsByTripId,
  isCloudSnapshotPromptDismissed,
  resetCloudSnapshotChecksForTests,
  setCloudSnapshotCheckResults,
} from './cloudSnapshotCheck'
import type { AutoSnapshotBackupEntry } from './autoSnapshotBackup'
import type { CloudBackupSummary } from './cloudBackup'
import type { Trip } from '../types'

const baseTrip: Trip = {
  createdAt: Date.parse('2026-04-01T00:00:00.000Z'),
  destination: '东京',
  endDate: '2026-04-03',
  id: 'trip_1',
  notes: '',
  startDate: '2026-04-01',
  title: '东京春日旅行',
  updatedAt: Date.parse('2026-04-02T10:00:00.000Z'),
}

beforeEach(() => {
  vi.unstubAllGlobals()
  resetCloudSnapshotChecksForTests()
})

afterEach(() => {
  resetCloudSnapshotChecksForTests()
  vi.unstubAllGlobals()
})

describe('cloud snapshot version comparison', () => {
  it('detects local newer, cloud newer, and in-sync states', () => {
    expect(
      compareCloudSnapshotVersions({
        backup: createBackup({ exportedAt: '2026-04-02T09:00:00.000Z' }),
        trip: baseTrip,
      }).status,
    ).toBe('local_newer')

    expect(
      compareCloudSnapshotVersions({
        backup: createBackup({ exportedAt: '2026-04-02T11:00:00.000Z' }),
        trip: baseTrip,
      }).status,
    ).toBe('cloud_newer')

    expect(
      compareCloudSnapshotVersions({
        backup: createBackup({ exportedAt: '2026-04-02T10:00:01.000Z' }),
        trip: baseTrip,
      }).status,
    ).toBe('in_sync')
  })

  it('uses dirtyAt as the local version when it is newer than trip.updatedAt', () => {
    const dirtyAt = Date.parse('2026-04-02T12:00:00.000Z')
    const comparison = compareCloudSnapshotVersions({
      autoStatus: createAutoStatus({ dirtyAt, lastSuccessAt: Date.parse('2026-04-02T10:30:00.000Z') }),
      backup: createBackup({ exportedAt: '2026-04-02T10:20:00.000Z' }),
      trip: baseTrip,
    })

    expect(comparison.status).toBe('local_newer')
    expect(comparison.localVersion).toBe(dirtyAt)
  })

  it('classifies dirty local state without lastSuccessAt as possible conflict', () => {
    expect(
      compareCloudSnapshotVersions({
        autoStatus: createAutoStatus({ dirtyAt: Date.parse('2026-04-02T12:00:00.000Z') }),
        backup: createBackup({ exportedAt: '2026-04-02T09:00:00.000Z' }),
        trip: baseTrip,
      }).status,
    ).toBe('possible_conflict')
  })

  it('classifies cloud changes after last success as possible conflict while dirty is present', () => {
    expect(
      compareCloudSnapshotVersions({
        autoStatus: createAutoStatus({
          dirtyAt: Date.parse('2026-04-02T12:00:00.000Z'),
          lastSuccessAt: Date.parse('2026-04-02T10:00:00.000Z'),
        }),
        backup: createBackup({ exportedAt: '2026-04-02T11:00:00.000Z' }),
        trip: baseTrip,
      }).status,
    ).toBe('possible_conflict')
  })

  it('returns unknown when cloud metadata or local timestamps are missing or invalid', () => {
    expect(compareCloudSnapshotVersions({ backup: null, trip: baseTrip }).status).toBe('unknown')
    expect(
      compareCloudSnapshotVersions({
        backup: createBackup({ createdAt: 'not-date', exportedAt: 'also-not-date' }),
        trip: baseTrip,
      }).status,
    ).toBe('unknown')
    expect(
      compareCloudSnapshotVersions({
        backup: createBackup({ exportedAt: '2026-04-02T10:00:00.000Z' }),
        trip: { ...baseTrip, updatedAt: 0 },
      }).status,
    ).toBe('unknown')
  })
})

describe('cloud snapshot backup grouping', () => {
  it('groups backups by originalTripId and selects the latest parsed exportedAt', () => {
    const older = createBackup({
      exportedAt: '2026-04-01T00:00:00.000Z',
      id: 'backup_older',
      originalTripId: 'trip_1',
    })
    const newer = createBackup({
      exportedAt: '2026-04-03T00:00:00.000Z',
      id: 'backup_newer',
      originalTripId: 'trip_1',
    })

    expect(groupLatestCloudBackupsByTripId([newer, older]).get('trip_1')?.id).toBe('backup_newer')
    expect(groupLatestCloudBackupsByTripId([older, newer]).get('trip_1')?.id).toBe('backup_newer')
  })

  it('falls back to createdAt when exportedAt is invalid', () => {
    const fallback = createBackup({
      createdAt: '2026-04-04T00:00:00.000Z',
      exportedAt: 'invalid',
      id: 'backup_created_at',
      originalTripId: 'trip_1',
    })
    const older = createBackup({
      createdAt: '2026-04-02T00:00:00.000Z',
      exportedAt: '2026-04-02T00:00:00.000Z',
      id: 'backup_exported_at',
      originalTripId: 'trip_1',
    })

    expect(groupLatestCloudBackupsByTripId([older, fallback]).get('trip_1')?.id).toBe('backup_created_at')
  })

  it('uses legacy tripId only when originalTripId is missing', () => {
    const legacy = createBackup({
      originalTripId: undefined,
      tripId: 'legacy_trip',
    })

    expect(groupLatestCloudBackupsByTripId([legacy]).get('legacy_trip')?.id).toBe(legacy.id)
  })

  it('ignores backups with no trip identity or valid timestamp', () => {
    const withoutTripId = createBackup({ originalTripId: undefined })
    const withoutValidTime = createBackup({ createdAt: 'bad', exportedAt: 'bad', originalTripId: 'trip_1' })

    expect(groupLatestCloudBackupsByTripId([withoutTripId, withoutValidTime]).size).toBe(0)
  })
})

describe('cloud snapshot prompt result building', () => {
  it('does not prompt when a local trip has no matching cloud backup', () => {
    expect(
      buildCloudSnapshotCheckResults({
        backups: [createBackup({ originalTripId: 'other_trip' })],
        trips: [baseTrip],
      }),
    ).toEqual([])
  })

  it('filters in-sync and unknown comparisons out of prompt results', () => {
    const results = buildCloudSnapshotCheckResults({
      backups: [
        createBackup({ exportedAt: '2026-04-02T10:00:01.000Z', id: 'backup_sync', originalTripId: 'trip_1' }),
        createBackup({ createdAt: 'bad', exportedAt: 'bad', id: 'backup_unknown', originalTripId: 'trip_2' }),
      ],
      trips: [baseTrip, { ...baseTrip, id: 'trip_2' }],
    })

    expect(results).toEqual([])
  })

  it('builds prompt signatures from version-sensitive values', () => {
    const [result] = buildCloudSnapshotCheckResults({
      backups: [createBackup({ exportedAt: '2026-04-03T00:00:00.000Z' })],
      trips: [baseTrip],
    })

    expect(result).toMatchObject({
      backupId: 'backup_1',
      status: 'cloud_newer',
      tripId: 'trip_1',
      tripTitle: '东京春日旅行',
    })
    expect(result.signature).toBe(
      buildCloudSnapshotCheckSignature({
        backupId: result.backupId,
        cloudVersion: result.cloudVersion,
        localVersion: result.localVersion,
        status: result.status,
        tripId: result.tripId,
      }),
    )
  })
})

describe('cloud snapshot prompt dismissal', () => {
  it('stores dismissed prompts in sessionStorage when available', () => {
    stubSessionStorage()
    const signature = buildCloudSnapshotCheckSignature({
      backupId: 'backup_1',
      cloudVersion: 200,
      localVersion: 100,
      status: 'cloud_newer',
      tripId: 'trip_1',
    })

    expect(isCloudSnapshotPromptDismissed(signature)).toBe(false)
    dismissCloudSnapshotPrompt(signature)
    expect(isCloudSnapshotPromptDismissed(signature)).toBe(true)
  })

  it('does not throw when sessionStorage is unavailable', () => {
    const eventTarget = new EventTarget()
    vi.stubGlobal('window', {
      addEventListener: eventTarget.addEventListener.bind(eventTarget),
      dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
      removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
      sessionStorage: {
        getItem: () => {
          throw new Error('blocked')
        },
        removeItem: () => {
          throw new Error('blocked')
        },
        setItem: () => {
          throw new Error('blocked')
        },
      },
    })

    expect(() => dismissCloudSnapshotPrompt('signature')).not.toThrow()
    expect(isCloudSnapshotPromptDismissed('signature')).toBe(false)
  })

  it('re-prompts when the version-sensitive signature changes', () => {
    stubSessionStorage()
    const first = buildCloudSnapshotCheckSignature({
      backupId: 'backup_1',
      cloudVersion: 200,
      localVersion: 100,
      status: 'cloud_newer',
      tripId: 'trip_1',
    })
    const second = buildCloudSnapshotCheckSignature({
      backupId: 'backup_2',
      cloudVersion: 300,
      localVersion: 100,
      status: 'cloud_newer',
      tripId: 'trip_1',
    })

    dismissCloudSnapshotPrompt(first)
    expect(isCloudSnapshotPromptDismissed(first)).toBe(true)
    expect(isCloudSnapshotPromptDismissed(second)).toBe(false)
  })

  it('filters dismissed results when replacing the global prompt state', () => {
    stubSessionStorage()
    const [result] = buildCloudSnapshotCheckResults({
      backups: [createBackup({ exportedAt: '2026-04-03T00:00:00.000Z' })],
      trips: [baseTrip],
    })

    dismissCloudSnapshotPrompt(result.signature)
    setCloudSnapshotCheckResults([result])

    expect(isCloudSnapshotPromptDismissed(result.signature)).toBe(true)
    expect(getCloudSnapshotCheckState().results).toEqual([])
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

function createAutoStatus(patch: Partial<AutoSnapshotBackupEntry>): AutoSnapshotBackupEntry {
  return {
    status: 'dirty',
    tripId: 'trip_1',
    ...patch,
  }
}

function stubSessionStorage() {
  const storage = new Map<string, string>()
  const eventTarget = new EventTarget()
  vi.stubGlobal('window', {
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
    removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => {
        storage.delete(key)
      },
      setItem: (key: string, value: string) => {
        storage.set(key, value)
      },
    },
  })
}
