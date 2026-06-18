import type { TripOperationsActiveInboxPreview, TripOperationsInboxSummary } from '../../tripOperationsAgent'
import type { TravelInboxEntry, TravelInboxPreviewRecord } from '../../../types'
import type { TripIntelligenceSuggestion } from '../types'

export type TripIntelligenceInboxInput = {
  accountErrorCount?: number
  accountNeedsAssignmentCount?: number
  accountPreviewCount?: number
  activePreview?: Pick<TripOperationsActiveInboxPreview, 'checkedDiffIds' | 'id'> | TravelInboxPreviewRecord | null
  entries?: TravelInboxEntry[]
  summary?: TripOperationsInboxSummary | null
}

export function mapInboxInputToSuggestions(input?: TripIntelligenceInboxInput | null): TripIntelligenceSuggestion[] {
  if (!input) return []
  const suggestions: TripIntelligenceSuggestion[] = []
  const preview = input.activePreview
  const selectedDiffCount = getSelectedDiffCount(preview, input.summary?.selectedPreviewDiffCount)

  if (preview) {
    suggestions.push({
      action: {
        kind: 'apply_inbox_preview',
        label: '确认整理建议',
        mode: 'confirm_required',
        sourceActionKind: 'apply_inbox_preview',
        targetRoute: 'inbox',
      },
      affectedDayIds: [],
      affectedItemIds: [],
      id: `inbox:preview:${preview.id}`,
      key: `inbox:preview:${preview.id}`,
      message: selectedDiffCount > 0
        ? `${selectedDiffCount} 条材料整理建议等待确认。`
        : '已有旅行材料整理预览等待确认。',
      priority: 20,
      requiresConfirmation: true,
      requiresPreview: true,
      scope: 'inbox',
      severity: 'medium',
      source: { id: preview.id, kind: 'inbox', label: 'preview' },
      status: 'needs_confirmation',
      ticketIds: [],
      title: '收件箱整理建议待确认',
    })
  }

  const readyEntryCount = input.summary?.readyEntryCount
    ?? input.entries?.filter((entry) => entry.status === 'ready').length
    ?? 0
  if (readyEntryCount > 0 && !preview) {
    suggestions.push(makeInboxSuggestion({
      id: 'ready',
      message: `${readyEntryCount} 份材料已完成本地提取，可以整理为待确认建议。`,
      priority: 40,
      title: '旅行材料可整理',
    }))
  }

  const errorCount = input.summary?.errorEntryCount
    ?? input.entries?.filter((entry) => entry.status === 'error').length
    ?? 0
  if (errorCount > 0) {
    suggestions.push(makeInboxSuggestion({
      id: 'error',
      message: `${errorCount} 份材料未能完成提取，需要重新上传或手动整理。`,
      priority: 15,
      severity: 'high',
      title: '收件箱材料需要处理',
    }))
  }

  const needsAssignmentCount = input.accountNeedsAssignmentCount ?? input.summary?.accountNeedsAssignmentCount ?? 0
  if (needsAssignmentCount > 0) {
    suggestions.push(makeInboxSuggestion({
      id: 'account-needs-assignment',
      message: `${needsAssignmentCount} 份账号材料需要选择目标旅行。`,
      priority: 25,
      title: '账号材料待分配',
    }))
  }

  const accountPreviewCount = input.accountPreviewCount ?? input.summary?.accountPreviewCount ?? 0
  if (accountPreviewCount > 0 && !preview) {
    suggestions.push(makeInboxSuggestion({
      id: 'account-preview',
      message: `${accountPreviewCount} 份账号材料已有预览，等待确认。`,
      priority: 30,
      title: '账号材料预览待确认',
    }))
  }

  const accountErrorCount = input.accountErrorCount ?? input.summary?.accountErrorCount ?? 0
  if (accountErrorCount > 0) {
    suggestions.push(makeInboxSuggestion({
      id: 'account-error',
      message: `${accountErrorCount} 份账号材料处理失败，需要检查。`,
      priority: 15,
      severity: 'high',
      title: '账号材料处理失败',
    }))
  }

  return suggestions
}

function makeInboxSuggestion({
  id,
  message,
  priority,
  severity = 'medium',
  title,
}: {
  id: string
  message: string
  priority: number
  severity?: TripIntelligenceSuggestion['severity']
  title: string
}): TripIntelligenceSuggestion {
  return {
    action: {
      kind: 'open_inbox',
      label: '打开材料',
      mode: 'navigate',
      sourceActionKind: 'open_inbox',
      targetRoute: 'inbox',
    },
    affectedDayIds: [],
    affectedItemIds: [],
    id: `inbox:${id}`,
    key: `inbox:${id}`,
    message,
    priority,
    requiresConfirmation: false,
    requiresPreview: false,
    scope: 'inbox',
    severity,
    source: { id, kind: 'inbox' },
    status: 'pending',
    ticketIds: [],
    title,
  }
}

function getSelectedDiffCount(
  preview: TripIntelligenceInboxInput['activePreview'],
  fallback = 0,
) {
  if (!preview) return fallback
  if ('checkedDiffIds' in preview) return preview.checkedDiffIds.length
  return fallback
}
