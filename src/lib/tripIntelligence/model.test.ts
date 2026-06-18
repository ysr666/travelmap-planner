import { describe, expect, it } from 'vitest'
import { buildTripIntelligenceModel } from './model'
import type { TripLiveModel } from '../tripLiveMode'
import type { TripOperationsHiddenRecommendation, TripOperationsModel, TripOperationsRecommendation } from '../tripOperationsAgent'
import type { TripReadinessModel } from '../tripReadiness'
import type { ItineraryItem, LedgerExpense, SharedTripMutation } from '../../types'

describe('buildTripIntelligenceModel', () => {
  it('maps operations recommendations and hidden dispositions into unified suggestions', () => {
    const active = recommendation({ id: 'active', priority: 20, requiresConfirm: true, title: '确认路线' })
    const ignored = recommendation({ id: 'ignored', scopeKey: 'ignored-scope', title: '忽略项' })
    const snoozed = recommendation({ id: 'snoozed', scopeKey: 'snoozed-scope', title: '稍后项' })
    const completed = recommendation({ id: 'completed', scopeKey: 'completed-scope', title: '完成项' })

    const model = buildTripIntelligenceModel({
      operationsModel: operationsModel({
        activeRecommendations: [active],
        hiddenRecommendations: [
          { disposition: disposition('ignored', ignored), recommendation: ignored },
          { disposition: disposition('snoozed', snoozed), recommendation: snoozed },
          { disposition: disposition('completed', completed), recommendation: completed },
        ],
      }),
    })

    expect(model.suggestions).toEqual([
      expect.objectContaining({ id: 'operations:active', status: 'needs_confirmation' }),
    ])
    expect(statusById(model.allSuggestions)).toMatchObject({
      'operations:active': 'needs_confirmation',
      'operations:completed': 'completed',
      'operations:ignored': 'ignored',
      'operations:snoozed': 'later',
    })
  })

  it('dedupes readiness issues behind operations recommendations', () => {
    const operation = recommendation({
      id: 'op-readiness',
      readinessIssueIds: ['readiness-1'],
      title: '绑定票据',
      type: 'missing_ticket',
    })
    const readinessModel: TripReadinessModel = {
      issues: [{
        actionKind: 'navigate_tickets',
        actionLabel: '打开票据',
        canBatchFix: false,
        defaultSelected: false,
        evidence: [],
        id: 'readiness-1',
        itemId: 'item-1',
        message: '行程点缺少票据。',
        requiresPreview: false,
        severity: 'medium',
        title: '缺少票据',
        type: 'missing_ticket',
      }],
      summary: {
        fixableCount: 0,
        highRiskCount: 0,
        message: '',
        selectedCount: 0,
        status: 'needs_attention',
        statusLabel: '',
        totalCount: 1,
      },
    }

    const model = buildTripIntelligenceModel({
      operationsModel: operationsModel({ activeRecommendations: [operation] }),
      readinessModel,
    })

    const deduped = model.allSuggestions.filter((suggestion) => suggestion.key === 'readiness:readiness-1')
    expect(deduped).toHaveLength(1)
    expect(deduped[0].source.kind).toBe('operations')
  })

  it('maps inbox active preview to a confirmation suggestion', () => {
    const model = buildTripIntelligenceModel({
      inbox: {
        activePreview: { checkedDiffIds: ['diff-1', 'diff-2'], id: 'preview-1' },
        summary: {
          accountErrorCount: 0,
          accountNeedsAssignmentCount: 0,
          accountPreviewCount: 0,
          errorEntryCount: 0,
          readyEntryCount: 0,
          selectedPreviewDiffCount: 2,
        },
      },
    })

    expect(model.forInbox()).toEqual([
      expect.objectContaining({
        id: 'inbox:preview:preview-1',
        message: expect.stringContaining('2 条'),
        status: 'needs_confirmation',
      }),
    ])
  })

  it('keeps live risks scoped to the affected day', () => {
    const model = buildTripIntelligenceModel({
      liveModel: liveModel('day-1', 'item-1'),
    })

    expect(model.forDay('day-1')).toEqual([
      expect.objectContaining({ id: 'live:late-risk', scope: 'live' }),
    ])
    expect(model.forDay('day-2')).toEqual([])
  })

  it('maps ledger review entries without triggering source scans', () => {
    const model = buildTripIntelligenceModel({
      ledgerReviewEntries: [{
        buckets: ['pending'],
        canBulkConfirm: true,
        canMarkReviewed: false,
        expense: expense({ id: 'expense-1', sourceLinks: [{ available: true, id: 'ticket:ticket-1', kind: 'ticket', role: 'payment_receipt', sourceId: 'ticket-1' }] }),
        issues: [],
        priority: 2,
      }],
    })

    expect(model.forFinance()).toEqual([
      expect.objectContaining({
        id: 'ledger:expense-1',
        status: 'needs_confirmation',
        ticketIds: ['ticket-1'],
      }),
    ])
    expect(model.forTicket('ticket-1')).toEqual([
      expect.objectContaining({ id: 'ledger:expense-1' }),
    ])
  })

  it('maps shared trip mutation statuses', () => {
    const model = buildTripIntelligenceModel({
      sharedMutations: [
        mutation('pending-1', 'pending'),
        mutation('conflict-1', 'conflict'),
        mutation('rejected-1', 'rejected'),
        mutation('applied-1', 'applied'),
      ],
    })

    expect(statusById(model.allSuggestions)).toMatchObject({
      'shared-trip:applied-1': 'completed',
      'shared-trip:conflict-1': 'needs_confirmation',
      'shared-trip:pending-1': 'needs_confirmation',
      'shared-trip:rejected-1': 'ignored',
    })
  })

  it('sorts and filters trip home, day, ticket, finance, and inbox suggestions', () => {
    const op = recommendation({
      affectedDayIds: ['day-1'],
      id: 'op-day',
      itemId: 'item-1',
      priority: 30,
      ticketIds: ['ticket-1'],
    })
    const model = buildTripIntelligenceModel({
      inbox: { activePreview: { checkedDiffIds: ['diff-1'], id: 'preview-1' } },
      ledgerReviewEntries: [{
        buckets: ['duplicate'],
        canBulkConfirm: false,
        canMarkReviewed: false,
        expense: expense({ id: 'expense-1', itemIds: ['item-1'] }),
        issues: [{ blocking: true, kind: 'duplicate_conflict', message: '可能重复' }],
        priority: 1,
      }],
      operationsModel: operationsModel({ activeRecommendations: [op] }),
    })

    expect(model.forTripHome().map((suggestion) => suggestion.id)).toEqual([
      'ledger:expense-1',
      'inbox:preview:preview-1',
      'operations:op-day',
    ])
    expect(model.forDay('day-1').map((suggestion) => suggestion.id)).toEqual(['operations:op-day'])
    expect(model.forItem('item-1').map((suggestion) => suggestion.id)).toEqual(['ledger:expense-1', 'operations:op-day'])
    expect(model.forTicket('ticket-1').map((suggestion) => suggestion.id)).toEqual(['operations:op-day'])
    expect(model.forFinance().map((suggestion) => suggestion.id)).toEqual(['ledger:expense-1'])
    expect(model.forInbox().map((suggestion) => suggestion.id)).toEqual(['inbox:preview:preview-1'])
    expect(model.summary).toEqual({ highRiskCount: 1, needsConfirmationCount: 1, totalCount: 3 })
  })
})

