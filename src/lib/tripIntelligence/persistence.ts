import { db } from '../../db/database'
import type {
  TripIntelligenceAppliedChangeRecord,
  TripIntelligenceSuggestionStateRecord,
} from '../../types'
import { emitTravelDataChanged } from '../dataEvents'
import {
  createEmptyTripOperationsLocalState,
  readTripOperationsLocalState,
  type TripOperationsDisposition,
  type TripOperationsExecutionRecord,
  type TripOperationsLocalState,
} from '../tripOperationsState'
import { enqueueObjectDelete, enqueueObjectUpsert } from '../objectSyncLocal'
import {
  getTripIntelligenceAppliedChangesForRecord,
  sanitizeAppliedChangeDetail,
} from './appliedChanges'

const LEGACY_STORAGE_KEY_PREFIX = 'tripmap:trip-operations:v2:'
const LEGACY_MIGRATION_MARKER_PREFIX = 'tripmap:trip-intelligence:migrated:v1:'
const DAY_MS = 24 * 60 * 60 * 1000
const APPLIED_CHANGE_RETENTION_MS = 180 * DAY_MS
const SUGGESTION_STATE_RETENTION_MS = 365 * DAY_MS
const APPLIED_CHANGE_LIMIT = 200

export type TripIntelligencePersistedLocalState = {
  localState: TripOperationsLocalState
  suggestionStates: TripIntelligenceSuggestionStateRecord[]
}

export async function loadTripIntelligenceLocalState(
  tripId: string,
  now = Date.now(),
): Promise<TripIntelligencePersistedLocalState> {
  await migrateLegacyTripOperationsState(tripId, now)
  await pruneTripIntelligencePersistence(tripId, now)
  const [appliedChanges, suggestionStates] = await Promise.all([
    db.tripIntelligenceAppliedChanges.where('tripId').equals(tripId).toArray(),
    listTripIntelligenceSuggestionStates(tripId),
  ])
  return {
    localState: buildTripOperationsLocalState(appliedChanges, suggestionStates),
    suggestionStates,
  }
}

export async function persistTripIntelligenceLocalState(
  tripId: string,
  state: TripOperationsLocalState,
  now = Date.now(),
) {
  const existingAppliedChanges = await db.tripIntelligenceAppliedChanges.where('tripId').equals(tripId).toArray()
  const existingSuggestionStates = await db.tripIntelligenceSuggestionStates.where('tripId').equals(tripId).toArray()
  const existingAppliedById = new Map(existingAppliedChanges.map((record) => [record.id, record]))
  const existingOperationsStates = existingSuggestionStates.filter((record) => record.sourceKind === 'operations' || record.legacyFingerprint)
  const desiredSuggestionStates = state.dispositions.map((disposition) => mapDispositionToRecord(tripId, disposition))
  const desiredStateIds = new Set(desiredSuggestionStates.map((record) => record.id))
  const appliedRecords = state.history.flatMap((record) => mapExecutionRecord(tripId, record))
  const appliedUpserts = appliedRecords.filter((record) => !isSameRecord(existingAppliedById.get(record.id), record))
  const stateById = new Map(existingSuggestionStates.map((record) => [record.id, record]))
  const stateUpserts = desiredSuggestionStates.filter((record) => !isSameRecord(stateById.get(record.id), record))
  const stateDeletes = existingOperationsStates.filter((record) => !desiredStateIds.has(record.id))

  await db.transaction(
    'rw',
    [db.tripIntelligenceAppliedChanges, db.tripIntelligenceSuggestionStates],
    async () => {
      if (appliedUpserts.length > 0) await db.tripIntelligenceAppliedChanges.bulkPut(appliedUpserts)
      if (stateUpserts.length > 0) await db.tripIntelligenceSuggestionStates.bulkPut(stateUpserts)
      if (stateDeletes.length > 0) await db.tripIntelligenceSuggestionStates.bulkDelete(stateDeletes.map((record) => record.id))
    },
  )

  await Promise.all([
    ...appliedUpserts.map((record) => enqueueObjectUpsert({ object: record, objectType: 'trip_intelligence_applied_change' })),
    ...stateUpserts.map((record) => enqueueObjectUpsert({ object: record, objectType: 'trip_intelligence_suggestion_state' })),
    ...stateDeletes.map((record) => enqueueObjectDelete({
      objectId: record.id,
      objectType: 'trip_intelligence_suggestion_state',
      tripId,
    })),
  ])
  await pruneTripIntelligencePersistence(tripId, now)
  return loadPersistedStateWithoutMigration(tripId)
}

