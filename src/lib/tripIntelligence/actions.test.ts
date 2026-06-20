import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeTripIntelligenceAction } from './actions'
import type { TripReplanRecord } from '../../types'

const mocks = vi.hoisted(() => ({
  applyInbox: vi.fn(),
  applyReplan: vi.fn(),
  createLedgerExpense: vi.fn(),
  createReplanPreview: vi.fn(),
  createTripDisruptionEvent: vi.fn(),
  executeOperations: vi.fn(),
  setExecutionState: vi.fn(),
  undoReplan: vi.fn(),
}))

vi.mock('../tripOperationsExecutor', () => ({
  executeTripOperationsRecommendations: mocks.executeOperations,
}))

vi.mock('../ai/travelInboxApply', () => ({
  applyTravelInboxPreviewRecord: mocks.applyInbox,
}))

vi.mock('../adaptiveReplanning', () => ({
  applyTripReplanOption: mocks.applyReplan,
  createTripReplanPreviewForEvent: mocks.createReplanPreview,
  undoTripReplan: mocks.undoReplan,
}))

vi.mock('../../db', () => ({
  createLedgerExpense: mocks.createLedgerExpense,
  createTripDisruptionEvent: mocks.createTripDisruptionEvent,
  setItineraryItemExecutionState: mocks.setExecutionState,
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('executeTripIntelligenceAction', () => {
  it('dispatches low-risk operations work to the existing executor', async () => {
    const legacyChange = {
      action: 'generated_route' as const,
      dayId: 'day_1',
      detail: '路线预览已生成。',
      occurredAt: 123,
      target: 'day' as const,
      title: '第一天',
    }
    mocks.executeOperations.mockResolvedValueOnce({
      appliedChanges: [legacyChange],
      outcomes: [{
        appliedChanges: [legacyChange],
        errors: [],
        fingerprint: 'route-fingerprint',
        messages: ['路线预览已生成。'],
        recommendationId: 'ops-route',
        status: 'applied',
      }],
      pendingPreviews: [],
    })

    const result = await executeTripIntelligenceAction({
      kind: 'trip_operations_execute',
      operation: { recommendations: [{ id: 'ops-route' }] } as never,
    })

    expect(mocks.executeOperations).toHaveBeenCalledWith({ recommendations: [{ id: 'ops-route' }] })
    expect(result).toEqual(expect.objectContaining({
      legacyAppliedChanges: [legacyChange],
      status: 'completed',
    }))
    expect(result.appliedChanges).toEqual([
      expect.objectContaining({
        actionType: 'generated_route',
        targetId: 'day_1',
        targetType: 'day',
        title: '第一天',
      }),
    ])
  })

  it('applies a Travel Inbox preview and maps inbox changes to unified and legacy shapes', async () => {
    mocks.applyInbox.mockResolvedValueOnce({
      affectedItemIds: ['item_1'],
      appliedChanges: [{
        action: 'created',
        dayId: 'day_1',
        id: 'change_1',
        itemId: 'item_1',
        kind: 'item',
        title: '酒店入住',
      }],
      appliedCount: 1,
      ok: true,
    })

    const result = await executeTripIntelligenceAction({
      checkedDiffIds: ['diff_1'],
      kind: 'travel_inbox_apply_preview',
      record: { checkedDiffIds: ['diff_1'], entryIds: [], id: 'preview_1', preview: {}, tripId: 'trip_1' } as never,
    })

    expect(mocks.applyInbox).toHaveBeenCalledWith({
      checkedDiffIds: ['diff_1'],
      record: expect.objectContaining({ id: 'preview_1' }),
    })
    expect(result.status).toBe('completed')
    expect(result.appliedChanges).toEqual([
      expect.objectContaining({
        actionType: 'inbox_created_item',
        source: expect.objectContaining({ kind: 'inbox' }),
        targetId: 'item_1',
        targetType: 'item',
      }),
    ])
    expect(result.legacyAppliedChanges).toEqual([
      expect.objectContaining({
        action: 'created_item',
        itemId: 'item_1',
        target: 'item',
      }),
    ])
  })

  it('applies and undoes replan records through the existing replan functions', async () => {
    mocks.applyReplan.mockResolvedValueOnce(replanRecord('applied'))
    mocks.undoReplan.mockResolvedValueOnce(replanRecord('undone'))

    const applied = await executeTripIntelligenceAction({
      kind: 'replan_apply_option',
      optionId: 'option_1',
      recordId: 'replan_1',
    })
    const undone = await executeTripIntelligenceAction({
      kind: 'replan_undo',
      recordId: 'replan_1',
    })

    expect(mocks.applyReplan).toHaveBeenCalledWith('replan_1', 'option_1')
    expect(mocks.undoReplan).toHaveBeenCalledWith('replan_1')
    expect(applied.appliedChanges[0]).toEqual(expect.objectContaining({
      actionType: 'replan_applied',
      targetId: 'replan_1',
      targetType: 'live',
    }))
    expect(undone.appliedChanges[0]).toEqual(expect.objectContaining({
      actionType: 'replan_undone',
      targetId: 'replan_1',
      targetType: 'live',
    }))
  })

  it('sets live item execution state through the existing item state function', async () => {
    const updatedItem = {
      createdAt: 1,
      dayId: 'day_1',
      id: 'item_1',
      sortOrder: 1,
      title: '浅草寺',
      tripId: 'trip_1',
      updatedAt: 2,
    }
    mocks.setExecutionState.mockResolvedValueOnce(updatedItem)

    const result = await executeTripIntelligenceAction({
      itemId: 'item_1',
      kind: 'live_set_item_execution_state',
      status: 'completed',
    })

    expect(mocks.setExecutionState).toHaveBeenCalledWith('item_1', 'completed')
    expect(result.status).toBe('completed')
    expect(result.liveItem).toBe(updatedItem)
    expect(result.appliedChanges).toEqual([
      expect.objectContaining({
        actionType: 'live_item_completed',
        targetId: 'item_1',
        targetType: 'item',
      }),
    ])
  })

  it('reports live disruption through existing event and replan preview functions', async () => {
    const event = {
      createdAt: 1,
      dayId: 'day_1',
      evidence: [],
      id: 'event_1',
      itemId: 'item_1',
      kind: 'late',
      occurredAt: '2026-06-10T01:00:00Z',
      reportedByRole: 'owner',
      status: 'reported',
      tripId: 'trip_1',
      updatedAt: 1,
    }
    mocks.createTripDisruptionEvent.mockResolvedValueOnce(event)
    mocks.createReplanPreview.mockResolvedValueOnce(replanRecord('preview'))

    const result = await executeTripIntelligenceAction({
      event: {
        dayId: 'day_1',
        evidence: [],
        itemId: 'item_1',
        kind: 'late',
        occurredAt: '2026-06-10T01:00:00Z',
        reportedByRole: 'owner',
        status: 'reported',
        tripId: 'trip_1',
      },
      kind: 'live_report_disruption',
    })

    expect(mocks.createTripDisruptionEvent).toHaveBeenCalledWith(expect.objectContaining({
      dayId: 'day_1',
      itemId: 'item_1',
      kind: 'late',
    }))
    expect(mocks.createReplanPreview).toHaveBeenCalledWith('event_1')
    expect(result.status).toBe('needs_confirmation')
    expect(result.disruptionEvent).toBe(event)
    expect(result.replanRecord).toEqual(expect.objectContaining({ id: 'replan_1', status: 'preview' }))
    expect(result.appliedChanges).toEqual([
      expect.objectContaining({
        actionType: 'live_disruption_reported',
        targetId: 'replan_1',
        targetType: 'live',
      }),
    ])
  })

  it('creates ledger expense drafts through tracked mutation and keeps unified ticket candidates unconfirmed', async () => {
    mocks.createLedgerExpense.mockImplementationOnce(async (input) => ({
      createdAt: 1,
      id: 'expense_1',
      updatedAt: 2,
      ...input,
    }))

    const result = await executeTripIntelligenceAction({
      candidate: {
        amountMinor: 12_000,
        category: 'lodging',
        currency: 'JPY',
        date: '2026-06-10',
        extractedText: '酒店 receipt paid JPY 12000',
        itemIds: ['item_1'],
        lineItems: [],
        orderStatus: 'active',
        paymentStatus: 'paid',
        recognitionConfidence: 0.99,
        source: { fingerprint: 'ticket-fingerprint', kind: 'ticket', label: '酒店订单.pdf', sourceId: 'ticket_1' },
        sourceLink: {
          available: true,
          capturedAt: '2026-06-10T00:00:00.000Z',
          fingerprint: 'ticket-fingerprint',
          id: 'ticket:ticket_1',
          kind: 'ticket',
          label: '酒店订单.pdf',
          role: 'payment_receipt',
          sourceId: 'ticket_1',
          title: '酒店订单.pdf',
        },
        sourceRole: 'payment_receipt',
        title: '酒店订单',
        warnings: [],
      },
      kind: 'ledger_create_expense_draft_from_candidate',
      participants: [{
        createdAt: 1,
        displayName: '我',
        id: 'person_1',
        isSelf: true,
        tripId: 'trip_1',
        updatedAt: 1,
      }],
      tripId: 'trip_1',
    })

    expect(mocks.createLedgerExpense).toHaveBeenCalledWith(expect.objectContaining({
      reviewStatus: 'needs_review',
      source: expect.objectContaining({ kind: 'ticket', sourceId: 'ticket_1' }),
      status: 'draft',
      tripId: 'trip_1',
    }))
    expect(mocks.createLedgerExpense.mock.calls[0][0].autoConfirmReason).toBeUndefined()
    expect(result.status).toBe('completed')
    expect(result.ledgerExpense).toEqual(expect.objectContaining({ id: 'expense_1' }))
    expect(result.appliedChanges).toEqual([
      expect.objectContaining({
        actionType: 'ledger_expense_draft_created',
        targetId: 'expense_1',
        targetType: 'finance',
      }),
    ])
  })

  it('does not execute unsupported action kinds', async () => {
    const result = await executeTripIntelligenceAction({ kind: 'ledger_review_apply' })

    expect(result).toEqual({
      appliedChanges: [],
      message: '「ledger_review_apply」尚未接入统一执行，将继续使用现有手动流程。',
      status: 'failed',
    })
    expect(mocks.executeOperations).not.toHaveBeenCalled()
    expect(mocks.applyInbox).not.toHaveBeenCalled()
    expect(mocks.applyReplan).not.toHaveBeenCalled()
    expect(mocks.createReplanPreview).not.toHaveBeenCalled()
    expect(mocks.undoReplan).not.toHaveBeenCalled()
  })
})

function replanRecord(status: 'preview' | 'applied' | 'undone'): TripReplanRecord {
  return {
    afterSnapshot: status === 'preview' ? undefined : { days: [], items: [{ id: 'item_1', title: '浅草寺' } as never] },
    baselineFingerprint: 'baseline',
    beforeSnapshot: { days: [], items: [{ id: 'item_1', title: '浅草寺' } as never] },
    createdAt: 1,
    eventId: 'event_1',
    evidence: [],
    id: 'replan_1',
    options: [{
      diff: {
        companionImpacts: [],
        itemChanges: [{
          after: { dayId: 'day_1', endTime: '10:30', executionState: undefined, sortOrder: 1, startTime: '09:30' },
          before: { dayId: 'day_1', endTime: '10:00', executionState: undefined, sortOrder: 1, startTime: '09:00' },
          changeType: 'time_changed',
          itemId: 'item_1',
          reason: '时间不足。',
          title: '浅草寺',
        }],
        ledgerImpacts: [],
        routeImpacts: [],
        ticketImpacts: [],
        warnings: [],
      },
      id: 'option_1',
      itemPatches: [],
      score: 1,
      strategy: 'least_change',
      summary: '缩短停留',
      title: '最少改动',
    }],
    selectedDiff: status === 'preview' ? undefined : {
      companionImpacts: [],
      itemChanges: [{
        after: { dayId: 'day_1', endTime: '10:30', executionState: undefined, sortOrder: 1, startTime: '09:30' },
        before: { dayId: 'day_1', endTime: '10:00', executionState: undefined, sortOrder: 1, startTime: '09:00' },
        changeType: 'time_changed',
        itemId: 'item_1',
        reason: '时间不足。',
        title: '浅草寺',
      }],
      ledgerImpacts: [],
      routeImpacts: [],
      ticketImpacts: [],
      warnings: [],
    },
    selectedOptionId: status === 'preview' ? undefined : 'option_1',
    status,
    tripId: 'trip_1',
    updatedAt: 2,
  }
}
