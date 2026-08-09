// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoutingConfig } from '../../lib/routing'
import { DayMapView } from './DayMapView'

const mocks = vi.hoisted(() => ({
  hasValidCoordinates: vi.fn(() => true),
  buildGoogleMapsNavigationUrl: vi.fn(() => 'https://www.google.com/maps/dir/?api=1&destination=35.0%2C139.0'),
  describeItemTime: vi.fn(() => '10:00'),
  formatDate: vi.fn(() => '4月1日'),
  getRoutingConfig: vi.fn<() => RoutingConfig>(() => ({
    apiKey: null,
    configured: false,
    googleMapsKey: null,
    provider: 'none' as const,
    source: 'none' as const,
  })),
  getPersistentRouteProvider: vi.fn<(config: RoutingConfig) => 'google' | 'openrouteservice' | null>(() => null),
  listRouteCachesForDay: vi.fn().mockResolvedValue([]),
  loadRouteCache: vi.fn().mockResolvedValue(null),
  generateAndCacheDayRoutePreview: vi.fn(),
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
  buildGoogleMapsNavigationUrl: mocks.buildGoogleMapsNavigationUrl,
}))

vi.mock('../../lib/itinerary', () => ({
  describeItemTime: mocks.describeItemTime,
  sortItineraryItemsByPlanOrder: (items: Array<{ sortOrder: number }>) => [...items].sort((first, second) => first.sortOrder - second.sortOrder),
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
  listRouteCachesForDay: mocks.listRouteCachesForDay,
  loadRouteCache: mocks.loadRouteCache,
}))

