import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CalendarClock, ExternalLink, FileText, Link2, ReceiptText, Route, Undo2 } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import {
  getItineraryItem,
  getLedgerExpense,
  getLedgerSettingsByTrip,
  getTicketMeta,
  getTrip,
  listItemsByTrip,
} from '../db'
import { getTravelInboxEntry } from '../lib/ai/travelInbox'
import { formatLedgerMoney, ledgerCategoryLabels } from '../lib/ledger'
import { getLedgerSourceLinks } from '../lib/ledgerArchive'
import { buildLedgerSourceNavigationTarget } from '../lib/ledgerSourceNavigation'
import { getRouteParams, navigateTo } from '../lib/routes'
import { listTransportBookings } from '../lib/travelDocumentCenter'
import type { ItineraryItem, LedgerExpense, LedgerExpenseSourceLink, LedgerSettings, Trip } from '../types'

type ResolvedSource = LedgerExpenseSourceLink & { exists: boolean }

const sourceRoleOrder: LedgerExpenseSourceLink['role'][] = [
  'order_confirmation',
  'payment_receipt',
  'invoice',
  'credit_card_notice',
  'cancellation_notice',
  'refund_notice',
  'other',
]

const sourceRoleLabels: Record<LedgerExpenseSourceLink['role'], string> = {
  cancellation_notice: '取消通知',
  credit_card_notice: '信用卡通知',
  invoice: '发票',
  order_confirmation: '订单确认',
  other: '其他来源',
  payment_receipt: '付款票据',
  refund_notice: '退款通知',
}

export function LedgerExpenseDetailPage() {
  const params = getRouteParams()
  const tripId = params.get('tripId') ?? ''
  const expenseId = params.get('expenseId') ?? ''
  const [trip, setTrip] = useState<Trip | null>(null)
  const [expense, setExpense] = useState<LedgerExpense | null>(null)
  const [settings, setSettings] = useState<LedgerSettings | null>(null)
  const [items, setItems] = useState<ItineraryItem[]>([])
  const [originalExpense, setOriginalExpense] = useState<LedgerExpense | null>(null)
  const [sources, setSources] = useState<ResolvedSource[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!tripId || !expenseId) return
      const [nextTrip, nextExpense, nextSettings, nextItems] = await Promise.all([
        getTrip(tripId),
        getLedgerExpense(expenseId),
        getLedgerSettingsByTrip(tripId),
        listItemsByTrip(tripId),
      ])
      if (!nextExpense || nextExpense.tripId !== tripId) {
        if (!cancelled) setLoading(false)
        return
      }
      const [nextSources, nextOriginal] = await Promise.all([
        resolveSources(getLedgerSourceLinks(nextExpense), tripId),
        nextExpense.originalExpenseId ? getLedgerExpense(nextExpense.originalExpenseId) : Promise.resolve(undefined),
      ])
      if (cancelled) return
      setTrip(nextTrip ?? null)
      setExpense(nextExpense)
      setSettings(nextSettings ?? null)
      setItems(nextItems)
      setOriginalExpense(nextOriginal ?? null)
      setSources(nextSources)
      setLoading(false)
    }
    void load().catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [expenseId, tripId])

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])

  if (loading) return <Card><p className="text-sm tm-muted">正在读取账单来源...</p></Card>
  if (!trip || !expense) return <EmptyState body="账单可能已删除，或不属于当前旅行。" icon={<ReceiptText className="size-6" />} title="无法打开账单" />

  return (
    <div className="space-y-5 pb-6" data-testid="ledger-expense-detail">
      <header className="flex items-start gap-3">
        <button aria-label="返回旅行账本" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-container text-on-surface-variant tm-focus" onClick={() => navigateTo('ledger', { tripId })} type="button">
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-primary">账单与来源</p>
          <h2 className="mt-1 truncate text-xl font-bold text-on-surface">{expense.title}</h2>
          <p className="mt-1 text-sm tm-muted">{trip.title} · {expense.date}</p>
        </div>
      </header>

      <Card className="space-y-4" variant="grouped">
        <div className="flex items-start justify-between gap-3">
          <div><p className="text-xs tm-muted">账单金额</p><p className="mt-1 text-2xl font-bold">{formatLedgerMoney(expense.amountMinor, expense.currency ?? settings?.tripCurrency ?? 'CNY')}</p></div>
          <span className="rounded-md bg-surface-container-high px-2 py-1 text-xs font-semibold">{expense.status === 'confirmed' ? '已确认' : expense.status === 'void' ? '已作废' : '待确认'}</span>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Detail label="类别" value={ledgerCategoryLabels[expense.category]} />
          <Detail label="商户" value={expense.merchant} />
          <Detail label="城市" value={expense.city} />
          <Detail label="付款状态" value={paymentLabel(expense.paymentStatus)} />
        </div>
        {expense.orderNumber ? <div className="rounded-lg bg-surface-container-high p-3"><p className="text-xs tm-muted">完整订单号</p><p className="mt-1 break-all font-mono text-sm text-on-surface">{expense.orderNumber}</p></div> : null}
      </Card>

      <Card className="space-y-3" variant="grouped">
        <h3 className="flex items-center gap-2 font-semibold"><CalendarClock className="size-4 text-primary" />订单生命周期</h3>
        <div className="grid grid-cols-2 gap-3">
          <Detail label="预订" value={expense.bookedAt} />
          <Detail label="付款" value={expense.paidAt} />
          <Detail label="使用" value={dateRange(expense.serviceStartAt, expense.serviceEndAt)} />
          <Detail label="取消 / 退款" value={dateRange(expense.cancelledAt, expense.refundedAt)} />
        </div>
        {originalExpense ? <Button icon={<Undo2 className="size-4" />} onClick={() => navigateTo('ledger/expense', { expenseId: originalExpense.id, tripId })} variant="secondary">查看原账单：{originalExpense.title}</Button> : null}
      </Card>

      {expense.lineItems?.length ? (
        <Card className="space-y-3" variant="grouped">
          <h3 className="font-semibold">账单明细</h3>
          {expense.lineItems.map((line) => <div className="flex items-center justify-between gap-3 text-sm" key={line.id}><span>{line.title} · {ledgerCategoryLabels[line.category]}</span><strong>{formatLedgerMoney(line.amountMinor, line.currency)}</strong></div>)}
        </Card>
      ) : null}

      <Card className="space-y-3" variant="grouped">
        <h3 className="flex items-center gap-2 font-semibold"><Route className="size-4 text-primary" />关联行程点</h3>
        {expense.itemIds?.length ? expense.itemIds.map((itemId) => {
          const item = itemById.get(itemId)
          return item ? <Button className="w-full justify-start" icon={<Link2 className="size-4" />} key={itemId} onClick={() => navigateTo('item', { dayId: item.dayId, itemId, tripId })} variant="secondary">{item.title}</Button> : <p className="text-sm tm-muted" key={itemId}>关联行程点已不可用</p>
        }) : <p className="text-sm tm-muted">尚未关联行程点。</p>}
      </Card>

      <section className="space-y-3">
        <div><h3 className="font-semibold">完整来源链</h3><p className="mt-1 text-xs tm-muted">按订单、付款、发票、取消和退款的业务顺序排列。</p></div>
        {sources.map((source) => (
          <Card className="space-y-2" data-testid="ledger-source-link" key={source.id} variant="grouped">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-container-high text-primary"><FileText className="size-4" /></div>
              <div className="min-w-0 flex-1"><p className="font-semibold">{source.title ?? source.label ?? sourceRoleLabels[source.role]}</p><p className="mt-1 text-xs tm-muted">{sourceRoleLabels[source.role]}{source.capturedAt ? ` · ${source.capturedAt}` : ''}</p></div>
              {source.exists && source.kind !== 'manual' ? <Button aria-label="打开原始来源" className="px-3" icon={<ExternalLink className="size-4" />} onClick={() => openSource(source, tripId, itemById)} variant="subtle">打开</Button> : null}
            </div>
            {!source.exists ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">来源已不可用，保留标题、角色和采集时间供追溯。</p> : null}
          </Card>
        ))}
      </section>
    </div>
  )
}

