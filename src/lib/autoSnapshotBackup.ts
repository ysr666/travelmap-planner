export const AUTO_SNAPSHOT_BACKUP_SETTINGS_KEY = 'tripmap:cloud-auto-snapshot:enabled'
export const AUTO_SNAPSHOT_BACKUP_STATE_KEY = 'tripmap:cloud-auto-snapshot:state'
const STATE_VERSION = 1

export const AUTO_SNAPSHOT_BACKUP_EVENT = 'tripmap:cloud-auto-snapshot:changed'
export const AUTO_SNAPSHOT_BACKUP_SETTINGS_EVENT = 'tripmap:cloud-auto-snapshot:settings-changed'

export type AutoSnapshotBackupStatus = 'dirty' | 'uploading' | 'synced' | 'error'

export type AutoSnapshotBackupEntry = {
  tripId: string
  cloudVersionAtDirty?: number | null
  dirtyAt?: number
  status: AutoSnapshotBackupStatus
  reason?: string
  lastAttemptAt?: number
  lastSuccessAt?: number
  lastError?: string
}

export type AutoSnapshotBackupState = {
  version: 1
  trips: Record<string, AutoSnapshotBackupEntry>
}

export type AutoSnapshotBackupEventDetail = {
  kind: 'dirty' | 'clear' | 'status' | 'settings'
  tripId?: string
}

const memoryStorage = new Map<string, string>()

export function isAutoSnapshotBackupEnabled() {
  return readStorageValue(AUTO_SNAPSHOT_BACKUP_SETTINGS_KEY) !== '0'
}

export function setAutoSnapshotBackupEnabled(enabled: boolean) {
  writeStorageValue(AUTO_SNAPSHOT_BACKUP_SETTINGS_KEY, enabled ? '1' : '0')
  emitAutoSnapshotBackupEvent({ kind: 'settings' }, AUTO_SNAPSHOT_BACKUP_SETTINGS_EVENT)
}

export function markTripAutoSnapshotDirty(
  tripId: string,
  reason?: string,
  now = Date.now(),
  options: { cloudVersionAtDirty?: number | null } = {},
) {
  if (!tripId) {
    return
  }

  const state = readAutoSnapshotBackupState()
  state.trips[tripId] = {
    ...state.trips[tripId],
    cloudVersionAtDirty: options.cloudVersionAtDirty,
    dirtyAt: now,
    lastError: undefined,
    reason,
    status: 'dirty',
    tripId,
  }
  writeAutoSnapshotBackupState(state)
  emitAutoSnapshotBackupEvent({ kind: 'dirty', tripId })
}

export function clearTripAutoSnapshotState(tripId: string) {
  if (!tripId) {
    return
  }

  const state = readAutoSnapshotBackupState()
  if (!state.trips[tripId]) {
    return
  }

  delete state.trips[tripId]
  writeAutoSnapshotBackupState(state)
  emitAutoSnapshotBackupEvent({ kind: 'clear', tripId })
}

export function getTripAutoSnapshotStatus(tripId: string | null | undefined) {
  if (!tripId) {
    return null
  }

  return cloneEntry(readAutoSnapshotBackupState().trips[tripId])
}

export function listDirtyAutoSnapshotTrips() {
  return Object.values(readAutoSnapshotBackupState().trips)
    .filter((entry) => typeof entry.dirtyAt === 'number')
    .map(cloneEntry)
}

export function listAutoSnapshotBackupEntries() {
  return Object.values(readAutoSnapshotBackupState().trips).map(cloneEntry).filter(isAutoSnapshotEntry)
}

export function hasPendingAutoSnapshotTrips() {
  return Object.values(readAutoSnapshotBackupState().trips).some(
    (entry) => typeof entry.dirtyAt === 'number' || entry.status === 'uploading',
  )
}

export function setTripAutoSnapshotUploading(tripId: string, dirtyAt: number, now = Date.now()) {
  updateTripStatusIfDirtyUnchanged(tripId, dirtyAt, {
    lastAttemptAt: now,
    status: 'uploading',
  })
}

export function completeTripAutoSnapshotSuccess(tripId: string, dirtyAt: number, now = Date.now()) {
  const state = readAutoSnapshotBackupState()
  const current = state.trips[tripId]
  if (!current || current.dirtyAt !== dirtyAt) {
    return false
  }

  state.trips[tripId] = {
    ...current,
    dirtyAt: undefined,
    cloudVersionAtDirty: undefined,
    lastError: undefined,
    lastSuccessAt: now,
    status: 'synced',
  }
  writeAutoSnapshotBackupState(state)
  emitAutoSnapshotBackupEvent({ kind: 'status', tripId })
  return true
}

export function markTripAutoSnapshotSynced(tripId: string, now = Date.now()) {
  if (!tripId) {
    return
  }

  const state = readAutoSnapshotBackupState()
  state.trips[tripId] = {
    ...state.trips[tripId],
    cloudVersionAtDirty: undefined,
    dirtyAt: undefined,
    lastError: undefined,
    lastSuccessAt: now,
    status: 'synced',
    tripId,
  }
  writeAutoSnapshotBackupState(state)
  emitAutoSnapshotBackupEvent({ kind: 'status', tripId })
}

