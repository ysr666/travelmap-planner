import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db/database'
import { createDay, createItineraryItem, createTrip, getTrip } from '../../db/repositories'
import { listDirtyAutoSnapshotTrips, resetAutoSnapshotBackupForTests } from '../autoSnapshotBackup'
import {
  appendDailyTipNotes,
  buildTripDailyTravelTip,
  generateEnhancedTripDailyTravelTip,
  saveTripDailyTravelTipPreviewToNotes,
  selectTripDailyTravelTipTarget,
  type TripDailyTravelTipEnhancedPreview,
} from './tripDailyTravelTip'
import type {
  ProviderProxyTravelSearchSuccessResponse,
  ProviderProxyTripDailyTipRequest,
  ProviderProxyTripDailyTipSuccessResponse,
} from './providerProxyContract'

beforeEach(async () => {
  resetAutoSnapshotBackupForTests()
  await db.delete()
  await db.open()
})

describe('tripDailyTravelTip', () => {
  it('selects pre-trip, today, tomorrow after final item, and completed modes', async () => {
    const seed = await seedTrip()
    const itemsByDay = {
      [seed.day1.id]: [seed.item1, { ...seed.item2, title: '回酒店', startTime: '18:00' }],
      [seed.day2.id]: [],
    }

    expect(selectTripDailyTravelTipTarget({
      days: [seed.day1, seed.day2],
      itemsByDay,
      now: new Date('2026-06-09T10:00:00+08:00'),
      trip: seed.trip,
    }).mode).toBe('pre_trip')

    expect(selectTripDailyTravelTipTarget({
      days: [seed.day1, seed.day2],
      itemsByDay,
      now: new Date('2026-06-10T12:00:00+08:00'),
      trip: seed.trip,
    }).mode).toBe('today')

    const tomorrow = selectTripDailyTravelTipTarget({
      days: [seed.day1, seed.day2],
      itemsByDay,
      now: new Date('2026-06-10T20:00:00+08:00'),
      trip: seed.trip,
    })
    expect(tomorrow.mode).toBe('tomorrow')
    expect(tomorrow.targetDay?.id).toBe(seed.day2.id)

    expect(selectTripDailyTravelTipTarget({
      days: [seed.day1, seed.day2],
      itemsByDay,
      now: new Date('2026-06-12T10:00:00+08:00'),
      trip: seed.trip,
    }).mode).toBe('completed')
  })

  it('aggregates saved opening hours, ticket price, notices, route status, and local findings', async () => {
    const seed = await seedTrip()
    const model = buildTripDailyTravelTip({
      days: [seed.day1, seed.day2],
      itemsByDay: { [seed.day1.id]: [seed.item1, seed.item2], [seed.day2.id]: [] },
      now: new Date('2026-06-10T12:00:00+08:00'),
      routePreparation: {
        cachedDayCount: 0,
        canGenerate: true,
        days: [{
          cacheEntry: null,
          coordinateCount: 2,
          day: seed.day1,
          eligible: true,
          identity: null,
          provider: 'google',
          staleCacheEntries: [],
          status: 'ready_to_generate',
        }],
        eligibleDayCount: 1,
        noCoordinateDayCount: 0,
        notEnoughPointDayCount: 0,
        provider: 'google',
        providerConfigured: true,
        readyDayCount: 1,
        staleDayCount: 0,
        targetDayIds: [seed.day1.id],
      },
      trip: seed.trip,
      tripCheck: {
        evidence: [],
        suggestions: [],
        summary: { criticalCount: 0, message: '', severity: 'warning', suggestionCount: 0, title: '', warningCount: 1 },
        warnings: [{
          affectedDayIds: [seed.day1.id],
          affectedItemIds: [],
          evidenceIds: [],
          id: 'dense-day',
          message: '当天安排偏密，注意体力。',
          ruleId: 'dense_day',
          severity: 'warning',
          source: 'local_rule',
          title: '当天安排偏密',
        }],
      },
    })

    expect(model.sections.find((section) => section.key === 'opening_hours')?.lines[0].text).toContain('全天开放')
    expect(model.sections.find((section) => section.key === 'ticket_price')?.lines[0].text).toContain('免费')
    expect(model.sections.find((section) => section.key === 'notices')?.lines[0].text).toContain('提前预约')
    expect(model.sections.find((section) => section.key === 'route_risk')?.lines.map((line) => line.title)).toContain('可生成路线')
    expect(model.sections.find((section) => section.key === 'route_risk')?.lines.map((line) => line.title)).toContain('当天安排偏密')
  })

  it('does not call daily tip AI when no source exists', async () => {
    const seed = await seedTrip({ withEnrichment: false })
    await expect(generateEnhancedTripDailyTravelTip({
      clients: {
        travelSearch: vi.fn(async () => searchResponse([])),
        tripDailyTip: vi.fn(async () => {
          throw new Error('should not call ai')
        }),
      },
      model: buildTripDailyTravelTip({
        days: [seed.day1],
        itemsByDay: { [seed.day1.id]: [seed.item1] },
        now: new Date('2026-06-10T10:00:00+08:00'),
        trip: seed.trip,
      }),
      proxyUrl: '/api/provider-proxy',
      trip: seed.trip,
    })).rejects.toThrow('没有可用来源')
  })

  it('calls search and trip_daily_tip only after requested and sends sanitized payload', async () => {
    const seed = await seedTrip()
    const captured: { ai?: ProviderProxyTripDailyTipRequest } = {}
    const preview = await generateEnhancedTripDailyTravelTip({
      clients: {
        travelSearch: vi.fn(async () => searchResponse([])),
        tripDailyTip: vi.fn(async (request) => {
          captured.ai = request
          return {
            ok: true,
            operation: 'trip_daily_tip',
            sections: [{ key: 'opening_hours', sourceIds: ['source-opening'], text: '以官网开放时间为准。', title: '开放时间' }],
            source: 'mock',
            sourceIds: ['source-opening'],
            summary: '请核对开放时间。',
          } satisfies ProviderProxyTripDailyTipSuccessResponse
        }),
      },
      model: buildTripDailyTravelTip({
        days: [seed.day1],
        itemsByDay: { [seed.day1.id]: [seed.item1] },
        now: new Date('2026-06-10T10:00:00+08:00'),
        trip: { ...seed.trip, notes: 'private notes should stay local' },
      }),
      proxyUrl: '/api/provider-proxy',
      trip: { ...seed.trip, notes: 'private notes should stay local' },
    })

    expect(preview.response.summary).toContain('核对开放时间')
    expect(JSON.stringify(captured.ai)).not.toContain('private notes')
    expect(JSON.stringify(captured.ai)).not.toContain('ticketIds')
    expect(JSON.stringify(captured.ai)).not.toContain('routeCache')
  })

  it('appends preview to trip notes, marks dirty, and rejects stale baseline', async () => {
    const seed = await seedTrip()
    const preview = makePreview(seed.trip.id, seed.trip.updatedAt)
    expect(appendDailyTipNotes('原备注', preview)).toContain('原备注')

    const saved = await saveTripDailyTravelTipPreviewToNotes({
      expectedBaselineFingerprint: preview.baselineFingerprint,
      now: 2000,
      preview,
      tripId: seed.trip.id,
    })
    expect(saved.ok).toBe(true)
    expect((await getTrip(seed.trip.id))?.notes).toContain('今日旅行提示')
    const dirtyEntry = listDirtyAutoSnapshotTrips()
      .filter((entry): entry is Exclude<ReturnType<typeof listDirtyAutoSnapshotTrips>[number], null> => Boolean(entry))
      .find((entry) => entry.tripId === seed.trip.id)
    expect(dirtyEntry?.reason).toBe('trip-daily-tip-saved')

    const stale = await saveTripDailyTravelTipPreviewToNotes({
      expectedBaselineFingerprint: preview.baselineFingerprint,
      preview,
      tripId: seed.trip.id,
    })
    expect(stale.ok).toBe(false)
  })
})

