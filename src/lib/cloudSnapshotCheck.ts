import type { AutoSnapshotBackupEntry } from './autoSnapshotBackup'
import type { CloudBackupSummary } from './cloudBackup'
import type { Trip } from '../types'

export type CloudSnapshotCheckStatus =
  | 'local_newer'
  | 'cloud_newer'
  | 'possible_conflict'
  | 'in_sync'
  | 'unknown'

export type CloudSnapshotCheckResult = {
  backup: CloudBackupSummary
  backupId: string
  cloudVersion: number
  cloudVersionIso: string
  dirtyAt: number | null
  localVersion: number
  signature: string
  status: CloudSnapshotCheckStatus
  tripId: string
  tripTitle: string
  tripUpdatedAt: number | null
}

export type CloudSnapshotCheckState = {
  error: string | null
  isChecking: boolean
  results: CloudSnapshotCheckResult[]
  updatedAt: number | null
}

type BackupWithLegacyTripId = CloudBackupSummary & {
  tripId?: string
}

type BuildCloudSnapshotCheckResultsInput = {
  autoStatusByTripId?: Record<string, AutoSnapshotBackupEntry | null | undefined>
  backups: CloudBackupSummary[]
  trips: Trip[]
}

const VERSION_TOLERANCE_MS = 2_000
const DISMISSED_PROMPTS_KEY = 'tripmap:cloud-snapshot-check:dismissed'
const CLOUD_SNAPSHOT_CHECK_EVENT = 'tripmap:cloud-snapshot-check:changed'

let currentState: CloudSnapshotCheckState = {
  error: null,
  isChecking: false,
  results: [],
  updatedAt: null,
}
let refreshProvider: (() => Promise<CloudSnapshotCheckResult[]>) | null = null
let refreshInFlight: Promise<CloudSnapshotCheckResult[]> | null = null
let refreshQueued = false

export function compareCloudSnapshotVersions({
  autoStatus,
  backup,
  trip,
}: {
  autoStatus?: AutoSnapshotBackupEntry | null
  backup?: CloudBackupSummary | null
  trip: Trip
}) {
  const cloudVersion = backup ? getCloudBackupVersion(backup) : null
  const tripUpdatedAt = normalizeTimestamp(trip.updatedAt)
  const dirtyAt = normalizeTimestamp(autoStatus?.dirtyAt)
  const lastSuccessAt = normalizeTimestamp(autoStatus?.lastSuccessAt)

  if (!backup || !cloudVersion || !tripUpdatedAt) {
    return {
      cloudVersion: cloudVersion?.time ?? null,
      dirtyAt,
      localVersion: dirtyAt ?? tripUpdatedAt ?? null,
      status: 'unknown' as CloudSnapshotCheckStatus,
      tripUpdatedAt,
    }
  }

  const localVersion = Math.max(tripUpdatedAt, dirtyAt ?? 0)

  if (dirtyAt) {
    if (!lastSuccessAt || cloudVersion.time > lastSuccessAt + VERSION_TOLERANCE_MS) {
      return {
        cloudVersion: cloudVersion.time,
        dirtyAt,
        localVersion,
        status: 'possible_conflict' as CloudSnapshotCheckStatus,
        tripUpdatedAt,
      }
    }
  }

  if (localVersion > cloudVersion.time + VERSION_TOLERANCE_MS) {
    return {
      cloudVersion: cloudVersion.time,
      dirtyAt,
      localVersion,
      status: 'local_newer' as CloudSnapshotCheckStatus,
      tripUpdatedAt,
    }
  }

  if (cloudVersion.time > localVersion + VERSION_TOLERANCE_MS) {
    return {
      cloudVersion: cloudVersion.time,
      dirtyAt,
      localVersion,
      status: 'cloud_newer' as CloudSnapshotCheckStatus,
      tripUpdatedAt,
    }
  }

  return {
    cloudVersion: cloudVersion.time,
    dirtyAt,
    localVersion,
    status: 'in_sync' as CloudSnapshotCheckStatus,
    tripUpdatedAt,
  }
}

