// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TripWorkspacePage } from './TripWorkspacePage'

const mocks = vi.hoisted(() => ({
  buildTripIntelligenceModel: vi.fn(),
  getRouteParams: vi.fn(() => new URLSearchParams({ tripId: 'trip_1' })),
  getActiveTravelInboxPreview: vi.fn().mockResolvedValue(null),
  intelligenceModel: {
    allSuggestions: [],
    forDay: vi.fn(() => []),
    forDocument: vi.fn(() => []),
    forFinance: vi.fn(() => []),
    forInbox: vi.fn(() => []),
    forItem: vi.fn(() => []),
    forSharedTrip: vi.fn(() => []),
    forTicket: vi.fn(() => []),
    forTripHome: vi.fn(() => []),
    suggestions: [],
    summary: {
      highRiskCount: 0,
      needsConfirmationCount: 0,
      totalCount: 0,
    },
  },
  listTravelInboxAccountSources: vi.fn().mockResolvedValue([]),
  listTravelInboxEntriesByTrip: vi.fn().mockResolvedValue([]),
  navigateTo: vi.fn(),
  listItemsByDay: vi.fn().mockResolvedValue([]),
  listTicketsByTrip: vi.fn().mockResolvedValue([]),
  listTripDisruptionEventsByTrip: vi.fn().mockResolvedValue([]),
  listTripReplanRecordsByTrip: vi.fn().mockResolvedValue([]),
  tripOperationsPanelProps: [] as Array<Record<string, unknown>>,
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
    { id: 'day_1', tripId: 'trip_1', date: '2026-04-01', sortOrder: 0, createdAt: 100, updatedAt: 100 },
  ]),
  useTripData: vi.fn(() => ({
    trip: {
      id: 'trip_1',
      title: '东京旅行',
      destination: '东京',
      startDate: '2026-04-01',
      endDate: '2026-04-05',
      createdAt: 100,
      updatedAt: 100,
    },
    days: [{ id: 'day_1', tripId: 'trip_1', date: '2026-04-01', sortOrder: 0, createdAt: 100, updatedAt: 100 }],
    selectedDay: { id: 'day_1', tripId: 'trip_1', date: '2026-04-01', sortOrder: 0, createdAt: 100, updatedAt: 100 },
    itemsByDay: { day_1: [] },
    allItems: [],
    isLoading: false,
    error: null,
    setDays: vi.fn(),
    setSelectedDay: vi.fn(),
    setItems: vi.fn(),
    setItemsByDay: vi.fn(),
    refresh: vi.fn(),
  })),
}))

vi.mock('../lib/routes', () => ({
  getRouteParams: mocks.getRouteParams,
  navigateTo: mocks.navigateTo,
}))

vi.mock('../db', () => ({
  getLedgerSettingsByTrip: vi.fn().mockResolvedValue(null),
  listLedgerBudgets: vi.fn().mockResolvedValue([]),
  listLedgerExpenses: vi.fn().mockResolvedValue([]),
  listLedgerParticipants: vi.fn().mockResolvedValue([]),
  listItemsByDay: mocks.listItemsByDay,
  listTicketsByTrip: mocks.listTicketsByTrip,
  listTripDisruptionEventsByTrip: mocks.listTripDisruptionEventsByTrip,
  listTripReplanRecordsByTrip: mocks.listTripReplanRecordsByTrip,
  getTrip: mocks.getTrip,
  listDaysByTrip: mocks.listDaysByTrip,
}))

vi.mock('../hooks/useTripData', () => ({
  useTripData: mocks.useTripData,
}))

vi.mock('../lib/ai/aiTripContext', () => ({
  buildTripContext: vi.fn(() => ({})),
}))

vi.mock('../lib/tripCheck', () => ({
  analyzeTripContext: vi.fn(() => ({
    evidence: [],
    suggestions: [],
    summary: {
      criticalCount: 0,
      message: 'ok',
      severity: 'info',
      suggestionCount: 0,
      title: 'ok',
      warningCount: 0,
    },
    warnings: [],
  })),
}))

vi.mock('../lib/travelProfile', () => ({
  getStoredTravelProfile: vi.fn(() => null),
}))

vi.mock('../lib/travelBrief', () => ({
  buildTripBrief: vi.fn(() => ''),
}))

vi.mock('../lib/ai/travelInbox', () => ({
  getActiveTravelInboxPreview: mocks.getActiveTravelInboxPreview,
  listTravelInboxEntriesByTrip: mocks.listTravelInboxEntriesByTrip,
}))

vi.mock('../lib/ai/travelInboxOrganization', () => ({
  listTravelInboxAccountSources: mocks.listTravelInboxAccountSources,
}))

vi.mock('../lib/cloudSyncQueueSummary', () => ({
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
}))

vi.mock('../lib/objectSyncLocal', () => ({
  listTicketBlobSyncStatesByTrip: vi.fn().mockResolvedValue([]),
}))

vi.mock('../lib/companion', () => ({
  loadOwnerSharedTripState: vi.fn().mockResolvedValue({
    configured: true,
    invites: [],
    activities: [],
    members: [],
    mutations: [],
    sharedTrip: null,
    signedIn: true,
  }),
}))

