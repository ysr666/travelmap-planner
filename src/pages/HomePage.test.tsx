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
  navigateTo: vi.fn(),
  subscribeTravelDataChanged: vi.fn(() => () => {}),
}))

vi.mock('../components/DayMap', () => ({
  DayMap: ({
    items,
    markerLabel,
    onSelectItem,
  }: {
    items: Array<{ id: string; title: string }>
    markerLabel?: string
    onSelectItem: (item: { id: string; title: string }) => void
  }) => (
    <div data-marker-label={markerLabel} data-testid="today-map">
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
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
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

    expect(container?.textContent).toContain('还没有旅行')
    expect(container?.textContent).toContain('新建旅行')
    expect(container?.textContent).not.toContain('随身管家')
  })

  it('keeps one primary creation action in the empty state', async () => {
    await act(async () => {
      root?.render(<HomePage />)
    })

    const button = Array.from(container?.querySelectorAll('button') ?? [])
      .find((node) => node.textContent?.trim() === '新建旅行')
    expect(button).toBeTruthy()

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mocks.navigateTo).toHaveBeenCalledWith('trip/new')
  })

  it('renders a map-first day workspace when a trip exists', async () => {
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
      { id: 'day_1', tripId: 'trip_1', date: '2099-07-30', title: '爱丁堡', sortOrder: 0 },
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
        ticketIds: ['ticket_1'],
        sortOrder: 0,
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
        size: 100,
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    await act(async () => {
      root?.render(<HomePage />)
    })

    expect(container?.querySelector('[data-testid="today-map"]')?.getAttribute('data-marker-label')).toBe('sequence')
    expect(container?.textContent).toContain('爱丁堡城堡')
    expect(container?.textContent).toContain('城堡门票')
    expect(container?.querySelector('a[href*="google.com/maps"]')?.textContent).toContain('开始导航')
  })

  it('renders error state on load failure', async () => {
    mocks.listTrips.mockRejectedValue(new Error('db error'))

    await act(async () => {
      root?.render(<HomePage />)
    })

    expect(container?.textContent).toBeTruthy()
  })
})
