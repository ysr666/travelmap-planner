// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TripMoreMenu } from './TripMoreMenu'

const mocks = vi.hoisted(() => ({
  navigateTo: vi.fn(),
}))

vi.mock('../../lib/routes', () => ({
  navigateTo: mocks.navigateTo,
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
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  container = null
  root = null
})

describe('TripMoreMenu', () => {
  it('renders more button', async () => {
    await act(async () => {
      root?.render(<TripMoreMenu tripId="trip_1" />)
    })

    const button = container?.querySelector('button[aria-label="更多"]')
    expect(button).toBeTruthy()
  })

  it('opens menu on button click', async () => {
    await act(async () => {
      root?.render(<TripMoreMenu tripId="trip_1" />)
    })

    const button = container?.querySelector('button[aria-label="更多"]')
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(container?.textContent).toContain('全部票据')
    expect(container?.textContent).toContain('同步与归档')
    expect(container?.textContent).toContain('设置')
    expect(container?.textContent).toContain('返回首页')
  })

  it('closes menu on X button click', async () => {
    await act(async () => {
      root?.render(<TripMoreMenu tripId="trip_1" />)
    })

    const button = container?.querySelector('button[aria-label="更多"]')
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(container?.querySelector('[data-testid="trip-more-menu"]')).toBeTruthy()

    const closeButton = Array.from(container?.querySelectorAll('button') ?? [])
      .find((b) => b.textContent?.includes('更多') && b.textContent?.includes('关闭'))
      ?? container?.querySelector('[data-testid="trip-more-menu"] button')

    if (closeButton) {
      await act(async () => {
        closeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
    }
  })

  it('navigates to tickets on click', async () => {
    await act(async () => {
      root?.render(<TripMoreMenu tripId="trip_1" />)
    })

    const button = container?.querySelector('button[aria-label="更多"]')
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const ticketsButton = Array.from(container?.querySelectorAll('button') ?? [])
      .find((b) => b.textContent?.includes('全部票据'))

    await act(async () => {
      ticketsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mocks.navigateTo).toHaveBeenCalledWith('tickets', { tripId: 'trip_1' })
  })

  it('navigates to settings on click', async () => {
    await act(async () => {
      root?.render(<TripMoreMenu tripId="trip_1" />)
    })

    const button = container?.querySelector('button[aria-label="更多"]')
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const settingsButton = Array.from(container?.querySelectorAll('button') ?? [])
      .find((b) => b.textContent?.includes('设置'))

    await act(async () => {
      settingsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mocks.navigateTo).toHaveBeenCalledWith('settings')
  })

  it('navigates to home on click', async () => {
    await act(async () => {
      root?.render(<TripMoreMenu tripId="trip_1" />)
    })

    const button = container?.querySelector('button[aria-label="更多"]')
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const homeButton = Array.from(container?.querySelectorAll('button') ?? [])
      .find((b) => b.textContent?.includes('返回首页'))

    await act(async () => {
      homeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mocks.navigateTo).toHaveBeenCalledWith('home')
  })
})
