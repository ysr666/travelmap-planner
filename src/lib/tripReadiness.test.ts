import { describe, expect, it } from 'vitest'
import { evaluateTripRoutePreparation } from './routePreparation'
import {
  buildTripReadinessModel,
  buildTripReadinessRepairPreview,
  hasSavedDailyTravelTipForDate,
} from './tripReadiness'
import type { CloudSyncQueueSummary } from './cloudSyncQueueSummary'
import type { TripDailyTravelTipModel } from './ai/tripDailyTravelTip'
import type { TripCheckResult } from './tripCheck'
import type { Day, ItineraryItem, TicketBlobSyncState, TicketMeta, Trip } from '../types'

describe('tripReadiness', () => {
  it('builds readiness issues for all supported local sources', () => {
    const seed = buildSeed()
    const routePreparation = evaluateTripRoutePreparation({
      days: [seed.day],
      itemsByDay: { [seed.day.id]: [seed.farStart, seed.farEnd] },
      provider: 'openrouteservice',
      tripId: seed.trip.id,
    })

    const model = buildTripReadinessModel({
      allItems: [seed.missingCoordinate, seed.ticketLike, seed.farStart, seed.farEnd],
      cloudSummary: cloudSummary({ pendingObjectCount: 1, syncItemCount: 1 }),
      dailyTipModel: dailyTipModel(seed.day),
      days: [seed.day],
      itemsByDay: { [seed.day.id]: [seed.farStart, seed.farEnd] },
      routePreparation,
      ticketBlobSyncStates: [
        ticketState(seed.pendingTicket, 'pending'),
        ticketState(seed.errorTicket, 'error', '上传失败'),
      ],
      tickets: [seed.pendingTicket, seed.errorTicket],
      trip: seed.trip,
      tripCheck: tripCheckFixture(seed),
    })

    expect(new Set(model.issues.map((issue) => issue.type))).toEqual(new Set([
      'cloud_sync_pending',
      'daily_tip_missing',
      'missing_content',
      'missing_coordinate',
      'missing_route',
      'missing_ticket',
      'route_long_distance',
      'ticket_unsynced',
      'time_conflict',
    ]))
    expect(model.summary.status).toBe('high_risk')
    expect(model.summary.statusLabel).toContain('高风险')
    expect(model.summary.highRiskCount).toBeGreaterThan(0)
    expect(model.issues.filter((issue) => issue.severity === 'high').every((issue) => !issue.defaultSelected)).toBe(true)
    expect(model.issues.find((issue) => issue.type === 'missing_route')?.defaultSelected).toBe(true)
  })

  it('excludes high risk issues from batch repair but allows single preview confirmation', () => {
    const seed = buildSeed()
    const routePreparation = evaluateTripRoutePreparation({
      days: [seed.day],
      itemsByDay: { [seed.day.id]: [seed.farStart, seed.farEnd] },
      provider: 'openrouteservice',
      tripId: seed.trip.id,
    })
    const model = buildTripReadinessModel({
      allItems: [seed.farStart, seed.farEnd],
      cloudSummary: cloudSummary({ syncItemCount: 0 }),
      dailyTipModel: dailyTipModel(seed.day),
      days: [seed.day],
      itemsByDay: { [seed.day.id]: [seed.farStart, seed.farEnd] },
      routePreparation,
      ticketBlobSyncStates: [
        ticketState(seed.pendingTicket, 'pending'),
        ticketState(seed.errorTicket, 'error', '上传失败'),
      ],
      tickets: [seed.pendingTicket, seed.errorTicket],
      trip: seed.trip,
      tripCheck: {
        evidence: [],
        suggestions: [],
        summary: { criticalCount: 0, message: '', severity: 'info', suggestionCount: 0, title: '', warningCount: 0 },
        warnings: [],
      },
    })
    const highTicketIssue = model.issues.find((issue) => issue.ticketId === seed.errorTicket.id)

    const batch = buildTripReadinessRepairPreview(model, model.issues.map((issue) => issue.id), 'batch')
    expect(batch.routeDayIds).toEqual([seed.day.id])
    expect(batch.ticketIds).toEqual([seed.pendingTicket.id])
    expect(batch.dailyTipRequested).toBe(true)
    expect(batch.contentItemIds).toEqual(expect.arrayContaining([seed.farStart.id, seed.farEnd.id]))
    expect(batch.contentItemIds).toHaveLength(2)
    expect(batch.excludedIssueIds).toContain(highTicketIssue?.id)

    const single = buildTripReadinessRepairPreview(model, [highTicketIssue?.id ?? ''], 'single')
    expect(single.ticketIds).toEqual([seed.errorTicket.id])
    expect(single.excludedIssueIds).toEqual([])
  })

  it('maps daily tip markers and cloud conflict severity', () => {
    const seed = buildSeed()
    expect(hasSavedDailyTravelTipForDate('## 今日旅行提示 · 2026-06-10\n内容', '2026-06-10')).toBe(true)

    const model = buildTripReadinessModel({
      allItems: [],
      cloudSummary: cloudSummary({ conflictCount: 1, syncItemCount: 1 }),
      dailyTipModel: dailyTipModel(seed.day),
      days: [seed.day],
      itemsByDay: { [seed.day.id]: [] },
      routePreparation: null,
      ticketBlobSyncStates: [],
      tickets: [],
      trip: { ...seed.trip, notes: '## 今日旅行提示 · 2026-06-10\n内容' },
      tripCheck: null,
    })

    expect(model.issues.some((issue) => issue.type === 'daily_tip_missing')).toBe(false)
    expect(model.issues.find((issue) => issue.type === 'cloud_sync_pending')?.severity).toBe('high')
  })
})

