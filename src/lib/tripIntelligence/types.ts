import type { RouteId } from '../../types'

export type TripIntelligenceSuggestionStatus =
  | 'pending'
  | 'needs_confirmation'
  | 'completed'
  | 'ignored'
  | 'later'

export type TripIntelligenceScope =
  | 'trip'
  | 'day'
  | 'item'
  | 'ticket'
  | 'inbox'
  | 'finance'
  | 'shared_trip'
  | 'document'
  | 'live'
  | 'sync'

export type TripIntelligenceSeverity = 'low' | 'medium' | 'high'

export type TripIntelligenceSourceKind =
  | 'operations'
  | 'readiness'
  | 'inbox'
  | 'live'
  | 'ledger'
  | 'shared_trip'

export type TripIntelligenceActionMode =
  | 'navigate'
  | 'preview'
  | 'confirm_required'
  | 'external_existing_flow'

export type TripIntelligenceAction = {
  kind: string
  label: string
  mode: TripIntelligenceActionMode
  sourceActionKind?: string
  targetRoute?: RouteId
}

export type TripIntelligenceSourceRef = {
  id: string
  kind: TripIntelligenceSourceKind
  label?: string
}

export type TripIntelligenceSuggestion = {
  action?: TripIntelligenceAction
  affectedDayIds: string[]
  affectedItemIds: string[]
  id: string
  key: string
  message: string
  priority: number
  requiresConfirmation: boolean
  requiresPreview: boolean
  scope: TripIntelligenceScope
  severity: TripIntelligenceSeverity
  source: TripIntelligenceSourceRef
  status: TripIntelligenceSuggestionStatus
  ticketIds: string[]
  title: string
}

export type TripIntelligenceAppliedChange = {
  actionType: string
  detail?: string
  id: string
  occurredAt: number
  source: TripIntelligenceSourceRef
  targetId?: string
  targetType: TripIntelligenceScope
  title: string
}

export type TripIntelligenceContext = {
  dayId?: string
  itemId?: string
  ticketId?: string
}

export type TripIntelligenceModel = {
  allSuggestions: TripIntelligenceSuggestion[]
  forDay: (dayId: string) => TripIntelligenceSuggestion[]
  forFinance: () => TripIntelligenceSuggestion[]
  forInbox: () => TripIntelligenceSuggestion[]
  forItem: (itemId: string) => TripIntelligenceSuggestion[]
  forTicket: (ticketId: string) => TripIntelligenceSuggestion[]
  forTripHome: () => TripIntelligenceSuggestion[]
  suggestions: TripIntelligenceSuggestion[]
  summary: {
    highRiskCount: number
    needsConfirmationCount: number
    totalCount: number
  }
}

