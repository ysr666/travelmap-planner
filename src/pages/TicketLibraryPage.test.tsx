// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TicketLibraryPage } from './TicketLibraryPage'

const mocks = vi.hoisted(() => ({
  appendExecutionResult: vi.fn(),
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
  updateTicketMeta: vi.fn(),
  updateItineraryItem: vi.fn(),
  describeTicketMetaLine: vi.fn(() => '其他票据 · PDF · 位置记录'),
  formatFileSize: vi.fn((size: number) => `${size} B`),
  formatTicketCreatedAt: vi.fn(() => '2026-04-01'),
  getTicketDisplayTitle: vi.fn((ticket?: { fileName?: string; title?: string }) => ticket?.title || ticket?.fileName || '票据'),
  getTicketFileType: vi.fn(() => 'image'),
  getTicketScope: vi.fn((ticket?: { itemId?: string; scope?: 'item' | 'trip' | 'unassigned' }) => ticket?.scope || (ticket?.itemId ? 'item' : 'trip')),
  getTicketStorageMode: vi.fn((ticket?: { storageMode?: 'copy' | 'external' | 'reference' }) => ticket?.storageMode || 'reference'),
  isValidExternalUrl: vi.fn(() => false),
  normalizeTicketFileName: vi.fn((name: string) => name),
  ticketCategoryOptions: [
    { label: '其他票据', value: 'other' },
    { label: '火车票', value: 'train_ticket' },
  ],
  ticketScopeLabels: { item: '行程点', trip: '旅行', unassigned: '未绑定' },
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
  restoreSuggestionState: vi.fn(),
  setSuggestionState: vi.fn(),
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
  updateTicketMeta: mocks.updateTicketMeta,
}))

vi.mock('../lib/tickets', () => ({
  describeTicketMetaLine: mocks.describeTicketMetaLine,
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

vi.mock('../hooks/useTripIntelligencePersistence', () => ({
  useTripIntelligencePersistence: () => ({
    appendExecutionResult: mocks.appendExecutionResult,
    restoreSuggestionState: mocks.restoreSuggestionState,
    setSuggestionState: mocks.setSuggestionState,
    suggestionStates: [],
  }),
}))

vi.mock('../components/TicketPreview', () => ({
  TicketPreview: ({
    intelligenceSuggestions = [],
    onIntelligenceSuggestionAction,
    onEditTicket,
    ticket,
  }: {
    intelligenceSuggestions?: Array<{ action?: { label?: string }; id: string; title: string }>
    onIntelligenceSuggestionAction?: (suggestion: { id: string }) => void
    onEditTicket?: (ticket: { id: string }) => void
    ticket: { id: string; title?: string }
  }) => (
    <div data-testid="ticket-preview">
      <button onClick={() => onEditTicket?.(ticket)} type="button">编辑票据</button>
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

function setInputValue(element: HTMLInputElement | HTMLTextAreaElement | undefined | null, value: string) {
  if (!element) return
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  setter?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

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
  mocks.updateTicketMeta.mockResolvedValue({
    changedItems: [],
    ticket: {
      createdAt: 100,
      fileName: 'ticket.pdf',
      fileType: 'pdf',
      id: 'ticket_1',
      mimeType: 'application/pdf',
      scope: 'trip',
      size: 1,
      storageMode: 'reference',
      title: '票据',
      tripId: 'trip_1',
      updatedAt: 101,
    },
  })
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

  it('filters gallery from actionable overview stats', async () => {
    mocks.listTicketsByTrip.mockResolvedValue([
      {
        id: 'ticket_copy',
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
        id: 'ticket_reference',
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
        id: 'ticket_external',
        tripId: 'trip_1',
        title: '外部订单',
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

    await act(async () => {
      container?.querySelector<HTMLButtonElement>('[data-testid="ticket-stat-external"]')?.click()
    })

    expect(container?.querySelector('[data-testid="ticket-filter-summary"]')?.textContent).toContain('外部链接：1 张')
    expect(container?.querySelector('[data-testid="ticket-gallery"]')?.textContent).toContain('外部订单')
    expect(container?.querySelector('[data-testid="ticket-gallery"]')?.textContent).not.toContain('机票确认')

    await act(async () => {
      container?.querySelector<HTMLButtonElement>('[data-testid="ticket-stat-all"]')?.click()
    })

    expect(container?.querySelector('[data-testid="ticket-filter-summary"]')?.textContent).toContain('全部票据：3 张')
    expect(container?.querySelector('[data-testid="ticket-gallery"]')?.textContent).toContain('机票确认')
  })

  it('opens the metadata editor from a ticket card and saves a rebind', async () => {
    const originalTicket = {
      id: 'ticket_1',
      tripId: 'trip_1',
      title: '机票确认',
      fileName: 'flight.pdf',
      fileType: 'pdf' as const,
      mimeType: 'application/pdf',
      size: 2048,
      storageMode: 'reference' as const,
      scope: 'trip' as const,
      ticketCategory: 'other' as const,
      createdAt: 100,
      updatedAt: 100,
    }
    mocks.listTicketsByTrip.mockResolvedValue([originalTicket])
    mocks.updateTicketMeta.mockResolvedValue({
      changedItems: [],
      ticket: {
        ...originalTicket,
        itemId: 'item_1',
        note: '改绑到浅草寺',
        scope: 'item',
        ticketCategory: 'train_ticket',
        title: '东京车票',
        updatedAt: 120,
      },
    })

    await act(async () => {
      root?.render(<TicketLibraryPage />)
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    const editButton = Array.from(container?.querySelectorAll('button') ?? [])
      .find((button) => button.getAttribute('aria-label') === '编辑机票确认')
    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(document.body.textContent).toContain('编辑票据')
    const editor = document.body.querySelector('[data-testid="ticket-metadata-editor"]')
    const titleInput = Array.from(editor?.querySelectorAll('input') ?? [])[0]
    const [categorySelect, bindingSelect] = Array.from(editor?.querySelectorAll('select') ?? [])
    const noteTextarea = editor?.querySelector('textarea')

    await act(async () => {
      setInputValue(titleInput, '东京车票')
      if (categorySelect) {
        categorySelect.value = 'train_ticket'
        categorySelect.dispatchEvent(new Event('change', { bubbles: true }))
      }
      if (bindingSelect) {
        bindingSelect.value = 'item:item_1'
        bindingSelect.dispatchEvent(new Event('change', { bubbles: true }))
      }
      setInputValue(noteTextarea, '改绑到浅草寺')
    })

    const saveButton = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('保存修改'))
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(mocks.updateTicketMeta).toHaveBeenCalledWith('ticket_1', {
      itemId: 'item_1',
      note: '改绑到浅草寺',
      scope: 'item',
      ticketCategory: 'train_ticket',
      title: '东京车票',
    })
    expect(document.body.textContent).toContain('票据信息已更新')
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

    const confirmButton = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('生成草稿'))
    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(mocks.createLedgerExpense).toHaveBeenCalledWith(expect.objectContaining({
      reviewStatus: 'needs_review',
      source: expect.objectContaining({ kind: 'ticket', sourceId: 'ticket_1' }),
      status: 'draft',
      tripId: 'trip_1',
    }))
    expect(mocks.appendExecutionResult).toHaveBeenCalledWith(expect.objectContaining({
      source: 'ticket',
      suggestion: expect.objectContaining({
        action: expect.objectContaining({ kind: 'ledger_create_expense_draft_from_candidate' }),
      }),
    }))
  })
})
