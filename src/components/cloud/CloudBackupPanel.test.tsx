// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CloudBackupPanel } from './CloudBackupPanel'

const mocks = vi.hoisted(() => ({
  getSupabaseConfigStatus: vi.fn(() => ({ configured: true })),
  getCurrentUser: vi.fn().mockResolvedValue(null),
  listCloudBackups: vi.fn().mockResolvedValue([]),
  deleteCloudBackup: vi.fn(),
  restoreCloudBackup: vi.fn(),
  signInWithEmailOtp: vi.fn(),
  signOut: vi.fn(),
  uploadTripCloudBackup: vi.fn(),
  verifyEmailOtp: vi.fn(),
  getSupabaseClient: vi.fn(() => null),
  listTrips: vi.fn().mockResolvedValue([]),
  subscribeTravelDataChanged: vi.fn(() => () => {}),
  isAutoSnapshotBackupEnabled: vi.fn(() => false),
  getTripAutoSnapshotStatus: vi.fn(() => ({ status: 'idle' })),
  listAutoSnapshotBackupEntries: vi.fn(() => []),
  subscribeAutoSnapshotBackup: vi.fn(() => () => {}),
  setAutoSnapshotBackupEnabled: vi.fn(),
  markTripAutoSnapshotSynced: vi.fn(),
  completeTripAutoSnapshotSuccess: vi.fn(),
  requestTripAutoSnapshotRetry: vi.fn(),
  getCloudAccountSyncStatusView: vi.fn(() => ({ status: 'idle', label: '空闲', tone: 'neutral' })),
  getCloudSyncQueueSummary: vi.fn().mockResolvedValue({
    conflictCount: 0,
    dirtyTripCount: 0,
    errorObjectCount: 0,
    pendingObjectCount: 0,
    syncItemCount: 0,
    syncingObjectCount: 0,
    ticketDeletedCount: 0,
    ticketErrorCount: 0,
    ticketPendingCount: 0,
    ticketUploadingCount: 0,
    tickets: [],
  }),
  getCloudLoginOnboardingCopy: vi.fn(() => null),
  listPendingObjectSyncConflicts: vi.fn().mockResolvedValue([]),
  getCloudSnapshotCheckState: vi.fn(() => ({ status: 'idle', results: [], error: null, isChecking: false })),
  subscribeCloudSnapshotChecks: vi.fn(() => () => {}),
  groupCloudBackupsForDisplay: vi.fn(() => []),
  navigateTo: vi.fn(),
  formatFileSize: vi.fn((size: number) => `${size} B`),
}))

vi.mock('../../lib/cloudBackup', () => ({
  getSupabaseConfigStatus: mocks.getSupabaseConfigStatus,
  getCurrentUser: mocks.getCurrentUser,
  listCloudBackups: mocks.listCloudBackups,
  deleteCloudBackup: mocks.deleteCloudBackup,
  restoreCloudBackup: mocks.restoreCloudBackup,
  signInWithEmailOtp: mocks.signInWithEmailOtp,
  signOut: mocks.signOut,
  uploadTripCloudBackup: mocks.uploadTripCloudBackup,
  verifyEmailOtp: mocks.verifyEmailOtp,
}))

vi.mock('../../lib/supabaseClient', () => ({
  getSupabaseClient: mocks.getSupabaseClient,
}))

vi.mock('../../db', () => ({
  listTrips: mocks.listTrips,
}))

vi.mock('../../lib/dataEvents', () => ({
  subscribeTravelDataChanged: mocks.subscribeTravelDataChanged,
}))

vi.mock('../../lib/tickets', () => ({
  formatFileSize: mocks.formatFileSize,
}))

vi.mock('../../lib/autoSnapshotBackup', () => ({
  isAutoSnapshotBackupEnabled: mocks.isAutoSnapshotBackupEnabled,
  getTripAutoSnapshotStatus: mocks.getTripAutoSnapshotStatus,
  listAutoSnapshotBackupEntries: mocks.listAutoSnapshotBackupEntries,
  subscribeAutoSnapshotBackup: mocks.subscribeAutoSnapshotBackup,
  setAutoSnapshotBackupEnabled: mocks.setAutoSnapshotBackupEnabled,
  markTripAutoSnapshotSynced: mocks.markTripAutoSnapshotSynced,
  completeTripAutoSnapshotSuccess: mocks.completeTripAutoSnapshotSuccess,
  requestTripAutoSnapshotRetry: mocks.requestTripAutoSnapshotRetry,
}))

vi.mock('../../lib/cloudAccountSyncStatus', () => ({
  getCloudAccountSyncStatusView: mocks.getCloudAccountSyncStatusView,
}))

vi.mock('../../lib/cloudSyncQueueSummary', () => ({
  getCloudSyncQueueSummary: mocks.getCloudSyncQueueSummary,
  getCloudLoginOnboardingCopy: mocks.getCloudLoginOnboardingCopy,
}))

