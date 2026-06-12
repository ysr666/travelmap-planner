import { describe, expect, it } from 'vitest'
import {
  buildTripOperationsModel,
  resolveTripOperationsPhase,
  type TripOperationsInboxSummary,
} from './tripOperationsAgent'
import type { CloudSyncQueueSummary } from './cloudSyncQueueSummary'
import type { TripDailyTravelTipModel } from './ai/tripDailyTravelTip'
import type { TripReadinessModel } from './tripReadiness'
import type { Day, ItineraryItem, TicketBlobSyncState, TicketMeta, Trip } from '../types'

describe('tripOperationsAgent', () => {
  it('switches phase by trip date and local trip hour', () => {
    const seed = buildSeed()
    expect(resolveTripOperationsPhase({
      days: seed.days,
      now: new Date('2026-06-09T10:00:00+08:00'),
      trip: seed.trip,
    })).toBe('pre_trip')
    expect(resolveTripOperationsPhase({
      days: seed.days,
      now: new Date('2026-06-10T08:30:00+08:00'),
      trip: seed.trip,
    })).toBe('travel_morning')
    expect(resolveTripOperationsPhase({
      days: seed.days,
      now: new Date('2026-06-10T14:30:00+08:00'),
      trip: seed.trip,
    })).toBe('traveling')
    expect(resolveTripOperationsPhase({
      days: seed.days,
      now: new Date('2026-06-10T20:30:00+08:00'),
      trip: seed.trip,
    })).toBe('travel_evening')
    expect(resolveTripOperationsPhase({
      days: seed.days,
      now: new Date('2026-06-13T10:00:00+08:00'),
      trip: seed.trip,
    })).toBe('post_trip')
  })

  it('ranks high risk first and caps visible recommendations at five', () => {
    const seed = buildSeed()
    const model = buildTripOperationsModel({
      allItems: seed.items,
      cloudSummary: cloudSummary({ conflictCount: 1, syncItemCount: 1 }),
      dailyTipModel: dailyTipModel(seed.days[1]),
      days: seed.days,
      inboxSummary: inboxSummary({ readyEntryCount: 2, selectedPreviewDiffCount: 3 }),
      itemsByDay: { day_1: seed.items },
      now: new Date('2026-06-10T14:30:00+08:00'),
      readinessModel: readinessModelFixture(),
      ticketBlobSyncStates: [syncedCacheState(seed.ticket)],
      tickets: [seed.ticket],
      trip: seed.trip,
    })

    expect(model.phase).toBe('traveling')
    expect(model.recommendations).toHaveLength(5)
    expect(model.recommendations[0].severity).toBe('high')
    expect(model.recommendations.map((recommendation) => recommendation.type)).toContain('inbox_needs_attention')
    expect(model.allRecommendations.length).toBeGreaterThan(model.recommendations.length)
  })

  it('prioritizes tomorrow review in the evening and cache cleanup after the trip', () => {
    const seed = buildSeed()
    const evening = buildTripOperationsModel({
      allItems: seed.items,
      days: seed.days,
      dailyTipModel: dailyTipModel(seed.days[1]),
      inboxSummary: inboxSummary(),
      itemsByDay: { day_1: seed.items },
      now: new Date('2026-06-10T20:30:00+08:00'),
      readinessModel: { issues: [], summary: emptySummary() },
      ticketBlobSyncStates: [syncedCacheState(seed.ticket)],
      tickets: [seed.ticket],
      trip: seed.trip,
    })
    expect(evening.recommendations[0].type).toBe('tomorrow_review')

    const postTrip = buildTripOperationsModel({
      allItems: seed.items,
      cloudSummary: cloudSummary({ syncItemCount: 0 }),
      days: seed.days,
      inboxSummary: inboxSummary(),
      itemsByDay: { day_1: seed.items },
      now: new Date('2026-06-13T10:00:00+08:00'),
      readinessModel: { issues: [], summary: emptySummary() },
      ticketBlobSyncStates: [syncedCacheState(seed.ticket)],
      tickets: [seed.ticket],
      trip: seed.trip,
    })
    expect(postTrip.recommendations[0].type).toBe('synced_ticket_cache')
  })

  it('returns a ready message when there are no recommendations', () => {
    const seed = buildSeed()
    const model = buildTripOperationsModel({
      allItems: [],
      days: seed.days,
      inboxSummary: inboxSummary(),
      itemsByDay: {},
      now: new Date('2026-06-10T14:30:00+08:00'),
      readinessModel: { issues: [], summary: emptySummary() },
      ticketBlobSyncStates: [],
      tickets: [],
      trip: seed.trip,
    })
    expect(model.recommendations).toEqual([])
    expect(model.summary.message).toContain('当前没有明显阻塞项')
  })
})

