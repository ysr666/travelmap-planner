// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ItemFormPage } from './ItemFormPage'

const mocks = vi.hoisted(() => ({
  routeFromHash: vi.fn(() => 'item/new'),
  getRouteParams: vi.fn(() => new URLSearchParams({ tripId: 'trip_1', dayId: 'day_1' })),
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
  listItemsByDay: vi.fn().mockResolvedValue([]),
  getItineraryItem: vi.fn().mockResolvedValue(null),
  createItineraryItem: vi.fn().mockResolvedValue({ id: 'new_item' }),
  updateItineraryItem: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../lib/routes', () => ({
  routeFromHash: mocks.routeFromHash,
  getRouteParams: mocks.getRouteParams,
  navigateTo: mocks.navigateTo,
}))

vi.mock('../db', () => ({
  getTrip: mocks.getTrip,
  getDay: mocks.getDay,
  listItemsByDay: mocks.listItemsByDay,
  getItineraryItem: mocks.getItineraryItem,
  createItineraryItem: mocks.createItineraryItem,
  updateItineraryItem: mocks.updateItineraryItem,
}))

vi.mock('../components/ItineraryItemForm', () => ({
  ItineraryItemForm: ({ onSubmit }: { onSubmit: (value: unknown) => void }) => (
    <div data-testid="itinerary-item-form">
      <button
        data-testid="submit-form"
        onClick={() => onSubmit({
          title: '新行程点',
          locationName: '地点',
          address: '地址',
          notes: '',
          startTime: '10:00',
          endTime: '11:00',
        })}
        type="button"
      >
        提交
      </button>
    </div>
  ),
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
  mocks.routeFromHash.mockReturnValue('item/new')
  mocks.getRouteParams.mockReturnValue(new URLSearchParams({ tripId: 'trip_1', dayId: 'day_1' }))
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
  mocks.listItemsByDay.mockResolvedValue([])
  mocks.getItineraryItem.mockResolvedValue(null)
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

describe('ItemFormPage', () => {
  it('renders new item form', async () => {
    await act(async () => {
      root?.render(<ItemFormPage />)
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(container?.textContent).toContain('新增行程点')
  })

  it('renders form component', async () => {
    await act(async () => {
      root?.render(<ItemFormPage />)
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(container?.querySelector('[data-testid="itinerary-item-form"]')).toBeTruthy()
  })

  it('renders edit item form', async () => {
    mocks.routeFromHash.mockReturnValue('item/edit')
    mocks.getRouteParams.mockReturnValue(new URLSearchParams({ tripId: 'trip_1', dayId: 'day_1', itemId: 'item_1' }))
    mocks.getItineraryItem.mockResolvedValue({
      id: 'item_1',
      dayId: 'day_1',
      tripId: 'trip_1',
      title: '浅草寺',
      sortOrder: 1,
      createdAt: 100,
      updatedAt: 100,
    })

    await act(async () => {
      root?.render(<ItemFormPage />)
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(container?.textContent).toContain('编辑行程点')
  })

  it('renders error when trip not found', async () => {
    mocks.getTrip.mockResolvedValue(null)

    await act(async () => {
      root?.render(<ItemFormPage />)
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(container?.textContent).toContain('未找到该旅行')
  })

  it('renders error when day not found', async () => {
    mocks.getDay.mockResolvedValue(null)

    await act(async () => {
      root?.render(<ItemFormPage />)
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(container?.textContent).toContain('未找到该日程')
  })

  it('renders error when missing trip ID', async () => {
    mocks.getRouteParams.mockReturnValue(new URLSearchParams())

    await act(async () => {
      root?.render(<ItemFormPage />)
    })

    expect(container?.textContent).toContain('缺少旅行或日程 ID')
  })

  it('renders error when edit missing item ID', async () => {
    mocks.routeFromHash.mockReturnValue('item/edit')
    mocks.getRouteParams.mockReturnValue(new URLSearchParams({ tripId: 'trip_1', dayId: 'day_1' }))

    await act(async () => {
      root?.render(<ItemFormPage />)
    })

    expect(container?.textContent).toContain('缺少行程点 ID')
  })

  it('renders back button', async () => {
    await act(async () => {
      root?.render(<ItemFormPage />)
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    const backButton = container?.querySelector('button')
    expect(backButton).toBeTruthy()
  })
})
