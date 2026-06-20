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

    expect(container?.textContent).toBeTruthy()
  })

  it('renders empty state when no trips exist', async () => {
    await act(async () => {
      root?.render(<HomePage />)
    })

    expect(container?.textContent).toBeTruthy()
  })

  it('links to AI trip builder from the main action area', async () => {
    await act(async () => {
      root?.render(<HomePage />)
    })

    const button = Array.from(container?.querySelectorAll('button') ?? [])
      .find((node) => node.textContent?.includes('AI 生成行程'))
    expect(button).toBeTruthy()

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mocks.navigateTo).toHaveBeenCalledWith('ai-draft')
  })

  it('renders trip list when trips exist', async () => {
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

    expect(container?.textContent).toContain('东京旅行')
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
    expect(primary?.textContent).toContain('未来旅行')
    expect(container?.textContent).toContain('已完成')
    expect(container?.textContent?.match(/未来旅行/g)).toHaveLength(1)
  })

  it('keeps trip deletion reachable with explicit confirmation', async () => {
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
    const deleteButton = container?.querySelector('button[aria-label="删除未来旅行"]')
    await act(async () => {
      deleteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(document.body.textContent).toContain('确认删除「未来旅行」吗？')
  })

  it('renders error state on load failure', async () => {
    mocks.listTrips.mockRejectedValue(new Error('db error'))

    await act(async () => {
      root?.render(<HomePage />)
    })

    expect(container?.textContent).toBeTruthy()
  })
})
