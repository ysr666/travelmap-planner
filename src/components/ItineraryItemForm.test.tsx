// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ItineraryItemForm } from './ItineraryItemForm'

vi.mock('../lib/mapLinks', () => ({
  parseCoordinatesFromMapLink: vi.fn(() => null),
  buildGoogleMapsUrl: vi.fn(() => ''),
  buildAppleMapsUrl: vi.fn(() => ''),
  hasValidCoordinates: vi.fn(() => false),
}))

vi.mock('../lib/googleMaps', () => ({
  isGoogleMapsConfigured: vi.fn(() => false),
}))

vi.mock('./ui/PlaceSearchInput', () => ({
  PlaceSearchInput: () => null,
}))

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  container = null
  root = null
})

describe('ItineraryItemForm', () => {
  it('renders with empty default values', async () => {
    const onSubmit = vi.fn()
    const onCancel = vi.fn()

    await act(async () => {
      root?.render(
        <ItineraryItemForm
          submitLabel="添加"
          onSubmit={onSubmit}
          onCancel={onCancel}
        />,
      )
    })

    expect(container?.querySelector('input')).toBeTruthy()
    expect(container?.textContent).toContain('添加')
  })

  it('renders with initial item values', async () => {
    const onSubmit = vi.fn()
    const onCancel = vi.fn()

    await act(async () => {
      root?.render(
        <ItineraryItemForm
          initialItem={{
            id: 'item_1',
            tripId: 'trip_1',
            dayId: 'day_1',
            title: '浅草寺',
            sortOrder: 0,
            createdAt: 100,
            updatedAt: 100,
            ticketIds: [],
          }}
          submitLabel="保存"
          onSubmit={onSubmit}
          onCancel={onCancel}
        />,
      )
    })

    expect(container?.textContent).toContain('保存')
  })

  it('calls onCancel when cancel button is clicked', async () => {
    const onSubmit = vi.fn()
    const onCancel = vi.fn()

    await act(async () => {
      root?.render(
        <ItineraryItemForm
          submitLabel="添加"
          onSubmit={onSubmit}
          onCancel={onCancel}
        />,
      )
    })

    const buttons = container?.querySelectorAll('button')
    const cancelButton = Array.from(buttons || []).find((b) => b.textContent?.includes('取消'))
    if (cancelButton) {
      cancelButton.click()
    }
    expect(onCancel).toHaveBeenCalled()
  })

  it('shows loading state', async () => {
    const onSubmit = vi.fn()
    const onCancel = vi.fn()

    await act(async () => {
      root?.render(
        <ItineraryItemForm
          submitLabel="保存"
          loading
          onSubmit={onSubmit}
          onCancel={onCancel}
        />,
      )
    })

    expect(container?.textContent).toContain('保存')
  })

  it('shows a visible notice when DST changes the requested wall-clock time', async () => {
    await act(async () => {
      root?.render(
        <ItineraryItemForm
          dayDate="2026-03-08"
          defaultTimeZone="America/New_York"
          initialItem={{
            createdAt: 1,
            dayId: 'day_1',
            endDate: '2026-03-08',
            endTime: '04:00',
            endTimeZone: 'America/New_York',
            id: 'flight_1',
            sortOrder: 1,
            startTime: '02:30',
            startTimeZone: 'America/New_York',
            ticketIds: [],
            title: '机场接驳',
            transportMode: 'flight',
            tripId: 'trip_1',
            updatedAt: 1,
          }}
          onCancel={vi.fn()}
          onSubmit={vi.fn()}
          submitLabel="保存"
        />,
      )
    })

    expect(container?.querySelector('[data-testid="time-adjustment-notice"]')?.textContent).toContain('夏令时跳时')
  })

  it('rejects a cross-time-zone arrival instant before departure', async () => {
    const onSubmit = vi.fn()
    await act(async () => {
      root?.render(
        <ItineraryItemForm
          dayDate="2026-06-10"
          initialItem={{
            createdAt: 1,
            dayId: 'day_1',
            endDate: '2026-06-10',
            endTime: '06:00',
            endTimeZone: 'America/Los_Angeles',
            id: 'flight_1',
            sortOrder: 1,
            startTime: '23:30',
            startTimeZone: 'Asia/Tokyo',
            ticketIds: [],
            title: '跨时区航班',
            transportMode: 'flight',
            tripId: 'trip_1',
            updatedAt: 1,
          }}
          onCancel={vi.fn()}
          onSubmit={onSubmit}
          submitLabel="保存"
        />,
      )
    })

    const submit = Array.from(container?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent?.includes('保存'))
    await act(async () => submit?.click())

    expect(onSubmit).not.toHaveBeenCalled()
    expect(container?.textContent).toContain('到达时刻不能早于出发时刻')
  })
})
