// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PwaLifecycleBanner } from './PwaLifecycleBanner'
import {
  resetPwaLifecycleForTests,
  setPwaUpdateAction,
} from '../lib/pwaLifecycle'

vi.stubGlobal('__APP_VERSION__', '0.0.0-test')

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  resetPwaLifecycleForTests({ isOnline: true, serviceWorkerSupported: true, status: 'registered' })
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  container = null
  root = null
  resetPwaLifecycleForTests()
})

describe('PwaLifecycleBanner', () => {
  it('shows a compact offline notice', async () => {
    resetPwaLifecycleForTests({ isOnline: false, serviceWorkerSupported: true, status: 'registered' })

    await act(async () => {
      root?.render(<PwaLifecycleBanner topAppBar />)
    })

    expect(container?.textContent).toContain('当前离线')
    expect(container?.textContent).toContain('地图、路线、搜索和云端同步需要网络')
  })

  it('runs the pending update action from the update banner', async () => {
    const updateAction = vi.fn()
    resetPwaLifecycleForTests({ isOnline: true, serviceWorkerSupported: true, status: 'update-ready' })
    setPwaUpdateAction(updateAction)

    await act(async () => {
      root?.render(<PwaLifecycleBanner topAppBar />)
    })
    const updateButton = Array.from(container?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent?.includes('更新并重启'))

    await act(async () => {
      updateButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(updateAction).toHaveBeenCalledTimes(1)
  })
})
