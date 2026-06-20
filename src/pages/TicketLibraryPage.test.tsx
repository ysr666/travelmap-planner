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
  getLedgerSettingsByTrip: vi.fn().mockResolvedValue(null),
  listLedgerExpenses: vi.fn().mockResolvedValue([]),
  listLedgerParticipants: vi.fn().mockResolvedValue([]),
  getItineraryItem: vi.fn().mockResolvedValue(null),
  createTicketMeta: vi.fn(),
  createLedgerExpense: vi.fn(),
  deleteTicket: vi.fn(),
  getTicketBlob: vi.fn(),
  saveTicketBlob: vi.fn(),
  updateItineraryItem: vi.fn(),
  formatFileSize: vi.fn((size: number) => `${size} B`),
  formatTicketCreatedAt: vi.fn(() => '2026-04-01'),
  getTicketDisplayTitle: vi.fn((ticket?: { fileName?: string; title?: string }) => ticket?.title || ticket?.fileName || '票据'),
  getTicketFileType: vi.fn(() => 'image'),
  getTicketScope: vi.fn((ticket?: { itemId?: string; scope?: 'item' | 'trip' | 'unassigned' }) => ticket?.scope || (ticket?.itemId ? 'item' : 'trip')),
  getTicketStorageMode: vi.fn((ticket?: { storageMode?: 'copy' | 'external' | 'reference' }) => ticket?.storageMode || 'reference'),
  isValidExternalUrl: vi.fn(() => false),
  normalizeTicketFileName: vi.fn((name: string) => name),
  ticketCategoryOptions: [],
  ticketScopeLabels: { trip: '旅行', day: '日期', item: '行程点' },
  describeItemTime: vi.fn(() => ''),
  getTicketCloudSyncView: vi.fn(() => ({ detail: '仅此设备', label: '本地', status: 'local' as const, tone: 'neutral' as const })),
  getTicketDisplayMeta: vi.fn((ticket?: { fileName?: string; fileType?: string }) => ({
    badge: ticket?.fileType || '文件',
    badgeTone: 'default' as const,
    secondaryLine: ticket?.fileName || '票据文件',
    toneKey: 'sky' as const,
  })),
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
  getLedgerSettingsByTrip: mocks.getLedgerSettingsByTrip,
  listLedgerExpenses: mocks.listLedgerExpenses,
  listLedgerParticipants: mocks.listLedgerParticipants,
  getItineraryItem: mocks.getItineraryItem,
  createTicketMeta: mocks.createTicketMeta,
  createLedgerExpense: mocks.createLedgerExpense,
  deleteTicket: mocks.deleteTicket,
  createTripDisruptionEvent: vi.fn(),
  getTicketBlob: mocks.getTicketBlob,
  saveTicketBlob: mocks.saveTicketBlob,
  setItineraryItemExecutionState: vi.fn(),
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
  TicketPreview: ({
    intelligenceSuggestions = [],
    onIntelligenceSuggestionAction,
  }: {
    intelligenceSuggestions?: Array<{ action?: { label?: string }; id: string; title: string }>
    onIntelligenceSuggestionAction?: (suggestion: { id: string }) => void
  }) => (
    <div data-testid="ticket-preview">
      {intelligenceSuggestions.map((suggestion) => (
        <button
          data-testid="ticket-preview-intelligence-action"
          key={suggestion.id}
          onClick={() => onIntelligenceSuggestionAction?.(suggestion)}
          type="button"
        >
          {suggestion.title} {suggestion.action?.label}
        </button>
      ))}
    </div>
  ),
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
  mocks.getLedgerSettingsByTrip.mockResolvedValue(null)
  mocks.listLedgerExpenses.mockResolvedValue([])
  mocks.listLedgerParticipants.mockResolvedValue([])
  mocks.createLedgerExpense.mockImplementation(async (input) => ({
    createdAt: 100,
    id: 'expense_1',
    updatedAt: 101,
    ...input,
  }))
  mocks.getTicketDisplayTitle.mockImplementation((ticket?: { fileName?: string; title?: string }) => ticket?.title || ticket?.fileName || '票据')
  mocks.getTicketScope.mockImplementation((ticket?: { itemId?: string; scope?: 'item' | 'trip' | 'unassigned' }) => ticket?.scope || (ticket?.itemId ? 'item' : 'trip'))
  mocks.getTicketStorageMode.mockImplementation((ticket?: { storageMode?: 'copy' | 'external' | 'reference' }) => ticket?.storageMode || 'reference')
  mocks.getTicketCloudSyncView.mockReturnValue({ detail: '仅此设备', label: '本地', status: 'local', tone: 'neutral' })
  mocks.getTicketDisplayMeta.mockImplementation((ticket?: { fileName?: string; fileType?: string }) => ({
    badge: ticket?.fileType || '文件',
    badgeTone: 'default' as const,
    secondaryLine: ticket?.fileName || '票据文件',
    toneKey: 'sky' as const,
  }))
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

  it('renders gallery overview and binding sections', async () => {
    mocks.listTicketsByTrip.mockResolvedValue([
      {
        id: 'ticket_item',
        tripId: 'trip_1',
        itemId: 'item_1',
        title: '浅草寺门票',
        fileName: 'asakusa.png',
        fileType: 'image',
        mimeType: 'image/png',
        size: 1024,
        storageMode: 'copy',
        scope: 'item',
        createdAt: 100,
        updatedAt: 100,
      },
      {
        id: 'ticket_trip',
        tripId: 'trip_1',
        title: '机票确认',
        fileName: 'flight.pdf',
        fileType: 'pdf',
        mimeType: 'application/pdf',
        size: 2048,
        storageMode: 'reference',
        scope: 'trip',
        createdAt: 101,
        updatedAt: 101,
      },
      {
        id: 'ticket_unassigned',
        tripId: 'trip_1',
        title: '待整理订单',
        fileName: 'order.url',
        fileType: 'other',
        mimeType: 'text/uri-list',
        size: 0,
        storageMode: 'external',
        scope: 'unassigned',
        createdAt: 102,
        updatedAt: 102,
      },
    ])

    await act(async () => {
      root?.render(<TicketLibraryPage />)
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(container?.textContent).toContain('票据总览')
    expect(container?.textContent).toContain('行程点票据')
    expect(container?.textContent).toContain('旅行级票据')
    expect(container?.textContent).toContain('未分类')
    expect(container?.querySelectorAll('[data-testid="ticket-gallery-section"]').length).toBe(3)
  })

  it('shows ticket intelligence suggestions and requires confirmation before creating an expense draft', async () => {
    mocks.getLedgerSettingsByTrip.mockResolvedValue({
      createdAt: 100,
      homeCurrency: 'CNY',
      id: 'settings_1',
      settlementCurrency: 'CNY',
      tripCurrency: 'JPY',
      tripId: 'trip_1',
      updatedAt: 100,
    })
    mocks.listLedgerParticipants.mockResolvedValue([
      { createdAt: 100, displayName: '我', id: 'person_1', isSelf: true, tripId: 'trip_1', updatedAt: 100 },
    ])
    mocks.listTicketsByTrip.mockResolvedValue([
      {
        createdAt: 100,
        fileName: 'receipt.pdf',
        fileType: 'pdf',
        id: 'ticket_1',
        mimeType: 'application/pdf',
        note: 'receipt paid JPY 12000',
        scope: 'unassigned',
        size: 1024,
        storageMode: 'reference',
        ticketCategory: 'other',
        title: '收据',
        tripId: 'trip_1',
        updatedAt: 100,
      },
    ])

    await act(async () => {
      root?.render(<TicketLibraryPage />)
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    const previewButton = Array.from(container?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent?.includes('查看'))
    await act(async () => {
      previewButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(container?.querySelector('[data-testid="ticket-preview"]')?.textContent).toContain('票据待绑定')
    expect(container?.querySelector('[data-testid="ticket-preview"]')?.textContent).toContain('可生成费用草稿')

    const draftButton = Array.from(container?.querySelectorAll('[data-testid="ticket-preview-intelligence-action"]') ?? [])
      .find((button) => button.textContent?.includes('生成费用草稿'))
    await act(async () => {
      draftButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mocks.createLedgerExpense).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('从票据生成费用草稿？')
  })
})