function buildSeed() {
  const trip: Trip = {
    createdAt: 1,
    destination: '杭州',
    endDate: '2026-06-12',
    id: 'trip_1',
    startDate: '2026-06-10',
    timeZone: 'Asia/Shanghai',
    title: '杭州三日',
    updatedAt: 1,
  }
  const days: Day[] = [
    { date: '2026-06-10', id: 'day_1', sortOrder: 1, title: '第一天', tripId: trip.id },
    { date: '2026-06-11', id: 'day_2', sortOrder: 2, title: '第二天', tripId: trip.id },
  ]
  const items: ItineraryItem[] = [{
    createdAt: 1,
    dayId: days[0].id,
    id: 'item_1',
    sortOrder: 1,
    ticketIds: [],
    title: '西湖',
    tripId: trip.id,
    updatedAt: 1,
  }]
  const ticket: TicketMeta = {
    createdAt: 1,
    fileName: 'ticket.pdf',
    fileType: 'pdf',
    id: 'ticket_1',
    mimeType: 'application/pdf',
    size: 100,
    storageMode: 'copy',
    title: '门票',
    tripId: trip.id,
    updatedAt: 1,
  }
  return { days, items, ticket, trip }
}

function readinessModelFixture(): TripReadinessModel {
  return {
    issues: [
      {
        actionKind: 'navigate_item',
        actionLabel: '检查路线顺序',
        canBatchFix: false,
        dayId: 'day_1',
        defaultSelected: false,
        evidence: ['西湖到远郊约 80km。'],
        id: 'risk',
        itemId: 'item_1',
        message: '距离明显偏远。',
        requiresPreview: true,
        severity: 'high',
        title: '路线距离高风险',
        type: 'route_long_distance',
      },
      {
        actionKind: 'generate_routes',
        actionLabel: '生成路线',
        canBatchFix: true,
        dayId: 'day_1',
        defaultSelected: true,
        evidence: ['第一天可生成路线。'],
        id: 'route',
        message: '缺少路线缓存。',
        requiresPreview: true,
        severity: 'low',
        title: '缺少路线预览',
        type: 'missing_route',
      },
      {
        actionKind: 'generate_content_preview',
        actionLabel: '补充景点内容',
        canBatchFix: true,
        dayId: 'day_1',
        defaultSelected: true,
        evidence: ['缺少开放时间。'],
        id: 'content',
        itemId: 'item_1',
        message: '缺少出行信息。',
        requiresPreview: true,
        severity: 'low',
        title: '西湖缺少出行信息',
        type: 'missing_content',
      },
      {
        actionKind: 'generate_daily_tip_preview',
        actionLabel: '生成每日提示',
        canBatchFix: true,
        dayId: 'day_1',
        defaultSelected: true,
        evidence: ['旅行备注中没有今日旅行提示。'],
        id: 'daily-tip',
        message: '缺少每日提示。',
        requiresPreview: true,
        severity: 'low',
        title: '缺少每日旅行提示',
        type: 'daily_tip_missing',
      },
      {
        actionKind: 'open_sync',
        actionLabel: '查看同步',
        canBatchFix: false,
        defaultSelected: false,
        evidence: ['1 个对象冲突。'],
        id: 'sync',
        message: '云同步存在风险。',
        requiresPreview: true,
        severity: 'high',
        title: '云同步存在风险',
        type: 'cloud_sync_pending',
      },
    ],
    summary: emptySummary(),
  }
}

function dailyTipModel(day: Day): TripDailyTravelTipModel {
  return {
    localSourceSummaries: [],
    mode: 'tomorrow',
    searchTargets: [],
    sections: [],
    subtitle: `${day.date} · ${day.title}`,
    targetDate: day.date,
    targetDay: day,
    targetItems: [],
    title: '明日提示',
    warnings: [],
  }
}

function inboxSummary(patch: Partial<TripOperationsInboxSummary> = {}): TripOperationsInboxSummary {
  return {
    accountErrorCount: 0,
    accountNeedsAssignmentCount: 0,
    accountPreviewCount: 0,
    errorEntryCount: 0,
    readyEntryCount: 0,
    selectedPreviewDiffCount: 0,
    ...patch,
  }
}

function syncedCacheState(ticket: TicketMeta): TicketBlobSyncState {
  return {
    cacheStatus: 'cached',
    cloudStoragePath: 'tickets/ticket_1.pdf',
    fileName: ticket.fileName,
    ticketId: ticket.id,
    tripId: ticket.tripId,
    updatedAt: 1,
    uploadStatus: 'synced',
  }
}

function cloudSummary(patch: Partial<CloudSyncQueueSummary>): CloudSyncQueueSummary {
  return {
    conflictCount: 0,
    dirtyTripCount: 0,
    errorObjectCount: 0,
    pendingObjectCount: 0,
    syncItemCount: 0,
    syncingObjectCount: 0,
    ticketDeletedCount: 0,
    ticketErrorCount: 0,
    ticketPendingCount: 0,
    ticketUploadingCount: 0,
    tickets: [],
    ...patch,
  }
}

function emptySummary(): TripReadinessModel['summary'] {
  return {
    fixableCount: 0,
    highRiskCount: 0,
    message: '',
    selectedCount: 0,
    status: 'ready',
    statusLabel: '可出行',
    totalCount: 0,
  }
}
