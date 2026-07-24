// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PwaLifecycleController } from './PwaLifecycleController'
import {
  applyPendingPwaUpdate,
  getPwaLifecycleState,
  resetPwaLifecycleForTests,
} from '../lib/pwaLifecycle'

type RegisterSWOptions = {
  immediate?: boolean
  onNeedRefresh?: () => void
  onOfflineReady?: () => void
  onRegisteredSW?: (swScriptUrl: string, registration?: ServiceWorkerRegistration) => void
  onRegisterError?: () => void
}

const mocks = vi.hoisted(() => ({
  registerSW: vi.fn(),
  updateSW: vi.fn(),
}))

vi.mock('../lib/pwaRegister', () => ({
  registerSW: mocks.registerSW,
}))

vi.stubGlobal('__APP_VERSION__', '0.0.0-test')

let container: HTMLDivElement | null = null
let root: Root | null = null
let registerOptions: RegisterSWOptions | null = null

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {},
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  registerOptions = null
  mocks.updateSW.mockResolvedValue(undefined)
  mocks.registerSW.mockImplementation((options: RegisterSWOptions) => {
    registerOptions = options
    return mocks.updateSW
  })
  resetPwaLifecycleForTests({ serviceWorkerSupported: true, status: 'idle' })
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  container = null
  root = null
  vi.clearAllMocks()
  resetPwaLifecycleForTests()
})

describe('PwaLifecycleController', () => {
  it('registers the service worker in prompt mode and records update readiness', async () => {
    await act(async () => {
      root?.render(<PwaLifecycleController />)
    })

    expect(mocks.registerSW).toHaveBeenCalledWith(expect.objectContaining({ immediate: true }))
    expect(registerOptions).toBeTruthy()

    await act(async () => {
      registerOptions?.onRegisteredSW?.('/sw.js', {} as ServiceWorkerRegistration)
    })
    expect(getPwaLifecycleState()).toMatchObject({ status: 'registered' })

    await act(async () => {
      registerOptions?.onNeedRefresh?.()
    })
    expect(getPwaLifecycleState()).toMatchObject({ status: 'update-ready' })
    expect(mocks.updateSW).not.toHaveBeenCalled()

    await applyPendingPwaUpdate()
    expect(mocks.updateSW).toHaveBeenCalledWith(true)
  })

  it('records offline-ready and registration errors', async () => {
    await act(async () => {
      root?.render(<PwaLifecycleController />)
    })

    await act(async () => {
      registerOptions?.onOfflineReady?.()
    })
    expect(getPwaLifecycleState()).toMatchObject({ status: 'offline-ready' })

    await act(async () => {
      registerOptions?.onRegisterError?.()
    })
    expect(getPwaLifecycleState()).toMatchObject({ status: 'error' })
  })
})