export function completeTripAutoSnapshotFailure(
  tripId: string,
  dirtyAt: number,
  error: string,
  now = Date.now(),
) {
  updateTripStatusIfDirtyUnchanged(tripId, dirtyAt, {
    lastAttemptAt: now,
    lastError: error,
    status: 'error',
  })
}

export function requestTripAutoSnapshotRetry(tripId: string) {
  if (!tripId) {
    return false
  }

  const state = readAutoSnapshotBackupState()
  const current = state.trips[tripId]
  if (!current?.dirtyAt) {
    return false
  }

  state.trips[tripId] = {
    ...current,
    lastError: undefined,
    status: 'dirty',
    tripId,
  }
  writeAutoSnapshotBackupState(state)
  emitAutoSnapshotBackupEvent({ kind: 'dirty', tripId })
  return true
}

export function subscribeAutoSnapshotBackup(listener: (detail: AutoSnapshotBackupEventDetail) => void) {
  if (typeof window === 'undefined') {
    return () => undefined
  }

  const handler = (event: Event) => {
    listener((event as CustomEvent<AutoSnapshotBackupEventDetail>).detail)
  }

  window.addEventListener(AUTO_SNAPSHOT_BACKUP_EVENT, handler)
  window.addEventListener(AUTO_SNAPSHOT_BACKUP_SETTINGS_EVENT, handler)
  return () => {
    window.removeEventListener(AUTO_SNAPSHOT_BACKUP_EVENT, handler)
    window.removeEventListener(AUTO_SNAPSHOT_BACKUP_SETTINGS_EVENT, handler)
  }
}

export function resetAutoSnapshotBackupForTests() {
  removeStorageValue(AUTO_SNAPSHOT_BACKUP_SETTINGS_KEY)
  removeStorageValue(AUTO_SNAPSHOT_BACKUP_STATE_KEY)
  memoryStorage.clear()
}

function updateTripStatusIfDirtyUnchanged(
  tripId: string,
  dirtyAt: number,
  patch: Partial<AutoSnapshotBackupEntry> & Pick<AutoSnapshotBackupEntry, 'status'>,
) {
  const state = readAutoSnapshotBackupState()
  const current = state.trips[tripId]
  if (!current || current.dirtyAt !== dirtyAt) {
    return false
  }

  state.trips[tripId] = {
    ...current,
    ...patch,
    tripId,
  }
  writeAutoSnapshotBackupState(state)
  emitAutoSnapshotBackupEvent({ kind: 'status', tripId })
  return true
}

function readAutoSnapshotBackupState(): AutoSnapshotBackupState {
  const raw = readStorageValue(AUTO_SNAPSHOT_BACKUP_STATE_KEY)
  if (!raw) {
    return createEmptyState()
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isAutoSnapshotBackupState(parsed)) {
      throw new Error('invalid state')
    }
    return parsed
  } catch {
    const empty = createEmptyState()
    writeAutoSnapshotBackupState(empty)
    return empty
  }
}

function writeAutoSnapshotBackupState(state: AutoSnapshotBackupState) {
  writeStorageValue(AUTO_SNAPSHOT_BACKUP_STATE_KEY, JSON.stringify(state))
}

function createEmptyState(): AutoSnapshotBackupState {
  return {
    trips: {},
    version: STATE_VERSION,
  }
}

function isAutoSnapshotBackupState(value: unknown): value is AutoSnapshotBackupState {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as AutoSnapshotBackupState
  if (candidate.version !== STATE_VERSION || !candidate.trips || typeof candidate.trips !== 'object') {
    return false
  }

  return Object.values(candidate.trips).every((entry) => {
    if (!entry || typeof entry !== 'object') {
      return false
    }
    const status = (entry as AutoSnapshotBackupEntry).status
    return (
      typeof (entry as AutoSnapshotBackupEntry).tripId === 'string' &&
      (status === 'dirty' || status === 'uploading' || status === 'synced' || status === 'error')
    )
  })
}

function cloneEntry(entry: AutoSnapshotBackupEntry | undefined) {
  return entry ? { ...entry } : null
}

function isAutoSnapshotEntry(entry: AutoSnapshotBackupEntry | null): entry is AutoSnapshotBackupEntry {
  return Boolean(entry)
}

function emitAutoSnapshotBackupEvent(
  detail: AutoSnapshotBackupEventDetail,
  eventName = AUTO_SNAPSHOT_BACKUP_EVENT,
) {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new CustomEvent(eventName, { detail }))
  if (eventName !== AUTO_SNAPSHOT_BACKUP_EVENT) {
    window.dispatchEvent(new CustomEvent(AUTO_SNAPSHOT_BACKUP_EVENT, { detail }))
  }
}

function readStorageValue(key: string) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(key)
    }
  } catch {
    // Fall through to in-memory storage for restricted environments.
  }

  return memoryStorage.get(key) ?? null
}

function writeStorageValue(key: string, value: string) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, value)
      return
    }
  } catch {
    // Fall through to in-memory storage for restricted environments.
  }

  memoryStorage.set(key, value)
}

function removeStorageValue(key: string) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(key)
      return
    }
  } catch {
    // Fall through to in-memory storage for restricted environments.
  }

  memoryStorage.delete(key)
}