export async function clearTripIntelligenceHistory(tripId: string) {
  const records = await db.tripIntelligenceAppliedChanges.where('tripId').equals(tripId).toArray()
  if (records.length === 0) return
  const deletedAtMs = Date.now()
  await db.tripIntelligenceAppliedChanges.bulkDelete(records.map((record) => record.id))
  await Promise.all(records.map((record) => enqueueObjectDelete({
    deletedAtMs,
    objectId: record.id,
    objectType: 'trip_intelligence_applied_change',
    tripId,
  })))
  emitTravelDataChanged()
}

export async function restoreTripIntelligenceSuggestionState(tripId: string, suggestionKey: string) {
  const record = await db.tripIntelligenceSuggestionStates
    .where('[tripId+suggestionKey]')
    .equals([tripId, suggestionKey])
    .first()
  if (!record) return
  await db.tripIntelligenceSuggestionStates.delete(record.id)
  await enqueueObjectDelete({
    objectId: record.id,
    objectType: 'trip_intelligence_suggestion_state',
    tripId,
  })
  emitTravelDataChanged()
}

export async function listTripIntelligenceSuggestionStates(tripId: string) {
  return db.tripIntelligenceSuggestionStates
    .where('tripId')
    .equals(tripId)
    .sortBy('updatedAt')
    .then((records) => records.reverse())
}

export async function pruneTripIntelligencePersistence(tripId: string, now = Date.now()) {
  const [appliedChanges, suggestionStates] = await Promise.all([
    db.tripIntelligenceAppliedChanges.where('tripId').equals(tripId).toArray(),
    db.tripIntelligenceSuggestionStates.where('tripId').equals(tripId).toArray(),
  ])
  const retainedAppliedIds = new Set(
    appliedChanges
      .filter((record) => record.occurredAt >= now - APPLIED_CHANGE_RETENTION_MS)
      .sort((first, second) => second.occurredAt - first.occurredAt || second.updatedAt - first.updatedAt)
      .slice(0, APPLIED_CHANGE_LIMIT)
      .map((record) => record.id),
  )
  const appliedDeletes = appliedChanges.filter((record) => !retainedAppliedIds.has(record.id))
  const stateDeletes = suggestionStates.filter((record) => {
    if (record.status === 'later') return !record.until || record.until <= now
    return record.updatedAt < now - SUGGESTION_STATE_RETENTION_MS
  })
  if (appliedDeletes.length === 0 && stateDeletes.length === 0) return

  await db.transaction(
    'rw',
    [db.tripIntelligenceAppliedChanges, db.tripIntelligenceSuggestionStates],
    async () => {
      if (appliedDeletes.length > 0) await db.tripIntelligenceAppliedChanges.bulkDelete(appliedDeletes.map((record) => record.id))
      if (stateDeletes.length > 0) await db.tripIntelligenceSuggestionStates.bulkDelete(stateDeletes.map((record) => record.id))
    },
  )
  const deletedAtMs = now
  await Promise.all([
    ...appliedDeletes.map((record) => enqueueObjectDelete({
      deletedAtMs,
      objectId: record.id,
      objectType: 'trip_intelligence_applied_change',
      tripId,
    })),
    ...stateDeletes.map((record) => enqueueObjectDelete({
      deletedAtMs,
      objectId: record.id,
      objectType: 'trip_intelligence_suggestion_state',
      tripId,
    })),
  ])
}

