import type { LedgerReviewEntry } from '../../ledgerReview'
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
