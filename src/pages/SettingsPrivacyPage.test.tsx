// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SettingsPrivacyPage } from './SettingsPrivacyPage'

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

describe('SettingsPrivacyPage', () => {
  it('renders privacy settings heading', async () => {
    await act(async () => {
      root?.render(<SettingsPrivacyPage />)
    })

    expect(container?.textContent).toContain('隐私设置')
  })

  it('renders trip data section', async () => {
    await act(async () => {
      root?.render(<SettingsPrivacyPage />)
    })

    expect(container?.textContent).toContain('行程数据')
    expect(container?.textContent).toContain('行程基础信息')
    expect(container?.textContent).toContain('地点名称和地址')
    expect(container?.textContent).toContain('坐标状态')
    expect(container?.textContent).toContain('交通信息')
  })

  it('renders tickets and notes section', async () => {
    await act(async () => {
      root?.render(<SettingsPrivacyPage />)
    })

    expect(container?.textContent).toContain('票据和备注')
    expect(container?.textContent).toContain('票据元数据')
    expect(container?.textContent).toContain('完整备注内容')
  })

  it('renders privacy notice', async () => {
    await act(async () => {
      root?.render(<SettingsPrivacyPage />)
    })

    expect(container?.textContent).toContain('localStorage')
  })

  it('renders named switch controls', async () => {
    await act(async () => {
      root?.render(<SettingsPrivacyPage />)
    })

    const switches = container?.querySelectorAll('[role="switch"]') ?? []
    expect(switches.length).toBe(6)
    expect(switches[0].getAttribute('aria-label')).toContain('行程基础信息')
    expect(switches[0].getAttribute('aria-checked')).toBe('true')
  })

  it('toggles switches with the full row target', async () => {
    await act(async () => {
      root?.render(<SettingsPrivacyPage />)
    })

    const firstSwitch = container?.querySelector('[role="switch"]') as HTMLButtonElement | null
    expect(firstSwitch).toBeTruthy()
    await act(async () => {
      firstSwitch?.click()
    })
    expect(firstSwitch?.getAttribute('aria-checked')).toBe('false')
  })
})