vi.mock('../lib/tripReadiness', () => ({
  buildTripReadinessModel: vi.fn(() => ({
    issues: [],
    summary: {
      fixableCount: 0,
      highRiskCount: 0,
      message: 'ok',
      selectedCount: 0,
      status: 'ready',
      statusLabel: '可出行',
      totalCount: 0,
    },
  })),
}))

vi.mock('../components/trip/TripReadinessCenterPanel', () => ({
  TripReadinessCenterPanel: () => <div data-testid="trip-readiness-center-panel" />,
}))

vi.mock('../components/trip/TripOperationsPanel', () => ({
  TripOperationsPanel: (props: Record<string, unknown>) => {
    mocks.tripOperationsPanelProps.push(props)
    return <div data-has-intelligence-model={props.intelligenceModel ? 'true' : 'false'} data-testid="trip-operations-panel" />
  },
}))

vi.mock('../components/trip/TripLiveModeCard', () => ({
  TripLiveModeCard: () => <div data-testid="trip-live-mode-card" />,
}))

vi.mock('../lib/tripOperationsNavigation', () => ({ navigateToTripOperationsRecommendation: vi.fn() }))

vi.mock('../components/trip/TripMapPreview', () => ({
  TripMapPreview: () => <div data-testid="trip-map-overview" />,
}))

vi.mock('../components/trip/TripDailyTravelTipCard', () => ({
  TripDailyTravelTipCard: () => <div data-testid="trip-daily-tip-card" />,
}))

vi.mock('../components/trip/TripContentEnrichmentPanel', () => ({
  TripContentEnrichmentPanel: () => <div data-testid="trip-content-enrichment-panel" />,
}))

vi.mock('../components/ai/TravelInboxPanel', () => ({
  TravelInboxPanel: () => <div data-testid="travel-inbox-panel" />,
}))

vi.mock('../components/ai/SmartTripWorkspacePanel', () => ({
  SmartTripWorkspacePanel: () => <div data-testid="smart-trip-workspace-panel" />,
}))

vi.mock('../components/ai/AiTripEditPanel', () => ({
  AiTripEditPanel: () => <div data-testid="ai-trip-edit-panel" />,
}))

vi.mock('../components/ai/TripBriefCard', () => ({
  TripBriefCard: () => <div data-testid="trip-brief-card" />,
}))

vi.mock('../components/cloud/CloudSnapshotCheckPrompts', () => ({
  CloudSnapshotCheckPrompts: () => <div data-testid="cloud-snapshot-check-prompts" />,
}))

vi.mock('../components/cloud/AutoSnapshotBackupStatus', () => ({
  AutoSnapshotBackupStatus: () => <div data-testid="auto-snapshot-backup-status" />,
}))

vi.mock('../lib/tripOperationsAgent', () => ({
  buildTripOperationsModel: vi.fn(() => ({
    activeRecommendations: [],
    allRecommendations: [],
    batchableCount: 0,
    batchableRecommendations: [],
    hiddenRecommendations: [],
    phase: 'pre_trip',
    phaseLabel: '出发前',
    recommendations: [],
    replanTimeline: [],
    summary: {
      highRiskCount: 0,
      message: 'ok',
      totalCount: 0,
    },
  })),
}))

vi.mock('../lib/tripIntelligence', () => ({
  buildTripIntelligenceModel: mocks.buildTripIntelligenceModel,
}))

vi.mock('../lib/routeGeneration', () => ({
  generateRoutePreviewsForTrip: vi.fn().mockResolvedValue({ results: [] }),
}))

vi.mock('../lib/routePreparation', () => ({
  getPersistentRouteProvider: vi.fn(() => null),
  loadTripRoutePreparation: vi.fn().mockResolvedValue(null),
}))

vi.mock('../lib/routeCache', () => ({
  ROUTE_CACHE_CHANGED_EVENT: 'route-cache-changed',
}))

vi.mock('../lib/routing', () => ({
  getRoutingConfig: vi.fn(() => ({})),
  ROUTING_CONFIG_CHANGED_EVENT: 'routing-config-changed',
}))

vi.stubGlobal('__APP_VERSION__', '0.0.0-test')

vi.mock('../lib/dates', () => ({
  ensureDaysForTrip: vi.fn((days) => days),
  formatDate: vi.fn(() => '4月1日'),
  formatDateKey: vi.fn(() => '2026-04-01'),
  formatDateRange: vi.fn(() => '4月1日 - 4月5日'),
  formatShortDateWithWeekday: vi.fn(() => '4月1日 周三'),
}))

