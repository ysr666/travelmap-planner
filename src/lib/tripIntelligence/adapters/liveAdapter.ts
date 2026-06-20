import type { TripReplanRecord } from '../../../types'
import { getTripOperationsSuggestionKey } from './operationsAdapter'
import type { TripLiveModel, TripLiveRisk } from '../../tripLiveMode'
import type { TripIntelligenceSuggestion } from '../types'

export function mapLiveModelToSuggestions(
  model?: TripLiveModel | null,
  options: { replanRecord?: TripReplanRecord | null } = {},
): TripIntelligenceSuggestion[] {
  if (!model) return []
  const dayId = model.targetItem?.dayId ?? model.currentItem?.dayId ?? model.nextItem?.dayId
  return [
    ...model.risks.map((risk) => mapLiveRisk(risk, dayId, model.targetItem?.id, model.ticketIds)),
    ...mapLiveReplanRecord(options.replanRecord),
  ]
}

function mapLiveRisk(
  risk: TripLiveRisk,
  dayId: string | undefined,
  itemId: string | undefined,
  ticketIds: string[],
): TripIntelligenceSuggestion {
  const affectedDayIds = uniqueIds([
    dayId,
    risk.recommendation?.dayId,
    ...(risk.recommendation?.affectedDayIds ?? []),
  ])
  const affectedItemIds = uniqueIds([
    itemId,
    risk.recommendation?.itemId,
    ...(risk.recommendation?.affectedItemIds ?? []),
  ])
  const affectedTicketIds = uniqueIds([
    ...ticketIds,
    ...(risk.recommendation?.ticketIds ?? []),
  ])
  const key = risk.recommendation ? getTripOperationsSuggestionKey(risk.recommendation) : `live:${risk.id}`
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
    affectedDayIds,
    affectedItemIds,
    id: `live:${risk.id}`,
    key,
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
    ticketIds: affectedTicketIds,
    title: risk.title,
  }
}

function mapLiveReplanRecord(record?: TripReplanRecord | null): TripIntelligenceSuggestion[] {
  if (!record || record.status === 'undone') return []
  const dayIds = uniqueIds([
    ...record.beforeSnapshot.days.map((day) => day.id),
    ...(record.afterSnapshot?.days.map((day) => day.id) ?? []),
    ...(record.selectedDiff?.routeImpacts.map((impact) => impact.dayId) ?? []),
  ])
  const itemIds = uniqueIds([
    ...record.beforeSnapshot.items.map((item) => item.id),
    ...(record.afterSnapshot?.items.map((item) => item.id) ?? []),
    ...(record.selectedDiff?.itemChanges.map((change) => change.itemId) ?? []),
  ])
  const ticketIds = uniqueIds([
    ...(record.selectedDiff?.ticketImpacts.map((impact) => impact.ticketId) ?? []),
  ])
  const status = record.status === 'conflict'
    ? 'needs_confirmation'
    : record.status === 'applied'
      ? 'needs_confirmation'
      : 'needs_confirmation'
  const severity = record.status === 'conflict' ? 'high' : record.status === 'preview' ? 'medium' : 'low'
  return [{
    action: {
      kind: record.status === 'applied' ? 'replan_undo' : 'replan_apply_option',
      label: record.status === 'applied' ? '查看撤销' : '查看方案',
      mode: 'confirm_required',
      sourceActionKind: record.status === 'applied' ? 'replan_undo' : 'replan_apply_option',
      targetRoute: 'day',
    },
    affectedDayIds: dayIds,
    affectedItemIds: itemIds,
    id: `live:replan:${record.id}`,
    key: `live:replan:${record.id}`,
    message: getReplanMessage(record),
    priority: record.status === 'conflict' ? 3 : record.status === 'preview' ? 12 : 55,
    requiresConfirmation: true,
    requiresPreview: record.status !== 'applied',
    scope: 'live',
    severity,
    source: { id: record.id, kind: 'live', label: 'replan_record' },
    status,
    ticketIds,
    title: getReplanTitle(record),
  }]
}

function getReplanTitle(record: TripReplanRecord) {
  if (record.status === 'conflict') return '重排方案需要重新确认'
  if (record.status === 'applied') return '已应用重排，可整次撤销'
  return '重排方案待确认'
}

function getReplanMessage(record: TripReplanRecord) {
  if (record.status === 'conflict') return '当前行程已变化，请重新生成或人工核对后再处理。'
  if (record.status === 'applied') return '这次重排已写入；需要时可在 Live Mode 中整次撤销。'
  return `已生成 ${record.options.length} 个方案，选择一个方案后再确认写入。`
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

function uniqueIds(ids: Array<string | undefined>) {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))]
}
