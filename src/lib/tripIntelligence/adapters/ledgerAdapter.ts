import type { LedgerReviewEntry } from '../../ledgerReview'
import type { LedgerExpenseDraftCandidate } from '../../ledgerExtraction'
import type { TripIntelligenceSuggestion } from '../types'

export function mapLedgerReviewEntriesToSuggestions(entries: LedgerReviewEntry[] = []): TripIntelligenceSuggestion[] {
  return entries.map((entry) => {
    const blockingCount = entry.issues.filter((issue) => issue.blocking).length
    return {
      action: {
        kind: 'open_ledger_review',
        label: entry.canBulkConfirm ? '确认费用' : '查看费用',
        mode: entry.canBulkConfirm ? 'confirm_required' : 'navigate',
        sourceActionKind: 'ledger_review',
        targetRoute: 'ledger',
      },
      affectedDayIds: [],
      affectedItemIds: entry.expense.itemIds ?? [],
      id: `ledger:${entry.expense.id}`,
      key: `ledger:${entry.expense.id}`,
      message: blockingCount > 0
        ? `${entry.expense.title} 有 ${blockingCount} 个阻塞问题需要处理。`
        : `${entry.expense.title} 等待费用确认或归档。`,
      priority: entry.priority,
      requiresConfirmation: entry.canBulkConfirm,
      requiresPreview: false,
      scope: 'finance',
      severity: blockingCount > 0 || entry.buckets.includes('duplicate') ? 'high' : 'medium',
      source: { id: entry.expense.id, kind: 'ledger', label: entry.buckets.join(',') },
      status: entry.canBulkConfirm ? 'needs_confirmation' : 'pending',
      ticketIds: entry.expense.sourceLinks
        ?.filter((link) => link.kind === 'ticket' && link.sourceId)
        .map((link) => link.sourceId!)
        ?? [],
      title: entry.buckets.includes('duplicate') ? '费用可能重复' : '费用待确认',
    } satisfies TripIntelligenceSuggestion
  })
}

export function mapLedgerDraftCandidatesToSuggestions(candidates: LedgerExpenseDraftCandidate[] = []): TripIntelligenceSuggestion[] {
  return candidates.map((candidate, index) => {
    const key = getLedgerDraftCandidateSuggestionKey(candidate, index)
    const sourceLabel = getCandidateSourceLabel(candidate)
    return {
      action: {
        kind: 'ledger_create_expense_draft_from_candidate',
        label: '生成费用草稿',
        mode: 'confirm_required',
        sourceActionKind: 'ledger_draft_candidate',
        targetRoute: 'ledger',
      },
      affectedDayIds: [],
      affectedItemIds: candidate.itemIds,
      id: key,
      key,
      message: `${sourceLabel}「${candidate.title}」可生成待确认费用草稿，确认后再进入账本审核。`,
      priority: candidate.source.kind === 'ticket' ? 18 : 24,
      requiresConfirmation: true,
      requiresPreview: false,
      scope: 'finance',
      severity: candidate.amountMinor == null || candidate.warnings.length > 0 ? 'medium' : 'low',
      source: { id: key, kind: 'ledger', label: 'draft_candidate' },
      status: 'needs_confirmation',
      ticketIds: candidate.source.kind === 'ticket' && candidate.source.sourceId ? [candidate.source.sourceId] : [],
      title: '可生成费用草稿',
    } satisfies TripIntelligenceSuggestion
  })
}

export function getLedgerDraftCandidateSuggestionKey(candidate: LedgerExpenseDraftCandidate, fallbackIndex = 0) {
  const sourceId = candidate.source.sourceId ?? candidate.source.fingerprint ?? String(fallbackIndex)
  return `ledger:candidate:${candidate.source.kind}:${sourceId}`
}

function getCandidateSourceLabel(candidate: LedgerExpenseDraftCandidate) {
  if (candidate.source.kind === 'ticket') return '票据'
  if (candidate.source.kind === 'inbox') return '旅行材料'
  if (candidate.source.kind === 'transport_booking') return '交通订单'
  if (candidate.source.kind === 'itinerary_note') return '行程备注'
  return '来源'
}