async function migrateLegacyTripOperationsState(tripId: string, now: number) {
  if (typeof window === 'undefined') return
  const markerKey = `${LEGACY_MIGRATION_MARKER_PREFIX}${tripId}`
  if (readStorage(markerKey) === '1') return
  const legacyKey = `${LEGACY_STORAGE_KEY_PREFIX}${tripId}`
  if (readStorage(legacyKey)) {
    await persistTripIntelligenceLocalState(tripId, readTripOperationsLocalState(tripId), now)
  }
  writeStorage(markerKey, '1')
}

async function loadPersistedStateWithoutMigration(tripId: string): Promise<TripIntelligencePersistedLocalState> {
  const [appliedChanges, suggestionStates] = await Promise.all([
    db.tripIntelligenceAppliedChanges.where('tripId').equals(tripId).toArray(),
    listTripIntelligenceSuggestionStates(tripId),
  ])
  return {
    localState: buildTripOperationsLocalState(appliedChanges, suggestionStates),
    suggestionStates,
  }
}

function mapDispositionToRecord(
  tripId: string,
  disposition: TripOperationsDisposition,
): TripIntelligenceSuggestionStateRecord {
  const suggestionKey = disposition.suggestionKey || `operations:${disposition.scopeKey}`
  return {
    createdAt: disposition.createdAt,
    id: buildSuggestionStateId(tripId, suggestionKey),
    legacyFingerprint: disposition.fingerprint,
    phase: disposition.phase,
    scopeKey: disposition.scopeKey,
    sourceKind: 'operations',
    status: disposition.status === 'snoozed' ? 'later' : disposition.status,
    suggestionKey,
    tripId,
    until: disposition.status === 'snoozed' ? getLatestPossibleEndOfZonedDate(disposition.zonedDate) : undefined,
    updatedAt: disposition.createdAt,
    zonedDate: disposition.zonedDate,
  }
}

function mapExecutionRecord(
  tripId: string,
  execution: TripOperationsExecutionRecord,
): TripIntelligenceAppliedChangeRecord[] {
  return getTripIntelligenceAppliedChangesForRecord(execution).map((change) => {
    const privacyLevel = change.source.kind === 'document' || change.targetType === 'document'
      ? 'sensitive_redacted'
      : 'private'
    const recordId = buildAppliedChangeId(tripId, change.id)
    const sourceLabel = privacyLevel === 'sensitive_redacted'
      ? '资料库'
      : sanitizeAppliedChangeDetail(change.source.label)
    const title = privacyLevel === 'sensitive_redacted'
      ? '资料操作已完成'
      : sanitizeAppliedChangeDetail(change.title) ?? '已完成的旅行修改'
    const detail = privacyLevel === 'sensitive_redacted'
      ? '已完成一项脱敏资料操作。'
      : sanitizeAppliedChangeDetail(change.detail)
    return {
      actionType: sanitizeIdentifier(change.actionType),
      dedupeKey: privacyLevel === 'sensitive_redacted' ? `${tripId}:${recordId}` : `${tripId}:${change.id}`,
      detail,
      executionId: execution.id,
      executionSource: execution.source,
      executionStatus: execution.status,
      executionTitle: privacyLevel === 'sensitive_redacted'
        ? '资料操作已完成'
        : sanitizeAppliedChangeDetail(execution.title) ?? '已完成的旅行修改',
      id: recordId,
      occurredAt: change.occurredAt,
      privacyLevel,
      recommendationFingerprints: execution.recommendationFingerprints.filter(isSafeIdentifier).slice(0, 50),
      sourceId: privacyLevel === 'sensitive_redacted' ? 'document' : sanitizeIdentifier(change.source.id),
      sourceKind: change.source.kind,
      sourceLabel,
      targetId: privacyLevel === 'sensitive_redacted'
        ? undefined
        : change.targetId ? sanitizeIdentifier(change.targetId) : undefined,
      targetType: change.targetType,
      title,
      tripId,
      updatedAt: change.occurredAt,
    }
  })
}

