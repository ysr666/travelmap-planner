// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StartupCloudSnapshotCheckController } from './StartupCloudSnapshotCheckController'
import {
  getTripAutoSnapshotStatus,
  markTripAutoSnapshotDirty,
  resetAutoSnapshotBackupForTests,
} from '../../lib/autoSnapshotBackup'
import {
  getCloudSnapshotCheckState,
  resetCloudSnapshotChecksForTests,
} from '../../lib/cloudSnapshotCheck'
import type { Trip } from '../../types'

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  getSupabaseClient: vi.fn(),
  getSupabaseConfigStatus: vi.fn(),
  listCloudBackups: vi.fn(),
  listTrips: vi.fn(),
  restoreCloudBackup: vi.fn(),
}))

vi.mock('../../db', () => ({
  listTrips: mocks.listTrips,
}))

vi.mock('../../lib/cloudBackup', () => ({
  getCurrentSession: mocks.getCurrentSession,
  getSupabaseConfigStatus: mocks.getSupabaseConfigStatus,
  listCloudBackups: mocks.listCloudBackups,
  restoreCloudBackup: mocks.restoreCloudBackup,
}))

vi.mock('../../lib/supabaseClient', () => ({
  getSupabaseClient: mocks.getSupabaseClient,
}))

const trip: Trip = {
  createdAt: Date.parse('2026-04-01T00:00:00.000Z'),
  destination: '东京',
  endDate: '2026-04-03',
  id: 'trip_1',
  startDate: '2026-04-01',
  title: '东京春日旅行',
  updatedAt: Date.parse('2026-04-02T10:00:00.000Z'),
}

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  resetAutoSnapshotBackupForTests()
  resetCloudSnapshotChecksForTests()
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

  mocks.listTrips.mockResolvedValue([trip])
  mocks.listCloudBackups.mockResolvedValue([
    {
      appVersion: '0.3.0',
      createdAt: '2026-04-02T11:00:00.000Z',
      destination: trip.destination,
      exportedAt: '2026-04-02T11:00:00.000Z',
      filesCount: 0,
      id: 'backup_cloud_newer',
      originalTripId: trip.id,
      schemaVersion: 1,
      snapshotPath: 'user_1/backup_cloud_newer/snapshot.json',
      title: trip.title,
      totalSizeBytes: 0,
      updatedAt: '2026-04-02T11:00:00.000Z',
      userId: 'user_1',
      warnings: [],
    },
  ])
  mocks.getCurrentSession.mockResolvedValue({ user: { id: 'user_1' } })
  mocks.getSupabaseClient.mockReturnValue(null)
  mocks.getSupabaseConfigStatus.mockReturnValue({
    anonKey: 'anon',
    configured: true,
    missing: [],
    url: 'https://example.supabase.co',
  })
  mocks.restoreCloudBackup.mockResolvedValue({
    exportedAt: '2026-04-02T11:00:00.000Z',
    title: trip.title,
    tripId: trip.id,
    warnings: [],
  })
})

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount()
    })
  }
  root = null
  container?.remove()
  container = null
  vi.useRealTimers()
  resetAutoSnapshotBackupForTests()
  resetCloudSnapshotChecksForTests()
})

describe('StartupCloudSnapshotCheckController cloud save decisions', () => {
  it('restores a cloud-newer save in place and suppresses the prompt', async () => {
    renderController()

    await runStartupCheck()

    expect(mocks.restoreCloudBackup).toHaveBeenCalledTimes(1)
    expect(mocks.restoreCloudBackup).toHaveBeenCalledWith('backup_cloud_newer')
    expect(getCloudSnapshotCheckState().results).toEqual([])
    expect(getTripAutoSnapshotStatus(trip.id)).toMatchObject({
      lastSuccessAt: Date.parse('2026-04-02T11:00:00.000Z'),
      status: 'synced',
    })
  })

  it('keeps a possible conflict as a prompt instead of restoring silently', async () => {
    markTripAutoSnapshotDirty(trip.id, 'local-edit', Date.parse('2026-04-02T12:00:00.000Z'))
    renderController()

    await runStartupCheck()

    expect(mocks.restoreCloudBackup).not.toHaveBeenCalled()
    expect(getCloudSnapshotCheckState().results).toHaveLength(1)
    expect(getCloudSnapshotCheckState().results[0]).toMatchObject({
      status: 'possible_conflict',
      tripId: trip.id,
    })
  })
})

function renderController() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(<StartupCloudSnapshotCheckController />)
  })
}

async function runStartupCheck() {
  await act(async () => {
    vi.advanceTimersByTime(0)
    await flushPromises()
  })
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}
