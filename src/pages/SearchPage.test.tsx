// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchPage } from './SearchPage'

const mocks = vi.hoisted(() => ({
  describeItemTime: vi.fn(() => '10:00'),
  formatDateRange: vi.fn(() => '4月1日 - 4月5日'),
  getTicketCategoryLabel: vi.fn(() => '门票'),
  getTicketDisplayTitle: vi.fn(() => '票据'),
  listDaysByTrip: vi.fn().mockResolvedValue([]),
  listItemsByTrip: vi.fn().mockResolvedValue([]),
  listLedgerExpenses: vi.fn().mockResolvedValue([]),
  listTicketsByTrip: vi.fn().mockResolvedValue([]),
  listTransportBookings: vi.fn().mockResolvedValue([]),
  listTransportSegments: vi.fn().mockResolvedValue([]),
  listTrips: vi.fn().mockResolvedValue([]),
  navigateTo: vi.fn(),
  subscribeTravelDataChanged: vi.fn(() => () => {}),
}))

vi.mock('../lib/routes', () => ({ navigateTo: mocks.navigateTo }))
vi.mock('../db', () => ({
  listDaysByTrip: mocks.listDaysByTrip,
  listItemsByTrip: mocks.listItemsByTrip,
  listLedgerExpenses: mocks.listLedgerExpenses,
  listTicketsByTrip: mocks.listTicketsByTrip,
  listTrips: mocks.listTrips,
}))
vi.mock('../lib/travelDocumentCenter', () => ({
  listTransportBookings: mocks.listTransportBookings,
  listTransportSegments: mocks.listTransportSegments,
}))
vi.mock('../lib/dataEvents', () => ({ subscribeTravelDataChanged: mocks.subscribeTravelDataChanged }))
vi.mock('../lib/dates', () => ({ formatDateRange: mocks.formatDateRange }))
vi.mock('../lib/itinerary', () => ({ describeItemTime: mocks.describeItemTime }))
vi.mock('../lib/tickets', () => ({
  getTicketCategoryLabel: mocks.getTicketCategoryLabel,
  getTicketDisplayTitle: mocks.getTicketDisplayTitle,
}))

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
  mocks.listLedgerExpenses.mockResolvedValue([])
  mocks.listTransportBookings.mockResolvedValue([])
  mocks.listTransportSegments.mockResolvedValue([])
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  container = null
  root = null
})

describe('SearchPage', () => {
  it('renders the expanded local search surface', async () => {
    await act(async () => root?.render(<SearchPage />))

    expect(container?.textContent).toContain('本机旅行、行程、票据、交通与账本')
    expect(container?.querySelector('input[type="search"]')).toBeTruthy()
    expect(container?.querySelector('[data-testid="search-filter-transport"]')).toBeTruthy()
    expect(container?.querySelector('[data-testid="search-filter-ledger"]')).toBeTruthy()
  })

  it('renders empty state when no local records exist', async () => {
    await act(async () => root?.render(<SearchPage />))
    expect(container?.textContent).toContain('还没有可搜索的本机旅行数据')
  })

  it('renders trip results', async () => {
    mocks.listTrips.mockResolvedValue([trip()])

    await act(async () => root?.render(<SearchPage />))

    expect(container?.textContent).toContain('东京旅行')
    expect(container?.querySelector('[data-testid="search-group-trip"]')).toBeTruthy()
  })

  it('finds a compact flight number and opens the exact transport booking', async () => {
    mocks.listTrips.mockResolvedValue([trip()])
    mocks.listTransportBookings.mockResolvedValue([booking()])
    mocks.listTransportSegments.mockResolvedValue([segment()])

    await act(async () => root?.render(<SearchPage />))
    await typeSearch('MU5137')

    await vi.waitFor(() => expect(container?.textContent).toContain('上海飞东京'))
    const result = container?.querySelector('button[aria-label="打开上海飞东京"]')
    await act(async () => result?.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    expect(mocks.navigateTo).toHaveBeenCalledWith('documents', {
      bookingId: 'booking_1',
      tab: 'transport',
      tripId: 'trip_1',
    })
  })

  it('filters matching records by category', async () => {
    mocks.listTrips.mockResolvedValue([trip()])
    mocks.listDaysByTrip.mockResolvedValue([{ date: '2026-04-01', id: 'day_1', sortOrder: 0, title: '第一天', tripId: 'trip_1' }])
    mocks.listItemsByTrip.mockResolvedValue([{
      createdAt: 1,
      dayId: 'day_1',
      id: 'item_1',
      sortOrder: 0,
      ticketIds: [],
      title: '东京塔',
      tripId: 'trip_1',
      updatedAt: 2,
    }])

    await act(async () => root?.render(<SearchPage />))
    await typeSearch('东京')
    const itemFilter = container?.querySelector('[data-testid="search-filter-item"]')
    await act(async () => itemFilter?.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    expect(container?.querySelector('[data-testid="search-group-item"]')).toBeTruthy()
    expect(container?.querySelector('[data-testid="search-group-trip"]')).toBeNull()
  })

  it('renders error state', async () => {
    mocks.listTrips.mockRejectedValue(new Error('db error'))
    await act(async () => root?.render(<SearchPage />))
    expect(container?.textContent).toContain('db error')
  })

  it('renders loading skeleton while the index is pending', async () => {
    mocks.listTrips.mockReturnValue(new Promise(() => {}))
    await act(async () => root?.render(<SearchPage />))
    expect(container?.querySelector('.animate-pulse')).toBeTruthy()
  })
})

async function typeSearch(value: string) {
  const input = container?.querySelector('input[type="search"]') as HTMLInputElement | null
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    valueSetter?.call(input, value)
    input?.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function trip() {
  return {
    createdAt: 1,
    destination: '东京',
    endDate: '2026-04-05',
    id: 'trip_1',
    startDate: '2026-04-01',
    title: '东京旅行',
    updatedAt: 1,
  }
}

function booking() {
  return {
    createdAt: 1,
    externalActions: [],
    id: 'booking_1',
    kind: 'flight' as const,
    providerName: '东方航空',
    status: 'confirmed' as const,
    title: '上海飞东京',
    tripId: 'trip_1',
    updatedAt: 2,
  }
}

function segment() {
  return {
    arrivalDate: '2026-04-01',
    arrivalPlace: '东京羽田',
    arrivalTimeZone: 'Asia/Tokyo',
    bookingId: 'booking_1',
    createdAt: 1,
    departureDate: '2026-04-01',
    departurePlace: '上海虹桥',
    departureTimeZone: 'Asia/Shanghai',
    id: 'segment_1',
    kind: 'flight' as const,
    serviceNumber: 'MU 5137',
    sortOrder: 0,
    status: 'scheduled' as const,
    tripId: 'trip_1',
    updatedAt: 2,
  }
}