async function seedTrip({ withEnrichment = true } = {}) {
  const trip = await createTrip({
    destination: '杭州',
    endDate: '2026-06-11',
    startDate: '2026-06-10',
    title: '杭州旅行',
  })
  const day1 = await createDay({ date: '2026-06-10', sortOrder: 1, title: '第一天', tripId: trip.id })
  const day2 = await createDay({ date: '2026-06-11', sortOrder: 2, title: '第二天', tripId: trip.id })
  const item1 = await createItineraryItem({
    contentEnrichment: withEnrichment ? {
      baselineFingerprint: 'baseline',
      generatedAt: '2026-06-01T00:00:00.000Z',
      introduction: { sourceIds: ['source-opening'], text: '西湖介绍' },
      notices: [{ sourceIds: ['source-opening'], text: '节假日建议提前预约。' }],
      openingHours: { sourceIds: ['source-opening'], text: '周一至周日 全天开放' },
      recommendedStay: { basis: 'ai_estimate', durationMinutes: 90, reason: '估算', text: '建议停留约 1.5 小时' },
      schemaVersion: 1,
      sources: [{
        confidence: 'high',
        id: 'source-opening',
        label: '官网',
        retrievedAt: '2026-06-01T00:00:00.000Z',
        sourceType: 'official',
        title: '西湖官网',
        url: 'https://westlake.example',
      }],
      ticketPrice: { kind: 'admission', sourceIds: ['source-opening'], text: '主景区免费。' },
      warnings: [],
    } : undefined,
    dayId: day1.id,
    endTime: '11:00',
    locationName: '西湖',
    sortOrder: 1,
    startTime: '09:00',
    ticketIds: [],
    title: '西湖',
    tripId: trip.id,
  })
  const item2 = await createItineraryItem({
    dayId: day1.id,
    endTime: '18:30',
    locationName: '酒店',
    sortOrder: 2,
    startTime: '18:00',
    ticketIds: [],
    title: '回酒店',
    tripId: trip.id,
  })
  return { day1, day2, item1, item2, trip: await getTrip(trip.id) ?? trip }
}

