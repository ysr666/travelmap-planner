// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ItemDetailPage } from './ItemDetailPage'

const mocks = vi.hoisted(() => ({
  getRouteParams: vi.fn(() => new URLSearchParams({ tripId: 'trip_1', dayId: 'day_1', itemId: 'item_1' })),
  navigateTo: vi.fn(),
  getTrip: vi.fn().mockResolvedValue({
    id: 'trip_1',
    title: '东京旅行',
    destination: '东京',
    startDate: '2026-04-01',
    endDate: '2026-04-05',
    createdAt: 100,
    updatedAt: 100,
  }),
  getDay: vi.fn().mockResolvedValue({
    id: 'day_1',
    tripId: 'trip_1',
    date: '2026-04-01',
    title: '第 1 天',
    sortOrder: 1,
    createdAt: 100,
    updatedAt: 100,
  }),
  getItineraryItem: vi.fn().mockResolvedValue({
    id: 'item_1',
    dayId: 'day_1',
    tripId: 'trip_1',
    title: '浅草寺',
    locationName: '浅草寺',
    address: '东京都台东区浅草2-3-1',
    lat: 35.7148,
    lng: 139.7967,
    sortOrder: 1,
    createdAt: 100,
    updatedAt: 100,
  }),
  listItemsByDay: vi.fn().mockResolvedValue([]),
  listTicketsByItem: vi.fn().mockResolvedValue([]),
  deleteItineraryItemCascade: vi.fn().mockResolvedValue(undefined),
  updateItineraryItem: vi.fn().mockResolvedValue(undefined),
  describeItemTime: vi.fn(() => '10:00'),
  describePreviousTransport: vi.fn(() => ''),
  formatDate: vi.fn(() => '4月1日'),
  getTicketCategoryLabel: vi.fn(() => ''),
  getTicketDisplayTitle: vi.fn(() => '票据'),
  hasValidCoordinates: vi.fn(() => true),
  buildAppleMapsDirectionsUrl: vi.fn(() => 'https://maps.apple.com/directions'),
  buildAppleMapsUrl: vi.fn(() => 'https://maps.apple.com'),
  buildGoogleMapsDirectionsUrl: vi.fn(() => 'https://maps.google.com/directions'),
  buildGoogleMapsUrl: vi.fn(() => 'https://maps.google.com'),
  getPlaceHeroVisual: vi.fn(() => ({
    gradientClass: 'from-blue-500 to-cyan-400',
    icon: '📍',
    label: '地点',
  })),
  getProviderProxyConfig: vi.fn(() => ({ baseUrl: '' })),
  fetchProviderProxyPlaceLookup: vi.fn().mockResolvedValue({ ok: true, result: null }),
}))

vi.mock('../lib/routes', () => ({
  getRouteParams: mocks.getRouteParams,
  navigateTo: mocks.navigateTo,
}))

vi.mock('../db', () => ({
  getTrip: mocks.getTrip,
  getDay: mocks.getDay,
  getItineraryItem: mocks.getItineraryItem,
  listItemsByDay: mocks.listItemsByDay,
  listTicketsByItem: mocks.listTicketsByItem,
  deleteItineraryItemCascade: mocks.deleteItineraryItemCascade,
  updateItineraryItem: mocks.updateItineraryItem,
}))

vi.mock('../lib/itinerary', () => ({
  describeItemTime: mocks.describeItemTime,
  describePreviousTransport: mocks.describePreviousTransport,
}))

vi.mock('../lib/dates', () => ({
  formatDate: mocks.formatDate,
}))

vi.mock('../lib/tickets', () => ({
  getTicketCategoryLabel: mocks.getTicketCategoryLabel,
  getTicketDisplayTitle: mocks.getTicketDisplayTitle,
}))

vi.mock('../lib/mapLinks', () => ({
  hasValidCoordinates: mocks.hasValidCoordinates,
  buildAppleMapsDirectionsUrl: mocks.buildAppleMapsDirectionsUrl,
  buildAppleMapsUrl: mocks.buildAppleMapsUrl,
  buildGoogleMapsDirectionsUrl: mocks.buildGoogleMapsDirectionsUrl,
  buildGoogleMapsUrl: mocks.buildGoogleMapsUrl,
}))

vi.mock('../lib/placeHeroVisual', () => ({
  getPlaceHeroVisual: mocks.getPlaceHeroVisual,
}))

vi.mock('../lib/providerProxyClient', () => ({
  ProviderProxyClientError: class extends Error {},
  getProviderProxyConfig: mocks.getProviderProxyConfig,
  fetchProviderProxyPlaceLookup: mocks.fetchProviderProxyPlaceLookup,
}))

vi.mock('../lib/ai/providerProxyContract', () => ({
  PROVIDER_PROXY_PLACE_LOOKUP_OPERATION: 'place_lookup',
}))

vi.mock('../components/TicketPreview', () => ({
  TicketPreview: () => <div data-testid="ticket-preview" />,
}))

vi.mock('../components/ai/TripContentEnrichmentPanel', () => ({
  ItemContentEnrichmentCard: () => <div data-testid="item-content-enrichment" />,
}))