function buildSeed() {
  const now = 1_769_472_000_000
  const trip: Trip = {
    createdAt: now,
    destination: '杭州',
    endDate: '2026-06-12',
    id: 'trip-1',
    startDate: '2026-06-10',
    title: '杭州周末',
    updatedAt: now,
  }
  const day: Day = {
    date: '2026-06-10',
    id: 'day-1',
    sortOrder: 1,
    title: '第一天',
    tripId: trip.id,
  }
  const missingCoordinate = item('missing-coordinate', day.id, 1, { locationName: '杭州博物馆' })
  const ticketLike = item('ticket-like', day.id, 2, { title: '宋城门票' })
  const farStart = item('far-start', day.id, 1, {
    endTime: '09:30',
    lat: 30.25,
    lng: 120.16,
    locationName: '西湖',
    startTime: '09:00',
    title: '西湖',
  })
  const farEnd = item('far-end', day.id, 2, {
    lat: 30.95,
    lng: 121.05,
    locationName: '远郊古镇',
    startTime: '09:40',
    title: '远郊古镇',
  })
  const pendingTicket = ticket('ticket-pending', trip.id, '高铁票.pdf')
  const errorTicket = ticket('ticket-error', trip.id, '酒店订单.pdf')
  return { day, errorTicket, farEnd, farStart, missingCoordinate, pendingTicket, ticketLike, trip }
}

function item(id: string, dayId: string, sortOrder: number, patch: Partial<ItineraryItem> = {}): ItineraryItem {
  return {
    createdAt: 1,
    dayId,
    id,
    sortOrder,
    ticketIds: [],
    title: '行程点',
    tripId: 'trip-1',
    updatedAt: 1,
    ...patch,
  }
}

function ticket(id: string, tripId: string, fileName: string): TicketMeta {
  return {
    createdAt: 1,
    fileName,
    fileType: 'pdf',
    id,
    mimeType: 'application/pdf',
    size: 100,
    ticketCategory: 'other',
    title: fileName,
    tripId,
    updatedAt: 1,
  }
}

function ticketState(
  ticketMeta: TicketMeta,
  uploadStatus: TicketBlobSyncState['uploadStatus'],
  lastError?: string,
): TicketBlobSyncState {
  return {
    cacheStatus: 'cached',
    fileName: ticketMeta.fileName,
    lastError,
    ticketId: ticketMeta.id,
    tripId: ticketMeta.tripId,
    updatedAt: 1,
    uploadStatus,
  }
}

function dailyTipModel(day: Day): TripDailyTravelTipModel {
  return {
    localSourceSummaries: [],
    mode: 'pre_trip',
    searchTargets: [],
    sections: [],
    subtitle: day.title,
    targetDate: day.date,
    targetDay: day,
    targetItems: [],
    title: '今日旅行提示',
    warnings: [],
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

function tripCheckFixture(seed: ReturnType<typeof buildSeed>): TripCheckResult {
  return {
    evidence: [
      { dayId: seed.day.id, id: 'ev-missing-coordinate', itemId: seed.missingCoordinate.id, label: '缺坐标', message: '没有可用于地图展示的坐标。' },
      { dayId: seed.day.id, id: 'ev-ticket', itemId: seed.ticketLike.id, label: '缺票据', message: '标题包含票据关键词。' },
      { dayId: seed.day.id, id: 'ev-time', itemId: seed.farEnd.id, label: '时间冲突', message: '上一项结束 10:30，当前开始 10:00。' },
    ],
    suggestions: [{
      affectedDayIds: [seed.day.id],
      affectedItemIds: [seed.ticketLike.id],
      evidenceIds: ['ev-ticket'],
      id: 'missing-ticket-ticket-like',
      message: '这个行程点看起来可能需要门票、预约或凭证，当前没有绑定票据。',
      ruleId: 'missing_ticket',
      severity: 'warning',
      source: 'local_rule',
      title: '可能缺少票据',
    }],
    summary: { criticalCount: 1, message: '', severity: 'critical', suggestionCount: 1, title: '', warningCount: 2 },
    warnings: [
      {
        affectedDayIds: [seed.day.id],
        affectedItemIds: [seed.missingCoordinate.id],
        evidenceIds: ['ev-missing-coordinate'],
        id: 'missing-coordinate-missing-coordinate',
        message: '该行程点缺少坐标。',
        ruleId: 'missing_coordinate',
        severity: 'warning',
        source: 'local_rule',
        title: '缺少地点坐标',
      },
      {
        affectedDayIds: [seed.day.id],
        affectedItemIds: [seed.farStart.id, seed.farEnd.id],
        evidenceIds: ['ev-time'],
        id: 'overlap-time-far-start-far-end',
        message: '两个相邻行程点的时间发生重叠，请人工核对。',
        ruleId: 'overlap_time',
        severity: 'critical',
        source: 'local_rule',
        title: '时间安排重叠',
      },
    ],
  }
}
