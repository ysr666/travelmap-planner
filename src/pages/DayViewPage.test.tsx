// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DayViewPage } from './DayViewPage'

const mocks = vi.hoisted(() => ({
  getRouteParams: vi.fn(() => new URLSearchParams({ tripId: 'trip_1', dayId: 'day_1', view: 'schedule' })),
  navigateTo: vi.fn(),
  useTripData: vi.fn(),
  listItemsByDay: vi.fn().mockResolvedValue([]),
  buildTripContext: vi.fn(() => ({})),
  analyzeTripContext: vi.fn(() => ({
    evidence: [],
    suggestions: [],
    summary: { criticalCount: 0, message: 'ok', severity: 'info', suggestionCount: 0, title: 'ok', warningCount: 0 },
    warnings: [],
  })),
  getStoredTravelProfile: vi.fn(() => null),
  buildDayBrief: vi.fn(() => null),
  formatDateKey: vi.fn(() => '2026-04-01'),
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
    { id: 'item_1', dayId: 'day_1', tripId: 'trip_1', title: '浅草寺', sortOrder: 1, createdAt: 100, updatedAt: 100 },
  ],
  itemsByDay: {
    day_1: [{ id: 'item_1', dayId: 'day_1', tripId: 'trip_1', title: '浅草寺', sortOrder: 1, createdAt: 100, updatedAt: 100 }],
  },
  allItems: [],
  isLoading: false,
  error: null,
  setItemsByDay: vi.fn(),
  refreshItems: vi.fn(),
}

vi.mock('../lib/routes', () => ({
  getRouteParams: mocks.getRouteParams,
  navigateTo: mocks.navigateTo,
}))

vi.mock('../hooks/useTripData', () => ({
  useTripData: mocks.useTripData,
}))

vi.mock('../db', () => ({
  listItemsByDay: mocks.listItemsByDay,
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

vi.mock('../lib/dates', () => ({
  formatDateKey: mocks.formatDateKey,
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

vi.mock('../components/trip/DayLiveBriefingCard', () => ({
  DayLiveBriefingCard: () => <div data-testid="day-live-briefing-card" />,
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

    expect(container?.querySelector('[data-testid="day-live-briefing-card"]')).toBeTruthy()
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
