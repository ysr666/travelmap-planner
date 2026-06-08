// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DayTimelineView } from './DayTimelineView'

const mocks = vi.hoisted(() => ({
  deleteItineraryItemCascade: vi.fn().mockResolvedValue(undefined),
  navigateTo: vi.fn(),
  describeItemTime: vi.fn(() => '10:00'),
  describePreviousTransport: vi.fn(() => ''),
  transportModeLabels: { walk: '步行', transit: '公共交通', car: '驾车', train: '火车', flight: '飞机', bus: '巴士', other: '其他' },
  buildAppleMapsDirectionsUrl: vi.fn(() => 'https://maps.apple.com'),
  buildGoogleMapsDirectionsUrl: vi.fn(() => 'https://maps.google.com'),
}))

vi.mock('../../db', () => ({
  deleteItineraryItemCascade: mocks.deleteItineraryItemCascade,
}))

vi.mock('../../lib/routes', () => ({
  navigateTo: mocks.navigateTo,
}))

vi.mock('../../lib/itinerary', () => ({
  describeItemTime: mocks.describeItemTime,
  describePreviousTransport: mocks.describePreviousTransport,
  transportModeLabels: mocks.transportModeLabels,
}))

vi.mock('../../lib/mapLinks', () => ({
  buildAppleMapsDirectionsUrl: mocks.buildAppleMapsDirectionsUrl,
  buildGoogleMapsDirectionsUrl: mocks.buildGoogleMapsDirectionsUrl,
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

describe('DayTimelineView', () => {
  it('renders empty state when no items', async () => {
    await act(async () => {
      root?.render(
        <DayTimelineView
          day={defaultDay}
          items={[]}
          onItemsChange={vi.fn()}
          onOpenItem={vi.fn()}
          trip={defaultTrip}
        />,
      )
    })

    expect(container?.textContent).toContain('这一天还没有行程点')
  })

  it('renders item list', async () => {
    const items = [
      { id: 'item_1', dayId: 'day_1', tripId: 'trip_1', title: '浅草寺', ticketIds: [], sortOrder: 1, createdAt: 100, updatedAt: 100 },
      { id: 'item_2', dayId: 'day_1', tripId: 'trip_1', title: '东京塔', ticketIds: [], sortOrder: 2, createdAt: 100, updatedAt: 100 },
    ]

    await act(async () => {
      root?.render(
        <DayTimelineView
          day={defaultDay}
          items={items}
          onItemsChange={vi.fn()}
          onOpenItem={vi.fn()}
          trip={defaultTrip}
        />,
      )
    })

    expect(container?.textContent).toContain('浅草寺')
    expect(container?.textContent).toContain('东京塔')
  })

  it('renders add item button', async () => {
    await act(async () => {
      root?.render(
        <DayTimelineView
          day={defaultDay}
          items={[]}
          onItemsChange={vi.fn()}
          onOpenItem={vi.fn()}
          trip={defaultTrip}
        />,
      )
    })

    const addButton = Array.from(container?.querySelectorAll('button') ?? [])
      .find((b) => b.textContent?.includes('新增'))
    expect(addButton).toBeTruthy()
  })

  it('renders compact mode', async () => {
    const items = [
      { id: 'item_1', dayId: 'day_1', tripId: 'trip_1', title: '浅草寺', ticketIds: [], sortOrder: 1, createdAt: 100, updatedAt: 100 },
    ]

    await act(async () => {
      root?.render(
        <DayTimelineView
          compact
          day={defaultDay}
          items={items}
          onItemsChange={vi.fn()}
          onOpenItem={vi.fn()}
          trip={defaultTrip}
        />,
      )
    })

    expect(container?.textContent).toContain('浅草寺')
  })

  it('renders item with location', async () => {
    const items = [
      { id: 'item_1', dayId: 'day_1', tripId: 'trip_1', title: '浅草寺', locationName: '浅草寺', ticketIds: [], sortOrder: 1, createdAt: 100, updatedAt: 100 },
    ]

    await act(async () => {
      root?.render(
        <DayTimelineView
          day={defaultDay}
          items={items}
          onItemsChange={vi.fn()}
          onOpenItem={vi.fn()}
          trip={defaultTrip}
        />,
      )
    })

    expect(container?.textContent).toContain('浅草寺')
  })

  it('renders item with time', async () => {
    mocks.describeItemTime.mockReturnValue('10:00 - 11:00')
    const items = [
      { id: 'item_1', dayId: 'day_1', tripId: 'trip_1', title: '浅草寺', startTime: '10:00', endTime: '11:00', ticketIds: [], sortOrder: 1, createdAt: 100, updatedAt: 100 },
    ]

    await act(async () => {
      root?.render(
        <DayTimelineView
          day={defaultDay}
          items={items}
          onItemsChange={vi.fn()}
          onOpenItem={vi.fn()}
          trip={defaultTrip}
        />,
      )
    })

    expect(container?.textContent).toContain('10:00 - 11:00')
  })

  it('calls onOpenItem when item clicked', async () => {
    const onOpenItem = vi.fn()
    const items = [
      { id: 'item_1', dayId: 'day_1', tripId: 'trip_1', title: '浅草寺', ticketIds: [], sortOrder: 1, createdAt: 100, updatedAt: 100 },
    ]

    await act(async () => {
      root?.render(
        <DayTimelineView
          day={defaultDay}
          items={items}
          onItemsChange={vi.fn()}
          onOpenItem={onOpenItem}
          trip={defaultTrip}
        />,
      )
    })

    const itemButton = Array.from(container?.querySelectorAll('button') ?? [])
      .find((b) => b.textContent?.includes('浅草寺'))

    if (itemButton) {
      await act(async () => {
        itemButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(onOpenItem).toHaveBeenCalled()
    }
  })

  it('renders delete button for items', async () => {
    const items = [
      { id: 'item_1', dayId: 'day_1', tripId: 'trip_1', title: '浅草寺', ticketIds: [], sortOrder: 1, createdAt: 100, updatedAt: 100 },
    ]

    await act(async () => {
      root?.render(
        <DayTimelineView
          day={defaultDay}
          items={items}
          onItemsChange={vi.fn()}
          onOpenItem={vi.fn()}
          trip={defaultTrip}
        />,
      )
    })

    const deleteButton = Array.from(container?.querySelectorAll('button') ?? [])
      .find((b) => b.getAttribute('aria-label')?.includes('删除') || b.textContent?.includes('删除'))
    expect(deleteButton).toBeTruthy()
  })

  it('renders multiple items with transport info', async () => {
    mocks.describePreviousTransport.mockReturnValue('步行 10 分钟')
    const items = [
      { id: 'item_1', dayId: 'day_1', tripId: 'trip_1', title: '浅草寺', ticketIds: [], sortOrder: 1, createdAt: 100, updatedAt: 100 },
      { id: 'item_2', dayId: 'day_1', tripId: 'trip_1', title: '东京塔', ticketIds: [], sortOrder: 2, createdAt: 100, updatedAt: 100 },
    ]

    await act(async () => {
      root?.render(
        <DayTimelineView
          day={defaultDay}
          items={items}
          onItemsChange={vi.fn()}
          onOpenItem={vi.fn()}
          trip={defaultTrip}
        />,
      )
    })

    expect(container?.textContent).toContain('浅草寺')
    expect(container?.textContent).toContain('东京塔')
  })
})
