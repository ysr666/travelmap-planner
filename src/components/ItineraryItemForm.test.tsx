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
})
