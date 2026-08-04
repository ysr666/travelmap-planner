// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HomePage } from './HomePage'

const mocks = vi.hoisted(() => ({
  listTrips: vi.fn().mockResolvedValue([]),
  listDaysByTrip: vi.fn().mockResolvedValue([]),
  listItemsByTrip: vi.fn().mockResolvedValue([]),
  listTicketsByTrip: vi.fn().mockResolvedValue([]),
  createDemoTrip: vi.fn().mockResolvedValue({ id: 'demo_1' }),
  deleteTripCascade: vi.fn().mockResolvedValue(undefined),
  fetchDayRoute: vi.fn(),
  generateRoutePreview: vi.fn(),
  getPersistentRouteProvider: vi.fn(),
  getRoutingConfig: vi.fn(),
  loadRouteCache: vi.fn().mockResolvedValue(null),
  navigateTo: vi.fn(),
  subscribeTravelDataChanged: vi.fn(() => () => {}),
}))

vi.mock('../components/DayMap', () => ({
  DayMap: ({
    items,
    mapEngine,
    mapStyleUrl,
    markerLabel,
    onSelectItem,
    routeLineStrings,
  }: {
    items: Array<{ id: string; title: string }>
    mapEngine?: string
    mapStyleUrl?: string
    markerLabel?: string
    onSelectItem: (item: { id: string; title: string }) => void
    routeLineStrings?: number[][][]
  }) => (
    <div
      data-map-style={mapStyleUrl}
      data-map-engine={mapEngine}
      data-marker-label={markerLabel}
      data-route-segments={routeLineStrings?.length ?? 0}
      data-testid="today-map"
    >
      {items.map((item) => (
        <button key={item.id} onClick={() => onSelectItem(item)} type="button">
          {item.title}
        </button>
      ))}
    </div>
  ),
}))

vi.mock('../db', () => ({
  listTrips: mocks.listTrips,
  listDaysByTrip: mocks.listDaysByTrip,
  listItemsByTrip: mocks.listItemsByTrip,
  listTicketsByTrip: mocks.listTicketsByTrip,
  createDemoTrip: mocks.createDemoTrip,
  deleteTripCascade: mocks.deleteTripCascade,
}))

vi.mock('../lib/routes', () => ({
  navigateTo: mocks.navigateTo,
}))

vi.mock('../lib/dataEvents', () => ({
  subscribeTravelDataChanged: mocks.subscribeTravelDataChanged,
}))

vi.mock('../lib/routePreparation', () => ({
  getPersistentRouteProvider: mocks.getPersistentRouteProvider,
}))

vi.mock('../lib/routeGeneration', () => ({
  generateAndCacheDayRoutePreview: mocks.generateRoutePreview,
}))

vi.mock('../lib/routeCache', () => ({
  ROUTE_CACHE_CHANGED_EVENT: 'tripmap:route-cache-changed',
  buildCurrentRouteCacheIdentity: () => ({ signature: 'route-signature' }),
  loadRouteCache: mocks.loadRouteCache,
}))

