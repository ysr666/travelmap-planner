import { describe, expect, it } from 'vitest'
import { mapSharedTripMutationsToSuggestions } from './sharedTripAdapter'
import type { SharedTripMutation } from '../../../types'

describe('mapSharedTripMutationsToSuggestions', () => {
  it('maps shared mutation statuses and keeps rejected/conflict active for owner review', () => {
    const suggestions = mapSharedTripMutationsToSuggestions([
      mutation('pending-1', 'pending'),
      mutation('conflict-1', 'conflict'),
      mutation('rejected-1', 'rejected'),
      mutation('applied-1', 'applied'),
    ])

    expect(Object.fromEntries(suggestions.map((suggestion) => [suggestion.id, suggestion.status]))).toMatchObject({
      'shared-trip:applied-1': 'completed',
      'shared-trip:conflict-1': 'needs_confirmation',
      'shared-trip:pending-1': 'needs_confirmation',
      'shared-trip:rejected-1': 'needs_confirmation',
    })
    expect(suggestions.find((suggestion) => suggestion.id === 'shared-trip:conflict-1')).toEqual(expect.objectContaining({
      requiresConfirmation: true,
      severity: 'high',
    }))
  })

  it('maps replan undo as a manual live suggestion and redacts payload/rejected reason', () => {
    const suggestions = mapSharedTripMutationsToSuggestions([
      mutation('undo-1', 'pending', 'request_replan_undo', {
        payload: { note: 'PNR ABC123 order ORDER-7788 raw replan details' },
        rejectedReason: 'Stack trace includes SECRET-STACK-7788',
      }),
      mutation('rejected-1', 'rejected', 'update_item', {
        displayName: 'Alice PNR ABC123',
        payload: { patch: { title: 'Private dinner ORDER-7788' } },
        rejectedReason: 'Rejected because secret provider payload leaked',
      }),
    ])

    expect(suggestions[0]).toEqual(expect.objectContaining({
      action: expect.objectContaining({ kind: 'open_adaptive_replan' }),
      scope: 'live',
      status: 'needs_confirmation',
      title: '同行请求撤销调整',
    }))

    const text = suggestions.map((suggestion) => [
      suggestion.action?.label,
      suggestion.message,
      suggestion.source.label,
      suggestion.title,
    ].join(' ')).join('\n')
    for (const sensitive of [
      'Alice',
      'PNR ABC123',
      'ORDER-7788',
      'Private dinner',
      'SECRET-STACK-7788',
      'provider payload',
      'raw replan details',
    ]) {
      expect(text).not.toContain(sensitive)
    }
  })
})

function mutation(
  id: string,
  status: SharedTripMutation['status'],
  mutationType: SharedTripMutation['mutationType'] = 'update_item',
  patch: Partial<SharedTripMutation> = {},
): SharedTripMutation {
  return {
    createdAt: '2026-06-10T00:00:00Z',
    displayName: '同行人',
    id,
    mutationType,
    payload: {},
    sharedTripId: 'shared-1',
    status,
    updatedAt: '2026-06-10T00:00:00Z',
    userId: 'user-1',
    ...patch,
  }
}