vi.mock('../lib/dayOrdinal', () => ({
  formatChineseDayOrdinal: vi.fn(() => '第1天'),
}))

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.clearAllMocks()
  mocks.getActiveTravelInboxPreview.mockResolvedValue(null)
  mocks.listTravelInboxAccountSources.mockResolvedValue([])
  mocks.listTravelInboxEntriesByTrip.mockResolvedValue([])
  mocks.buildTripIntelligenceModel.mockReturnValue(mocks.intelligenceModel)
  mocks.useTripData.mockReturnValue({
    trip: {
      id: 'trip_1',
      title: '东京旅行',
      destination: '东京',
      startDate: '2026-04-01',
      endDate: '2026-04-05',
      createdAt: 100,
      updatedAt: 100,
    },
    days: [{ id: 'day_1', tripId: 'trip_1', date: '2026-04-01', sortOrder: 0, createdAt: 100, updatedAt: 100 }],
    selectedDay: { id: 'day_1', tripId: 'trip_1', date: '2026-04-01', sortOrder: 0, createdAt: 100, updatedAt: 100 },
    itemsByDay: { day_1: [] },
    allItems: [],
    isLoading: false,
    error: null,
    setDays: vi.fn(),
    setSelectedDay: vi.fn(),
    setItems: vi.fn(),
    setItemsByDay: vi.fn(),
    refresh: vi.fn(),
  })
  mocks.tripOperationsPanelProps.length = 0
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  container = null
  root = null
})

describe('TripWorkspacePage', () => {
  it('renders trip title', async () => {
    act(() => {
      root?.render(<TripWorkspacePage />)
    })

    expect(container?.textContent).toContain('东京旅行')
  })

  it('renders day information', async () => {
    act(() => {
      root?.render(<TripWorkspacePage />)
    })

    expect(container?.textContent).toBeTruthy()
  })

  it('passes the unified intelligence model to the operations panel', async () => {
    await renderWorkspacePage()
    await waitForSelector('[data-testid="trip-operations-panel"]')

    expect(mocks.buildTripIntelligenceModel).toHaveBeenCalledWith(expect.objectContaining({
      inbox: expect.objectContaining({
        activePreview: null,
        summary: expect.anything(),
      }),
      operationsModel: expect.anything(),
      readinessModel: expect.anything(),
      sharedMutations: [],
    }))
    expect(mocks.tripOperationsPanelProps.at(-1)?.intelligenceModel).toBe(mocks.intelligenceModel)
    expect(container?.querySelector('[data-testid="trip-operations-panel"]')?.getAttribute('data-has-intelligence-model')).toBe('true')
  })

  it('keeps the embedded travel inbox hidden when there is no material needing attention', async () => {
    await renderWorkspacePage()
    await waitForSelector('[data-testid="trip-home-quick-actions"]')

    expect(container?.querySelector('[data-testid="travel-inbox-panel"]')).toBeNull()
    expect(container?.querySelector('[data-testid="trip-action-travel-inbox"]')).not.toBeNull()
    expect(container?.querySelector('[data-testid="trip-action-account-inbox"]')).not.toBeNull()
  })

  it('shows the embedded travel inbox when an active preview is waiting for confirmation', async () => {
    mocks.getActiveTravelInboxPreview.mockResolvedValue({
      checkedDiffIds: ['diff_1'],
      createdAt: 100,
      id: 'preview_1',
      preview: { diffs: [] },
      sourceEntryIds: [],
      tripId: 'trip_1',
      updatedAt: 100,
    })

    await renderWorkspacePage()
    await waitForSelector('[data-testid="travel-inbox-panel"]')

    expect(container?.querySelector('[data-testid="travel-inbox-panel"]')).not.toBeNull()
  })

  it('keeps ready material in the secondary tool entry instead of expanding the inbox by default', async () => {
    mocks.listTravelInboxEntriesByTrip.mockResolvedValue([
      {
        createdAt: 100,
        fileName: 'hotel.txt',
        fileType: 'text/plain',
        id: 'entry_1',
        sourceKind: 'manual',
        status: 'ready',
        text: '酒店确认单',
        tripId: 'trip_1',
        updatedAt: 100,
      },
    ])

    await renderWorkspacePage()
    await waitForSelector('[data-testid="trip-home-quick-actions"]')

    expect(container?.querySelector('[data-testid="travel-inbox-panel"]')).toBeNull()
    expect(container?.querySelector('[data-testid="trip-action-travel-inbox"]')).not.toBeNull()
  })

  it('handles missing trip gracefully', async () => {
    mocks.useTripData.mockReturnValue({
      trip: null,
      days: [],
      selectedDay: undefined,
      itemsByDay: { day_1: [] },
      allItems: [],
      isLoading: false,
      error: 'not found',
      setDays: vi.fn(),
      setSelectedDay: vi.fn(),
      setItems: vi.fn(),
      setItemsByDay: vi.fn(),
      refresh: vi.fn(),
    } as unknown as ReturnType<typeof mocks.useTripData>)

    act(() => {
      root?.render(<TripWorkspacePage />)
    })

    expect(container?.textContent).toBeTruthy()
  })
})

async function renderWorkspacePage() {
  await act(async () => {
    root?.render(<TripWorkspacePage />)
  })
  await flushAsyncWork()
}

async function flushAsyncWork() {
  for (let index = 0; index < 6; index += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

async function waitForSelector(selector: string) {
  for (let index = 0; index < 12; index += 1) {
    const element = container?.querySelector(selector)
    if (element) return element
    await flushAsyncWork()
  }
  throw new Error(`Missing selector ${selector}`)
}
