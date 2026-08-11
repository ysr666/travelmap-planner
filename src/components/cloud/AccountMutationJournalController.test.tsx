// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountMutationJournalController } from './AccountMutationJournalController'

const mocks = vi.hoisted(() => ({
  activeHash: vi.fn<() => string | null>(() => 'account-hash'),
  authCallback: undefined as ((event: string, session: unknown) => void) | undefined,
  database: { name: 'account-db' },
  drain: vi.fn().mockResolvedValue({ processed: [], skippedMutationIds: [] }),
  mode: vi.fn<() => 'disabled' | 'enabled'>(() => 'enabled'),
  recover: vi.fn().mockResolvedValue({ recovered: 0, scanned: 0, staleLocal: 0 }),
  resume: vi.fn().mockResolvedValue(0),
  unsubscribe: vi.fn(),
}))

vi.mock('../../lib/accountCloud/coordinator', () => ({
  drainAccountMutationJournal: mocks.drain,
}))

vi.mock('../../lib/accountCloud/feature', () => ({
  getAccountCloudV2Mode: mocks.mode,
  isAccountCloudV2AccountEnabled: (accountHash: string | null) => (
    mocks.mode() === 'enabled' && Boolean(accountHash)
  ),
}))

vi.mock('../../lib/accountCloud/localStore', () => ({
  recoverTerminalOptimisticAccountMutations: mocks.recover,
  resumeBlockedAuthAccountMutations: mocks.resume,
}))

vi.mock('../../db/database', () => ({
  getActiveTravelDatabase: () => mocks.database,
}))

vi.mock('../../lib/accountStorageScope', () => ({
  getActiveAccountHash: mocks.activeHash,
}))

vi.mock('../../lib/supabaseClient', () => ({
  getSupabaseClient: () => ({
    auth: {
      onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
        mocks.authCallback = callback
        return { data: { subscription: { unsubscribe: mocks.unsubscribe } } }
      },
    },
  }),
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mocks.activeHash.mockReturnValue('account-hash')
  mocks.authCallback = undefined
  mocks.drain.mockClear()
  mocks.mode.mockReturnValue('enabled')
  mocks.recover.mockClear()
  mocks.resume.mockClear()
  mocks.unsubscribe.mockClear()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('AccountMutationJournalController', () => {
  it('does nothing when the account-cloud rollout is disabled', async () => {
    mocks.mode.mockReturnValue('disabled')
    await act(async () => root.render(<AccountMutationJournalController />))

    expect(mocks.drain).not.toHaveBeenCalled()
    expect(mocks.authCallback).toBeUndefined()
  })

  it('drains on startup, reconnect, and authenticated recovery', async () => {
    await act(async () => root.render(<AccountMutationJournalController />))
    expect(mocks.recover).toHaveBeenCalledTimes(1)
    expect(mocks.drain).toHaveBeenCalledTimes(1)

    await act(async () => window.dispatchEvent(new Event('online')))
    expect(mocks.recover).toHaveBeenCalledTimes(2)
    expect(mocks.drain).toHaveBeenCalledTimes(2)

    await act(async () => {
      await mocks.authCallback?.('SIGNED_IN', { access_token: 'redacted' })
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    expect(mocks.resume).toHaveBeenCalledTimes(1)
    expect(mocks.recover).toHaveBeenCalledTimes(3)
    expect(mocks.drain).toHaveBeenCalledTimes(3)

    act(() => root.unmount())
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1)
    root = createRoot(container)
  })

  it('does not start against the legacy unauthenticated database', async () => {
    mocks.activeHash.mockReturnValue(null)
    await act(async () => root.render(<AccountMutationJournalController />))
    expect(mocks.drain).not.toHaveBeenCalled()
  })
})
