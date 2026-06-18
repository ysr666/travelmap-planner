import type { TripLiveModel, TripLiveRisk } from '../../tripLiveMode'
import type { TripIntelligenceSuggestion } from '../types'

export function mapLiveModelToSuggestions(model?: TripLiveModel | null): TripIntelligenceSuggestion[] {
  if (!model) return []
  const dayId = model.targetItem?.dayId ?? model.currentItem?.dayId ?? model.nextItem?.dayId
  return model.risks.map((risk) => mapLiveRisk(risk, dayId, model.targetItem?.id, model.ticketIds))
}

function mapLiveRisk(
  risk: TripLiveRisk,
  dayId: string | undefined,
  itemId: string | undefined,
  ticketIds: string[],
): TripIntelligenceSuggestion {
  return {
    action: risk.recommendation ? {
      kind: risk.recommendation.actionKind,
      label: risk.recommendation.actionLabel,
      mode: risk.recommendation.requiresConfirm ? 'confirm_required' : risk.recommendation.requiresPreview ? 'preview' : 'navigate',
      sourceActionKind: risk.recommendation.actionKind,
      targetRoute: risk.kind === 'ticket' ? 'tickets' : 'day',
    } : {
      kind: `review_${risk.kind}`,
      label: '查看当天',
      mode: 'navigate',
      targetRoute: 'day',
    },
    affectedDayIds: dayId ? [dayId] : [],
    affectedItemIds: itemId ? [itemId] : [],
    id: `live:${risk.id}`,
    key: `live:${risk.id}`,
    message: risk.detail,
    priority: getPriority(risk),
    requiresConfirmation: risk.recommendation?.requiresConfirm ?? false,
    requiresPreview: risk.recommendation?.requiresPreview ?? false,
    scope: 'live',
    severity: mapSeverity(risk),
    source: { id: risk.id, kind: 'live', label: risk.kind },
    status: risk.recommendation?.requiresConfirm || risk.recommendation?.requiresPreview
      ? 'needs_confirmation'
      : 'pending',
    ticketIds,
    title: risk.title,
  }
}

function mapSeverity(risk: TripLiveRisk): TripIntelligenceSuggestion['severity'] {
  if (risk.severity === 'critical') return 'high'
  if (risk.severity === 'warning') return 'medium'
  return 'low'
}

function getPriority(risk: TripLiveRisk) {
  if (risk.severity === 'critical') return 5
  if (risk.severity === 'warning') return 25
  return 60
}
