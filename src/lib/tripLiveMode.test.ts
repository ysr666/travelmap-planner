import { describe, expect, it } from 'vitest'
import { buildTripLiveModel } from './tripLiveMode'
import type { RoutePreparationDay } from './routePreparation'
import type { TripOperationsRecommendation } from './tripOperationsAgent'
import type { ContentEnrichmentSource, Day, ItineraryItem, Trip } from '../types'

const trip: Trip = {
  createdAt: 1,
  destination: '东京',
  endDate: '2026-06-13',
  id: 'trip_1',
  startDate: '2026-06-13',
  timeZone: 'Asia/Tokyo',
  title: '东京旅行',
  updatedAt: 1,
}
const day: Day = { date: '2026-06-13', id: 'day_1', sortOrder: 1, title: '东京一天', tripId: trip.id }

describe('buildTripLiveModel', () => {
  it('switches through the five live stages using destination time', () => {
    const first = item({ endTime: '10:00', id: 'first', startTime: '09:00' })
    const second = item({ id: 'second', previousTransportDurationMinutes: 30, sortOrder: 2, startTime: '11:00' })

    expect(model([first, second], '2026-06-12T23:00:00Z').stage).toBe('not_started')
    expect(model([first, second], '2026-06-13T00:30:00Z').stage).toBe('visiting')

    const completedFirst = { ...first, executionState: { status: 'completed' as const, updatedAt: 1 } }
    expect(model([completedFirst, second], '2026-06-13T00:15:00Z').stage).toBe('en_route')
    expect(model([completedFirst, second], '2026-06-13T01:35:00Z').stage).toBe('next_due')

    const completedSecond = { ...second, executionState: { status: 'skipped' as const, updatedAt: 2 } }
    expect(model([completedFirst, completedSecond], '2026-06-13T02:00:00Z').stage).toBe('day_finished')
  })

  it('skips completed and skipped items when selecting the next target', () => {
    const result = model([
      item({ executionState: { status: 'completed', updatedAt: 1 }, id: 'first' }),
      item({ executionState: { status: 'skipped', updatedAt: 2 }, id: 'second', sortOrder: 2 }),
      item({ id: 'third', sortOrder: 3 }),
    ], '2026-06-13T00:00:00Z')

    expect(result.targetItem?.id).toBe('third')
    expect(result.counts).toEqual({ completed: 1, pending: 1, skipped: 1, total: 3 })
  })

  it('prefers item travel duration over the two-point route cache estimate', () => {
    const result = buildTripLiveModel({
      day,
      items: [
        item({ executionState: { status: 'completed', updatedAt: 1 }, id: 'first', lat: 35.1, lng: 139.1 }),
        item({ id: 'second', lat: 35.2, lng: 139.2, previousTransportDurationMinutes: 20, sortOrder: 2, startTime: '10:00' }),
      ],
      now: new Date('2026-06-13T00:00:00Z'),
      routeDay: routeDay(3600),
      trip,
    })

    expect(result.travelEstimate).toMatchObject({ minutes: 20, source: 'item' })
  })

  it('uses aggregate route duration only when exactly two locations have coordinates', () => {
    const twoPoint = buildTripLiveModel({
      day,
      items: [
        item({ executionState: { status: 'completed', updatedAt: 1 }, id: 'first', lat: 35.1, lng: 139.1 }),
        item({ id: 'second', lat: 35.2, lng: 139.2, sortOrder: 2, startTime: '10:00' }),
      ],
      now: new Date('2026-06-13T00:00:00Z'),
      routeDay: routeDay(2700),
      trip,
    })
    const threePoint = buildTripLiveModel({
      day,
      items: [
        item({ executionState: { status: 'completed', updatedAt: 1 }, id: 'first', lat: 35.1, lng: 139.1 }),
        item({ id: 'second', lat: 35.2, lng: 139.2, sortOrder: 2, startTime: '10:00' }),
        item({ id: 'third', lat: 35.3, lng: 139.3, sortOrder: 3 }),
      ],
      now: new Date('2026-06-13T00:00:00Z'),
      routeDay: routeDay(2700),
      trip,
    })

    expect(twoPoint.travelEstimate).toMatchObject({ minutes: 45, source: 'route_cache' })
    expect(threePoint.travelEstimate).toBeUndefined()
  })

  it('marks one-to-ten minute lateness as warning and larger lateness as critical', () => {
    const target = item({ previousTransportDurationMinutes: 20, startTime: '09:15' })
    const warning = model([target], '2026-06-13T00:00:00Z')
    const critical = model([target], '2026-06-13T00:10:00Z')

    expect(warning.risks.find((risk) => risk.kind === 'late')?.severity).toBe('warning')
    expect(critical.risks.find((risk) => risk.kind === 'late')?.severity).toBe('critical')
  })

  it('only interprets simple source-backed opening hours', () => {
    const source: ContentEnrichmentSource = { confidence: 'high', id: 'source', label: '官网', retrievedAt: '2026-06-01', sourceType: 'official', title: '官网' }
    const simple = item({
      contentEnrichment: { baselineFingerprint: 'x', generatedAt: 'x', notices: [], openingHours: { sourceIds: ['source'], text: '09:00-10:00' }, schemaVersion: 1, sources: [source], warnings: [] },
      previousTransportDurationMinutes: 40,
    })
    const complex = item({
      contentEnrichment: { baselineFingerprint: 'x', generatedAt: 'x', notices: [], openingHours: { sourceIds: ['source'], text: '周末 09:00-10:00，周一闭馆' }, schemaVersion: 1, sources: [source], warnings: [] },
    })

    expect(model([simple], '2026-06-13T00:30:00Z').openingHours.state).toBe('closed')
    expect(model([complex], '2026-06-13T00:30:00Z').openingHours.state).toBe('unknown')
  })

  it('keeps only current-day or current-target operations recommendations and caps at two', () => {
    const recommendations = [recommendation('one', day.id, 'item_1'), recommendation('two', day.id), recommendation('three', day.id), recommendation('other', 'day_other')]
    const result = buildTripLiveModel({ day, items: [item()], now: new Date('2026-06-13T00:00:00Z'), operations: { recommendations }, trip })

    expect(result.operationsRecommendations.map((entry) => entry.id)).toEqual(['one', 'two'])
  })
})

