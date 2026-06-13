import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeTripOperationsRecommendations } from './tripOperationsExecutor'
import type { TripOperationsRecommendation } from './tripOperationsAgent'
import type { TripReadinessModel } from './tripReadiness'
import type { Day, ItineraryItem, TicketMeta, Trip } from '../types'

const mocks = vi.hoisted(() => ({
  clearCache: vi.fn(),
  executeRepair: vi.fn(),
}))

vi.mock('./cloudObjectSync', () => ({
  clearSyncedTicketBlobCache: mocks.clearCache,
}))

vi.mock('./tripReadinessRepair', () => ({
  executeTripReadinessRepairPreview: mocks.executeRepair,
}))

describe('tripOperationsExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.executeRepair.mockResolvedValue({
      contentPreview: null,
      dailyTipPreview: null,
      messages: [],
      retriedTicketIds: [],
      routeResult: {
        failedCount: 0,
        generatedCount: 1,
        outcomes: [{
          day,
          lineStrings: [],
          message: '路线预览已生成。',
          provider: 'google',
          saved: true,
          status: 'generated',
          warnings: [],
        }],
        previewCacheSaved: true,
        provider: 'google',
        skippedCount: 0,
      },
      ticketErrors: [],
      ticketRetryCount: 0,
    })
  })

  it('returns per-recommendation outcomes so partial batch failures only hide successes', async () => {
    mocks.clearCache.mockRejectedValueOnce(new Error('缓存正在使用'))
    const result = await executeTripOperationsRecommendations({
      allItems: [item],
      dailyTipModel: null,
      days: [day],
      itemsByDay: { [day.id]: [item] },
      now: 100,
      readinessModel,
      recommendations: [routeRecommendation, cacheRecommendation],
      tickets: [ticket],
      trip,
    })

    expect(result.outcomes).toEqual([
      expect.objectContaining({ fingerprint: routeRecommendation.fingerprint, status: 'applied' }),
      expect.objectContaining({ fingerprint: cacheRecommendation.fingerprint, status: 'failed' }),
    ])
    expect(result.appliedChanges).toEqual([
      expect.objectContaining({ action: 'generated_route', dayId: day.id, occurredAt: 100 }),
    ])
  })

  it('does not report preview-only work as applied', async () => {
    mocks.executeRepair.mockResolvedValueOnce({
      contentPreview: {
        baselineFingerprint: 'baseline',
        checkedIds: ['preview_1'],
        generatedAt: '2026-06-10T00:00:00.000Z',
        items: [{ hasWrite: true, id: 'preview_1', itemId: item.id, itemTitle: item.title, summary: '补充开放时间', warnings: [] }],
        requestCounts: { aiSynthesis: 1, placeDetails: 1, placeLookup: 1, total: 4, travelSearch: 1 },
        warnings: [],
      },
      dailyTipPreview: null,
      messages: ['已生成内容预览。'],
      retriedTicketIds: [],
      ticketErrors: [],
      ticketRetryCount: 0,
    })
    const result = await executeTripOperationsRecommendations({
      allItems: [item],
      dailyTipModel: null,
      days: [day],
      itemsByDay: { [day.id]: [item] },
      readinessModel,
      recommendations: [contentRecommendation],
      tickets: [],
      trip,
    })
    expect(result.outcomes[0].status).toBe('pending_preview')
    expect(result.appliedChanges).toEqual([])
    expect(result.pendingPreviews).toHaveLength(1)
  })
})

const trip: Trip = {
  createdAt: 1,
  destination: '杭州',
  endDate: '2026-06-11',
  id: 'trip_1',
  startDate: '2026-06-10',
  title: '杭州两日',
  updatedAt: 1,
}

const day: Day = { date: '2026-06-10', id: 'day_1', sortOrder: 1, title: '第一天', tripId: trip.id }
const item: ItineraryItem = { createdAt: 1, dayId: day.id, id: 'item_1', sortOrder: 1, ticketIds: [], title: '西湖', tripId: trip.id, updatedAt: 1 }
const ticket: TicketMeta = { createdAt: 1, fileName: 'ticket.pdf', fileType: 'pdf', id: 'ticket_1', mimeType: 'application/pdf', size: 1, storageMode: 'copy', title: '门票', tripId: trip.id, updatedAt: 1 }

const readinessModel: TripReadinessModel = {
  issues: [
    { actionKind: 'generate_routes', actionLabel: '生成路线', canBatchFix: true, dayId: day.id, defaultSelected: true, evidence: [], id: 'route-issue', message: '', requiresPreview: true, severity: 'low', title: '', type: 'missing_route' },
    { actionKind: 'generate_content_preview', actionLabel: '生成预览', canBatchFix: true, dayId: day.id, defaultSelected: true, evidence: [], id: 'content-issue', itemId: item.id, message: '', requiresPreview: true, severity: 'low', title: '', type: 'missing_content' },
  ],
  summary: { fixableCount: 2, highRiskCount: 0, message: '', selectedCount: 2, status: 'needs_attention', statusLabel: '待完善', totalCount: 2 },
}

const routeRecommendation = recommendation({
  actionKind: 'generate_routes',
  affectedDayIds: [day.id],
  fingerprint: 'route-fingerprint',
  readinessIssueIds: ['route-issue'],
  type: 'missing_route',
})
const cacheRecommendation = recommendation({
  actionKind: 'clear_ticket_cache',
  fingerprint: 'cache-fingerprint',
  readinessIssueIds: [],
  ticketIds: [ticket.id],
  type: 'synced_ticket_cache',
})
const contentRecommendation = recommendation({
  actionKind: 'generate_content_preview',
  affectedDayIds: [day.id],
  affectedItemIds: [item.id],
  executionMode: 'preview_low_risk',
  fingerprint: 'content-fingerprint',
  readinessIssueIds: ['content-issue'],
  type: 'missing_content',
})

function recommendation(patch: Partial<TripOperationsRecommendation>): TripOperationsRecommendation {
  return {
    actionKind: 'generate_routes',
    actionLabel: '处理',
    affectedDayIds: [],
    affectedItemIds: [],
    canBatch: true,
    detail: '',
    evidence: [],
    executionMode: 'confirmed_low_risk',
    fingerprint: 'fingerprint',
    id: 'recommendation',
    message: '',
    phaseWeight: 10,
    priority: 110,
    readinessIssueIds: [],
    requiresConfirm: true,
    requiresPreview: true,
    scopeKey: 'scope',
    severity: 'low',
    ticketIds: [],
    title: '建议',
    type: 'missing_route',
    ...patch,
  }
}
