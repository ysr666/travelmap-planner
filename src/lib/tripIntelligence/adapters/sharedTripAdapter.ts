import type { SharedTripMutation } from '../../../types'
import type { TripIntelligenceSuggestion, TripIntelligenceSuggestionStatus } from '../types'

export function mapSharedTripMutationsToSuggestions(mutations: SharedTripMutation[] = []): TripIntelligenceSuggestion[] {
  return mutations.map((mutation) => ({
    action: {
      kind: mutation.mutationType === 'request_replan_undo' ? 'open_adaptive_replan' : 'sync_shared_trip',
      label: actionLabel(mutation),
      mode: mutation.status === 'pending' || mutation.status === 'conflict' || mutation.status === 'rejected' ? 'confirm_required' : 'navigate',
      sourceActionKind: mutation.mutationType,
      targetRoute: 'shared-trip',
    },
    affectedDayIds: [],
    affectedItemIds: [],
    id: `shared-trip:${mutation.id}`,
    key: `shared-trip:${mutation.id}`,
    message: buildMessage(mutation),
    priority: mutation.status === 'conflict' ? 5 : mutation.status === 'rejected' ? 18 : mutation.status === 'pending' ? 20 : 70,
    requiresConfirmation: mutation.status === 'pending' || mutation.status === 'conflict' || mutation.status === 'rejected',
    requiresPreview: false,
    scope: mutation.mutationType === 'request_replan_undo' ? 'live' : 'shared_trip',
    severity: mutation.status === 'conflict' ? 'high' : mutation.status === 'pending' || mutation.status === 'rejected' ? 'medium' : 'low',
    source: { id: mutation.id, kind: 'shared_trip', label: mutationTypeLabel(mutation.mutationType) },
    status: mapStatus(mutation.status),
    ticketIds: [],
    title: buildTitle(mutation),
  }))
}

function mapStatus(status: SharedTripMutation['status']): TripIntelligenceSuggestionStatus {
  if (status === 'pending' || status === 'conflict' || status === 'rejected') return 'needs_confirmation'
  if (status === 'applied') return 'completed'
  return 'needs_confirmation'
}

function buildTitle(mutation: SharedTripMutation) {
  if (mutation.status === 'conflict') return '同行更改存在冲突'
  if (mutation.status === 'applied') return '同行更改已应用'
  if (mutation.status === 'rejected') return '同行更改未应用需查看'
  if (mutation.mutationType === 'request_replan_undo') return '同行请求撤销调整'
  return mutationTypeTitle(mutation.mutationType)
}

function buildMessage(mutation: SharedTripMutation) {
  const typeLabel = mutationTypeLabel(mutation.mutationType)
  if (mutation.status === 'rejected') return `有一条${typeLabel}未应用，需要查看原因并决定后续处理。`
  if (mutation.status === 'applied') return `一条${typeLabel}已应用到主人行程。`
  if (mutation.status === 'conflict') return `有一条${typeLabel}存在冲突，需要人工处理。`
  if (mutation.mutationType === 'request_replan_undo') return '同行请求撤销一次重排结果，请在现有重排流程中确认。'
  return `有一条${typeLabel}等待主人确认。`
}

function actionLabel(mutation: SharedTripMutation) {
  if (mutation.mutationType === 'request_replan_undo') return '查看重排'
  if (mutation.status === 'applied') return '查看记录'
  return '处理同行更改'
}

function mutationTypeTitle(type: SharedTripMutation['mutationType']) {
  if (type === 'report_disruption') return '同行报告突发情况'
  if (type === 'request_replan_undo') return '同行请求撤销调整'
  return '同行更改待确认'
}

function mutationTypeLabel(type: SharedTripMutation['mutationType']) {
  if (type === 'create_item') return '同行新增行程'
  if (type === 'delete_item') return '同行删除行程'
  if (type === 'reorder_day_items') return '同行调整顺序'
  if (type === 'report_disruption') return '同行突发报告'
  if (type === 'request_replan_undo') return '同行撤销重排请求'
  if (type === 'update_item_execution_state') return '同行现场状态更新'
  return '同行行程修改'
}
