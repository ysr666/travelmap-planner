// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DayViewPage } from './DayViewPage'
import type { TripOperationsRecommendation } from '../lib/tripOperationsAgent'

const mocks = vi.hoisted(() => ({
  getRouteParams: vi.fn(() => new URLSearchParams({ tripId: 'trip_1', dayId: 'day_1', view: 'schedule' })),
  navigateTo: vi.fn(),
  useTripData: vi.fn(),
  listItemsByDay: vi.fn().mockResolvedValue([]),
  listTicketsByTrip: vi.fn().mockResolvedValue([]),
  buildTripContext: vi.fn(() => ({})),
  analyzeTripContext: vi.fn(() => ({
    evidence: [],
    suggestions: [],
    summary: { criticalCount: 0, message: 'ok', severity: 'info', suggestionCount: 0, title: 'ok', warningCount: 0 },
    warnings: [],
  })),
  getStoredTravelProfile: vi.fn(() => null),
  buildDayBrief: vi.fn(() => null),
  buildTripDailyTravelTip: vi.fn(() => ({ mode: 'today', targetDay: null })),
  buildTripReadinessModel: vi.fn(() => ({ issues: [], summary: {} })),
  buildTripOperationsModel: vi.fn(),
  createEmptyTripOperationsLocalState: vi.fn(() => ({ dispositions: [], history: [], version: 2 })),
  listTripDisruptionEventsByTrip: vi.fn().mockResolvedValue([]),
  listTripReplanRecordsByTrip: vi.fn().mockResolvedValue([]),
  readTripOperationsLocalState: vi.fn(() => ({ dispositions: [], history: [], version: 2 })),
  writeTripOperationsLocalState: vi.fn((_tripId: string, state: unknown) => state),
  formatDateKey: vi.fn(() => '2026-04-01'),
  formatShortDate: vi.fn((date: string) => date === '2026-04-01' ? '4月1日' : date),
  loadTripRoutePreparation: vi.fn().mockResolvedValue(null),
  getPersistentRouteProvider: vi.fn(() => null),
  getRoutingConfig: vi.fn(() => ({})),
  markMapStartup: vi.fn(),
  resetMapStartupTrace: vi.fn(),
}))

const defaultTripData = {
  trip: {
    id: 'trip_1',
    title: '东京旅行',
    destination: '东京',
    startDate: '2026-04-01',
    endDate: '2026-04-03',
    createdAt: 100,
    updatedAt: 100,
  },
  days: [
    { id: 'day_1', tripId: 'trip_1', date: '2026-04-01', title: '第 1 天', sortOrder: 1, createdAt: 100, updatedAt: 100 },
    { id: 'day_2', tripId: 'trip_1', date: '2026-04-02', title: '第 2 天', sortOrder: 2, createdAt: 100, updatedAt: 100 },
  ],
  selectedDay: { id: 'day_1', tripId: 'trip_1', date: '2026-04-01', title: '第 1 天', sortOrder: 1, createdAt: 100, updatedAt: 100 },
  items: [
    { id: 'item_1', dayId: 'day_1', ticketIds: [], tripId: 'trip_1', title: '浅草寺', sortOrder: 1, createdAt: 100, updatedAt: 100 },
  ],
  itemsByDay: {
    day_1: [{ id: 'item_1', dayId: 'day_1', ticketIds: [], tripId: 'trip_1', title: '浅草寺', sortOrder: 1, createdAt: 100, updatedAt: 100 }],
  },
  allItems: [],
  isLoading: false,
  error: null,
  setItemsByDay: vi.fn(),
  refreshItems: vi.fn(),
  refresh: vi.fn(),
}

vi.mock('../lib/routes', () => ({
  getRouteParams: mocks.getRouteParams,
  navigateTo: mocks.navigateTo,
}))

vi.mock('../hooks/useTripData', () => ({
  useTripData: mocks.useTripData,
}))

vi.mock('../db', () => ({
  listTripDisruptionEventsByTrip: mocks.listTripDisruptionEventsByTrip,
  listItemsByDay: mocks.listItemsByDay,
  listTicketsByTrip: mocks.listTicketsByTrip,
  listTripReplanRecordsByTrip: mocks.listTripReplanRecordsByTrip,
  updateDay: vi.fn(),
}))