function Detail({ label, value }: { label: string; value?: string }) {
  return <div><p className="text-xs tm-muted">{label}</p><p className="mt-1 break-words text-sm font-medium text-on-surface">{value || '未记录'}</p></div>
}

async function resolveSources(links: LedgerExpenseSourceLink[], tripId: string): Promise<ResolvedSource[]> {
  const bookings = await listTransportBookings(tripId)
  const bookingIds = new Set(bookings.map((booking) => booking.id))
  const resolved = await Promise.all(links.map(async (link) => {
    if (link.kind === 'manual') return { ...link, exists: true }
    if (link.available === false || !link.sourceId) return { ...link, exists: false }
    if (link.kind === 'ticket') return { ...link, exists: Boolean(await getTicketMeta(link.sourceId)) }
    if (link.kind === 'transport_booking') return { ...link, exists: bookingIds.has(link.sourceId) }
    if (link.kind === 'inbox') return { ...link, exists: Boolean(await getTravelInboxEntry(link.sourceId)) }
    if (link.kind === 'itinerary_note') return { ...link, exists: Boolean(await getItineraryItem(link.sourceId)) }
    return { ...link, exists: false }
  }))
  return resolved.sort((left, right) => sourceRoleOrder.indexOf(left.role) - sourceRoleOrder.indexOf(right.role) || (left.capturedAt ?? '').localeCompare(right.capturedAt ?? ''))
}

function openSource(source: ResolvedSource, tripId: string, itemById: Map<string, ItineraryItem>) {
  const target = buildLedgerSourceNavigationTarget(source, tripId, [...itemById.values()])
  if (target) navigateTo(target.route, target.params)
}

function dateRange(first?: string, second?: string) {
  if (first && second) return `${first} 至 ${second}`
  return first ?? second
}

function paymentLabel(status: LedgerExpense['paymentStatus']) {
  if (status === 'paid') return '已付款'
  if (status === 'unpaid') return '未付款'
  if (status === 'partially_refunded') return '部分退款'
  if (status === 'refunded') return '已退款'
  return '未知'
}