vi.stubGlobal('__APP_VERSION__', '0.0.0-test')

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  vi.useFakeTimers()
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.clearAllMocks()
  // Re-set defaults
  mocks.getTrip.mockResolvedValue({
    id: 'trip_1',
    title: '东京旅行',
    destination: '东京',
    startDate: '2026-04-01',
    endDate: '2026-04-05',
    createdAt: 100,
    updatedAt: 100,
  })
  mocks.getDay.mockResolvedValue({
    id: 'day_1',
    tripId: 'trip_1',
    date: '2026-04-01',
    title: '第 1 天',
    sortOrder: 1,
    createdAt: 100,
    updatedAt: 100,
  })
  mocks.getItineraryItem.mockResolvedValue({
    id: 'item_1',
    dayId: 'day_1',
    tripId: 'trip_1',
    title: '浅草寺',
    locationName: '浅草寺',
    address: '东京都台东区浅草2-3-1',
    lat: 35.7148,
    lng: 139.7967,
    sortOrder: 1,
    createdAt: 100,
    updatedAt: 100,
  })
  mocks.listTicketsByItem.mockResolvedValue([])
  mocks.listItemsByDay.mockResolvedValue([])
  mocks.hasValidCoordinates.mockReturnValue(true)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  container = null
  root = null
  vi.useRealTimers()
})

describe('ItemDetailPage', () => {
  it('renders loading skeleton initially', async () => {
    mocks.getItineraryItem.mockReturnValue(new Promise(() => {}))

    await act(async () => {
      root?.render(<ItemDetailPage />)
    })

    expect(container?.querySelector('.animate-pulse')).toBeTruthy()
  })

  it('renders item not found state', async () => {
    mocks.getItineraryItem.mockResolvedValue(null)

    await act(async () => {
      root?.render(<ItemDetailPage />)
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(container?.textContent).toContain('未找到该行程点')
  })

  it('renders item title and location', async () => {
    await act(async () => {
      root?.render(<ItemDetailPage />)
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(container?.textContent).toContain('浅草寺')
    expect(container?.textContent).toContain('东京都台东区浅草2-3-1')
  })

  it('renders map links when coordinates are valid', async () => {
    await act(async () => {
      root?.render(<ItemDetailPage />)
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(container?.textContent).toContain('地图')
  })

  it('renders back button that navigates to day view', async () => {
    await act(async () => {
      root?.render(<ItemDetailPage />)
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    const backButton = container?.querySelector('button[aria-label="返回"]')
      ?? container?.querySelector('button')
    if (backButton) {
      await act(async () => {
        backButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
    }
  })

  it('renders trip not found state', async () => {
    mocks.getTrip.mockResolvedValue(null)

    await act(async () => {
      root?.render(<ItemDetailPage />)
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(container?.textContent).toBeTruthy()
  })

  it('renders day not found state', async () => {
    mocks.getDay.mockResolvedValue(null)

    await act(async () => {
      root?.render(<ItemDetailPage />)
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(container?.textContent).toBeTruthy()
  })

  it('renders delete button', async () => {
    await act(async () => {
      root?.render(<ItemDetailPage />)
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    const deleteButton = Array.from(container?.querySelectorAll('button') ?? [])
      .find((b) => b.textContent?.includes('删除'))
    expect(deleteButton).toBeTruthy()
  })

  it('renders onsite summary with scoped ticket access', async () => {
    mocks.listItemsByDay.mockResolvedValue([
      { id: 'item_0', dayId: 'day_1', tripId: 'trip_1', title: '酒店', ticketIds: [], sortOrder: 0, createdAt: 100, updatedAt: 100 },
      { id: 'item_1', dayId: 'day_1', tripId: 'trip_1', title: '浅草寺', locationName: '浅草寺', ticketIds: ['ticket_1'], sortOrder: 1, createdAt: 100, updatedAt: 100 },
      { id: 'item_2', dayId: 'day_1', tripId: 'trip_1', title: '东京塔', ticketIds: [], sortOrder: 2, createdAt: 100, updatedAt: 100 },
    ])
    mocks.listTicketsByItem.mockResolvedValue([
      {
        id: 'ticket_1',
        tripId: 'trip_1',
        itemId: 'item_1',
        fileName: 'ticket.pdf',
        fileType: 'pdf',
        mimeType: 'application/pdf',
        size: 1024,
        ticketCategory: 'admission_ticket',
        createdAt: 100,
        updatedAt: 100,
      },
    ])

    await act(async () => {
      root?.render(<ItemDetailPage />)
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(container?.textContent).toContain('第 2/3 项')
    expect(container?.textContent).toContain('现场凭证')
    expect(container?.textContent).toContain('1 张票据')

    await act(async () => {
      container?.querySelector<HTMLButtonElement>('[data-testid="item-ticket-view-all"]')?.click()
    })

    expect(mocks.navigateTo).toHaveBeenCalledWith('tickets', { tripId: 'trip_1', itemId: 'item_1' })
  })
})
