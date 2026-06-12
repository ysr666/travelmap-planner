// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SettingsRoutePage } from './SettingsRoutePage'

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

describe('SettingsRoutePage', () => {
  it('renders route preferences heading', async () => {
    await act(async () => {
      root?.render(<SettingsRoutePage />)
    })

    expect(container?.textContent).toContain('路线偏好')
  })

  it('renders route strategy options', async () => {
    await act(async () => {
      root?.render(<SettingsRoutePage />)
    })

    expect(container?.textContent).toContain('最快路线')
    expect(container?.textContent).toContain('最短路线')
    expect(container?.textContent).toContain('风景路线')
  })

  it('renders avoidance options', async () => {
    await act(async () => {
      root?.render(<SettingsRoutePage />)
    })

    expect(container?.textContent).toContain('避让选项')
    expect(container?.textContent).toContain('避开收费站')
    expect(container?.textContent).toContain('避开高速公路')
  })

  it('renders named switch controls for avoidance', async () => {
    await act(async () => {
      root?.render(<SettingsRoutePage />)
    })

    const switches = container?.querySelectorAll('[role="switch"]') ?? []
    expect(switches.length).toBe(2)
    expect(switches[0].getAttribute('aria-label')).toBe('避开收费站')
  })

  it('renders route strategy section', async () => {
    await act(async () => {
      root?.render(<SettingsRoutePage />)
    })

    expect(container?.textContent).toContain('路线策略')
  })

  it('renders route strategy as keyboard-operable radio buttons', async () => {
    await act(async () => {
      root?.render(<SettingsRoutePage />)
    })

    const radios = Array.from(container?.querySelectorAll('[role="radio"]') ?? []) as HTMLButtonElement[]
    expect(radios.length).toBe(3)
    expect(radios[0].getAttribute('aria-checked')).toBe('true')

    await act(async () => {
      radios[1].dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ' }))
    })

    expect(radios[1].getAttribute('aria-checked')).toBe('true')
  })
})
