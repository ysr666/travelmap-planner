import { describe, expect, it } from 'vitest'
import {
  appendTripIntelligenceExecutionRecord,
  getTripIntelligenceAppliedChangesForRecord,
  mapExistingTripImportAppliedChange,
  mapExistingTripImportAppliedChangeToTripOperationsChange,
  mapLedgerExpenseDraftCreatedAppliedChange,
  mapLiveDisruptionReportedAppliedChange,
  mapLiveItemExecutionAppliedChange,
  mapTripOperationsAppliedChange,
  mapTripReplanAppliedChange,
  sanitizeAppliedChangeDetail,
} from './appliedChanges'
import { createEmptyTripOperationsLocalState, type TripOperationsAppliedChange } from '../tripOperationsState'
import type { ItineraryItem, LedgerExpense, TripReplanRecord } from '../../types'

describe('trip intelligence appliedChanges', () => {
  it('maps operations changes to unified target/source fields', () => {
    const change: TripOperationsAppliedChange = {
      action: 'generated_route',
      dayId: 'day_1',
      detail: '路线预览已生成。',
      occurredAt: 123,
      target: 'day',
      title: '第一天',
    }

    expect(mapTripOperationsAppliedChange(change)).toEqual(expect.objectContaining({
      actionType: 'generated_route',
      detail: '路线预览已生成。',
      occurredAt: 123,
      source: expect.objectContaining({ kind: 'operations' }),
      targetId: 'day_1',
      targetType: 'day',
      title: '第一天',
    }))
  })

  it('maps inbox changes to unified and legacy history shapes', () => {
    const inboxChange = {
      action: 'bound' as const,
      dayId: 'day_1',
      id: 'change_1',
      itemId: 'item_1',
      kind: 'ticket' as const,
      ticketId: 'ticket_1',
      title: '西湖门票',
    }

    expect(mapExistingTripImportAppliedChange(inboxChange, 456)).toEqual(expect.objectContaining({
      actionType: 'inbox_bound_ticket',
      occurredAt: 456,
      source: expect.objectContaining({ kind: 'inbox' }),
      targetId: 'ticket_1',
      targetType: 'ticket',
    }))
    expect(mapExistingTripImportAppliedChangeToTripOperationsChange(inboxChange, 456)).toEqual(expect.objectContaining({
      action: 'bound_ticket',
      occurredAt: 456,
      target: 'tickets',
      ticketId: 'ticket_1',
    }))
  })

  it('redacts details that look like credentials, provider payload ids, or stack traces', () => {
    const detail = [
      'Authorization: Bearer SK1234567890',
      '订单号 1234567890123',
      'PNR ABC123456',
      'at unsafeProviderCall (/tmp/raw-stack.ts:1:1)',
    ].join('\n')

    const sanitized = sanitizeAppliedChangeDetail(detail)

    expect(sanitized).not.toContain('Bearer')
    expect(sanitized).not.toContain('SK1234567890')
    expect(sanitized).not.toContain('1234567890123')
    expect(sanitized).not.toContain('ABC123456')
    expect(sanitized).not.toContain('unsafeProviderCall')
    expect(sanitized).toContain('[已隐藏')
  })

  it('maps live item completion, skip, and restore changes', () => {
    const item = {
      createdAt: 1,
      dayId: 'day_1',
      id: 'item_1',
      sortOrder: 1,
      ticketIds: [],
      title: '浅草寺',
      tripId: 'trip_1',
      updatedAt: 2,
    }

    expect(mapLiveItemExecutionAppliedChange(item, 'completed', 123)).toEqual(expect.objectContaining({
      actionType: 'live_item_completed',
      occurredAt: 123,
      source: expect.objectContaining({ kind: 'live' }),
      targetId: 'item_1',
      targetType: 'item',
    }))
    expect(mapLiveItemExecutionAppliedChange(item, 'skipped', 123)).toEqual(expect.objectContaining({
      actionType: 'live_item_skipped',
      targetId: 'item_1',
    }))
    expect(mapLiveItemExecutionAppliedChange(item, null, 123)).toEqual(expect.objectContaining({
      actionType: 'live_item_restored',
      targetId: 'item_1',
    }))
  })

  it('maps live disruption and replan changes without leaking raw evidence details', () => {
    const disruption = mapLiveDisruptionReportedAppliedChange({
      createdAt: 1,
      dayId: 'day_1',
      evidence: [{
        confidence: 'high',
        displayUrl: 'example.com',
        domain: 'example.com',
        id: 'raw-provider-id-123456789',
        kind: 'travel_search',
        label: 'Provider raw result',
        retrievedAt: '2026-06-10T00:00:00Z',
        snippet: 'Authorization: Bearer SECRET123456',
        sourceType: 'unknown',
        url: 'https://example.com/raw',
      }],
      id: 'event_1',
      kind: 'late',
      notes: 'PNR ABC123456',
      occurredAt: '2026-06-10T00:00:00Z',
      reportedByRole: 'owner',
      status: 'reported',
      tripId: 'trip_1',
      updatedAt: 1,
    }, replanRecord(), 456)
    const replan = mapTripReplanAppliedChange(replanRecord(), 'applied', 456)

    expect(disruption).toEqual(expect.objectContaining({
      actionType: 'live_disruption_reported',
      detail: '已生成 1 个重排方案，确认前不会写入行程。',
      targetId: 'replan_1',
      targetType: 'live',
      title: '迟到已报告',
    }))
    expect(`${disruption.detail} ${disruption.title}`).not.toContain('Bearer')
    expect(`${disruption.detail} ${disruption.title}`).not.toContain('ABC123456')
    expect(replan).toEqual(expect.objectContaining({
      actionType: 'replan_applied',
      detail: '已写入 1 个行程点调整；票据、账本和交通订单仍需人工确认。',
      targetId: 'replan_1',
      targetType: 'live',
    }))
  })

  it('appends unified applied changes into existing operations history', () => {
    const legacyChange: TripOperationsAppliedChange = {
      action: 'updated_item',
      dayId: 'day_1',
      detail: '已更新时间。',
      itemId: 'item_1',
      occurredAt: 123,
      target: 'item',
      title: '西湖',
    }
    const intelligenceChange = mapTripOperationsAppliedChange(legacyChange)

    const state = appendTripIntelligenceExecutionRecord(createEmptyTripOperationsLocalState(), {
      fingerprints: ['fingerprint_1'],
      intelligenceAppliedChanges: [intelligenceChange],
      legacyAppliedChanges: [legacyChange],
      now: 999,
      status: 'success',
      title: '更新行程点',
    })

    expect(state.history[0]).toEqual(expect.objectContaining({
      appliedChanges: [legacyChange],
      createdAt: 999,
      intelligenceAppliedChanges: [intelligenceChange],
      recommendationFingerprints: ['fingerprint_1'],
    }))
  })

  it('maps ledger draft creation without leaking raw source text or order numbers', () => {
    const expense: LedgerExpense = {
      amountMinor: 12_000,
      category: 'lodging',
      createdAt: 1,
      currency: 'JPY',
      date: '2026-06-10',
      id: 'expense_1',
      itemIds: ['item_1'],
      orderNumber: 'ABC123456789',
      payerParticipantId: 'person_1',
      paymentStatus: 'paid',
      reviewStatus: 'needs_review',
      source: { fingerprint: 'fingerprint_1', kind: 'ticket', sourceId: 'ticket_1' },
      splitMode: 'equal',
      splitShares: [{ participantId: 'person_1', weight: 1 }],
      status: 'draft',
      title: '酒店订单 ABC123456789',
      tripId: 'trip_1',
      updatedAt: 2,
    }
    const change = mapLedgerExpenseDraftCreatedAppliedChange(expense, {
      amountMinor: 12_000,
      category: 'lodging',
      currency: 'JPY',
      date: '2026-06-10',
      extractedText: 'raw provider payload Authorization: Bearer SECRET123456 订单号 ABC123456789',
      itemIds: ['item_1'],
      lineItems: [],
      orderNumber: 'ABC123456789',
      orderStatus: 'active',
      paymentStatus: 'paid',
      recognitionConfidence: 0.99,
      source: { fingerprint: 'fingerprint_1', kind: 'ticket', sourceId: 'ticket_1' },
      sourceLink: {
        available: true,
        capturedAt: '2026-06-10T00:00:00.000Z',
        fingerprint: 'fingerprint_1',
        id: 'ticket:ticket_1',
        kind: 'ticket',
        role: 'payment_receipt',
        sourceId: 'ticket_1',
        title: '酒店订单',
      },
      sourceRole: 'payment_receipt',
      title: '酒店订单',
      warnings: [],
    }, 456)

    expect(change).toEqual(expect.objectContaining({
      actionType: 'ledger_expense_draft_created',
      occurredAt: 456,
      source: expect.objectContaining({ kind: 'ledger' }),
      targetId: 'expense_1',
      targetType: 'finance',
    }))
    expect(`${change.title} ${change.detail}`).not.toContain('ABC123456789')
    expect(`${change.title} ${change.detail}`).not.toContain('Bearer')
    expect(`${change.title} ${change.detail}`).not.toContain('raw provider payload')
  })

  it('derives unified changes for old history records that only contain legacy appliedChanges', () => {
    const legacyChange: TripOperationsAppliedChange = {
      action: 'retried_ticket_upload',
      detail: '已重新加入票据上传队列。',
      occurredAt: 123,
      target: 'tickets',
      ticketId: 'ticket_1',
      title: '门票',
    }

    expect(getTripIntelligenceAppliedChangesForRecord({
      appliedChanges: [legacyChange],
      createdAt: 123,
      id: 'history_1',
      recommendationFingerprints: ['ticket_upload'],
      source: 'trip_operations',
      status: 'success',
      title: '重试上传',
    })).toEqual([
      expect.objectContaining({
        actionType: 'retried_ticket_upload',
        targetId: 'ticket_1',
        targetType: 'ticket',
      }),
    ])
  })
})

function replanRecord(): TripReplanRecord {
  const item: ItineraryItem = {
    createdAt: 1,
    dayId: 'day_1',
    id: 'item_1',
    sortOrder: 1,
    ticketIds: [],
    title: '浅草寺',
    tripId: 'trip_1',
    updatedAt: 1,
  }
  return {
    baselineFingerprint: 'baseline',
    beforeSnapshot: { days: [], items: [item] },
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
    selectedDiff: {
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
    selectedOptionId: 'option_1',
    status: 'applied',
    tripId: 'trip_1',
    updatedAt: 2,
  }
}