export function buildCloudSnapshotCheckResults({
  autoStatusByTripId = {},
  backups,
  trips,
}: BuildCloudSnapshotCheckResultsInput) {
  const backupByTripId = groupLatestCloudBackupsByTripId(backups)
  const results: CloudSnapshotCheckResult[] = []

  for (const trip of trips) {
    const backup = backupByTripId.get(trip.id)
    if (!backup) {
      continue
    }

    const comparison = compareCloudSnapshotVersions({
      autoStatus: autoStatusByTripId[trip.id],
      backup,
      trip,
    })
    if (
      comparison.status === 'unknown' ||
      comparison.status === 'in_sync' ||
      comparison.cloudVersion === null ||
      comparison.localVersion === null
    ) {
      continue
    }

    const signature = buildCloudSnapshotCheckSignature({
      backupId: backup.id,
      cloudVersion: comparison.cloudVersion,
      localVersion: comparison.localVersion,
      status: comparison.status,
      tripId: trip.id,
    })
    if (isCloudSnapshotPromptDismissed(signature)) {
      continue
    }

    results.push({
      backup,
      backupId: backup.id,
      cloudVersion: comparison.cloudVersion,
      cloudVersionIso: new Date(comparison.cloudVersion).toISOString(),
      dirtyAt: comparison.dirtyAt ?? null,
      localVersion: comparison.localVersion,
      signature,
      status: comparison.status,
      tripId: trip.id,
      tripTitle: trip.title,
      tripUpdatedAt: comparison.tripUpdatedAt ?? null,
    })
  }

  return deduplicateResultsByTripId(results).sort((first, second) => second.cloudVersion - first.cloudVersion)
}

export function deduplicateResultsByTripId(results: CloudSnapshotCheckResult[]) {
  const byTripId = new Map<string, CloudSnapshotCheckResult>()
  for (const result of results) {
    const existing = byTripId.get(result.tripId)
    if (!existing || result.cloudVersion > existing.cloudVersion) {
      byTripId.set(result.tripId, result)
    }
  }
  return [...byTripId.values()]
}