function statusById(suggestions: Array<{ id: string; status: string }>) {
  return Object.fromEntries(suggestions.map((suggestion) => [suggestion.id, suggestion.status]))
}

function operationsModel({
  activeRecommendations,
  hiddenRecommendations = [],
}: {
  activeRecommendations: TripOperationsRecommendation[]
  hiddenRecommendations?: TripOperationsHiddenRecommendation[]
}): TripOperationsModel {
  return {
    activeRecommendations,
    allRecommendations: [...activeRecommendations, ...hiddenRecommendations.map((entry) => entry.recommendation)],
    batchableCount: 0,
    batchableRecommendations: [],
    hiddenRecommendations,
    phase: 'traveling',
    phaseLabel: '旅行中',
    recommendations: activeRecommendations.slice(0, 5),
    replanTimeline: [],
    summary: {
      highRiskCount: activeRecommendations.filter((item) => item.severity === 'high').length,
      message: '',
      totalCount: activeRecommendations.length,
    },
  }
}

function recommendation(patch: Partial<TripOperationsRecommendation> = {}): TripOperationsRecommendation {
  return {
    actionKind: 'open_day',
    actionLabel: '查看',
    affectedDayIds: [],
    affectedItemIds: [],
    canBatch: false,
    detail: '建议详情',
    evidence: [],
    executionMode: 'manual_navigation',
    fingerprint: `fingerprint-${patch.id ?? 'recommendation'}`,
    id: patch.id ?? 'recommendation',
    message: '建议消息',
    phaseWeight: 0,
    priority: 50,
    readinessIssueIds: [],
    requiresConfirm: false,
    requiresPreview: false,
    scopeKey: patch.scopeKey ?? patch.id ?? 'recommendation',
    severity: 'medium',
    ticketIds: [],
    title: '建议',
    type: 'missing_route',
    ...patch,
  }
}

