// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TicketLibraryPage } from './TicketLibraryPage'

const mocks = vi.hoisted(() => ({
  getRouteParams: vi.fn(() => new URLSearchParams({ tripId: 'trip_1' })),
  navigateTo: vi.fn(),
  getTrip: vi.fn().mockResolvedValue({
    id: 'trip_1',
    title: '东京旅行',
    destination: '东京',
    startDate: '2026-04-01',
    endDate: '2026-04-05',
    createdAt: 100,
    updatedAt: 100,
  }),
  listDaysByTrip: vi.fn().mockResolvedValue([
    { id: 'day_1', tripId: 'trip_1', date: '2026-04-01', sortOrder: 1, createdAt: 100, updatedAt: 100 },
  ]),
  listItemsByTrip: vi.fn().mockResolvedValue([
    { id: 'item_1', dayId: 'day_1', tripId: 'trip_1', title: '浅草寺', sortOrder: 1, createdAt: 100, updatedAt: 100 },
  ]),
  listTicketsByTrip: vi.fn().mockResolvedValue([]),
  getItineraryItem: vi.fn().mockResolvedValue(null),
  createTicketMeta: vi.fn(),
  deleteTicket: vi.fn(),
  getTicketBlob: vi.fn(),
  saveTicketBlob: vi.fn(),
  updateItineraryItem: vi.fn(),
  formatFileSize: vi.fn((size: number) => `${size} B`),
  formatTicketCreatedAt: vi.fn(() => '2026-04-01'),
  getTicketDisplayTitle: vi.fn(() => '票据'),
  getTicketFileType: vi.fn(() => 'image'),
  getTicketScope: vi.fn(() => 'trip'),
  getTicketStorageMode: vi.fn(() => 'reference'),
  isValidExternalUrl: vi.fn(() => false),
  normalizeTicketFileName: vi.fn((name: string) => name),
  ticketCategoryOptions: [],
  ticketScopeLabels: { trip: '旅行', day: '日期', item: '行程点' },
  describeItemTime: vi.fn(() => ''),
  getTicketCloudSyncView: vi.fn(() => ({ status: 'local' as const, label: '本地' })),
  getTicketDisplayMeta: vi.fn(() => ({ badge: '图片', badgeTone: 'default' as const })),
  getTripAutoSnapshotStatus: vi.fn(() => ({ status: 'idle' as const })),
  isAutoSnapshotBackupEnabled: vi.fn(() => false),
  subscribeAutoSnapshotBackup: vi.fn(() => () => {}),
  getCurrentUser: vi.fn(() => null),
  getSupabaseConfigStatus: vi.fn(() => ({ configured: false })),
  clearSyncedTicketBlobCache: vi.fn(),
  restoreTicketBlobCacheFromCloud: vi.fn(),
  retryTicketBlobUpload: vi.fn(),
  getTicketBlobSyncState: vi.fn(() => null),
  getSupabaseClient: vi.fn(() => null),
}))

vi.mock('../lib/routes', () => ({
  getRouteParams: mocks.getRouteParams,
  navigateTo: mocks.navigateTo,
}))

vi.mock('../db', () => ({
  getTrip: mocks.getTrip,
  listDaysByTrip: mocks.listDaysByTrip,
  listItemsByTrip: mocks.listItemsByTrip,
  listTicketsByTrip: mocks.listTicketsByTrip,
  getItineraryItem: mocks.getItineraryItem,
  createTicketMeta: mocks.createTicketMeta,
  deleteTicket: mocks.deleteTicket,
  getTicketBlob: mocks.getTicketBlob,
  saveTicketBlob: mocks.saveTicketBlob,
  updateItineraryItem: mocks.updateItineraryItem,
}))

vi.mock('../lib/tickets', () => ({
  formatFileSize: mocks.formatFileSize,
  formatTicketCreatedAt: mocks.formatTicketCreatedAt,
  getTicketDisplayTitle: mocks.getTicketDisplayTitle,
  getTicketFileType: mocks.getTicketFileType,
  getTicketScope: mocks.getTicketScope,
  getTicketStorageMode: mocks.getTicketStorageMode,
  isValidExternalUrl: mocks.isValidExternalUrl,
  normalizeTicketFileName: mocks.normalizeTicketFileName,
  ticketCategoryOptions: mocks.ticketCategoryOptions,
  ticketScopeLabels: mocks.ticketScopeLabels,
}))

vi.mock('../lib/itinerary', () => ({
  describeItemTime: mocks.describeItemTime,
}))

