import type { LedgerExpense } from '../types'
import { findDuplicateExpenseIds } from './ledger'

export type LedgerReviewBucket = 'auto_archived' | 'pending' | 'duplicate' | 'missing_fields'

export type LedgerReviewIssueKind =
  | 'missing_amount'
  | 'missing_currency'
  | 'missing_payment_evidence'
  | 'duplicate_conflict'
  | 'cancelled_not_reversed'
  | 'source_missing'
  | 'line_item_mismatch'
  | 'missing_payer'
  | 'unlinked_itinerary'

export type LedgerReviewIssue = {
  blocking: boolean
  kind: LedgerReviewIssueKind
  message: string
}

export type LedgerReviewEntry = {
  buckets: LedgerReviewBucket[]
  canBulkConfirm: boolean
  canMarkReviewed: boolean
  expense: LedgerExpense
  issues: LedgerReviewIssue[]
  priority: number
}

const paymentEvidenceRoles = new Set(['payment_receipt', 'invoice', 'credit_card_notice'])

export function buildLedgerReviewEntries(expenses: LedgerExpense[]): LedgerReviewEntry[] {
  const duplicateIds = findDuplicateExpenseIds(expenses)
  return expenses
    .map((expense) => buildLedgerReviewEntry(expense, duplicateIds))
    .filter((entry) => entry.buckets.length > 0)
    .sort((first, second) => first.priority - second.priority || second.expense.updatedAt - first.expense.updatedAt)
}

export function buildLedgerReviewEntry(expense: LedgerExpense, duplicateIds = new Set<string>()): LedgerReviewEntry {
  const issues: LedgerReviewIssue[] = []
  const links = expense.sourceLinks?.length ? expense.sourceLinks : [{ ...expense.source, available: true, id: `legacy:${expense.id}`, role: 'other' as const }]
  const hasPaymentEvidence = expense.paymentStatus === 'paid' && links.some((link) => paymentEvidenceRoles.has(link.role))
  const duplicateConflict = !expense.duplicateAcknowledged && duplicateIds.has(expense.id)

  if (expense.amountMinor == null) issues.push(issue('missing_amount', '缺少金额', true))
  if (!expense.currency) issues.push(issue('missing_currency', '缺少币种', true))
  if (!hasPaymentEvidence) issues.push(issue('missing_payment_evidence', '缺少明确付款证据', true))
  if (duplicateConflict) issues.push(issue('duplicate_conflict', '可能与另一笔账单重复', true))
  if (expense.orderStatus === 'cancelled' && ['paid', 'partially_refunded'].includes(expense.paymentStatus ?? 'unknown')) {
    issues.push(issue('cancelled_not_reversed', '已取消但尚未完整退款冲正', true))
  }
  if (links.some((link) => link.available === false)) issues.push(issue('source_missing', '原始来源已不可用', true))
  if (expense.lineItems?.length && expense.lineItems.reduce((sum, item) => sum + item.amountMinor, 0) !== expense.amountMinor) {
    issues.push(issue('line_item_mismatch', '账单明细与总额不一致', true))
  }
  if (!expense.payerParticipantId) issues.push(issue('missing_payer', '付款人待补充', false))
  if (!expense.itemIds?.length) issues.push(issue('unlinked_itinerary', '尚未关联行程点', false))

  const buckets: LedgerReviewBucket[] = []
  if (expense.reviewStatus === 'auto_confirmed') buckets.push('auto_archived')
  if (expense.status === 'draft' || expense.reviewStatus === 'needs_review') buckets.push('pending')
  if (duplicateConflict) buckets.push('duplicate')
  if (issues.some((item) => ['missing_amount', 'missing_currency', 'missing_payer', 'unlinked_itinerary'].includes(item.kind))) buckets.push('missing_fields')

  const hasBlockingIssue = issues.some((item) => item.blocking)
  return {
    buckets,
    canBulkConfirm: expense.status === 'draft' && !hasBlockingIssue,
    canMarkReviewed: expense.reviewStatus === 'auto_confirmed',
    expense,
    issues,
    priority: duplicateConflict ? 0 : issues.some((item) => item.blocking) ? 1 : expense.status === 'draft' || expense.reviewStatus === 'needs_review' ? 2 : 3,
  }
}

function issue(kind: LedgerReviewIssueKind, message: string, blocking: boolean): LedgerReviewIssue {
  return { blocking, kind, message }
}