vi.mock('../lib/routing', () => ({
  ROUTING_CONFIG_CHANGED_EVENT: 'tripmap:routing-config-changed',
  fetchDayRoute: mocks.fetchDayRoute,
  getItemLngLat: (item?: { lat?: number; lng?: number }) => (
    Number.isFinite(item?.lat) && Number.isFinite(item?.lng)
      ? [item?.lng, item?.lat]
      : null
  ),
  getRoutingConfig: mocks.getRoutingConfig,
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
  window.localStorage.clear()
  window.location.hash = '/home'
  mocks.listTrips.mockResolvedValue([])
  mocks.listDaysByTrip.mockResolvedValue([])
  mocks.listItemsByTrip.mockResolvedValue([])
  mocks.listTicketsByTrip.mockResolvedValue([])
  mocks.createDemoTrip.mockResolvedValue({ id: 'demo_1' })
  mocks.deleteTripCascade.mockResolvedValue(undefined)
  mocks.fetchDayRoute.mockResolvedValue({
    lineStrings: [],
    segments: [],
    status: 'straight',
  })
  mocks.generateRoutePreview.mockResolvedValue({
    lineStrings: [],
    status: 'failed',
  })
  mocks.getPersistentRouteProvider.mockReturnValue(null)
  mocks.getRoutingConfig.mockReturnValue({
    apiKey: null,
    configured: false,
    googleMapsKey: null,
    provider: 'none',
    source: 'none',
  })
  mocks.loadRouteCache.mockResolvedValue(null)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  vi.useRealTimers()
  container?.remove()
  container = null
  root = null
})

describe('HomePage', () => {
  it('renders loading state initially', async () => {
    mocks.listTrips.mockReturnValue(new Promise(() => {}))

    await act(async () => {
      root?.render(<HomePage />)
    })

    expect(container?.querySelector('[aria-label="正在加载今日行程"]')).toBeTruthy()
  })

  it('renders empty state when no trips exist', async () => {
    await act(async () => {
      root?.render(<HomePage />)
    })

    expect(container?.textContent).toContain('开始准备下一次旅行')
    expect(container?.textContent).toContain('导入旅行材料')
    expect(container?.textContent).toContain('用 AI 创建旅行')
    expect(container?.textContent).not.toContain('随身管家')
  })

  it('keeps import as the primary creation action in the empty state', async () => {
    await act(async () => {
      root?.render(<HomePage />)
    })

    const button = Array.from(container?.querySelectorAll('button') ?? [])
      .find((node) => node.textContent?.trim() === '导入旅行材料')
    expect(button).toBeTruthy()

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mocks.navigateTo).toHaveBeenCalledWith('inbox')
  })

  it('renders an action-first map workspace for an ongoing trip', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-01T09:00:00.000Z'))
    mocks.listTrips.mockResolvedValue([
      {
        id: 'trip_1',
        title: '东京旅行',
        destination: '东京',
        startDate: '2026-04-01',
        endDate: '2026-04-05',
        createdAt: 100,
        updatedAt: 100,
      },
    ])
    mocks.listDaysByTrip.mockResolvedValue([
      { id: 'day_1', tripId: 'trip_1', date: '2026-04-01', sortOrder: 0, createdAt: 100, updatedAt: 100 },
    ])
    mocks.listItemsByTrip.mockResolvedValue([])
    mocks.listTicketsByTrip.mockResolvedValue([])

    await act(async () => {
      root?.render(<HomePage />)
    })

    expect(container?.querySelector('[data-testid="home-primary-trip"]')).toBeTruthy()
    expect(container?.textContent).toContain('东京')
    expect(container?.textContent).toContain('添加行程点')
    expect(container?.textContent).not.toContain('日程1 天')
  })

  it('renders a compact pre-departure view and opens one-click repair through AI', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-04T08:00:00.000Z'))
    mocks.listTrips.mockResolvedValue([{
      id: 'trip_1',
      title: '英国12天家庭旅行',
      destination: '伦敦',
      startDate: '2026-08-12',
      endDate: '2026-08-23',
      createdAt: 1,
      updatedAt: 1,
    }])
    mocks.listDaysByTrip.mockResolvedValue([
      { id: 'day_1', tripId: 'trip_1', date: '2026-08-12', sortOrder: 0 },
    ])
    mocks.listItemsByTrip.mockResolvedValue([{
      id: 'item_1',
      tripId: 'trip_1',
      dayId: 'day_1',
      title: '抵达伦敦',
      ticketIds: [],
      sortOrder: 0,
    }])
    mocks.listTicketsByTrip.mockResolvedValue([{
      id: 'ticket_1',
      tripId: 'trip_1',
      title: '上海至伦敦机票',
      fileName: 'flight.pdf',
      fileType: 'pdf',
      mimeType: 'application/pdf',
      size: 100,
      storageMode: 'reference',
      ticketCategory: 'flight_ticket',
      createdAt: 1,
      updatedAt: 1,
    }])
    let command = ''
    const handler = (event: Event) => {
      command = (event as CustomEvent<{ command?: string }>).detail?.command ?? ''
    }
    window.addEventListener('tripmap:open-ai', handler)

    await act(async () => {
      root?.render(<HomePage />)
    })

    expect(container?.querySelector('[data-testid="today-upcoming"]')).toBeTruthy()
    expect(container?.textContent).toContain('还有 8 天')
    expect(container?.textContent).toContain('1 个地点待补全')
    expect(container?.textContent).toContain('上海至伦敦机票')

    await act(async () => {
      container?.querySelector<HTMLButtonElement>('[data-testid="home-smart-repair"]')?.click()
    })
    expect(command).toContain('缺失的地点')
    window.removeEventListener('tripmap:open-ai', handler)
  })

  it('selects the next real trip instead of the most recently edited completed trip', async () => {
    mocks.listTrips.mockResolvedValue([
      {
        id: 'completed_trip',
        title: '旧旅行',
        destination: '巴黎',
        startDate: '2000-01-01',
        endDate: '2000-01-05',
        createdAt: 1,
        updatedAt: 999,
      },
      {
        id: 'future_trip',
        title: '未来旅行',
        destination: '东京',
        startDate: '2099-04-01',
        endDate: '2099-04-05',
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    await act(async () => {
      root?.render(<HomePage />)
    })

    const primary = container?.querySelector('[data-testid="home-primary-trip"]')
    expect(primary?.textContent).toContain('东京')
    expect(container?.textContent).toContain('已完成')
    expect(container?.textContent).toContain('旧旅行')
  })

  it('keeps destructive trip actions off the Today surface', async () => {
    mocks.listTrips.mockResolvedValue([
      {
        id: 'future_trip',
        title: '未来旅行',
        destination: '东京',
        startDate: '2099-04-01',
        endDate: '2099-04-05',
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    await act(async () => {
      root?.render(<HomePage />)
    })
    expect(container?.querySelector('button[aria-label^="删除"]')).toBeNull()
  })

  it('shows the real next stop, linked ticket, and navigation action', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-30T09:47:20.000Z'))
    mocks.listTrips.mockResolvedValue([
      {
        id: 'trip_1',
        title: '英国旅行',
        destination: '爱丁堡',
        startDate: '2026-07-24',
        endDate: '2026-08-04',
        timeZone: 'Europe/London',
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    mocks.listDaysByTrip.mockResolvedValue([
      { id: 'day_1', tripId: 'trip_1', date: '2026-07-30', title: '爱丁堡', sortOrder: 0 },
    ])
    mocks.listItemsByTrip.mockResolvedValue([
      {
        id: 'item_1',
        tripId: 'trip_1',
        dayId: 'day_1',
        title: '爱丁堡城堡',
        startTime: '11:00',
        locationName: 'Edinburgh Castle',
        lat: 55.9486,
        lng: -3.1999,
        previousTransportDurationMinutes: 16,
        previousTransportMode: 'walk',
        previousTransportNote: '约 1.1 公里',
        ticketIds: ['ticket_1'],
        sortOrder: 0,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'item_2',
        tripId: 'trip_1',
        dayId: 'day_1',
        title: '皇家英里大道',
        startTime: '13:30',
        locationName: 'Royal Mile',
        lat: 55.9502,
        lng: -3.1883,
        previousTransportDurationMinutes: 18,
        previousTransportMode: 'walk',
        ticketIds: [],
        sortOrder: 1,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'item_3',
        tripId: 'trip_1',
        dayId: 'day_1',
        title: '荷里路德宫',
        startTime: '15:30',
        locationName: 'Palace of Holyroodhouse',
        lat: 55.9527,
        lng: -3.1723,
        previousTransportDurationMinutes: 22,
        previousTransportMode: 'walk',
        ticketIds: [],
        sortOrder: 2,
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    mocks.listTicketsByTrip.mockResolvedValue([
      {
        id: 'ticket_1',
        tripId: 'trip_1',
        itemId: 'item_1',
        title: '城堡门票',
        fileName: 'castle.pdf',
        fileType: 'pdf',
        mimeType: 'application/pdf',
        note: '11:00 入场 · 已就绪',
        size: 100,
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    await act(async () => {
      root?.render(<HomePage />)
    })

    expect(container?.querySelector('[data-testid="today-map"]')?.getAttribute('data-marker-label')).toBe('details')
    expect(container?.querySelector('[data-testid="today-map"]')?.getAttribute('data-map-engine')).toBe('auto')
    expect(container?.querySelector('[data-testid="today-map"]')?.getAttribute('data-map-style')).toBe('https://tiles.openfreemap.org/styles/positron')
    expect(container?.textContent).toContain('爱丁堡城堡')
    expect(container?.textContent).toContain('城堡门票')
    expect(container?.textContent).toContain('12:40')
    expect(container?.textContent).toContain('步行 · 16 分钟 (约 1.1 公里)')
    expect(container?.textContent).toContain('Royal Mile')
    expect(container?.textContent).toContain('Palace of Holyroodhouse')
    expect(container?.querySelector('.today-ticket-action')?.textContent).toBe('打开门票')
    expect(container?.querySelector('a[href*="google.com/maps"]')?.textContent).toContain('开始导航')
    expect(container?.querySelector('.today-transport')).toBeTruthy()
  })

  it('shows an exact cached road route on Today instead of replacing it with straight segments', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2099-07-30T09:00:00.000Z'))
    mocks.listTrips.mockResolvedValue([
      {
        id: 'trip_1',
        title: '英国旅行',
        destination: '爱丁堡',
        startDate: '2099-07-30',
        endDate: '2099-08-02',
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    mocks.listDaysByTrip.mockResolvedValue([
      { id: 'day_1', tripId: 'trip_1', date: '2099-07-30', sortOrder: 0 },
    ])
    mocks.listItemsByTrip.mockResolvedValue([
      { id: 'item_1', tripId: 'trip_1', dayId: 'day_1', title: '城堡', lat: 55.94, lng: -3.2, ticketIds: [], sortOrder: 0 },
      { id: 'item_2', tripId: 'trip_1', dayId: 'day_1', title: '王宫', lat: 55.95, lng: -3.18, ticketIds: [], sortOrder: 1 },
    ])
    mocks.loadRouteCache.mockResolvedValue({
      lineStrings: [[[-3.2, 55.94], [-3.19, 55.945], [-3.18, 55.95]]],
    })

    await act(async () => {
      root?.render(<HomePage />)
    })

    expect(mocks.loadRouteCache).toHaveBeenCalledWith('route-signature')
    expect(container?.querySelector('[data-testid="today-map"]')?.getAttribute('data-route-segments')).toBe('1')
  })

  it('generates and caches a real provider route when Today has no exact route cache', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2099-07-30T09:00:00.000Z'))
    const day = { id: 'day_1', tripId: 'trip_1', date: '2099-07-30', sortOrder: 0 }
    const items = [
      { id: 'item_1', tripId: 'trip_1', dayId: 'day_1', title: '城堡', lat: 55.94, lng: -3.2, previousTransportMode: 'walk', ticketIds: [], sortOrder: 0 },
      { id: 'item_2', tripId: 'trip_1', dayId: 'day_1', title: '王宫', lat: 55.95, lng: -3.18, previousTransportMode: 'walk', ticketIds: [], sortOrder: 1 },
    ]
    const routingConfig = {
      apiKey: null,
      configured: true,
      googleMapsKey: null,
      provider: 'openrouteservice',
      routeProxyUrl: '/api/provider-proxy',
      source: 'proxy',
    }
    const realRoute = [[[-3.2, 55.94], [-3.195, 55.945], [-3.18, 55.95]]]
    mocks.listTrips.mockResolvedValue([
      {
        id: 'trip_1',
        title: '英国旅行',
        destination: '爱丁堡',
        startDate: '2099-07-30',
        endDate: '2099-08-02',
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    mocks.listDaysByTrip.mockResolvedValue([day])
    mocks.listItemsByTrip.mockResolvedValue(items)
    mocks.getRoutingConfig.mockReturnValue(routingConfig)
    mocks.getPersistentRouteProvider.mockReturnValue('openrouteservice')
    mocks.generateRoutePreview.mockResolvedValue({
      day,
      lineStrings: realRoute,
      message: '路线预览已生成。',
      provider: 'openrouteservice',
      saved: true,
      status: 'generated',
      warnings: [],
    })

    await act(async () => {
      root?.render(<HomePage />)
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.generateRoutePreview).toHaveBeenCalledTimes(1)
    expect(mocks.generateRoutePreview).toHaveBeenCalledWith(expect.objectContaining({
      config: routingConfig,
      day,
      forceRefresh: true,
      items,
      tripId: 'trip_1',
    }))
    expect(container?.querySelector('[data-testid="today-map"]')?.getAttribute('data-route-segments')).toBe('1')
  })

  it('renders the active workspace without an obsolete draggable sheet control', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2099-07-30T09:00:00.000Z'))
    mocks.listTrips.mockResolvedValue([
      {
        id: 'trip_1',
        title: '英国旅行',
        destination: '伦敦',
        startDate: '2099-07-30',
        endDate: '2099-08-02',
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    mocks.listDaysByTrip.mockResolvedValue([
      { id: 'day_1', tripId: 'trip_1', date: '2099-07-30', sortOrder: 0 },
    ])

    await act(async () => {
      root?.render(<HomePage />)
    })

    const workspace = container?.querySelector('.today-workspace')
    expect(workspace).toBeTruthy()
    expect(container?.querySelector('[data-testid="today-trip-sheet"]')).toBeTruthy()
    expect(container?.querySelector('[data-testid="today-sheet-handle"]')).toBeNull()
    expect(workspace?.hasAttribute('data-sheet-state')).toBe(false)
  })

  it('does not offer live navigation for a completed trip', async () => {
    mocks.listTrips.mockResolvedValue([
      {
        id: 'trip_1',
        title: '旧旅行',
        destination: '伦敦',
        startDate: '2000-07-30',
        endDate: '2000-08-02',
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    mocks.listDaysByTrip.mockResolvedValue([
      { id: 'day_1', tripId: 'trip_1', date: '2000-07-30', sortOrder: 0 },
    ])
    mocks.listItemsByTrip.mockResolvedValue([
      {
        id: 'item_1',
        tripId: 'trip_1',
        dayId: 'day_1',
        title: '伦敦塔桥',
        startTime: '10:00',
        locationName: 'Tower Bridge',
        ticketIds: [],
        sortOrder: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    await act(async () => {
      root?.render(<HomePage />)
    })

    expect(container?.textContent).toContain('行程回顾')
    expect(container?.textContent).not.toContain('开始导航')
    expect(container?.querySelector('a[href*="google.com/maps"]')).toBeNull()

    const openTrip = Array.from(container?.querySelectorAll('button') ?? [])
      .find((node) => node.textContent?.includes('行程回顾'))
    await act(async () => {
      openTrip?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(mocks.navigateTo).toHaveBeenCalledWith('trip', { tripId: 'trip_1' })
  })

  it('renders error state on load failure', async () => {
    mocks.listTrips.mockRejectedValue(new Error('db error'))

    await act(async () => {
      root?.render(<HomePage />)
    })

    expect(container?.textContent).toBeTruthy()
  })
})