vi.mock('../lib/ticketDisplay', () => ({
  getTicketCloudSyncView: mocks.getTicketCloudSyncView,
  getTicketDisplayMeta: mocks.getTicketDisplayMeta,
}))

vi.mock('../lib/autoSnapshotBackup', () => ({
  getTripAutoSnapshotStatus: mocks.getTripAutoSnapshotStatus,
  isAutoSnapshotBackupEnabled: mocks.isAutoSnapshotBackupEnabled,
  subscribeAutoSnapshotBackup: mocks.subscribeAutoSnapshotBackup,
}))

vi.mock('../lib/cloudBackup', () => ({
  getCurrentUser: mocks.getCurrentUser,
  getSupabaseConfigStatus: mocks.getSupabaseConfigStatus,
}))

vi.mock('../lib/cloudObjectSync', () => ({
  clearSyncedTicketBlobCache: mocks.clearSyncedTicketBlobCache,
  restoreTicketBlobCacheFromCloud: mocks.restoreTicketBlobCacheFromCloud,
  retryTicketBlobUpload: mocks.retryTicketBlobUpload,
}))

vi.mock('../lib/objectSyncLocal', () => ({
  getTicketBlobSyncState: mocks.getTicketBlobSyncState,
}))

vi.mock('../lib/supabaseClient', () => ({
  getSupabaseClient: mocks.getSupabaseClient,
}))

vi.mock('../components/TicketPreview', () => ({
  TicketPreview: () => <div data-testid="ticket-preview" />,
}))

vi.mock('../components/tickets/TicketThumbnail', () => ({
  TicketThumbnail: () => <div data-testid="ticket-thumbnail" />,
}))

vi.mock('../components/AppShell', () => ({
  TripNav: () => <div data-testid="trip-nav" />,
}))

vi.stubGlobal('__APP_VERSION__', '0.0.0-test')

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  vi.useFakeTimers()
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.clearAllMocks()
  // Re-set default mock return values after clearAllMocks
  mocks.getTrip.mockResolvedValue({
    id: 'trip_1',
    title: '东京旅行',
    destination: '东京',
    startDate: '2026-04-01',
    endDate: '2026-04-05',
    createdAt: 100,
    updatedAt: 100,
  })
  mocks.listDaysByTrip.mockResolvedValue([
    { id: 'day_1', tripId: 'trip_1', date: '2026-04-01', sortOrder: 1, createdAt: 100, updatedAt: 100 },
  ])
  mocks.listItemsByTrip.mockResolvedValue([
    { id: 'item_1', dayId: 'day_1', tripId: 'trip_1', title: '浅草寺', sortOrder: 1, createdAt: 100, updatedAt: 100 },
  ])
  mocks.listTicketsByTrip.mockResolvedValue([])
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

describe('TicketLibraryPage', () => {
  it('renders loading skeleton initially', async () => {
    mocks.listTicketsByTrip.mockReturnValue(new Promise(() => {}))

    await act(async () => {
      root?.render(<TicketLibraryPage />)
    })

    expect(container?.querySelector('.animate-pulse')).toBeTruthy()
  })

  it('renders empty state when no tickets', async () => {
    await act(async () => {
      root?.render(<TicketLibraryPage />)
    })
    // Flush the setTimeout in useEffect
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(container?.textContent).toContain('票据库')
  })

  it('renders trip not found state', async () => {
    mocks.getTrip.mockResolvedValue(null)

    await act(async () => {
      root?.render(<TicketLibraryPage />)
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(container?.textContent).toContain('没有找到这个旅行')
  })

  it('renders ticket list when tickets exist', async () => {
    mocks.listTicketsByTrip.mockResolvedValue([
      {
        id: 'ticket_1',
        tripId: 'trip_1',
        title: '机票确认',
        fileName: 'flight.pdf',
        fileType: 'pdf',
        storageMode: 'reference',
        scope: 'trip',
        createdAt: 100,
        updatedAt: 100,
      },
    ])

    await act(async () => {
      root?.render(<TicketLibraryPage />)
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(container?.textContent).toContain('票据库')
  })

  it('renders filter buttons', async () => {
    await act(async () => {
      root?.render(<TicketLibraryPage />)
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(container?.textContent).toContain('全部')
  })

  it('renders navigation', async () => {
    await act(async () => {
      root?.render(<TicketLibraryPage />)
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(container?.querySelector('[data-testid="trip-nav"]')).toBeTruthy()
  })

  it('handles load error gracefully', async () => {
    mocks.listTicketsByTrip.mockRejectedValue(new Error('db error'))

    await act(async () => {
      root?.render(<TicketLibraryPage />)
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(container?.textContent).toContain('db error')
  })
})