function disposition(
  status: 'completed' | 'ignored' | 'snoozed',
  target: TripOperationsRecommendation,
) {
  return {
    createdAt: 1,
    fingerprint: target.fingerprint,
    phase: 'traveling' as const,
    scopeKey: target.scopeKey,
    status,
    zonedDate: '2026-06-10',
  }
}

function liveModel(dayId: string, itemId: string): TripLiveModel {
  const target = item(dayId, itemId)
  return {
    completedItems: [],
    counts: { completed: 0, pending: 1, skipped: 0, total: 1 },
    currentTimeLabel: '09:00',
    openingHours: { detail: '未知', state: 'unknown' },
    operationsRecommendations: [],
    risks: [{
      detail: '可能迟到 15 分钟。',
      id: 'late-risk',
      kind: 'late',
      severity: 'critical',
      title: '时间风险',
    }],
    skippedItems: [],
    stage: 'next_due',
    stageLabel: '即将开始',
    subtitle: '去下一站',
    targetItem: target,
    ticketIds: [],
    ticketTitles: [],
    title: '下一站',
  }
}

function item(dayId: string, id: string): ItineraryItem {
  return {
    createdAt: 1,
    dayId,
    id,
    sortOrder: 1,
    ticketIds: [],
    title: '行程点',
    tripId: 'trip-1',
    updatedAt: 1,
  }
}

function expense(patch: Partial<LedgerExpense> = {}): LedgerExpense {
  return {
    amountMinor: 10_000,
    category: 'lodging',
    createdAt: 1,
    currency: 'JPY',
    date: '2026-06-10',
    id: patch.id ?? 'expense-1',
    itemIds: ['item-1'],
    payerParticipantId: 'person-1',
    paymentStatus: 'paid',
    reviewStatus: 'needs_review',
    source: { kind: 'manual' },
    splitMode: 'equal',
    splitShares: [{ participantId: 'person-1', weight: 1 }],
    status: 'draft',
    title: '酒店费用',
    tripId: 'trip-1',
    updatedAt: 1,
    ...patch,
  }
}

function mutation(id: string, status: SharedTripMutation['status']): SharedTripMutation {
  return {
    createdAt: '2026-06-10T00:00:00Z',
    displayName: '同行人',
    id,
    mutationType: 'update_item',
    payload: {},
    sharedTripId: 'shared-1',
    status,
    updatedAt: '2026-06-10T00:00:00Z',
    userId: 'user-1',
  }
}
