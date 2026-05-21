// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AutoSnapshotBackupController } from './AutoSnapshotBackupController'
import {
  markTripAutoSnapshotDirty,
  resetAutoSnapshotBackupForTests,
  setAutoSnapshotBackupEnabled,
} from '../../lib/autoSnapshotBackup'
import type { Trip } from '../../types'

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  getSupabaseClient: vi.fn(),
  getSupabaseConfigStatus: vi.fn(),
  getTrip: vi.fn(),
  listCloudBackups: vi.fn(),
  listTrips: vi.fn(),
  uploadTripCloudBackup: vi.fn(),
}))

vi.mock('../../db', () => ({
  getTrip: mocks.getTrip,
  listTrips: mocks.listTrips,
}))

vi.mock('../../lib/cloudBackup', () => ({
  getCurrentSession: mocks.getCurrentSession,
  getSupabaseConfigStatus: mocks.getSupabaseConfigStatus,
  listCloudBackups: mocks.listCloudBackups,
  uploadTripCloudBackup: mocks.uploadTripCloudBackup,
}))

vi.mock('../../lib/supabaseClient', () => ({
  getSupabaseClient: mocks.getSupabaseClient,
}))

const trip: Trip = {
  createdAt: 100,
  destination: '东京',
  endDate: '2026-04-03',
  id: 'trip_1',
  startDate: '2026-04-01',
  title: '东京春日旅行',
  updatedAt: 10_000,
}

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  resetAutoSnapshotBackupForTests()
  setDocumentVisibilityState('visible')
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

  mocks.getTrip.mockResolvedValue(trip)
  mocks.listTrips.mockResolvedValue([trip])
  mocks.listCloudBackups.mockResolvedValue([
    {
      appVersion: '0.3.0',
      createdAt: '2026-04-02T10:00:00.000Z',
      destination: trip.destination,
      exportedAt: '2026-04-02T10:00:00.000Z',
      filesCount: 0,
      id: 'backup_1',
      originalTripId: trip.id,
      schemaVersion: 1,
      snapshotPath: 'user_1/backup_1/snapshot.json',
      title: trip.title,
      totalSizeBytes: 0,
      updatedAt: '2026-04-02T10:00:00.000Z',
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
  mocks.uploadTripCloudBackup.mockResolvedValue({
    backupId: 'backup_1',
    exportedAt: '2026-04-02T10:00:00.000Z',
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
  setDocumentVisibilityState('visible')
})

describe('AutoSnapshotBackupController exit protection', () => {
  it('uploads a local trip on startup when it has no cloud save yet', async () => {
    setAutoSnapshotBackupEnabled(true)
    mocks.listCloudBackups.mockResolvedValue([])
    renderController()

    await runStartupAutoBackupScan()

    expect(mocks.uploadTripCloudBackup).toHaveBeenCalledTimes(1)
    expect(mocks.uploadTripCloudBackup).toHaveBeenCalledWith(trip.id)
  })

  it('uploads a local trip on startup when the local version is newer than cloud', async () => {
    setAutoSnapshotBackupEnabled(true)
    mocks.listCloudBackups.mockResolvedValue([
      {
        appVersion: '0.3.0',
        createdAt: '1970-01-01T00:00:00.100Z',
        destination: trip.destination,
        exportedAt: '1970-01-01T00:00:00.100Z',
        filesCount: 0,
        id: 'backup_older',
        originalTripId: trip.id,
        schemaVersion: 1,
        snapshotPath: 'user_1/backup_older/snapshot.json',
        title: trip.title,
        totalSizeBytes: 0,
        updatedAt: '1970-01-01T00:00:00.100Z',
        userId: 'user_1',
        warnings: [],
      },
    ])
    renderController()

    await runStartupAutoBackupScan()

    expect(mocks.uploadTripCloudBackup).toHaveBeenCalledTimes(1)
    expect(mocks.uploadTripCloudBackup).toHaveBeenCalledWith(trip.id)
  })

  it('flushes debounced dirty trips immediately on pagehide', async () => {
    setAutoSnapshotBackupEnabled(true)
    renderController()
    markTripAutoSnapshotDirty(trip.id, 'item-updated', 100)

    expect(mocks.uploadTripCloudBackup).not.toHaveBeenCalled()

    window.dispatchEvent(new Event('pagehide'))
    await flushPromises()

    expect(mocks.uploadTripCloudBackup).toHaveBeenCalledTimes(1)
    expect(mocks.uploadTripCloudBackup).toHaveBeenCalledWith(trip.id)

    await act(async () => {
      vi.advanceTimersByTime(10_000)
      await flushPromises()
    })
    expect(mocks.uploadTripCloudBackup).toHaveBeenCalledTimes(1)
  })

  it('flushes debounced dirty trips immediately when the document becomes hidden', async () => {
    setAutoSnapshotBackupEnabled(true)
    renderController()
    markTripAutoSnapshotDirty(trip.id, 'trip-updated', 100)

    setDocumentVisibilityState('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()

    expect(mocks.uploadTripCloudBackup).toHaveBeenCalledTimes(1)
  })

  it('shows the native leave prompt while dirty work is still pending', async () => {
    setAutoSnapshotBackupEnabled(true)
    renderController()
    markTripAutoSnapshotDirty(trip.id, 'ticket-updated', 100)

    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
    const allowedToLeave = window.dispatchEvent(event)
    await flushPromises()

    expect(allowedToLeave).toBe(false)
    expect(event.defaultPrevented).toBe(true)
    expect(mocks.uploadTripCloudBackup).toHaveBeenCalledTimes(1)
  })

  it('does not show the native leave prompt when no work is pending', () => {
    setAutoSnapshotBackupEnabled(true)
    renderController()

    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
    const allowedToLeave = window.dispatchEvent(event)

    expect(allowedToLeave).toBe(true)
    expect(event.defaultPrevented).toBe(false)
    expect(mocks.uploadTripCloudBackup).not.toHaveBeenCalled()
  })
})

function renderController() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(<AutoSnapshotBackupController />)
  })
}

async function runStartupAutoBackupScan() {
  await act(async () => {
    vi.advanceTimersByTime(0)
    await flushPromises()
    vi.advanceTimersByTime(0)
    await flushPromises()
  })
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function setDocumentVisibilityState(value: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value,
  })
}
