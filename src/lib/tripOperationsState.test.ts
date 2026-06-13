// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  appendTripOperationsExecutionRecord,
  clearTripOperationsExecutionHistory,
  createEmptyTripOperationsLocalState,
  createTripOperationsExecutionRecord,
  getActiveTripOperationsDisposition,
  readTripOperationsLocalState,
  restoreTripOperationsRecommendation,
  setTripOperationsDisposition,
  writeTripOperationsLocalState,
} from './tripOperationsState'
import type { TripOperationsRecommendation } from './tripOperationsAgent'

beforeEach(() => window.localStorage.clear())

describe('trip operations local state', () => {
  it('persists completed and ignored dispositions by recommendation fingerprint', () => {
    let state = createEmptyTripOperationsLocalState()
    state = setTripOperationsDisposition({
      phase: 'traveling',
      recommendation,
      state,
      status: 'ignored',
      zonedDate: '2026-06-13',
    })
    writeTripOperationsLocalState('trip_1', state)

    expect(readTripOperationsLocalState('trip_1').dispositions).toEqual([
      expect.objectContaining({ fingerprint: 'fingerprint-1', status: 'ignored' }),
    ])
  })

  it('expires snoozed dispositions when phase or destination date changes', () => {
    const state = setTripOperationsDisposition({
      phase: 'travel_morning',
      recommendation,
      state: createEmptyTripOperationsLocalState(),
      status: 'snoozed',
      zonedDate: '2026-06-13',
    })

    expect(getActiveTripOperationsDisposition({
      dispositions: state.dispositions,
      fingerprint: recommendation.fingerprint,
      phase: 'travel_morning',
      zonedDate: '2026-06-13',
    })).toBeDefined()
    expect(getActiveTripOperationsDisposition({
      dispositions: state.dispositions,
      fingerprint: recommendation.fingerprint,
      phase: 'traveling',
      zonedDate: '2026-06-13',
    })).toBeUndefined()
    expect(getActiveTripOperationsDisposition({
      dispositions: state.dispositions,
      fingerprint: recommendation.fingerprint,
      phase: 'travel_morning',
      zonedDate: '2026-06-14',
    })).toBeUndefined()
  })

  it('restores hidden recommendations without clearing history', () => {
    const hidden = setTripOperationsDisposition({
      phase: 'traveling',
      recommendation,
      state: createEmptyTripOperationsLocalState(),
      status: 'completed',
      zonedDate: '2026-06-13',
    })
    const withHistory = appendTripOperationsExecutionRecord(hidden, createTripOperationsExecutionRecord({
      appliedChanges: [],
      fingerprints: [recommendation.fingerprint],
      now: 1,
      status: 'success',
      title: '完成路线',
    }))

    expect(restoreTripOperationsRecommendation(withHistory, recommendation.fingerprint)).toMatchObject({
      dispositions: [],
      history: [expect.objectContaining({ title: '完成路线' })],
    })
    expect(clearTripOperationsExecutionHistory(withHistory)).toMatchObject({
      dispositions: [expect.objectContaining({ status: 'completed' })],
      history: [],
    })
  })

  it('keeps the most recent 20 execution records and resets corrupt storage', () => {
    let state = createEmptyTripOperationsLocalState()
    for (let index = 0; index < 25; index += 1) {
      state = appendTripOperationsExecutionRecord(state, createTripOperationsExecutionRecord({
        appliedChanges: [],
        fingerprints: [`fingerprint-${index}`],
        now: index + 1,
        status: 'success',
        title: `记录 ${index}`,
      }))
    }
    expect(state.history).toHaveLength(20)
    expect(state.history[0]?.title).toBe('记录 24')

    window.localStorage.setItem('tripmap:trip-operations:v2:trip_bad', '{bad')
    expect(readTripOperationsLocalState('trip_bad')).toEqual(createEmptyTripOperationsLocalState())
    window.localStorage.setItem('tripmap:trip-operations:v2:trip_future', JSON.stringify({
      dispositions: [],
      history: [],
      version: 3,
    }))
    expect(readTripOperationsLocalState('trip_future')).toEqual(createEmptyTripOperationsLocalState())
  })
})

const recommendation: TripOperationsRecommendation = {
  actionKind: 'generate_routes',
  actionLabel: '生成路线',
  affectedDayIds: ['day_1'],
  affectedItemIds: [],
  canBatch: true,
  dayId: 'day_1',
  detail: '第一天',
  evidence: [],
  executionMode: 'confirmed_low_risk',
  fingerprint: 'fingerprint-1',
  id: 'ops-route',
  message: '缺路线',
  phaseWeight: 1,
  priority: 1,
  readinessIssueIds: [],
  requiresConfirm: true,
  requiresPreview: true,
  scopeKey: 'missing_route:day_1',
  severity: 'low',
  ticketIds: [],
  title: '缺少路线',
  type: 'missing_route',
}
