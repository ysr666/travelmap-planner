import type { TripOperationsHiddenRecommendation, TripOperationsModel, TripOperationsRecommendation } from '../../tripOperationsAgent'
import type { TripOperationsDispositionStatus } from '../../tripOperationsState'
import type {
  TripIntelligenceAction,
  TripIntelligenceScope,
  TripIntelligenceSuggestion,
  TripIntelligenceSuggestionStatus,
} from '../types'

export function mapTripOperationsModelToSuggestions(model?: TripOperationsModel | null): TripIntelligenceSuggestion[] {
  if (!model) return []
  return [
    ...model.activeRecommendations.map((recommendation) =>
      mapTripOperationsRecommendation(recommendation),
    ),
    ...model.hiddenRecommendations.map(mapHiddenRecommendation),
  ]
}

export function mapTripOperationsRecommendation(
  recommendation: TripOperationsRecommendation,
  status: TripIntelligenceSuggestionStatus = getActiveRecommendationStatus(recommendation),
): TripIntelligenceSuggestion {
  return {
    action: mapAction(recommendation),
    affectedDayIds: uniqueIds([...recommendation.affectedDayIds, recommendation.dayId]),
    affectedItemIds: uniqueIds([...recommendation.affectedItemIds, recommendation.itemId]),
    id: `operations:${recommendation.id}`,
    key: getTripOperationsSuggestionKey(recommendation),
    message: recommendation.message,
    priority: recommendation.priority,
    requiresConfirmation: recommendation.requiresConfirm,
    requiresPreview: recommendation.requiresPreview,
    scope: inferScope(recommendation),
    severity: recommendation.severity,
    source: {
      id: recommendation.id,
      kind: 'operations',
      label: recommendation.type,
    },
    status,
    ticketIds: recommendation.ticketIds,
    title: recommendation.title,
  }
}

function uniqueIds(ids: Array<string | undefined>) {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))]
}

export function getTripOperationsSuggestionKey(recommendation: TripOperationsRecommendation) {
  return recommendation.readinessIssueIds[0]
    ? `readiness:${recommendation.readinessIssueIds[0]}`
    : `operations:${recommendation.scopeKey}`
}

function mapHiddenRecommendation({ disposition, recommendation }: TripOperationsHiddenRecommendation) {
  return mapTripOperationsRecommendation(recommendation, mapDispositionStatus(disposition.status))
}

function mapDispositionStatus(status: TripOperationsDispositionStatus): TripIntelligenceSuggestionStatus {
  if (status === 'completed') return 'completed'
  if (status === 'ignored') return 'ignored'
  return 'later'
}

function getActiveRecommendationStatus(recommendation: TripOperationsRecommendation): TripIntelligenceSuggestionStatus {
  return recommendation.requiresConfirm || recommendation.requiresPreview
    ? 'needs_confirmation'
    : 'pending'
}

function inferScope(recommendation: TripOperationsRecommendation): TripIntelligenceScope {
  if (recommendation.type === 'inbox_needs_attention') return 'inbox'
  if (recommendation.type === 'cloud_sync_pending' || recommendation.type === 'synced_ticket_cache') return 'sync'
  if (recommendation.type === 'adaptive_replan' || recommendation.type === 'replan_undo_request') return 'live'
  if (recommendation.ticketIds.length > 0 || recommendation.actionKind === 'open_tickets') return 'ticket'
  if (recommendation.itemId || recommendation.affectedItemIds.length > 0) return 'item'
  if (recommendation.dayId || recommendation.affectedDayIds.length > 0) return 'day'
  return 'trip'
}

function mapAction(recommendation: TripOperationsRecommendation): TripIntelligenceAction {
  return {
    kind: recommendation.actionKind,
    label: recommendation.actionLabel,
    mode: inferActionMode(recommendation),
    sourceActionKind: recommendation.actionKind,
    targetRoute: inferTargetRoute(recommendation),
  }
}

function inferActionMode(recommendation: TripOperationsRecommendation): TripIntelligenceAction['mode'] {
  if (recommendation.requiresConfirm) return 'confirm_required'
  if (recommendation.requiresPreview) return 'preview'
  if (recommendation.executionMode === 'manual_navigation') return 'navigate'
  return 'external_existing_flow'
}

function inferTargetRoute(recommendation: TripOperationsRecommendation): TripIntelligenceAction['targetRoute'] {
  if (recommendation.actionKind === 'open_day' || recommendation.actionKind === 'review_tomorrow') return 'day'
  if (recommendation.actionKind === 'open_item') return 'item'
  if (recommendation.actionKind === 'open_tickets') return 'tickets'
  if (recommendation.actionKind === 'open_inbox' || recommendation.actionKind === 'apply_inbox_preview') return 'inbox'
  if (recommendation.actionKind === 'open_sync') return 'settings'
  return 'trip'
}
