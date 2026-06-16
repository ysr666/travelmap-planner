import { useMemo, useState } from 'react'
import { CheckCheck, FileWarning, Pencil, ReceiptText } from 'lucide-react'
import { bulkReviewLedgerExpenses } from '../../db'
import { formatLedgerMoney, normalizeCurrencyCode } from '../../lib/ledger'
import { getLedgerExchangeRateSnapshot } from '../../lib/ledgerExchangeRates'
import {
  buildLedgerReviewEntries,
  type LedgerReviewBucket,
  type LedgerReviewEntry,
} from '../../lib/ledgerReview'
import { navigateTo } from '../../lib/routes'
import type { LedgerExpense, LedgerSettings, Trip } from '../../types'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { EmptyState } from '../ui/EmptyState'

const bucketLabels: Record<LedgerReviewBucket, string> = {
  auto_archived: '已自动归档',
  duplicate: '疑似重复',
  missing_fields: '缺字段',
  pending: '待确认',
}

const bucketOrder: LedgerReviewBucket[] = ['auto_archived', 'pending', 'duplicate', 'missing_fields']

export function LedgerReviewQueue({
  expenses,
  onChanged,
  onEdit,
  settings,
  trip,
}: {
  expenses: LedgerExpense[]
  onChanged: () => Promise<void>
  onEdit: (expense: LedgerExpense) => void
  settings: LedgerSettings
  trip: Trip
}) {
  const entries = useMemo(() => buildLedgerReviewEntries(expenses), [expenses])
  const [filters, setFilters] = useState<Set<LedgerReviewBucket>>(() => new Set(bucketOrder))
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const visible = entries.filter((entry) => entry.buckets.some((bucket) => filters.has(bucket)))
  const selected = entries.filter((entry) => selectedIds.has(entry.expense.id))
  const confirmable = selected.filter((entry) => entry.canBulkConfirm)
  const reviewable = selected.filter((entry) => entry.canMarkReviewed)

  function toggleFilter(bucket: LedgerReviewBucket) {
    setFilters((current) => {
      const next = new Set(current)
      if (next.has(bucket)) next.delete(bucket)
      else next.add(bucket)
      return next
    })
  }

  function toggleSelected(entry: LedgerReviewEntry) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(entry.expense.id)) next.delete(entry.expense.id)
      else next.add(entry.expense.id)
      return next
    })
  }

  async function confirmSelected() {
    setBusy(true); setError(''); setMessage('')
    try {
      const records = await Promise.all(confirmable.map(async ({ expense }) => {
        let exchangeRate = expense.exchangeRate
        const currency = normalizeCurrencyCode(expense.currency)
        if (currency && (currency !== normalizeCurrencyCode(settings.tripCurrency) || currency !== normalizeCurrencyCode(settings.homeCurrency))) {
          try {
            exchangeRate = await getLedgerExchangeRateSnapshot({
              baseCurrency: currency,
              date: expense.date,
              homeCurrency: settings.homeCurrency,
              tripCurrency: settings.tripCurrency,
            })
          } catch {
            exchangeRate = undefined
          }
        }
        return { exchangeRate, expectedUpdatedAt: expense.updatedAt, id: expense.id }
      }))
      await bulkReviewLedgerExpenses({ action: 'confirm', records, tripId: trip.id })
      setSelectedIds(new Set())
      setMessage(`已确认 ${records.length} 笔账单；缺汇率项目仍保留待换算提醒。`)
      await onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '批量确认失败。')
    } finally {
      setBusy(false)
    }
  }

  async function markReviewed() {
    setBusy(true); setError(''); setMessage('')
    try {
      const records = reviewable.map(({ expense }) => ({ expectedUpdatedAt: expense.updatedAt, id: expense.id }))
      await bulkReviewLedgerExpenses({ action: 'mark_reviewed', records, tripId: trip.id })
      setSelectedIds(new Set())
      setMessage(`已将 ${records.length} 笔自动归档标记为已阅。`)
      await onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '标记已阅失败。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-4" data-testid="ledger-review-queue">
      <div className="flex flex-wrap gap-2" aria-label="审核筛选">
        {bucketOrder.map((bucket) => (
          <button
            aria-pressed={filters.has(bucket)}
            className={`min-h-10 rounded-lg border px-3 text-xs font-semibold ${filters.has(bucket) ? 'border-primary bg-primary-container text-on-primary-container' : 'border-outline-variant/40 text-on-surface-variant'}`}
            key={bucket}
            onClick={() => toggleFilter(bucket)}
            type="button"
          >
            {bucketLabels[bucket]} {entries.filter((entry) => entry.buckets.includes(bucket)).length}
          </button>
        ))}
      </div>

      {selected.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 rounded-lg bg-surface-container-high p-2">
          <Button disabled={confirmable.length === 0} loading={busy} onClick={() => void confirmSelected()}>
            确认可处理项（{confirmable.length}）
          </Button>
          <Button disabled={reviewable.length === 0} icon={<CheckCheck className="size-4" />} loading={busy} onClick={() => void markReviewed()} variant="secondary">
            标记已阅（{reviewable.length}）
          </Button>
        </div>
      ) : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {visible.length === 0 ? (
        <EmptyState body="自动归档已阅、待确认账单和资料问题都会集中在这里。" icon={<CheckCheck className="size-6" />} title="当前没有待审核项目" />
      ) : visible.map((entry) => (
        <Card className="space-y-3" data-testid="ledger-review-row" key={entry.expense.id} variant="grouped">
          <div className="flex items-start gap-3">
            <input
              aria-label={`选择 ${entry.expense.title}`}
              checked={selectedIds.has(entry.expense.id)}
              className="mt-1 size-4"
              disabled={!entry.canBulkConfirm && !entry.canMarkReviewed}
              onChange={() => toggleSelected(entry)}
              type="checkbox"
            />
            <button className="min-w-0 flex-1 text-left" onClick={() => navigateTo('ledger/expense', { expenseId: entry.expense.id, tripId: trip.id })} type="button">
              <span className="block truncate font-semibold">{entry.expense.title}</span>
              <span className="mt-1 block text-xs tm-muted">{entry.expense.date} · {formatLedgerMoney(entry.expense.amountMinor, entry.expense.currency ?? settings.tripCurrency)}</span>
            </button>
            <button aria-label={`编辑 ${entry.expense.title}`} className="flex size-10 shrink-0 items-center justify-center rounded-lg text-primary" onClick={() => onEdit(entry.expense)} type="button"><Pencil className="size-4" /></button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {entry.buckets.map((bucket) => <span className="rounded-md bg-surface-container-high px-2 py-1 text-[11px] font-semibold" key={bucket}>{bucketLabels[bucket]}</span>)}
          </div>
          {entry.issues.length > 0 ? <div className="space-y-1">{entry.issues.map((issue) => <p className={`flex items-center gap-2 text-xs ${issue.blocking ? 'text-red-700' : 'text-amber-700'}`} key={issue.kind}><FileWarning className="size-3.5 shrink-0" />{issue.message}</p>)}</div> : <p className="flex items-center gap-2 text-xs text-emerald-700"><ReceiptText className="size-3.5" />自动识别字段完整，等待确认已阅。</p>}
        </Card>
      ))}
    </section>
  )
}