vi.mock('../lib/ai/aiTripContext', () => ({
  buildTripContext: mocks.buildTripContext,
}))

vi.mock('../lib/tripCheck', () => ({
  analyzeTripContext: mocks.analyzeTripContext,
}))

vi.mock('../lib/travelProfile', () => ({
  getStoredTravelProfile: mocks.getStoredTravelProfile,
}))

vi.mock('../lib/travelBrief', () => ({
  buildDayBrief: mocks.buildDayBrief,
}))

vi.mock('../lib/ai/tripDailyTravelTip', () => ({ buildTripDailyTravelTip: mocks.buildTripDailyTravelTip }))
vi.mock('../lib/tripReadiness', () => ({ buildTripReadinessModel: mocks.buildTripReadinessModel }))
vi.mock('../lib/tripOperationsAgent', () => ({ buildTripOperationsModel: mocks.buildTripOperationsModel }))
vi.mock('../lib/tripOperationsState', () => ({
  createEmptyTripOperationsLocalState: mocks.createEmptyTripOperationsLocalState,
  readTripOperationsLocalState: mocks.readTripOperationsLocalState,
  writeTripOperationsLocalState: mocks.writeTripOperationsLocalState,
}))
vi.mock('../lib/tripOperationsNavigation', () => ({ navigateToTripOperationsRecommendation: vi.fn() }))

vi.mock('../lib/dates', () => ({
  formatDateKey: mocks.formatDateKey,
  formatShortDate: mocks.formatShortDate,
}))

vi.mock('../lib/routePreparation', () => ({
  loadTripRoutePreparation: mocks.loadTripRoutePreparation,
  getPersistentRouteProvider: mocks.getPersistentRouteProvider,
}))

vi.mock('../lib/routeCache', () => ({
  ROUTE_CACHE_CHANGED_EVENT: 'route-cache-changed',
}))

vi.mock('../lib/routing', () => ({
  getRoutingConfig: mocks.getRoutingConfig,
  ROUTING_CONFIG_CHANGED_EVENT: 'routing-config-changed',
}))

vi.mock('../lib/mapConfig', () => ({
  DEFAULT_MAP_STYLE: 'https://example.com/style.json',
}))

vi.mock('../lib/mapStartupMetrics', () => ({
  markMapStartup: mocks.markMapStartup,
  resetMapStartupTrace: mocks.resetMapStartupTrace,
}))

vi.mock('../components/trip/TripLiveModeCard', () => ({
  TripLiveModeCard: (props: { localState?: unknown; onLocalStateChange?: unknown }) => (
    <div
      data-has-local-state={props.localState ? 'yes' : 'no'}
      data-has-local-state-handler={typeof props.onLocalStateChange === 'function' ? 'yes' : 'no'}
      data-testid="trip-live-mode-card"
    />
  ),
}))

vi.mock('../components/ai/DayBriefCard', () => ({
  DayBriefCard: () => <div data-testid="day-brief-card" />,
}))

vi.mock('../components/trip/DayTimelineView', () => ({
  DayTimelineView: () => <div data-testid="day-timeline-view" />,
}))

vi.mock('../components/trip/DaySelector', () => ({
  DaySelector: () => <div data-testid="day-selector" />,
}))

vi.stubGlobal('__APP_VERSION__', '0.0.0-test')

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.clearAllMocks()
  mocks.useTripData.mockReturnValue(defaultTripData)
  mocks.buildTripOperationsModel.mockReturnValue(tripOperationsModel())
  mocks.listTripDisruptionEventsByTrip.mockResolvedValue([])
  mocks.listTripReplanRecordsByTrip.mockResolvedValue([])
  mocks.readTripOperationsLocalState.mockReturnValue({ dispositions: [], history: [], version: 2 })
  mocks.writeTripOperationsLocalState.mockImplementation((_tripId: string, state: unknown) => state)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  container = null
  root = null
})

