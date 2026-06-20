import { describe, expect, it } from 'vitest'
import { buildTripIntelligenceModel } from './model'
import type { TripLiveModel } from '../tripLiveMode'
import type { TripOperationsHiddenRecommendation, TripOperationsModel, TripOperationsRecommendation } from '../tripOperationsAgent'
import type { TripReadinessModel } from '../tripReadiness'
import type { ItineraryItem, LedgerExpense, SharedTripMutation, TicketBlobSyncState, TicketMeta, TripIntelligenceSuggestionStateRecord, TripReplanRecord } from '../../types'

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

  it('overlays persisted suggestion states and ignores expired later states', () => {
    const ignoredRecommendation = recommendation({ id: 'ignored-persisted', scopeKey: 'ignored-persisted' })
    const expiredRecommendation = recommendation({ id: 'expired-later', scopeKey: 'expired-later' })
    const states: TripIntelligenceSuggestionStateRecord[] = [{
      createdAt: 1,
      id: 'state-ignored',
      sourceKind: 'operations',
      status: 'ignored',
      suggestionKey: 'operations:ignored-persisted',
      tripId: 'trip-1',
      updatedAt: 2,
    }, {
      createdAt: 1,
      id: 'state-expired',
      status: 'later',
      suggestionKey: 'operations:expired-later',
      tripId: 'trip-1',
      until: Date.now() - 1,
      updatedAt: 2,
    }]

    const model = buildTripIntelligenceModel({
      operationsModel: operationsModel({ activeRecommendations: [ignoredRecommendation, expiredRecommendation] }),
      suggestionStates: states,
    })

    expect(model.forTripHome().map((suggestion) => suggestion.id)).toContain('operations:expired-later')
    expect(model.forTripHome().map((suggestion) => suggestion.id)).not.toContain('operations:ignored-persisted')
    expect(statusById(model.allSuggestions)['operations:ignored-persisted']).toBe('ignored')
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

  it('limits day context to current day item, ticket, and live suggestions', () => {
    const readinessModel: TripReadinessModel = {
      issues: [{
        actionKind: 'navigate_item',
        actionLabel: '查看行程点',
        canBatchFix: false,
        defaultSelected: false,
        evidence: [],
        id: 'readiness-day-1',
        itemId: 'item-1',
        message: '当天行程点需要补充信息。',
        requiresPreview: false,
        severity: 'medium',
        title: '补充当天信息',
        type: 'missing_content',
      }, {
        actionKind: 'navigate_item',
        actionLabel: '查看行程点',
        canBatchFix: false,
        defaultSelected: false,
        evidence: [],
        id: 'readiness-day-2',
        itemId: 'item-2',
        message: '其他日期行程点需要补充信息。',
        requiresPreview: false,
        severity: 'medium',
        title: '补充其他日期信息',
        type: 'missing_content',
      }],
      summary: {
        fixableCount: 0,
        highRiskCount: 0,
        message: '',
        selectedCount: 0,
        status: 'needs_attention',
        statusLabel: '',
        totalCount: 2,
      },
    }
    const syncRecommendation = recommendation({
      affectedDayIds: ['day-1'],
      actionKind: 'open_sync',
      id: 'sync-day-1',
      title: '同步待处理',
      type: 'cloud_sync_pending',
    })

    const model = buildTripIntelligenceModel({
      inbox: { activePreview: { checkedDiffIds: ['diff-1'], id: 'preview-1' } },
      items: [item('day-1', 'item-1'), item('day-2', 'item-2')],
      ledgerReviewEntries: [{
        buckets: ['pending'],
        canBulkConfirm: true,
        canMarkReviewed: false,
        expense: expense({ id: 'expense-day-1', itemIds: ['item-1'] }),
        issues: [],
        priority: 1,
      }],
      liveModel: liveModel('day-1', 'item-1'),
      operationsModel: operationsModel({ activeRecommendations: [
        syncRecommendation,
        recommendation({ id: 'other-day', itemId: 'item-2', title: '其他日期建议' }),
      ] }),
      readinessModel,
      sharedMutations: [mutation('pending-1', 'pending')],
    })

    expect(model.forDay('day-1').map((suggestion) => suggestion.id).sort()).toEqual([
      'readiness:readiness-day-1',
      'live:late-risk',
    ].sort())
    expect(model.forDay('day-2').map((suggestion) => suggestion.id).sort()).toEqual([
      'operations:other-day',
      'readiness:readiness-day-2',
    ].sort())
  })

  it('maps active replan records into day-scoped live suggestions', () => {
    const model = buildTripIntelligenceModel({
      items: [item('day-1', 'item-1')],
      liveModel: liveModel('day-1', 'item-1'),
      liveReplanRecord: replanRecord('preview'),
    })

    expect(model.forDay('day-1')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: expect.objectContaining({ kind: 'replan_apply_option', mode: 'confirm_required' }),
        id: 'live:replan:replan-1',
        scope: 'live',
        status: 'needs_confirmation',
      }),
    ]))
    expect(model.forDay('day-2').map((suggestion) => suggestion.id)).not.toContain('live:replan:replan-1')
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

  it('maps ticket context suggestions and ledger draft candidates into ticket and finance views', () => {
    const ticket = ticketMeta({
      id: 'ticket-1',
      fileName: 'receipt.pdf',
      note: 'receipt paid JPY 12000',
      ticketCategory: 'other',
      title: '收据',
    })
    const syncState: TicketBlobSyncState = {
      cacheStatus: 'cached',
      lastError: 'upload failed',
      ticketId: 'ticket-1',
      tripId: 'trip-1',
      updatedAt: 2,
      uploadStatus: 'error',
    }
    const model = buildTripIntelligenceModel({
      ledgerDraftCandidates: [ledgerCandidate({ sourceId: 'ticket-1' })],
      ticketInput: {
        ticketBlobSyncStates: [syncState],
        tickets: [ticket],
      },
    })

    expect(model.forTicket('ticket-1').map((suggestion) => suggestion.id)).toEqual([
      'ticket:sync-upload:ticket-1',
      'ticket:bind:ticket-1',
      'ledger:candidate:ticket:ticket-1',
      'ticket:classify:ticket-1',
    ])
    expect(model.forFinance()).toEqual([
      expect.objectContaining({
        action: expect.objectContaining({ kind: 'ledger_create_expense_draft_from_candidate' }),
        id: 'ledger:candidate:ticket:ticket-1',
        status: 'needs_confirmation',
        ticketIds: ['ticket-1'],
      }),
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
      'shared-trip:rejected-1': 'needs_confirmation',
    })
    expect(model.forSharedTrip().map((suggestion) => suggestion.id).sort()).toEqual([
      'shared-trip:conflict-1',
      'shared-trip:pending-1',
      'shared-trip:rejected-1',
    ].sort())
  })

  it('maps document input into document context without requiring trip home to load vault data', () => {
    const model = buildTripIntelligenceModel({
      documentInput: {
        documents: [{
          data: {
            attachmentIds: [],
            documentNumber: 'P123456789',
            format: 'electronic',
            kind: 'passport',
            status: 'active',
            title: 'Private passport P123456789',
            travelerIds: [],
            validUntil: '2026-06-20',
          },
          id: 'doc-1',
        }],
        now: '2026-06-01T00:00:00.000Z',
        reminders: [],
      },
    })

    expect(model.forDocument().map((suggestion) => suggestion.id)).toEqual([
      'document:expiring:doc-1',
      'document:reminder:doc-1',
    ])
    expect(model.forDocument().map((suggestion) => `${suggestion.title} ${suggestion.message}`).join(' ')).not.toContain('P123456789')

    const emptyModel = buildTripIntelligenceModel({})
    expect(emptyModel.forDocument()).toEqual([])
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

function ticketMeta(patch: Partial<TicketMeta> = {}): TicketMeta {
  return {
    createdAt: 1,
    fileName: '酒店订单.pdf',
    fileType: 'pdf',
    id: 'ticket-1',
    mimeType: 'application/pdf',
    size: 1000,
    storageMode: 'copy',
    ticketCategory: 'other',
    title: '酒店订单',
    tripId: 'trip-1',
    updatedAt: 1,
    ...patch,
  }
}

function ledgerCandidate({ sourceId = 'ticket-1' }: { sourceId?: string }) {
  return {
    amountMinor: 12_000,
    category: 'lodging' as const,
    currency: 'JPY',
    date: '2026-06-10',
    extractedText: '酒店 receipt paid JPY 12000',
    itemIds: [],
    lineItems: [],
    orderStatus: 'active' as const,
    paymentStatus: 'paid' as const,
    recognitionConfidence: 0.99,
    source: { fingerprint: `fingerprint-${sourceId}`, kind: 'ticket' as const, label: '酒店订单.pdf', sourceId },
    sourceLink: {
      available: true,
      capturedAt: '2026-06-10T00:00:00.000Z',
      fingerprint: `fingerprint-${sourceId}`,
      id: `ticket:${sourceId}`,
      kind: 'ticket' as const,
      label: '酒店订单.pdf',
      role: 'payment_receipt' as const,
      sourceId,
      title: '酒店订单.pdf',
    },
    sourceRole: 'payment_receipt' as const,
    title: '酒店订单',
    warnings: [],
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

function replanRecord(status: TripReplanRecord['status']): TripReplanRecord {
  return {
    baselineFingerprint: 'baseline',
    beforeSnapshot: { days: [{ id: 'day-1', title: '第一天' } as never], items: [item('day-1', 'item-1')] },
    createdAt: 1,
    eventId: 'event-1',
    evidence: [],
    id: 'replan-1',
    options: [{
      diff: {
        companionImpacts: [],
        itemChanges: [{
          after: { dayId: 'day-1', endTime: '10:30', executionState: undefined, sortOrder: 1, startTime: '09:30' },
          before: { dayId: 'day-1', endTime: '10:00', executionState: undefined, sortOrder: 1, startTime: '09:00' },
          changeType: 'time_changed',
          itemId: 'item-1',
          reason: '时间不足。',
          title: '浅草寺',
        }],
        ledgerImpacts: [],
        routeImpacts: [{ dayId: 'day-1', itemIds: ['item-1'], staleRouteCache: false, summary: '路线需要重算' }],
        ticketImpacts: [{ impact: 'time_warning', summary: '票据时间需核对', ticketId: 'ticket-1', title: '门票' }],
        warnings: [],
      },
      id: 'option-1',
      itemPatches: [],
      score: 1,
      strategy: 'least_change',
      summary: '缩短停留',
      title: '最少改动',
    }],
    selectedOptionId: undefined,
    status,
    tripId: 'trip-1',
    updatedAt: 2,
  }
}
