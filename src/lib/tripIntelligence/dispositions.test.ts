import { describe, expect, it } from 'vitest'
import { getTripIntelligenceDispositionPolicy } from './dispositions'
import type { TripIntelligenceSuggestion } from './types'

describe('trip intelligence disposition policy', () => {
  it('allows ordinary non-operations suggestions to be ignored or delayed', () => {
    expect(getTripIntelligenceDispositionPolicy(suggestion('medium'))).toEqual({
      canIgnore: true,
      canLater: true,
    })
  })

  it('allows high-severity suggestions to be delayed but not ignored', () => {
    expect(getTripIntelligenceDispositionPolicy(suggestion('high'))).toEqual({
      canIgnore: false,
      canLater: true,
    })
  })

  it('leaves operations dispositions to the legacy timezone-aware flow', () => {
    expect(getTripIntelligenceDispositionPolicy(suggestion('medium', 'operations'))).toEqual({
      canIgnore: false,
      canLater: false,
    })
  })
})

function suggestion(
  severity: TripIntelligenceSuggestion['severity'],
  sourceKind: TripIntelligenceSuggestion['source']['kind'] = 'inbox',
): TripIntelligenceSuggestion {
  return {
    affectedDayIds: [],
    affectedItemIds: [],
    id: 'suggestion-1',
    key: 'suggestion-1',
    message: '需要处理。',
    priority: 1,
    requiresConfirmation: false,
    requiresPreview: false,
    scope: 'inbox',
    severity,
    source: { id: 'source-1', kind: sourceKind },
    status: 'pending',
    ticketIds: [],
    title: '待处理建议',
  }
}
