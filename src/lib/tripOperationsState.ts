import type { TripOperationsPhase, TripOperationsRecommendation } from './tripOperationsAgent'

export type TripOperationsDispositionStatus = 'completed' | 'ignored' | 'snoozed'

export type TripOperationsDisposition = {
  createdAt: number
  fingerprint: string
  phase: TripOperationsPhase
  scopeKey: string
  status: TripOperationsDispositionStatus
  zonedDate: string
}

export type TripOperationsAppliedChangeAction =
  | 'bound_ticket'
  | 'cleared_ticket_cache'
  | 'created_item'
  | 'generated_route'
  | 'merged_ticket'
  | 'removed_item'
  | 'reordered_day'
  | 'retried_ticket_upload'
  | 'saved_daily_tip'
  | 'updated_content'
  | 'updated_day'
  | 'updated_item'
  | 'updated_trip'

export type TripOperationsAppliedChangeTarget =
  | 'day'
  | 'item'
  | 'route_settings'
  | 'sync_settings'
  | 'tickets'
  | 'trip'

export type TripOperationsAppliedChange = {
  action: TripOperationsAppliedChangeAction
  dayId?: string
  detail: string
  itemId?: string
  occurredAt: number
  target: TripOperationsAppliedChangeTarget
  ticketId?: string
  title: string
}

export type TripOperationsExecutionRecord = {
  appliedChanges: TripOperationsAppliedChange[]
  createdAt: number
  id: string
  recommendationFingerprints: string[]
  source: TripOperationsExecutionSource
  status: 'partial' | 'success'
  title: string
}

export type TripOperationsExecutionSource = 'ai_trip_edit' | 'travel_inbox' | 'trip_operations'

export type TripOperationsLocalState = {
  dispositions: TripOperationsDisposition[]
  history: TripOperationsExecutionRecord[]
  version: 2
}

export type TripOperationsExecutionOutcome = {
  appliedChanges: TripOperationsAppliedChange[]
  errors: string[]
  fingerprint: string
  messages: string[]
  recommendationId: string
  status: 'applied' | 'failed' | 'partial' | 'pending_preview'
}

export type TripOperationsExecutionResult = {
  appliedChanges: TripOperationsAppliedChange[]
  outcomes: TripOperationsExecutionOutcome[]
}

const STORAGE_KEY_PREFIX = 'tripmap:trip-operations:v2:'
const HISTORY_LIMIT = 20
const DISPOSITION_LIMIT = 200
const VALID_PHASES = new Set<TripOperationsPhase>([
  'post_trip',
  'pre_trip',
  'travel_evening',
  'travel_morning',
  'traveling',
])
const VALID_APPLIED_ACTIONS = new Set<TripOperationsAppliedChangeAction>([
  'bound_ticket',
  'cleared_ticket_cache',
  'created_item',
  'generated_route',
  'merged_ticket',
  'removed_item',
  'reordered_day',
  'retried_ticket_upload',
  'saved_daily_tip',
  'updated_content',
  'updated_day',
  'updated_item',
  'updated_trip',
])
const VALID_APPLIED_TARGETS = new Set<TripOperationsAppliedChangeTarget>([
  'day',
  'item',
  'route_settings',
  'sync_settings',
  'tickets',
  'trip',
])

export function createEmptyTripOperationsLocalState(): TripOperationsLocalState {
  return { dispositions: [], history: [], version: 2 }
}

export function readTripOperationsLocalState(tripId: string): TripOperationsLocalState {
  try {
    if (typeof window === 'undefined') return createEmptyTripOperationsLocalState()
    const raw = window.localStorage.getItem(getStorageKey(tripId))
    if (!raw) return createEmptyTripOperationsLocalState()
    return normalizeState(JSON.parse(raw))
  } catch {
    return createEmptyTripOperationsLocalState()
  }
}

export function writeTripOperationsLocalState(tripId: string, state: TripOperationsLocalState) {
  const normalized = normalizeState(state)
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(getStorageKey(tripId), JSON.stringify(normalized))
    }
  } catch {
    // Local execution history is best effort; the active React state still works.
  }
  return normalized
}

export function setTripOperationsDisposition({
  now = Date.now(),
  phase,
  recommendation,
  state,
  status,
  zonedDate,
}: {
  now?: number
  phase: TripOperationsPhase
  recommendation: TripOperationsRecommendation
  state: TripOperationsLocalState
  status: TripOperationsDispositionStatus
  zonedDate: string
}): TripOperationsLocalState {
  const disposition: TripOperationsDisposition = {
    createdAt: now,
    fingerprint: recommendation.fingerprint,
    phase,
    scopeKey: recommendation.scopeKey,
    status,
    zonedDate,
  }
  return normalizeState({
    ...state,
    dispositions: [
      disposition,
      ...state.dispositions.filter((entry) => entry.fingerprint !== recommendation.fingerprint),
    ],
  })
}

