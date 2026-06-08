// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsMapsPage } from './SettingsMapsPage'

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

describe('SettingsMapsPage', () => {
  it('renders offline maps heading', async () => {
    await act(async () => {
      root?.render(<SettingsMapsPage />)
    })

    expect(container?.textContent).toContain('离线地图')
  })

  it('renders map status section', async () => {
    await act(async () => {
      root?.render(<SettingsMapsPage />)
    })

    expect(container?.textContent).toContain('地图状态')
    expect(container?.textContent).toContain('在线状态')
    expect(container?.textContent).toContain('地图来源')
  })

  it('renders map source info', async () => {
    await act(async () => {
      root?.render(<SettingsMapsPage />)
    })

    expect(container?.textContent).toContain('OpenFreeMap')
  })

  it('renders explanation section', async () => {
    await act(async () => {
      root?.render(<SettingsMapsPage />)
    })

    expect(container?.textContent).toContain('说明')
    expect(container?.textContent).toContain('需要网络连接')
  })
})
