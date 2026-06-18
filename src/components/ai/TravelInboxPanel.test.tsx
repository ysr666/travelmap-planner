// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TravelInboxPanel } from './TravelInboxPanel'

const mocks = vi.hoisted(() => ({
  listTravelInboxEntriesByTrip: vi.fn().mockResolvedValue([]),
  getActiveTravelInboxPreview: vi.fn().mockResolvedValue(null),
  deleteTravelInboxEntries: vi.fn(),
  deleteTravelInboxPreview: vi.fn(),
  isTravelInboxAutoRecognizeEnabled: vi.fn(() => false),
  setTravelInboxAutoRecognizeEnabled: vi.fn(),
  buildTravelInboxSourceSummaries: vi.fn(() => []),
  buildTravelInboxProviderTicketSummaries: vi.fn(() => []),
  buildTravelInboxTicketSummaries: vi.fn(() => []),
  summarizeTravelInboxPreview: vi.fn(() => ''),
  describeTravelInboxSourceKind: vi.fn(() => '文件'),
  inferTravelInboxSourceKind: vi.fn(() => 'file'),
  addTravelInboxExtraction: vi.fn(),
  addTravelInboxErrorEntry: vi.fn(),
  markTravelInboxEntriesRecognizing: vi.fn(),
  markTravelInboxEntriesError: vi.fn(),
  replaceTravelInboxEntryWithExtraction: vi.fn(),
  saveTravelInboxPreview: vi.fn(),
  updateTravelInboxPreviewRecord: vi.fn(),
  buildTravelInboxApplyFiles: vi.fn(() => []),
  getProviderProxyConfig: vi.fn(() => ({ baseUrl: '' })),
  fetchProviderProxyExistingTripImport: vi.fn(),
  buildExistingTripImportRequestSources: vi.fn(() => []),
  extractExistingTripImportSources: vi.fn(),
  buildExistingTripImportPreview: vi.fn(),
  applyExistingTripImportPreview: vi.fn(),
  navigateTo: vi.fn(),
  db: { travelInbox: { where: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })) } },
  SYNC_QUEUE_SUCCESS_COPY: '已保存',
  ticketCategoryOptions: [],
  ticketCategoryLabels: {},
}))

vi.mock('../../lib/ai/travelInbox', () => ({
  listTravelInboxEntriesByTrip: mocks.listTravelInboxEntriesByTrip,
  getActiveTravelInboxPreview: mocks.getActiveTravelInboxPreview,
  deleteTravelInboxEntries: mocks.deleteTravelInboxEntries,
  deleteTravelInboxPreview: mocks.deleteTravelInboxPreview,
  isTravelInboxAutoRecognizeEnabled: mocks.isTravelInboxAutoRecognizeEnabled,
  setTravelInboxAutoRecognizeEnabled: mocks.setTravelInboxAutoRecognizeEnabled,
  buildTravelInboxSourceSummaries: mocks.buildTravelInboxSourceSummaries,
  buildTravelInboxProviderTicketSummaries: mocks.buildTravelInboxProviderTicketSummaries,
  buildTravelInboxTicketSummaries: mocks.buildTravelInboxTicketSummaries,
  summarizeTravelInboxPreview: mocks.summarizeTravelInboxPreview,
  describeTravelInboxSourceKind: mocks.describeTravelInboxSourceKind,
  inferTravelInboxSourceKind: mocks.inferTravelInboxSourceKind,
  addTravelInboxExtraction: mocks.addTravelInboxExtraction,
  addTravelInboxErrorEntry: mocks.addTravelInboxErrorEntry,
  markTravelInboxEntriesRecognizing: mocks.markTravelInboxEntriesRecognizing,
  markTravelInboxEntriesError: mocks.markTravelInboxEntriesError,
  replaceTravelInboxEntryWithExtraction: mocks.replaceTravelInboxEntryWithExtraction,
  saveTravelInboxPreview: mocks.saveTravelInboxPreview,
  updateTravelInboxPreviewRecord: mocks.updateTravelInboxPreviewRecord,
  buildTravelInboxApplyFiles: mocks.buildTravelInboxApplyFiles,
}))

vi.mock('../../lib/providerProxyClient', () => ({
  getProviderProxyConfig: mocks.getProviderProxyConfig,
  fetchProviderProxyExistingTripImport: mocks.fetchProviderProxyExistingTripImport,
  ProviderProxyClientError: class extends Error {},
}))

vi.mock('../../lib/ai/existingTripImportExtraction', () => ({
  buildExistingTripImportRequestSources: mocks.buildExistingTripImportRequestSources,
  DEFAULT_EXISTING_TRIP_IMPORT_OCR_LANGUAGES: [],
  extractExistingTripImportSources: mocks.extractExistingTripImportSources,
  OPTIONAL_EXISTING_TRIP_IMPORT_OCR_LANGUAGES: [],
}))

vi.mock('../../lib/ai/existingTripImport', () => ({
  buildExistingTripImportPreview: mocks.buildExistingTripImportPreview,
  applyExistingTripImportPreview: mocks.applyExistingTripImportPreview,
}))

vi.mock('../../lib/ai/providerProxyContract', () => ({
  PROVIDER_PROXY_AI_EXISTING_TRIP_IMPORT_OPERATION: 'existing_trip_import',
}))

