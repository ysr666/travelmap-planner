import type { TripIntelligenceSuggestion } from './types'

export const TRIP_INTELLIGENCE_LATER_MS = 24 * 60 * 60 * 1000

export type TripIntelligenceDispositionPolicy = {
  canIgnore: boolean
  canLater: boolean
}

export function getTripIntelligenceDispositionPolicy(
  suggestion: TripIntelligenceSuggestion,
): TripIntelligenceDispositionPolicy {
  const isActive = suggestion.status === 'pending' || suggestion.status === 'needs_confirmation'
  if (!isActive || suggestion.source.kind === 'operations') {
    return { canIgnore: false, canLater: false }
  }
  return {
    canIgnore: suggestion.severity !== 'high',
    canLater: true,
  }
}
