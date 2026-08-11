let activeAccountHash: string | null = null

export function setActiveAccountStorageScope(accountHash: string) {
  activeAccountHash = accountHash
}

export function clearActiveAccountStorageScope() {
  activeAccountHash = null
}

export function getActiveAccountHash() {
  return activeAccountHash
}

export function getAccountScopedStorageKey(key: string) {
  return activeAccountHash ? `${key}:account:${activeAccountHash}` : key
}

export async function hashAccountStorageScopeId(userId: string) {
  const normalized = userId.trim()
  if (!normalized) throw new Error('账号标识无效。')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized))
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('').slice(0, 32)
}
