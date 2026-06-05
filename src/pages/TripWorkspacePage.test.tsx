// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TripWorkspacePage } from './TripWorkspacePage'

const mocks = vi.hoisted(() => ({
  getRouteParams: vi.fn(() => new URLSearchParams({ tripId: 'trip_1' })),
  navigateTo: vi.fn(),
  listItemsByDay: vi.fn().mockResolvedValue([]),
  listTicketsByTrip: vi.fn().mockResolvedValue([]),
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
  listItemsByDay: mocks.listItemsByDay,
  listTicketsByTrip: mocks.listTicketsByTrip,
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
    await act(async () => {
      root?.render(<TripWorkspacePage />)
    })

    expect(container?.textContent).toContain('东京旅行')
  })

  it('renders day information', async () => {
    await act(async () => {
      root?.render(<TripWorkspacePage />)
    })

    expect(container?.textContent).toBeTruthy()
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

    await act(async () => {
      root?.render(<TripWorkspacePage />)
    })

    expect(container?.textContent).toBeTruthy()
  })
})
