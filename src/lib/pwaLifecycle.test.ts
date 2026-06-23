import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyPendingPwaUpdate,
  getPwaLifecycleState,
  getPwaLifecycleStatusLabel,
  resetPwaLifecycleForTests,
  setPwaLifecycleState,
  setPwaUpdateAction,
  subscribePwaLifecycle,
} from './pwaLifecycle'

afterEach(() => {
  resetPwaLifecycleForTests()
})

describe('pwaLifecycle', () => {
  it('notifies subscribers when lifecycle state changes', () => {
    const listener = vi.fn()
    const unsubscribe = subscribePwaLifecycle(listener)

    setPwaLifecycleState({ status: 'update-ready' })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(getPwaLifecycleState()).toMatchObject({ status: 'update-ready' })
    unsubscribe()
  })

  it('runs the pending update action only when one exists', async () => {
    await expect(applyPendingPwaUpdate()).resolves.toBe(false)
    const action = vi.fn()
    setPwaUpdateAction(action)

    await expect(applyPendingPwaUpdate()).resolves.toBe(true)

    expect(action).toHaveBeenCalledTimes(1)
  })

  it('returns Chinese status labels', () => {
    expect(getPwaLifecycleStatusLabel('idle')).toBe('等待注册')
    expect(getPwaLifecycleStatusLabel('update-ready')).toBe('有新版本可更新')
    expect(getPwaLifecycleStatusLabel('unsupported')).toContain('不支持')
  })
})