export function formatVersionTimestamp(epochMs: number | null): string | null {
  if (epochMs == null || !Number.isFinite(epochMs) || epochMs <= 0) {
    return null
  }
  const date = new Date(epochMs)
  if (Number.isNaN(date.getTime())) {
    return null
  }
  const pad = (value: number) => value.toString().padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function groupLatestCloudBackupsByTripId(backups: CloudBackupSummary[]) {
  const byTripId = new Map<string, CloudBackupSummary>()

  for (const backup of backups) {
    const tripId = getBackupTripId(backup)
    const version = getCloudBackupVersion(backup)
    if (!tripId || !version) {
      continue
    }

    const existing = byTripId.get(tripId)
    const existingVersion = existing ? getCloudBackupVersion(existing) : null
    if (!existing || !existingVersion || version.time > existingVersion.time) {
      byTripId.set(tripId, backup)
    }
  }

  return byTripId
}

export function buildCloudSnapshotCheckSignature({
  backupId,
  cloudVersion,
  localVersion,
  status,
  tripId,
}: {
  backupId: string
  cloudVersion: number
  localVersion: number
  status: CloudSnapshotCheckStatus
  tripId: string
}) {
  return [tripId, status, localVersion, cloudVersion, backupId].join('|')
}

export function isPromptableCloudSnapshotStatus(status: CloudSnapshotCheckStatus) {
  return status === 'local_newer' || status === 'cloud_newer' || status === 'possible_conflict'
}

export function dismissCloudSnapshotPrompt(signature: string) {
  addDismissedSignature(signature)
  setCloudSnapshotCheckResults(currentState.results.filter((result) => result.signature !== signature))
}

export function suppressCloudSnapshotPrompt(signature: string) {
  dismissCloudSnapshotPrompt(signature)
}

export function isCloudSnapshotPromptDismissed(signature: string) {
  return readDismissedSignatures().has(signature)
}

export function subscribeCloudSnapshotChecks(listener: (state: CloudSnapshotCheckState) => void) {
  if (typeof window === 'undefined') {
    return () => undefined
  }

  const handler = () => listener(getCloudSnapshotCheckState())
  window.addEventListener(CLOUD_SNAPSHOT_CHECK_EVENT, handler)
  listener(getCloudSnapshotCheckState())
  return () => window.removeEventListener(CLOUD_SNAPSHOT_CHECK_EVENT, handler)
}

export function getCloudSnapshotCheckState() {
  return {
    ...currentState,
    results: [...currentState.results],
  }
}

export function setCloudSnapshotCheckRefreshProvider(provider: (() => Promise<CloudSnapshotCheckResult[]>) | null) {
  refreshProvider = provider
}

export async function refreshCloudSnapshotChecks() {
  if (!refreshProvider) {
    setCloudSnapshotCheckResults([])
    return []
  }

  if (refreshInFlight) {
    refreshQueued = true
    return refreshInFlight
  }

  setCloudSnapshotCheckState({ ...currentState, error: null, isChecking: true })
  refreshInFlight = refreshProvider()
    .then((results) => {
      setCloudSnapshotCheckResults(results)
      return results
    })
    .catch((caught) => {
      setCloudSnapshotCheckState({
        ...currentState,
        error: caught instanceof Error ? caught.message : '检查云端快照失败。',
        isChecking: false,
      })
      return []
    })
    .finally(() => {
      refreshInFlight = null
      if (refreshQueued) {
        refreshQueued = false
        setTimeout(() => {
          void refreshCloudSnapshotChecks()
        }, 0)
      }
    })

  return refreshInFlight
}

export function setCloudSnapshotCheckResults(results: CloudSnapshotCheckResult[]) {
  setCloudSnapshotCheckState({
    error: null,
    isChecking: false,
    results: results.filter(
      (result) => isPromptableCloudSnapshotStatus(result.status) && !isCloudSnapshotPromptDismissed(result.signature),
    ),
    updatedAt: Date.now(),
  })
}

export function resetCloudSnapshotChecksForTests() {
  currentState = {
    error: null,
    isChecking: false,
    results: [],
    updatedAt: null,
  }
  refreshProvider = null
  refreshInFlight = null
  refreshQueued = false
  if (typeof window === 'undefined') {
    return
  }
  try {
    window.sessionStorage.removeItem(DISMISSED_PROMPTS_KEY)
  } catch {
    // Session storage is best-effort only.
  }
}

function getBackupTripId(backup: CloudBackupSummary) {
  const candidate = backup as BackupWithLegacyTripId
  return backup.originalTripId || candidate.tripId || null
}

function getCloudBackupVersion(backup: CloudBackupSummary) {
  const exportedAt = parseTimestamp(backup.exportedAt)
  if (exportedAt) {
    return { source: 'exportedAt' as const, time: exportedAt }
  }

  const createdAt = parseTimestamp(backup.createdAt)
  return createdAt ? { source: 'createdAt' as const, time: createdAt } : null
}

function parseTimestamp(value: string | number | undefined | null) {
  if (typeof value === 'number') {
    return normalizeTimestamp(value)
  }
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }
  return normalizeTimestamp(Date.parse(value))
}

function normalizeTimestamp(value: number | undefined | null) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function setCloudSnapshotCheckState(state: CloudSnapshotCheckState) {
  currentState = state
  emitCloudSnapshotCheckEvent()
}

function readDismissedSignatures() {
  const signatures = new Set<string>()
  if (typeof window === 'undefined') {
    return signatures
  }
  try {
    const raw = window.sessionStorage.getItem(DISMISSED_PROMPTS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (Array.isArray(parsed)) {
      for (const value of parsed) {
        if (typeof value === 'string') {
          signatures.add(value)
        }
      }
    }
  } catch {
    // Session storage is best-effort only.
  }
  return signatures
}

function addDismissedSignature(signature: string) {
  if (typeof window === 'undefined') {
    return
  }
  try {
    const signatures = readDismissedSignatures()
    signatures.add(signature)
    window.sessionStorage.setItem(DISMISSED_PROMPTS_KEY, JSON.stringify([...signatures]))
  } catch {
    // Session storage is best-effort only.
  }
}

function emitCloudSnapshotCheckEvent() {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new CustomEvent(CLOUD_SNAPSHOT_CHECK_EVENT))
}
