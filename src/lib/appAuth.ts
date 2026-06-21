import type { User } from '@supabase/supabase-js'

const OFFLINE_ACCESS_LEASE_KEY = 'tripmap:auth:offline-access-lease'
export const OFFLINE_ACCESS_LEASE_MS = 30 * 24 * 60 * 60 * 1000

type OfflineAccessLease = {
  expiresAt: number
  userId: string
  verifiedAt: number
}

export function isE2eAuthBypassEnabled() {
  return import.meta.env.VITE_E2E_AUTH_BYPASS === '1'
}

export function createE2eAuthUser(): User {
  return {
    app_metadata: {},
    aud: 'authenticated',
    created_at: new Date(0).toISOString(),
    id: 'tripmap-e2e-user',
    user_metadata: {},
  }
}

export function renewOfflineAccessLease(userId: string, now = Date.now()) {
  const lease: OfflineAccessLease = {
    expiresAt: now + OFFLINE_ACCESS_LEASE_MS,
    userId,
    verifiedAt: now,
  }
  writeLease(lease)
  return lease
}

export function hasValidOfflineAccessLease(userId: string, now = Date.now()) {
  const lease = readLease()
  return Boolean(lease && lease.userId === userId && lease.expiresAt > now)
}

export function clearOfflineAccessLease() {
  try {
    window.localStorage.removeItem(OFFLINE_ACCESS_LEASE_KEY)
  } catch {
    // The auth session still gets cleared even when browser storage is restricted.
  }
}

function readLease(): OfflineAccessLease | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(OFFLINE_ACCESS_LEASE_KEY) ?? 'null') as Partial<OfflineAccessLease> | null
    if (!value || typeof value.userId !== 'string' || !Number.isFinite(value.expiresAt) || !Number.isFinite(value.verifiedAt)) {
      return null
    }
    return value as OfflineAccessLease
  } catch {
    return null
  }
}

function writeLease(lease: OfflineAccessLease) {
  try {
    window.localStorage.setItem(OFFLINE_ACCESS_LEASE_KEY, JSON.stringify(lease))
  } catch {
    // A live Supabase session can still be used while online.
  }
}