vi.mock('../../lib/cloudObjectSync', () => ({
  listPendingObjectSyncConflicts: mocks.listPendingObjectSyncConflicts,
}))

vi.mock('../../lib/cloudSnapshotCheck', () => ({
  getCloudSnapshotCheckState: mocks.getCloudSnapshotCheckState,
  subscribeCloudSnapshotChecks: mocks.subscribeCloudSnapshotChecks,
}))

vi.mock('../../lib/cloudBackupDisplay', () => ({
  groupCloudBackupsForDisplay: mocks.groupCloudBackupsForDisplay,
}))

vi.mock('../../lib/routes', () => ({
  navigateTo: mocks.navigateTo,
}))

vi.mock('../cloud/CloudSnapshotCheckPrompts', () => ({
  CloudSnapshotCheckPrompts: () => <div data-testid="cloud-snapshot-check-prompts" />,
}))

vi.mock('../cloud/ObjectSyncConflictPanel', () => ({
  ObjectSyncConflictPanel: () => <div data-testid="object-sync-conflict-panel" />,
}))

vi.stubGlobal('__APP_VERSION__', '0.0.0-test')

const defaultTrip = {
  id: 'trip_1',
  title: '东京旅行',
  destination: '东京',
  startDate: '2026-04-01',
  endDate: '2026-04-05',
  createdAt: 100,
  updatedAt: 100,
}

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  vi.useFakeTimers()
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.clearAllMocks()
  mocks.getSupabaseConfigStatus.mockReturnValue({ configured: true })
  mocks.getCurrentUser.mockResolvedValue(null)
  mocks.listCloudBackups.mockResolvedValue([])
  mocks.getSupabaseClient.mockReturnValue(null)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  container = null
  root = null
  vi.useRealTimers()
})

describe('CloudBackupPanel', () => {
  it('renders unconfigured state', async () => {
    mocks.getSupabaseConfigStatus.mockReturnValue({ configured: false })

    await act(async () => {
      root?.render(<CloudBackupPanel trip={defaultTrip} />)
    })

    expect(container?.textContent).toContain('VITE_SUPABASE_URL')
  })

  it('renders loading state', async () => {
    mocks.getCurrentUser.mockReturnValue(new Promise(() => {}))

    await act(async () => {
      root?.render(<CloudBackupPanel trip={defaultTrip} />)
    })

    expect(container?.querySelector('.animate-pulse')).toBeTruthy()
  })

  it('renders signed out state', async () => {
    await act(async () => {
      root?.render(<CloudBackupPanel trip={defaultTrip} />)
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(container?.textContent).toContain('登录')
  })

  it('renders signed in state with user email', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'user_1', email: 'test@example.com' })

    await act(async () => {
      root?.render(<CloudBackupPanel trip={defaultTrip} />)
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(container?.textContent).toContain('test@example.com')
  })

  it('renders auto backup toggle', async () => {
    await act(async () => {
      root?.render(<CloudBackupPanel trip={defaultTrip} />)
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(container?.textContent).toContain('自动同步')
  })

  it('renders error state', async () => {
    mocks.getCurrentUser.mockRejectedValue(new Error('网络错误'))

    await act(async () => {
      root?.render(<CloudBackupPanel trip={defaultTrip} />)
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(container?.textContent).toContain('网络错误')
  })

  it('renders email input for login', async () => {
    await act(async () => {
      root?.render(<CloudBackupPanel trip={defaultTrip} />)
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    const emailInput = container?.querySelector('input[type="email"]')
    expect(emailInput).toBeTruthy()
  })

  it('renders with null trip', async () => {
    await act(async () => {
      root?.render(<CloudBackupPanel trip={null} />)
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(container?.textContent).toBeTruthy()
  })

  it('renders backup list when signed in', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'user_1', email: 'test@example.com' })
    mocks.listCloudBackups.mockResolvedValue([
      { id: 'backup_1', tripId: 'trip_1', title: '东京旅行', exportedAt: '2026-04-01T10:00:00Z', createdAt: '2026-04-01T10:00:00Z', totalSizeBytes: 1024, filesCount: 3, warnings: [] },
    ])
    mocks.groupCloudBackupsForDisplay.mockReturnValue([
      {
        backups: [{ id: 'backup_1', tripId: 'trip_1', title: '东京旅行', exportedAt: '2026-04-01T10:00:00Z', createdAt: '2026-04-01T10:00:00Z', totalSizeBytes: 1024, filesCount: 3, warnings: [] }],
        groupKey: 'trip_1',
        isGrouped: false,
        latestSnapshotAt: '2026-04-01T10:00:00Z',
        title: '东京旅行',
      },
    ])

    await act(async () => {
      root?.render(<CloudBackupPanel trip={defaultTrip} />)
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(container?.textContent).toContain('test@example.com')
  })
})
