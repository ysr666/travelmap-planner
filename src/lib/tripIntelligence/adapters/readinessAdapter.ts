import type { TripReadinessIssue } from '../../tripReadiness'
import type { TripIntelligenceAction, TripIntelligenceScope, TripIntelligenceSuggestion } from '../types'

export function mapReadinessIssuesToSuggestions(issues: TripReadinessIssue[] = []): TripIntelligenceSuggestion[] {
  return issues.map((issue) => ({
    action: mapAction(issue),
    affectedDayIds: issue.dayId ? [issue.dayId] : [],
    affectedItemIds: issue.itemId ? [issue.itemId] : [],
    id: `readiness:${issue.id}`,
    key: `readiness:${issue.id}`,
    message: issue.message,
    priority: getPriority(issue),
    requiresConfirmation: issue.requiresPreview,
    requiresPreview: issue.requiresPreview,
    scope: inferScope(issue),
    severity: issue.severity,
    source: {
      id: issue.id,
      kind: 'readiness',
      label: issue.type,
    },
    status: issue.requiresPreview ? 'needs_confirmation' : 'pending',
    ticketIds: issue.ticketId ? [issue.ticketId] : [],
    title: issue.title,
  }))
}

function mapAction(issue: TripReadinessIssue): TripIntelligenceAction {
  return {
    kind: issue.actionKind,
    label: issue.actionLabel,
    mode: issue.requiresPreview ? 'preview' : 'navigate',
    sourceActionKind: issue.actionKind,
    targetRoute: inferTargetRoute(issue),
  }
}

function inferScope(issue: TripReadinessIssue): TripIntelligenceScope {
  if (issue.type === 'cloud_sync_pending' || issue.type === 'ticket_unsynced') return 'sync'
  if (issue.ticketId || issue.type === 'missing_ticket') return 'ticket'
  if (issue.itemId) return 'item'
  if (issue.dayId) return 'day'
  return 'trip'
}

function inferTargetRoute(issue: TripReadinessIssue): TripIntelligenceAction['targetRoute'] {
  if (issue.actionKind === 'navigate_item') return 'item'
  if (issue.actionKind === 'navigate_tickets' || issue.actionKind === 'retry_ticket_upload') return 'tickets'
  if (issue.actionKind === 'open_sync') return 'settings'
  return 'trip'
}

function getPriority(issue: TripReadinessIssue) {
  if (issue.severity === 'high') return 10
  if (issue.severity === 'medium') return 30
  return 50
}