vi.mock('../../db/database', () => ({
  db: mocks.db,
}))

vi.mock('../../lib/routes', () => ({
  navigateTo: mocks.navigateTo,
}))

vi.mock('../../lib/tripSyncQueue', () => ({
  SYNC_QUEUE_SUCCESS_COPY: mocks.SYNC_QUEUE_SUCCESS_COPY,
}))

vi.mock('../../lib/tickets', () => ({
  ticketCategoryOptions: mocks.ticketCategoryOptions,
  ticketCategoryLabels: mocks.ticketCategoryLabels,
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

const defaultDays = [
  { id: 'day_1', tripId: 'trip_1', date: '2026-04-01', title: '第 1 天', sortOrder: 1, createdAt: 100, updatedAt: 100 },
]

const defaultAllItems = [
  { id: 'item_1', dayId: 'day_1', tripId: 'trip_1', title: '浅草寺', ticketIds: [], sortOrder: 1, createdAt: 100, updatedAt: 100 },
]

const defaultTickets: never[] = []

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  vi.useFakeTimers()
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.clearAllMocks()
  mocks.listTravelInboxEntriesByTrip.mockResolvedValue([])
  mocks.getActiveTravelInboxPreview.mockResolvedValue(null)
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

describe('TravelInboxPanel', () => {
  it('renders inbox panel', async () => {
    await act(async () => {
      root?.render(
        <TravelInboxPanel
          days={defaultDays}
          allItems={defaultAllItems} tickets={defaultTickets} onApplied={vi.fn()}
          trip={defaultTrip}
        />,
      )
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(container?.textContent).toContain('旅行材料输入 · 待确认建议')
  })

  it('renders empty state when no entries', async () => {
    await act(async () => {
      root?.render(
        <TravelInboxPanel
          days={defaultDays}
          allItems={defaultAllItems} tickets={defaultTickets} onApplied={vi.fn()}
          trip={defaultTrip}
        />,
      )
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(container?.textContent).toContain('还没有待处理收件')
  })

  it('renders upload button', async () => {
    await act(async () => {
      root?.render(
        <TravelInboxPanel
          days={defaultDays}
          allItems={defaultAllItems} tickets={defaultTickets} onApplied={vi.fn()}
          trip={defaultTrip}
        />,
      )
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    const uploadButton = Array.from(container?.querySelectorAll('button') ?? [])
      .find((b) => b.textContent?.includes('上传') || b.textContent?.includes('添加'))
    expect(uploadButton).toBeTruthy()
  })

  it('renders auto recognize toggle', async () => {
    await act(async () => {
      root?.render(
        <TravelInboxPanel
          days={defaultDays}
          allItems={defaultAllItems} tickets={defaultTickets} onApplied={vi.fn()}
          trip={defaultTrip}
        />,
      )
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(container?.textContent).toContain('自动 AI 识别')
  })

  it('renders with entries', async () => {
    mocks.listTravelInboxEntriesByTrip.mockResolvedValue([
      { id: 'entry_1', tripId: 'trip_1', kind: 'file', title: '机票确认.pdf', status: 'extracted', warnings: [], createdAt: 100, updatedAt: 100 },
    ])

    await act(async () => {
      root?.render(
        <TravelInboxPanel
          days={defaultDays}
          allItems={defaultAllItems} tickets={defaultTickets} onApplied={vi.fn()}
          trip={defaultTrip}
        />,
      )
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(container?.textContent).toContain('需处理文件')
  })

  it('renders with pending entries', async () => {
    mocks.listTravelInboxEntriesByTrip.mockResolvedValue([
      { id: 'entry_1', tripId: 'trip_1', kind: 'file', title: '酒店确认.pdf', status: 'pending', warnings: [], createdAt: 100, updatedAt: 100 },
    ])

    await act(async () => {
      root?.render(
        <TravelInboxPanel
          days={defaultDays}
          allItems={defaultAllItems} tickets={defaultTickets} onApplied={vi.fn()}
          trip={defaultTrip}
        />,
      )
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(container?.textContent).toContain('待处理收件')
  })

  it('renders with error entries', async () => {
    mocks.listTravelInboxEntriesByTrip.mockResolvedValue([
      { id: 'entry_1', tripId: 'trip_1', kind: 'file', title: '文件.pdf', status: 'error', error: '解析失败', warnings: [], createdAt: 100, updatedAt: 100 },
    ])

    await act(async () => {
      root?.render(
        <TravelInboxPanel
          days={defaultDays}
          allItems={defaultAllItems} tickets={defaultTickets} onApplied={vi.fn()}
          trip={defaultTrip}
        />,
      )
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(container?.textContent).toContain('待处理收件')
  })

  it('renders with preview', async () => {
    mocks.getActiveTravelInboxPreview.mockResolvedValue({
      id: 'preview_1',
      tripId: 'trip_1',
      status: 'ready',
      diffs: [],
      createdAt: 100,
      updatedAt: 100,
    })
    mocks.summarizeTravelInboxPreview.mockReturnValue('识别到 2 个行程点')

    await act(async () => {
      root?.render(
        <TravelInboxPanel
          days={defaultDays}
          allItems={defaultAllItems} tickets={defaultTickets} onApplied={vi.fn()}
          trip={defaultTrip}
        />,
      )
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(container?.textContent).toContain('旅行材料输入 · 待确认建议')
  })
})
