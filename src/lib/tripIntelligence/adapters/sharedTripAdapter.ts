import type { SharedTripMutation } from '../../../types'
import type { TripIntelligenceSuggestion, TripIntelligenceSuggestionStatus } from '../types'

export function mapSharedTripMutationsToSuggestions(mutations: SharedTripMutation[] = []): TripIntelligenceSuggestion[] {
  return mutations.map((mutation) => ({
    action: {
      kind: mutation.mutationType === 'request_replan_undo' ? 'open_adaptive_replan' : 'sync_shared_trip',
      label: mutation.status === 'pending' ? '处理同行更改' : '查看同行记录',
      mode: mutation.status === 'pending' || mutation.status === 'conflict' ? 'confirm_required' : 'navigate',
      sourceActionKind: mutation.mutationType,
      targetRoute: 'shared-trip',
    },
    affectedDayIds: [],
    affectedItemIds: [],
    id: `shared-trip:${mutation.id}`,
    key: `shared-trip:${mutation.id}`,
    message: buildMessage(mutation),
    priority: mutation.status === 'conflict' ? 5 : mutation.status === 'pending' ? 20 : 70,
    requiresConfirmation: mutation.status === 'pending' || mutation.status === 'conflict',
    requiresPreview: false,
    scope: mutation.mutationType === 'request_replan_undo' ? 'live' : 'shared_trip',
    severity: mutation.status === 'conflict' ? 'high' : mutation.status === 'pending' ? 'medium' : 'low',
    source: { id: mutation.id, kind: 'shared_trip', label: mutation.mutationType },
    status: mapStatus(mutation.status),
    ticketIds: [],
    title: buildTitle(mutation),
  }))
}

function mapStatus(status: SharedTripMutation['status']): TripIntelligenceSuggestionStatus {
  if (status === 'pending' || status === 'conflict') return 'needs_confirmation'
  if (status === 'applied') return 'completed'
  return 'ignored'
}

function buildTitle(mutation: SharedTripMutation) {
  if (mutation.status === 'conflict') return '同行更改存在冲突'
  if (mutation.status === 'applied') return '同行更改已应用'
  if (mutation.status === 'rejected') return '同行更改未应用'
  if (mutation.mutationType === 'request_replan_undo') return '同行请求撤销调整'
  return '同行更改待确认'
}

function buildMessage(mutation: SharedTripMutation) {
  const actor = mutation.displayName || '同行人'
  if (mutation.status === 'rejected') return mutation.rejectedReason || `${actor} 的更改未应用。`
  if (mutation.status === 'applied') return `${actor} 的更改已应用到主人行程。`
  if (mutation.status === 'conflict') return `${actor} 的更改需要人工处理冲突。`
  return `${actor} 提交了 ${mutation.mutationType}，等待确认。`
}