function buildTripOperationsLocalState(
  appliedChanges: TripIntelligenceAppliedChangeRecord[],
  suggestionStates: TripIntelligenceSuggestionStateRecord[],
): TripOperationsLocalState {
  const dedupedAppliedChanges = dedupeAppliedChanges(appliedChanges)
  const byExecution = new Map<string, TripIntelligenceAppliedChangeRecord[]>()
  for (const record of dedupedAppliedChanges) {
    const current = byExecution.get(record.executionId) ?? []
    current.push(record)
    byExecution.set(record.executionId, current)
  }
  const history = [...byExecution.values()]
    .map((records): TripOperationsExecutionRecord => {
      const latest = records.reduce((current, record) => record.occurredAt > current.occurredAt ? record : current)
      return {
        appliedChanges: [],
        createdAt: latest.occurredAt,
        id: latest.executionId,
        intelligenceAppliedChanges: records
          .sort((first, second) => second.occurredAt - first.occurredAt)
          .map((record) => ({
            actionType: record.actionType,
            detail: record.detail,
            id: record.dedupeKey.slice(record.tripId.length + 1),
            occurredAt: record.occurredAt,
            source: { id: record.sourceId, kind: record.sourceKind, label: record.sourceLabel },
            targetId: record.targetId,
            targetType: record.targetType,
            title: record.title,
          })),
        recommendationFingerprints: latest.recommendationFingerprints,
        source: latest.executionSource,
        status: latest.executionStatus,
        title: latest.executionTitle,
      }
    })
    .sort((first, second) => second.createdAt - first.createdAt)
    .slice(0, 20)

  const dispositions = suggestionStates
    .filter((record) => record.sourceKind === 'operations' && record.legacyFingerprint && record.phase && record.scopeKey && record.zonedDate)
    .map((record): TripOperationsDisposition => ({
      createdAt: record.updatedAt,
      fingerprint: record.legacyFingerprint!,
      phase: record.phase!,
      scopeKey: record.scopeKey!,
      status: record.status === 'later' ? 'snoozed' : record.status,
      suggestionKey: record.suggestionKey,
      zonedDate: record.zonedDate!,
    }))
    .slice(0, 200)
  return { dispositions, history, version: 2 }
}

function dedupeAppliedChanges(records: TripIntelligenceAppliedChangeRecord[]) {
  const byDedupeKey = new Map<string, TripIntelligenceAppliedChangeRecord>()
  for (const record of records) {
    const current = byDedupeKey.get(record.dedupeKey)
    if (!current || record.occurredAt > current.occurredAt || (record.occurredAt === current.occurredAt && record.updatedAt > current.updatedAt)) {
      byDedupeKey.set(record.dedupeKey, record)
    }
  }
  return [...byDedupeKey.values()]
}

function buildSuggestionStateId(tripId: string, suggestionKey: string) {
  return `trip-intelligence-state-${hashString(`${tripId}:${suggestionKey}`)}`
}

function buildAppliedChangeId(tripId: string, changeId: string) {
  return `trip-intelligence-change-${hashString(`${tripId}:${changeId}`)}`
}

function getLatestPossibleEndOfZonedDate(zonedDate: string) {
  const parsed = Date.parse(`${zonedDate}T23:59:59.999-12:00`)
  return Number.isFinite(parsed) ? parsed : Date.now() + DAY_MS
}

function sanitizeIdentifier(input: string) {
  return input.replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 160) || 'redacted'
}

function isSafeIdentifier(input: string) {
  return /^[a-zA-Z0-9:_-]{1,200}$/.test(input)
}

function hashString(input: string) {
  let hash = 0
  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(31, hash) + input.charCodeAt(index) | 0
  }
  return Math.abs(hash).toString(36)
}

function isSameRecord(left: unknown, right: unknown) {
  return left !== undefined && JSON.stringify(left) === JSON.stringify(right)
}

function readStorage(key: string) {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Migration remains idempotent because persisted record ids are deterministic.
  }
}

export function createEmptyTripIntelligencePersistedLocalState(): TripIntelligencePersistedLocalState {
  return { localState: createEmptyTripOperationsLocalState(), suggestionStates: [] }
}
