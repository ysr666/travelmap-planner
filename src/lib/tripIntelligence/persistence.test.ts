// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/database'
import type { TripIntelligenceAppliedChangeRecord, TripIntelligenceSuggestionStateRecord } from '../../types'
import {
  appendTripOperationsExecutionRecord,
  createEmptyTripOperationsLocalState,
  createTripOperationsExecutionRecord,
  setTripOperationsDisposition,
  writeTripOperationsLocalState,
} from '../tripOperationsState'
import type { TripOperationsRecommendation } from '../tripOperationsAgent'
import {
  clearTripIntelligenceHistory,
  loadTripIntelligenceLocalState,
  persistTripIntelligenceLocalState,
  pruneTripIntelligencePersistence,
  restoreTripIntelligenceSuggestionState,
} from './persistence'

beforeEach(async () => {
  window.localStorage.clear()
  db.close()
  await db.delete()
  await db.open()
})

describe('trip intelligence persistence', () => {
  it('migrates legacy localStorage once without duplicating records', async () => {
    let state = setTripOperationsDisposition({
      now: 10,
      phase: 'traveling',
      recommendation,
      state: createEmptyTripOperationsLocalState(),
      status: 'ignored',
      zonedDate: '2026-06-20',
    })
    state = appendTripOperationsExecutionRecord(state, createTripOperationsExecutionRecord({
      appliedChanges: [],
      fingerprints: [recommendation.fingerprint],
      intelligenceAppliedChanges: [appliedChange('legacy-change', 20)],
      now: 20,
      status: 'success',
      title: '已完成路线检查',
    }))
    writeTripOperationsLocalState('trip-1', state)

    const first = await loadTripIntelligenceLocalState('trip-1', 30)
    const second = await loadTripIntelligenceLocalState('trip-1', 30)

    expect(first.localState.history).toHaveLength(1)
    expect(first.suggestionStates).toEqual([
      expect.objectContaining({ legacyFingerprint: recommendation.fingerprint, status: 'ignored' }),
    ])
    expect(second).toEqual(first)
    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(1)
    await expect(db.tripIntelligenceSuggestionStates.count()).resolves.toBe(1)
    expect(window.localStorage.getItem('tripmap:trip-operations:v2:trip-1')).toBeTruthy()
  })

  it('sanitizes persisted history before it enters IndexedDB and object sync', async () => {
    const state = appendTripOperationsExecutionRecord(
      createEmptyTripOperationsLocalState(),
      createTripOperationsExecutionRecord({
        appliedChanges: [],
        fingerprints: ['safe-fingerprint'],
        intelligenceAppliedChanges: [{
          actionType: 'document_saved',
          detail: 'PNR AB12CD 订单号 123456789 Authorization: Bearer secret-token rawProviderPayload={"passport":"E12345678"}\n at save (vault.ts:1)',
          id: 'document-change-1',
          occurredAt: 100,
          source: { id: 'vault-secret-object', kind: 'document', label: '护照 E12345678' },
          targetId: 'E12345678',
          targetType: 'document',
          title: '叶某护照 E12345678',
        }],
        now: 100,
        status: 'success',
        title: '保存护照 E12345678',
      }),
    )

    await persistTripIntelligenceLocalState('trip-1', state, 100)
    const raw = JSON.stringify(await db.tripIntelligenceAppliedChanges.toArray())

    expect(raw).not.toContain('AB12CD')
    expect(raw).not.toContain('123456789')
    expect(raw).not.toContain('secret-token')
    expect(raw).not.toContain('passport')
    expect(raw).not.toContain('E12345678')
    expect(raw).not.toContain('vault-secret-object')
    expect(raw).toContain('sensitive_redacted')
  })

  it('prunes history by age and per-trip limit, and enqueues deletes', async () => {
    const now = 200 * 24 * 60 * 60 * 1000
    const records = Array.from({ length: 205 }, (_, index) => persistedAppliedRecord(`change-${index}`, now - index))
    records.push(persistedAppliedRecord('expired-change', now - 181 * 24 * 60 * 60 * 1000))
    await db.tripIntelligenceAppliedChanges.bulkPut(records)

    await pruneTripIntelligencePersistence('trip-1', now)

    await expect(db.tripIntelligenceAppliedChanges.where('tripId').equals('trip-1').count()).resolves.toBe(200)
    const deletes = await db.syncOutbox.where('objectType').equals('trip_intelligence_applied_change').toArray()
    expect(deletes.filter((entry) => entry.operation === 'delete')).toHaveLength(6)
  })

  it('clears history and restores a suggestion state with synced tombstones', async () => {
    await db.tripIntelligenceAppliedChanges.put(persistedAppliedRecord('clear-me', 100))
    const suggestionState: TripIntelligenceSuggestionStateRecord = {
      createdAt: 100,
      id: 'state-1',
      status: 'completed',
      suggestionKey: 'operations:route',
      tripId: 'trip-1',
      updatedAt: 100,
    }
    await db.tripIntelligenceSuggestionStates.put(suggestionState)

    await clearTripIntelligenceHistory('trip-1')
    await restoreTripIntelligenceSuggestionState('trip-1', suggestionState.suggestionKey)

    await expect(db.tripIntelligenceAppliedChanges.count()).resolves.toBe(0)
    await expect(db.tripIntelligenceSuggestionStates.count()).resolves.toBe(0)
    const deletes = await db.syncOutbox.toArray()
    expect(deletes).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'trip_intelligence_applied_change', operation: 'delete' }),
      expect.objectContaining({ objectType: 'trip_intelligence_suggestion_state', operation: 'delete' }),
    ]))
  })
})

function appliedChange(id: string, occurredAt: number) {
  return {
    actionType: 'generated_route',
    detail: '已生成路线。',
    id,
    occurredAt,
    source: { id: 'trip-operations', kind: 'operations' as const, label: 'Trip Operations' },
    targetId: 'day-1',
    targetType: 'day' as const,
    title: '第一天路线',
  }
}

function persistedAppliedRecord(id: string, occurredAt: number): TripIntelligenceAppliedChangeRecord {
  return {
    actionType: 'generated_route',
    dedupeKey: `trip-1:${id}`,
    executionId: `execution-${id}`,
    executionSource: 'trip_operations',
    executionStatus: 'success',
    executionTitle: '已完成路线',
    id,
    occurredAt,
    privacyLevel: 'private',
    recommendationFingerprints: [],
    sourceId: 'trip-operations',
    sourceKind: 'operations',
    targetType: 'trip',
    title: '路线已完成',
    tripId: 'trip-1',
    updatedAt: occurredAt,
  }
}

const recommendation: TripOperationsRecommendation = {
  actionKind: 'generate_routes',
  actionLabel: '生成路线',
  affectedDayIds: ['day-1'],
  affectedItemIds: [],
  canBatch: true,
  dayId: 'day-1',
  detail: '第一天',
  evidence: [],
  executionMode: 'confirmed_low_risk',
  fingerprint: 'fingerprint-1',
  id: 'operations-route',
  message: '缺路线',
  phaseWeight: 1,
  priority: 1,
  readinessIssueIds: [],
  requiresConfirm: true,
  requiresPreview: true,
  scopeKey: 'missing_route:day-1',
  severity: 'low',
  ticketIds: [],
  title: '缺少路线',
  type: 'missing_route',
}
