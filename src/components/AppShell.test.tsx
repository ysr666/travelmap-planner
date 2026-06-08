// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BottomTabBar } from './BottomTabBar'
import { ErrorBoundary } from './ErrorBoundary'
import { AppVersion } from './AppVersion'

const mocks = vi.hoisted(() => ({
  navigateTo: vi.fn(),
}))

vi.mock('../lib/routes', () => ({
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

describe('BottomTabBar', () => {
  it('renders all tabs', async () => {
    await act(async () => {
      root?.render(<BottomTabBar activeRoute="home" />)
    })
    expect(container?.textContent).toContain('首页')
    expect(container?.textContent).toContain('行程')
    expect(container?.textContent).toContain('搜索')
    expect(container?.textContent).toContain('设置')
  })

  it('highlights active tab', async () => {
    await act(async () => {
      root?.render(<BottomTabBar activeRoute="home" />)
    })
    const homeButton = container?.querySelector('button[aria-label="首页"]')
    expect(homeButton?.className).toContain('text-primary')
  })

  it('navigates on click', async () => {
    await act(async () => {
      root?.render(<BottomTabBar activeRoute="home" />)
    })
    const searchButton = container?.querySelector('button[aria-label="搜索"]')
    await act(async () => {
      searchButton?.click()
    })
    expect(mocks.navigateTo).toHaveBeenCalledWith('search')
  })

  it('has aria-labels on all buttons', async () => {
    await act(async () => {
      root?.render(<BottomTabBar activeRoute="home" />)
    })
    const buttons = container?.querySelectorAll('button') ?? []
    expect(buttons.length).toBe(4)
    Array.from(buttons).forEach((button) => {
      expect(button.getAttribute('aria-label')).toBeTruthy()
    })
  })

  it('maps day route to trip tab', async () => {
    await act(async () => {
      root?.render(<BottomTabBar activeRoute="day" />)
    })
    const tripButton = container?.querySelector('button[aria-label="行程"]')
    expect(tripButton?.className).toContain('text-primary')
  })

  it('maps settings sub-routes to settings tab', async () => {
    await act(async () => {
      root?.render(<BottomTabBar activeRoute="settings/privacy" />)
    })
    const settingsButton = container?.querySelector('button[aria-label="设置"]')
    expect(settingsButton?.className).toContain('text-primary')
  })
})

describe('ErrorBoundary', () => {
  it('renders children when no error', async () => {
    await act(async () => {
      root?.render(
        <ErrorBoundary>
          <div>正常内容</div>
        </ErrorBoundary>,
      )
    })
    expect(container?.textContent).toContain('正常内容')
  })

  it('renders error state when child throws', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    function ThrowingComponent() {
      throw new Error('测试错误')
    }

    await act(async () => {
      root?.render(
        <ErrorBoundary>
          <ThrowingComponent />
        </ErrorBoundary>,
      )
    })

    expect(container?.textContent).toContain('页面加载出错')
    expect(container?.textContent).toContain('测试错误')
    expect(container?.textContent).toContain('返回首页')

    consoleSpy.mockRestore()
  })

  it('renders reload button', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    function ThrowingComponent() {
      throw new Error('测试错误')
    }

    await act(async () => {
      root?.render(
        <ErrorBoundary>
          <ThrowingComponent />
        </ErrorBoundary>,
      )
    })

    const button = container?.querySelector('button')
    expect(button?.textContent).toContain('返回首页')

    consoleSpy.mockRestore()
  })
})

describe('AppVersion', () => {
  it('renders version', async () => {
    await act(async () => {
      root?.render(<AppVersion />)
    })
    expect(container?.textContent).toContain('旅图 v0.0.0-test')
  })

  it('renders custom label', async () => {
    await act(async () => {
      root?.render(<AppVersion label="当前版本" />)
    })
    expect(container?.textContent).toContain('当前版本：v0.0.0-test')
  })

  it('renders suffix', async () => {
    await act(async () => {
      root?.render(<AppVersion suffix="本地优先" />)
    })
    expect(container?.textContent).toContain('本地优先')
  })

  it('applies custom className', async () => {
    await act(async () => {
      root?.render(<AppVersion className="text-left" />)
    })
    const p = container?.querySelector('p')
    expect(p?.className).toContain('text-left')
  })
})
