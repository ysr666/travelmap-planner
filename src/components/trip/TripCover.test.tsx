// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TripCover } from './TripCover'

vi.mock('../../lib/dates', () => ({
  formatDateRange: vi.fn(() => '4月1日 - 4月5日'),
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

describe('TripCover', () => {
  it('renders emoji for known destinations in thumbnail', async () => {
    await act(async () => {
      root?.render(<TripCover trip={defaultTrip} />)
    })

    expect(container?.textContent).toContain('🗼')
  })

  it('renders generic emoji for unknown destinations', async () => {
    const trip = { ...defaultTrip, destination: '未知城市' }

    await act(async () => {
      root?.render(<TripCover trip={trip} />)
    })

    expect(container?.textContent).toContain('✈️')
  })

  it('renders trip title in hero variant', async () => {
    await act(async () => {
      root?.render(<TripCover trip={defaultTrip} variant="hero" />)
    })

    expect(container?.textContent).toContain('东京旅行')
  })

  it('renders date range in hero variant', async () => {
    await act(async () => {
      root?.render(<TripCover trip={defaultTrip} variant="hero" />)
    })

    expect(container?.textContent).toContain('4月1日 - 4月5日')
  })

  it('renders destination in hero variant when different from title', async () => {
    await act(async () => {
      root?.render(<TripCover trip={defaultTrip} variant="hero" />)
    })

    expect(container?.textContent).toContain('东京')
  })

  it('renders hero variant with stats', async () => {
    await act(async () => {
      root?.render(
        <TripCover
          heroStats={{ days: 5, spots: 12, tickets: 3 }}
          trip={defaultTrip}
          variant="hero"
        />,
      )
    })

    expect(container?.textContent).toContain('东京旅行')
    expect(container?.textContent).toContain('5')
    expect(container?.textContent).toContain('12')
    expect(container?.textContent).toContain('3')
  })

  it('renders compact variant', async () => {
    await act(async () => {
      root?.render(<TripCover trip={defaultTrip} variant="compact" />)
    })

    expect(container?.textContent).toContain('🗼')
  })

  it('renders with photo in hero variant', async () => {
    await act(async () => {
      root?.render(
        <TripCover photo="https://example.com/photo.jpg" trip={defaultTrip} variant="hero" />,
      )
    })

    const img = container?.querySelector('img')
    expect(img?.getAttribute('src')).toBe('https://example.com/photo.jpg')
  })

  it('renders photo in thumbnail variant', async () => {
    await act(async () => {
      root?.render(
        <TripCover photo="https://example.com/photo.jpg" trip={defaultTrip} />,
      )
    })

    const img = container?.querySelector('img')
    expect(img?.getAttribute('src')).toBe('https://example.com/photo.jpg')
  })
})
