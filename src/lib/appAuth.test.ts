// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import {
  OFFLINE_ACCESS_LEASE_MS,
  clearOfflineAccessLease,
  hasValidOfflineAccessLease,
  renewOfflineAccessLease,
} from './appAuth'

beforeEach(() => window.localStorage.clear())

describe('offline account access lease', () => {
  it('allows the verified account for 30 days and rejects other accounts', () => {
    renewOfflineAccessLease('account-a', 1_000)
    expect(hasValidOfflineAccessLease('account-a', 1_000 + OFFLINE_ACCESS_LEASE_MS - 1)).toBe(true)
    expect(hasValidOfflineAccessLease('account-a', 1_000 + OFFLINE_ACCESS_LEASE_MS)).toBe(false)
    expect(hasValidOfflineAccessLease('account-b', 2_000)).toBe(false)
  })

  it('removes offline access on sign out', () => {
    renewOfflineAccessLease('account-a', 1_000)
    clearOfflineAccessLease()
    expect(hasValidOfflineAccessLease('account-a', 1_001)).toBe(false)
  })
})