export function restoreTripOperationsRecommendation(
  state: TripOperationsLocalState,
  fingerprint: string,
): TripOperationsLocalState {
  return normalizeState({
    ...state,
    dispositions: state.dispositions.filter((entry) => entry.fingerprint !== fingerprint),
  })
}

export function appendTripOperationsExecutionRecord(
  state: TripOperationsLocalState,
  record: TripOperationsExecutionRecord,
): TripOperationsLocalState {
  return normalizeState({
    ...state,
    history: [record, ...state.history.filter((entry) => entry.id !== record.id)],
  })
}

export function clearTripOperationsExecutionHistory(state: TripOperationsLocalState): TripOperationsLocalState {
  return { ...state, history: [] }
}

export function getActiveTripOperationsDisposition({
  dispositions,
  fingerprint,
  phase,
  zonedDate,
}: {
  dispositions: TripOperationsDisposition[]
  fingerprint: string
  phase: TripOperationsPhase
  zonedDate: string
}) {
  const disposition = dispositions.find((entry) => entry.fingerprint === fingerprint)
  if (!disposition) return undefined
  if (disposition.status !== 'snoozed') return disposition
  return disposition.phase === phase && disposition.zonedDate === zonedDate ? disposition : undefined
}

export function createTripOperationsExecutionRecord({
  appliedChanges,
  fingerprints,
  now = Date.now(),
  source = 'trip_operations',
  status,
  title,
}: {
  appliedChanges: TripOperationsAppliedChange[]
  fingerprints: string[]
  now?: number
  source?: TripOperationsExecutionSource
  status: TripOperationsExecutionRecord['status']
  title: string
}): TripOperationsExecutionRecord {
  return {
    appliedChanges,
    createdAt: now,
    id: `trip-operations-${now}-${fingerprints.join('-').slice(0, 80)}`,
    recommendationFingerprints: [...new Set(fingerprints)],
    source,
    status,
    title,
  }
}

function getStorageKey(tripId: string) {
  return `${STORAGE_KEY_PREFIX}${tripId}`
}

function normalizeState(input: unknown): TripOperationsLocalState {
  const record = readRecord(input)
  if (record.version !== 2) return createEmptyTripOperationsLocalState()
  const dispositions = Array.isArray(record.dispositions)
    ? record.dispositions.filter(isDisposition).slice(0, DISPOSITION_LIMIT)
    : []
  const history = Array.isArray(record.history)
    ? record.history.filter(isExecutionRecord).slice(0, HISTORY_LIMIT)
    : []
  return { dispositions, history, version: 2 }
}

function isDisposition(input: unknown): input is TripOperationsDisposition {
  const record = readRecord(input)
  return (
    typeof record.createdAt === 'number' &&
    typeof record.fingerprint === 'string' &&
    VALID_PHASES.has(record.phase as TripOperationsPhase) &&
    typeof record.scopeKey === 'string' &&
    (record.status === 'completed' || record.status === 'ignored' || record.status === 'snoozed') &&
    typeof record.zonedDate === 'string'
  )
}

function isExecutionRecord(input: unknown): input is TripOperationsExecutionRecord {
  const record = readRecord(input)
  return (
    Array.isArray(record.appliedChanges) &&
    record.appliedChanges.every(isAppliedChange) &&
    typeof record.createdAt === 'number' &&
    typeof record.id === 'string' &&
    Array.isArray(record.recommendationFingerprints) &&
    record.recommendationFingerprints.every((entry) => typeof entry === 'string') &&
    (record.source === 'ai_trip_edit' || record.source === 'travel_inbox' || record.source === 'trip_operations') &&
    (record.status === 'partial' || record.status === 'success') &&
    typeof record.title === 'string'
  )
}

function isAppliedChange(input: unknown): input is TripOperationsAppliedChange {
  const record = readRecord(input)
  return (
    VALID_APPLIED_ACTIONS.has(record.action as TripOperationsAppliedChangeAction) &&
    typeof record.detail === 'string' &&
    typeof record.occurredAt === 'number' &&
    VALID_APPLIED_TARGETS.has(record.target as TripOperationsAppliedChangeTarget) &&
    typeof record.title === 'string'
  )
}

function readRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? input as Record<string, unknown> : {}
}