describe('DayViewPage', () => {
  it('renders loading skeleton when data is loading', async () => {
    mocks.useTripData.mockReturnValue({
      ...defaultTripData,
      isLoading: true,
      trip: null,
      days: [],
      selectedDay: undefined,
      items: [],
      itemsByDay: {},
      allItems: [],
    })

    await act(async () => {
      root?.render(<DayViewPage />)
    })

    expect(container?.querySelector('.animate-pulse')).toBeTruthy()
  })

  it('renders error state when trip fails to load', async () => {
    mocks.useTripData.mockReturnValue({
      ...defaultTripData,
      isLoading: false,
      trip: null,
      days: [],
      selectedDay: undefined,
      items: [],
      itemsByDay: {},
      allItems: [],
      error: '无法加载旅行数据',
    })

    await act(async () => {
      root?.render(<DayViewPage />)
    })

    expect(container?.textContent).toContain('无法打开每日行程')
    expect(container?.textContent).toContain('无法加载旅行数据')
  })

  it('renders empty state when trip exists but no day selected', async () => {
    mocks.useTripData.mockReturnValue({
      ...defaultTripData,
      isLoading: false,
      selectedDay: undefined,
      items: [],
      itemsByDay: {},
      allItems: [],
      error: null,
    })

    await act(async () => {
      root?.render(<DayViewPage />)
    })

    expect(container?.textContent).toContain('暂无每日行程')
  })

  it('renders day title and date in schedule view', async () => {
    await act(async () => {
      root?.render(<DayViewPage />)
    })

    expect(container?.textContent).toContain('第 1 天')
    expect(container?.textContent).toContain('4月1日')
  })

  it('renders day selector', async () => {
    await act(async () => {
      root?.render(<DayViewPage />)
    })

    expect(container?.querySelector('[data-testid="day-selector"]')).toBeTruthy()
  })

  it('renders timeline view in schedule mode', async () => {
    await act(async () => {
      root?.render(<DayViewPage />)
    })

    expect(container?.querySelector('[data-testid="day-timeline-view"]')).toBeTruthy()
  })

  it('renders live briefing card', async () => {
    await act(async () => {
      root?.render(<DayViewPage />)
    })

    const liveCard = container?.querySelector('[data-testid="trip-live-mode-card"]')
    expect(liveCard).toBeTruthy()
    expect(liveCard?.getAttribute('data-has-local-state')).toBe('yes')
    expect(liveCard?.getAttribute('data-has-local-state-handler')).toBe('yes')
  })

  it('does not render day intelligence card when there are no day suggestions', async () => {
    await act(async () => {
      root?.render(<DayViewPage />)
    })

    expect(container?.querySelector('[data-testid="day-intelligence-card"]')).toBeFalsy()
  })

  it('renders only current-day contextual suggestions', async () => {
    mocks.buildTripOperationsModel.mockReturnValue(tripOperationsModel([
      recommendation({ affectedDayIds: ['day_1'], id: 'today-route', title: '确认今天路线' }),
      recommendation({ affectedDayIds: ['day_2'], id: 'tomorrow-route', title: '确认明天路线' }),
    ]))

    await act(async () => {
      root?.render(<DayViewPage />)
    })

    const card = container?.querySelector('[data-testid="day-intelligence-card"]')
    expect(card).toBeTruthy()
    expect(card?.textContent).toContain('今天要处理')
    expect(card?.textContent).toContain('确认今天路线')
    expect(card?.textContent).not.toContain('确认明天路线')
    expect(container?.querySelectorAll('[data-testid="day-intelligence-suggestion"]')).toHaveLength(1)
    expect(mocks.buildTripOperationsModel).toHaveBeenCalledWith(expect.objectContaining({
      dispositions: [],
      tripDisruptionEvents: [],
      tripReplanRecords: [],
    }))
  })

  it('does not show day intelligence for unrelated future day suggestions', async () => {
    mocks.buildTripOperationsModel.mockReturnValue(tripOperationsModel([
      recommendation({ affectedDayIds: ['day_2'], id: 'tomorrow-route', title: '确认明天路线' }),
    ]))

    await act(async () => {
      root?.render(<DayViewPage />)
    })

    expect(container?.querySelector('[data-testid="day-intelligence-card"]')).toBeFalsy()
  })

  it('navigates to trip overview on back button click', async () => {
    await act(async () => {
      root?.render(<DayViewPage />)
    })

    const backButton = container?.querySelector('button[aria-label="总览"]')
    expect(backButton).toBeTruthy()

    await act(async () => {
      backButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mocks.navigateTo).toHaveBeenCalledWith('trip', { tripId: 'trip_1' })
  })

  it('opens more menu on button click', async () => {
    await act(async () => {
      root?.render(<DayViewPage />)
    })

    const moreButton = container?.querySelector('button[aria-label="更多操作"]')
    expect(moreButton).toBeTruthy()

    await act(async () => {
      moreButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    // BottomSheet uses createPortal, so content is in document.body
    expect(document.body.textContent).toContain('旅行总览')
    expect(document.body.textContent).toContain('票据库')
    expect(document.body.textContent).toContain('设置')
    expect(document.body.textContent).toContain('返回首页')
  })

  it('renders view switch buttons', async () => {
    await act(async () => {
      root?.render(<DayViewPage />)
    })

    expect(container?.querySelector('[data-testid="view-switch-map"]')).toBeTruthy()
    expect(container?.querySelector('[data-testid="view-switch-schedule"]')).toBeTruthy()
  })

  it('renders return to home button in error state', async () => {
    mocks.useTripData.mockReturnValue({
      ...defaultTripData,
      isLoading: false,
      trip: null,
      error: '网络错误',
    })

    await act(async () => {
      root?.render(<DayViewPage />)
    })

    const returnButton = Array.from(container?.querySelectorAll('button') ?? [])
      .find((node) => node.textContent?.includes('返回首页'))
    expect(returnButton).toBeTruthy()

    await act(async () => {
      returnButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mocks.navigateTo).toHaveBeenCalledWith('home')
  })

  it('renders return to trip overview button when no day selected', async () => {
    mocks.useTripData.mockReturnValue({
      ...defaultTripData,
      isLoading: false,
      selectedDay: undefined,
      items: [],
      itemsByDay: {},
      allItems: [],
    })

    await act(async () => {
      root?.render(<DayViewPage />)
    })

    const returnButton = Array.from(container?.querySelectorAll('button') ?? [])
      .find((node) => node.textContent?.includes('返回旅行总览'))
    expect(returnButton).toBeTruthy()

    await act(async () => {
      returnButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mocks.navigateTo).toHaveBeenCalledWith('trip', { tripId: 'trip_1' })
  })
})

function tripOperationsModel(activeRecommendations: TripOperationsRecommendation[] = []) {
  return {
    activeRecommendations,
    allRecommendations: activeRecommendations,
    batchableCount: 0,
    batchableRecommendations: [],
    hiddenRecommendations: [],
    phase: 'traveling',
    phaseLabel: '旅行中',
    recommendations: activeRecommendations.slice(0, 5),
    replanTimeline: [],
    summary: {
      highRiskCount: activeRecommendations.filter((recommendation: { severity: string }) => recommendation.severity === 'high').length,
      message: '',
      totalCount: activeRecommendations.length,
    },
  }
}

function recommendation(patch: Partial<TripOperationsRecommendation> = {}): TripOperationsRecommendation {
  return {
    actionKind: 'open_route_panel',
    actionLabel: '查看',
    affectedDayIds: [],
    affectedItemIds: [],
    canBatch: false,
    detail: '建议详情',
    evidence: [],
    executionMode: 'manual_navigation',
    fingerprint: `fingerprint-${patch.id ?? 'recommendation'}`,
    id: patch.id ?? 'recommendation',
    message: '建议消息',
    phaseWeight: 0,
    priority: 30,
    readinessIssueIds: [],
    requiresConfirm: false,
    requiresPreview: false,
    scopeKey: patch.id ?? 'recommendation',
    severity: 'medium',
    ticketIds: [],
    title: '建议',
    type: 'missing_route',
    ...patch,
  }
}