function model(items: ItineraryItem[], iso: string) {
  return buildTripLiveModel({ day, items, now: new Date(iso), trip })
}

function item(patch: Partial<ItineraryItem> = {}): ItineraryItem {
  return { createdAt: 1, dayId: day.id, id: patch.id ?? 'item_1', sortOrder: patch.sortOrder ?? 1, ticketIds: [], title: patch.title ?? '浅草寺', tripId: trip.id, updatedAt: 1, ...patch }
}

function routeDay(durationSeconds: number): RoutePreparationDay {
  return {
    cacheEntry: { coordinateKey: 'x', createdAt: 'x', dayId: day.id, durationSeconds, id: 'route', lastUsedAt: 'x', lineStrings: [], modeKey: 'x', provider: 'google', routingVersion: 1, signature: 'x', sizeBytes: 1, tripId: trip.id, updatedAt: 'x', warnings: [] },
    coordinateCount: 2,
    day,
    eligible: true,
    identity: null,
    provider: 'google',
    staleCacheEntries: [],
    status: 'cached',
  }
}

function recommendation(id: string, dayId: string, itemId?: string): TripOperationsRecommendation {
  return { actionKind: 'open_day', actionLabel: '处理', affectedDayIds: [dayId], affectedItemIds: itemId ? [itemId] : [], canBatch: false, dayId, detail: id, evidence: [], executionMode: 'manual_navigation', fingerprint: id, id, itemId, message: id, phaseWeight: 1, priority: 1, readinessIssueIds: [], requiresConfirm: false, requiresPreview: false, scopeKey: id, severity: 'medium', ticketIds: [], title: id, type: 'time_conflict' }
}