vi.mock('../../lib/routeGeneration', () => ({
  generateAndCacheDayRoutePreview: mocks.generateAndCacheDayRoutePreview,
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

vi.mock('../DayMap', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  return {
    DayMap: ({
      activeRouteLineKind,
      activeRouteLineStrings,
      connectUserLocationToFirst,
      items,
      onBaseLoadingChange,
      onMapReady,
      onSelectItem,
      routeLineKind,
      routeLineStrings,
    }: {
      activeRouteLineKind?: string
      activeRouteLineStrings?: unknown[][]
      connectUserLocationToFirst?: boolean
      items: unknown[]
      onBaseLoadingChange?: (loading: boolean) => void
      onMapReady?: () => void
      onSelectItem?: (item: unknown) => void
      routeLineKind?: string
      routeLineStrings?: unknown[][]
    }) => {
      const didNotifyReadyRef = React.useRef(false)
      React.useEffect(() => {
        if (didNotifyReadyRef.current) {
          return
        }
        didNotifyReadyRef.current = true
        onBaseLoadingChange?.(false)
        onMapReady?.()
      }, [onBaseLoadingChange, onMapReady])

      return (
        <div
          data-active-route-kind={activeRouteLineKind}
          data-active-route-segments={activeRouteLineStrings?.length ?? 0}
          data-connect-user-location={connectUserLocationToFirst ? 'true' : 'false'}
          data-route-kind={routeLineKind}
          data-route-segments={routeLineStrings?.length ?? 0}
          data-testid="day-map"
        >
          <button
            data-testid="mock-marker"
            onClick={() => onSelectItem?.(items[0])}
            type="button"
          >
            Marker
          </button>
        </div>
      )
    },
  }
})

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
  mocks.generateAndCacheDayRoutePreview.mockReset()
  mocks.getPersistentRouteProvider.mockReturnValue(null)
  mocks.getRoutingConfig.mockReturnValue({
    apiKey: null,
    configured: false,
    googleMapsKey: null,
    provider: 'none',
    source: 'none',
  })
  mocks.listRouteCachesForDay.mockResolvedValue([])
  mocks.loadRouteCache.mockResolvedValue(null)
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
      { id: 'item_1', dayId: 'day_1', tripId: 'trip_1', title: '浅草寺', lat: 35.7148, lng: 139.7967, ticketIds: [], sortOrder: 1, createdAt: 100, updatedAt: 100 },
      { id: 'item_2', dayId: 'day_1', tripId: 'trip_1', title: '东京塔', lat: 35.6586, lng: 139.7454, ticketIds: [], sortOrder: 2, createdAt: 100, updatedAt: 100 },
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

  it('opens marker card from marker selection and moves to next place', async () => {
    const onOpenTickets = vi.fn()
    const items = [
      {
        id: 'item_1',
        dayId: 'day_1',
        tripId: 'trip_1',
        title: '浅草寺',
        locationName: '台东区',
        lat: 35.7148,
        lng: 139.7967,
        ticketIds: [],
        sortOrder: 1,
        createdAt: 100,
        updatedAt: 100,
      },
      {
        id: 'item_2',
        dayId: 'day_1',
        tripId: 'trip_1',
        title: '东京塔',
        locationName: '芝公园',
        lat: 35.6586,
        lng: 139.7454,
        ticketIds: ['ticket_1'],
        sortOrder: 2,
        createdAt: 100,
        updatedAt: 100,
      },
    ]

    await act(async () => {
      root?.render(
        <DayMapView
          day={defaultDay}
          items={items}
          onOpenItem={vi.fn()}
          onOpenTickets={onOpenTickets}
          trip={defaultTrip}
        />,
      )
    })

    expect(container?.textContent).toContain('浅草寺')
    expect(container?.textContent).toContain('第 1/2 站')

    await act(async () => {
      container?.querySelector<HTMLButtonElement>('[data-testid="mock-marker"]')?.click()
    })

    expect(container?.textContent).toContain('浅草寺')

    await act(async () => {
      container?.querySelector<HTMLButtonElement>('[data-testid="map-marker-card-next"]')?.click()
    })

    expect(container?.textContent).toContain('东京塔')
    expect(container?.textContent).toContain('1 张票据')

    await act(async () => {
      container?.querySelector<HTMLButtonElement>('[data-testid="map-marker-card-tickets"]')?.click()
    })
    expect(onOpenTickets).toHaveBeenCalledWith(items[1])
  })

  it('labels missing geometry as an estimate and connects only a nearby user location', async () => {
    const items = [
      { id: 'item_1', dayId: 'day_1', tripId: 'trip_1', title: '浅草寺', lat: 35.7148, lng: 139.7967, ticketIds: [], sortOrder: 1, createdAt: 100, updatedAt: 100 },
      { id: 'item_2', dayId: 'day_1', tripId: 'trip_1', title: '东京塔', lat: 35.6586, lng: 139.7454, ticketIds: [], sortOrder: 2, createdAt: 100, updatedAt: 100 },
    ]

    await act(async () => {
      root?.render(
        <DayMapView day={defaultDay} items={items} onOpenItem={vi.fn()} trip={defaultTrip} />,
      )
    })

    expect(container?.querySelector('[data-testid="map-route-status"]')?.textContent).toContain('路线为估算')
    expect(container?.querySelector('[data-testid="day-map"]')?.getAttribute('data-route-kind')).toBe('sequence')
    expect(container?.querySelector('[data-testid="day-map"]')?.getAttribute('data-active-route-kind')).toBe('estimate')
    expect(container?.querySelector('[data-testid="day-map"]')?.getAttribute('data-connect-user-location')).toBe('true')
  })

  it('recalculates road geometry only after the user presses the route status', async () => {
    const items = [
      { id: 'item_1', dayId: 'day_1', tripId: 'trip_1', title: '浅草寺', lat: 35.7148, lng: 139.7967, ticketIds: [], sortOrder: 1, createdAt: 100, updatedAt: 100 },
      { id: 'item_2', dayId: 'day_1', tripId: 'trip_1', title: '东京塔', lat: 35.6586, lng: 139.7454, previousTransportMode: 'walk' as const, ticketIds: [], sortOrder: 2, createdAt: 100, updatedAt: 100 },
    ]
    const configured: RoutingConfig = {
      apiKey: null,
      configured: true,
      googleMapsKey: null,
      provider: 'openrouteservice',
      routeProxyUrl: '/api/provider-proxy',
      source: 'proxy',
    }
    mocks.getRoutingConfig.mockReturnValue(configured)
    mocks.getPersistentRouteProvider.mockReturnValue('openrouteservice')
    mocks.generateAndCacheDayRoutePreview.mockResolvedValue({
      cacheEntry: undefined,
      day: defaultDay,
      lineStrings: [[[139.7967, 35.7148], [139.77, 35.69], [139.7454, 35.6586]]],
      message: '路线预览已生成。',
      provider: 'openrouteservice',
      result: {
        cacheKey: 'runtime',
        lineStrings: [[[139.7967, 35.7148], [139.77, 35.69], [139.7454, 35.6586]]],
        provider: 'openrouteservice',
        segments: [{
          coordinates: [[139.7967, 35.7148], [139.77, 35.69], [139.7454, 35.6586]],
          distanceMeters: 8200,
          durationSeconds: 1500,
          fromItemId: 'item_1',
          kind: 'road',
          provider: 'openrouteservice',
          segmentIndex: 0,
          toItemId: 'item_2',
        }],
        status: 'road',
        warnings: [],
      },
      saved: false,
      status: 'generated',
      warnings: [],
    })

    await act(async () => {
      root?.render(
        <DayMapView day={defaultDay} items={items} onOpenItem={vi.fn()} trip={defaultTrip} />,
      )
    })
    expect(mocks.generateAndCacheDayRoutePreview).not.toHaveBeenCalled()

    await act(async () => {
      container?.querySelector<HTMLButtonElement>('[data-testid="map-route-status"]')?.click()
      await Promise.resolve()
    })

    expect(mocks.generateAndCacheDayRoutePreview).toHaveBeenCalledTimes(1)
    expect(container?.querySelector('[data-testid="map-route-status"]')?.textContent).toContain('道路路线')
    expect(container?.querySelector('[data-testid="day-map"]')?.getAttribute('data-route-kind')).toBe('road')
    expect(container?.querySelector('[data-testid="day-map"]')?.getAttribute('data-active-route-kind')).toBe('walk')
  })

  it('keeps valid cached road geometry when an explicit refresh fails', async () => {
    const items = [
      { id: 'item_1', dayId: 'day_1', tripId: 'trip_1', title: '浅草寺', lat: 35.7148, lng: 139.7967, ticketIds: [], sortOrder: 1, createdAt: 100, updatedAt: 100 },
      { id: 'item_2', dayId: 'day_1', tripId: 'trip_1', title: '东京塔', lat: 35.6586, lng: 139.7454, previousTransportMode: 'walk' as const, ticketIds: [], sortOrder: 2, createdAt: 100, updatedAt: 100 },
    ]
    const configured: RoutingConfig = {
      apiKey: null,
      configured: true,
      googleMapsKey: null,
      provider: 'openrouteservice',
      routeProxyUrl: '/api/provider-proxy',
      source: 'proxy',
    }
    const cacheEntry = {
      coordinateKey: 'coords',
      createdAt: '2026-04-01T00:00:00.000Z',
      dayId: defaultDay.id,
      id: 'test-signature',
      lastUsedAt: '2026-04-01T00:00:00.000Z',
      lineStrings: [[[139.7967, 35.7148], [139.77, 35.69], [139.7454, 35.6586]]] as Array<Array<[number, number]>>,
      modeKey: 'mode',
      provider: 'openrouteservice' as const,
      routingVersion: 1 as const,
      signature: 'test-signature',
      sizeBytes: 100,
      status: 'road' as const,
      tripId: defaultTrip.id,
      updatedAt: '2026-04-01T00:00:00.000Z',
      warnings: [],
    }
    mocks.getRoutingConfig.mockReturnValue(configured)
    mocks.getPersistentRouteProvider.mockReturnValue('openrouteservice')
    mocks.listRouteCachesForDay.mockResolvedValue([cacheEntry])
    mocks.loadRouteCache.mockResolvedValue(cacheEntry)
    mocks.generateAndCacheDayRoutePreview.mockRejectedValue(new Error('fixture failure'))

    await act(async () => {
      root?.render(<DayMapView day={defaultDay} items={items} onOpenItem={vi.fn()} trip={defaultTrip} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(container?.querySelector('[data-testid="day-map"]')?.getAttribute('data-route-kind')).toBe('road')

    await act(async () => {
      container?.querySelector<HTMLButtonElement>('[data-testid="map-route-status"]')?.click()
      await Promise.resolve()
    })

    expect(container?.querySelector('[data-testid="map-route-status"]')?.textContent).toContain('道路路线（刷新失败）')
    expect(container?.querySelector('[data-testid="day-map"]')?.getAttribute('data-route-kind')).toBe('road')
  })
})
