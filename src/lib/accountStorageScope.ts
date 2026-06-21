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