function searchResponse(results: ProviderProxyTravelSearchSuccessResponse['results']): ProviderProxyTravelSearchSuccessResponse {
  return {
    ok: true,
    operation: 'travel_search',
    query: 'query',
    results,
    retrievedAt: '2026-06-01T00:00:00.000Z',
    source: 'mock',
  }
}

function makePreview(tripId: string, updatedAt: number): TripDailyTravelTipEnhancedPreview {
  return {
    baselineFingerprint: JSON.stringify({
      endDate: '2026-06-11',
      notes: '',
      startDate: '2026-06-10',
      targetDate: '2026-06-10',
      title: '杭州旅行',
      updatedAt,
    }),
    generatedAt: '2026-06-01T00:00:00.000Z',
    requestCounts: { aiSynthesis: 1, total: 1, travelSearch: 0 },
    response: {
      ok: true,
      operation: 'trip_daily_tip',
      sections: [{ key: 'opening_hours', sourceIds: ['source-opening'], text: '以官网为准。', title: '开放时间' }],
      source: 'mock',
      sourceIds: ['source-opening'],
      summary: '今日旅行提示摘要。',
    },
    sources: [{
      confidence: 'high',
      id: 'source-opening',
      label: '官网',
      retrievedAt: '2026-06-01T00:00:00.000Z',
      sourceType: 'official',
      title: '西湖官网',
      url: 'https://westlake.example',
    }],
    targetDate: '2026-06-10',
    targetTitle: tripId,
    warnings: [],
  }
}
