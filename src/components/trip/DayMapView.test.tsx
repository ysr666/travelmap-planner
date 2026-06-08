// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DayMapView } from './DayMapView'

const mocks = vi.hoisted(() => ({
  hasValidCoordinates: vi.fn(() => true),
  describeItemTime: vi.fn(() => '10:00'),
  formatDate: vi.fn(() => '4月1日'),
  getRoutingConfig: vi.fn(() => ({})),
  getPersistentRouteProvider: vi.fn(() => null),
  loadRouteCache: vi.fn().mockResolvedValue(null),
  pruneStaleRouteCachesForDay: vi.fn(),
  buildCurrentRouteCacheIdentity: vi.fn(() => ({ signature: 'test-signature' })),
  buildDayPrewarmQueue: vi.fn(() => []),
  shouldSkipMapPrewarm: vi.fn(() => true),
  markMapStartup: vi.fn(),
  normalizeEdgeInsets: vi.fn((v: unknown) => v),
  DEFAULT_DAY_MAP_PADDING: { top: 72, right: 72, bottom: 72, left: 72 },
  ROUTE_CACHE_CHANGED_EVENT: 'route-cache-changed',
  ROUTING_CONFIG_CHANGED_EVENT: 'routing-config-changed',
}))

vi.mock('../../lib/mapLinks', () => ({
  hasValidCoordinates: mocks.hasValidCoordinates,
}))

vi.mock('../../lib/itinerary', () => ({
  describeItemTime: mocks.describeItemTime,
}))

vi.mock('../../lib/dates', () => ({
  formatDate: mocks.formatDate,
}))

vi.mock('../../lib/routing', () => ({
  getRoutingConfig: mocks.getRoutingConfig,
  ROUTING_CONFIG_CHANGED_EVENT: mocks.ROUTING_CONFIG_CHANGED_EVENT,
}))

vi.mock('../../lib/routePreparation', () => ({
  getPersistentRouteProvider: mocks.getPersistentRouteProvider,
}))

vi.mock('../../lib/routeCache', () => ({
  ROUTE_CACHE_CHANGED_EVENT: mocks.ROUTE_CACHE_CHANGED_EVENT,
  buildCurrentRouteCacheIdentity: mocks.buildCurrentRouteCacheIdentity,
  loadRouteCache: mocks.loadRouteCache,
  pruneStaleRouteCachesForDay: mocks.pruneStaleRouteCachesForDay,
}))

vi.mock('../../lib/mapPrewarm', () => ({
  buildDayPrewarmQueue: mocks.buildDayPrewarmQueue,
  shouldSkipMapPrewarm: mocks.shouldSkipMapPrewarm,
}))

vi.mock('../../lib/mapStartupMetrics', () => ({
  markMapStartup: mocks.markMapStartup,
}))

vi.mock('../../lib/dayMapViewport', () => ({
  DEFAULT_DAY_MAP_PADDING: mocks.DEFAULT_DAY_MAP_PADDING,
  normalizeEdgeInsets: mocks.normalizeEdgeInsets,
}))

vi.mock('../DayMap', () => ({
  DayMap: ({ onMarkerSelect }: { onMarkerSelect?: (item: unknown) => void }) => (
    <div data-testid="day-map">
      <button
        data-testid="mock-marker"
        onClick={() => onMarkerSelect?.({ id: 'item_1', title: '浅草寺' })}
        type="button"
      >
        Marker
      </button>
    </div>
  ),
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

const defaultDay = {
  id: 'day_1',
  tripId: 'trip_1',
  date: '2026-04-01',
  title: '第 1 天',
  sortOrder: 1,
  createdAt: 100,
  updatedAt: 100,
}

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  Element.prototype.scrollIntoView = vi.fn()
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
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

describe('DayMapView', () => {
  it('renders without crashing', async () => {
    await act(async () => {
      root?.render(
        <DayMapView
          day={defaultDay}
          items={[]}
          onOpenItem={vi.fn()}
          trip={defaultTrip}
        />,
      )
    })

    expect(container?.textContent).toBeTruthy()
  })

  it('renders with items', async () => {
    const items = [
      { id: 'item_1', dayId: 'day_1', tripId: 'trip_1', title: '浅草寺', lat: 35.7148, lng: 139.7967, sortOrder: 1, createdAt: 100, updatedAt: 100 },
      { id: 'item_2', dayId: 'day_1', tripId: 'trip_1', title: '东京塔', lat: 35.6586, lng: 139.7454, sortOrder: 2, createdAt: 100, updatedAt: 100 },
    ]

    await act(async () => {
      root?.render(
        <DayMapView
          day={defaultDay}
          items={items}
          onOpenItem={vi.fn()}
          trip={defaultTrip}
        />,
      )
    })

    expect(container?.textContent).toBeTruthy()
  })

  it('renders embedded mode', async () => {
    await act(async () => {
      root?.render(
        <DayMapView
          day={defaultDay}
          embedded
          items={[]}
          onOpenItem={vi.fn()}
          trip={defaultTrip}
        />,
      )
    })

    expect(container?.textContent).toBeTruthy()
  })

  it('renders with allDays', async () => {
    const allDays = [
      defaultDay,
      { id: 'day_2', tripId: 'trip_1', date: '2026-04-02', title: '第 2 天', sortOrder: 2, createdAt: 100, updatedAt: 100 },
    ]

    await act(async () => {
      root?.render(
        <DayMapView
          allDays={allDays}
          day={defaultDay}
          items={[]}
          onOpenItem={vi.fn()}
          trip={defaultTrip}
        />,
      )
    })

    expect(container?.textContent).toBeTruthy()
  })

  it('renders with empty items', async () => {
    await act(async () => {
      root?.render(
        <DayMapView
          day={defaultDay}
          items={[]}
          onOpenItem={vi.fn()}
          trip={defaultTrip}
        />,
      )
    })

    expect(container?.textContent).toBeTruthy()
  })

  it('renders with minimalOverlay', async () => {
    await act(async () => {
      root?.render(
        <DayMapView
          day={defaultDay}
          items={[]}
          minimalOverlay
          onOpenItem={vi.fn()}
          trip={defaultTrip}
        />,
      )
    })

    expect(container?.textContent).toBeTruthy()
  })
})
