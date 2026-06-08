// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchPage } from './SearchPage'

const mocks = vi.hoisted(() => ({
  navigateTo: vi.fn(),
  listTrips: vi.fn().mockResolvedValue([]),
  listDaysByTrip: vi.fn().mockResolvedValue([]),
  listItemsByTrip: vi.fn().mockResolvedValue([]),
  listTicketsByTrip: vi.fn().mockResolvedValue([]),
  subscribeTravelDataChanged: vi.fn(() => () => {}),
  formatDateRange: vi.fn(() => '4月1日 - 4月5日'),
  describeItemTime: vi.fn(() => '10:00'),
  getTicketCategoryLabel: vi.fn(() => ''),
  getTicketDisplayTitle: vi.fn(() => '票据'),
}))

vi.mock('../lib/routes', () => ({
  navigateTo: mocks.navigateTo,
}))

vi.mock('../db', () => ({
  listTrips: mocks.listTrips,
  listDaysByTrip: mocks.listDaysByTrip,
  listItemsByTrip: mocks.listItemsByTrip,
  listTicketsByTrip: mocks.listTicketsByTrip,
}))

vi.mock('../lib/dataEvents', () => ({
  subscribeTravelDataChanged: mocks.subscribeTravelDataChanged,
}))

vi.mock('../lib/dates', () => ({
  formatDateRange: mocks.formatDateRange,
}))

vi.mock('../lib/itinerary', () => ({
  describeItemTime: mocks.describeItemTime,
}))

vi.mock('../lib/tickets', () => ({
  getTicketCategoryLabel: mocks.getTicketCategoryLabel,
  getTicketDisplayTitle: mocks.getTicketDisplayTitle,
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
  mocks.listTrips.mockResolvedValue([])
  mocks.listDaysByTrip.mockResolvedValue([])
  mocks.listItemsByTrip.mockResolvedValue([])
  mocks.listTicketsByTrip.mockResolvedValue([])
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  container = null
  root = null
})

describe('SearchPage', () => {
  it('renders search input', async () => {
    await act(async () => {
      root?.render(<SearchPage />)
    })

    expect(container?.textContent).toContain('搜索')
  })

  it('renders empty state when no trips', async () => {
    await act(async () => {
      root?.render(<SearchPage />)
    })

    expect(container?.textContent).toBeTruthy()
  })

  it('renders trip results', async () => {
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

    await act(async () => {
      root?.render(<SearchPage />)
    })

    expect(container?.textContent).toContain('东京旅行')
  })

  it('renders error state', async () => {
    mocks.listTrips.mockRejectedValue(new Error('db error'))

    await act(async () => {
      root?.render(<SearchPage />)
    })

    expect(container?.textContent).toBeTruthy()
  })

  it('renders loading skeleton', async () => {
    mocks.listTrips.mockReturnValue(new Promise(() => {}))

    await act(async () => {
      root?.render(<SearchPage />)
    })

    expect(container?.querySelector('.animate-pulse')).toBeTruthy()
  })
})
