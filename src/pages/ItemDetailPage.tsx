import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, CalendarDays, ChevronRight, Clock3, Edit3, ExternalLink, FileText, MapPin, Navigation, Ticket, Trash2 } from 'lucide-react'
import {
  deleteItineraryItemCascade,
  getDay,
  getItineraryItem,
  getTrip,
  listTicketsByItem,
} from '../db'
import { TicketPreview } from '../components/TicketPreview'
import {
  buildAppleMapsUrl,
  buildGoogleMapsUrl,
  hasValidCoordinates,
} from '../lib/mapLinks'
import { describeItemTime, describePreviousTransport, transportModeLabels } from '../lib/itinerary'
import { formatDate } from '../lib/dates'
import { navigateTo } from '../lib/routes'
import {
  describeTicketMetaLine,
  formatTicketCreatedAt,
  getTicketDisplayTitle,
} from '../lib/tickets'
import type { Day, ItineraryItem, TicketMeta, Trip } from '../types'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { EmptyState } from '../components/ui/EmptyState'
import { SkeletonLine } from '../components/ui/SkeletonLine'
import { getRouteParams } from '../lib/routes'

type ItemDetailContentProps = {
  trip: Trip
  day: Day
  item: ItineraryItem
  onItemDeleted: () => void
}

export function ItemDetailPage() {
  const params = getRouteParams()
  const tripId = params.get('tripId')
  const dayId = params.get('dayId')
  const itemId = params.get('itemId')
  const hasMissingParams = !tripId || !dayId || !itemId
  const sourceView = normalizeSourceView(params.get('view'))
  const [trip, setTrip] = useState<Trip | null>(null)
  const [day, setDay] = useState<Day | null>(null)
  const [item, setItem] = useState<ItineraryItem | null>(null)
  const [isLoading, setIsLoading] = useState(!hasMissingParams)
  const [error, setError] = useState<string | null>(() => {
    if (hasMissingParams) return '缺少行程点参数。'
    return null
  })

  useEffect(() => {
    if (hasMissingParams) {
      return
    }

    let cancelled = false
    const timeout = window.setTimeout(() => {
      setIsLoading(true)
      setError(null)
      void Promise.all([
        getTrip(tripId),
        getDay(dayId),
        getItineraryItem(itemId),
      ]).then(([foundTrip, foundDay, foundItem]) => {
        if (cancelled) return
        if (!foundTrip || !foundDay || !foundItem) {
          setError('未找到该行程点。')
          setTrip(foundTrip ?? null)
          setDay(foundDay ?? null)
          setItem(foundItem ?? null)
          return
        }
        setTrip(foundTrip)
        setDay(foundDay)
        setItem(foundItem)
      }).catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : '加载行程点失败')
        }
      }).finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })
    }, 0)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [dayId, hasMissingParams, itemId, tripId])

  function goBackToDay() {
    if (tripId && dayId) {
      navigateTo('day', { tripId, dayId, view: sourceView })
    } else if (tripId) {
      navigateTo('trip', { tripId })
    } else {
      navigateTo('home')
    }
  }
  const backLabel = sourceView === 'map' ? '返回地图' : '返回日程'

  if (isLoading) {
    return (
      <div className="space-y-4 px-4 pt-[max(0.9rem,env(safe-area-inset-top))]">
        <Card className="space-y-3">
          <SkeletonLine className="w-2/3" />
          <SkeletonLine className="w-full" />
          <SkeletonLine className="w-1/2" />
        </Card>
      </div>
    )
  }

  if (error || !trip || !day || !item) {
    return (
      <div className="space-y-4 px-4 pt-[max(0.9rem,env(safe-area-inset-top))]">
        <EmptyState
          body={error || '请从每日行程重新打开。'}
          icon={<CalendarDays className="size-6" />}
          title="无法打开行程点"
        />
        <Button onClick={goBackToDay} variant="secondary">
          返回每日行程
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="item-detail-page">
      <header className="z-30 shrink-0 border-b border-white/70 bg-surface/88 px-4 pb-3 pt-[max(0.9rem,env(safe-area-inset-top))] backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3">
          <button
            aria-label={backLabel}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-white px-3 text-sm font-semibold text-slate-700 ring-1 ring-slate-200/80 active:scale-[0.98]"
            onClick={goBackToDay}
            type="button"
          >
            <ArrowLeft className="size-4" />
            <span>{backLabel}</span>
          </button>
          <h1 className="sr-only">
            行程点详情
          </h1>
          <button
            aria-label="编辑行程点"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-white px-3 text-sm font-semibold text-slate-700 ring-1 ring-slate-200/80 active:scale-[0.98]"
            onClick={() => navigateTo('item/edit', { tripId: trip.id, dayId: day.id, itemId: item.id, view: sourceView })}
            type="button"
          >
            <Edit3 className="size-4" />
            <span>编辑</span>
          </button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-4 app-scrollbar">
        <div className="page-transition">
          <ItemDetailContent
            day={day}
            item={item}
            onItemDeleted={goBackToDay}
            trip={trip}
          />
        </div>
      </main>
    </div>
  )
}

export function ItemDetailContent({ trip, day, item, onItemDeleted }: ItemDetailContentProps) {
  const [tickets, setTickets] = useState<TicketMeta[]>([])
  const [previewTicket, setPreviewTicket] = useState<TicketMeta | null>(null)
  const [isLoadingRelations, setIsLoadingRelations] = useState(true)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const loadRelations = useCallback(async () => {
    setIsLoadingRelations(true)
    try {
      const foundTickets = await listTicketsByItem(item.id)
      setTickets(foundTickets)
    } catch {
      // silently ignore
    } finally {
      setIsLoadingRelations(false)
    }
  }, [item.id])

  const didLoadRef = useRef(false)
  useEffect(() => {
    if (didLoadRef.current) return
    didLoadRef.current = true
    void loadRelations()
  }, [loadRelations])

  const transportDescription = describePreviousTransport(item)
  const hasCoordinates = hasValidCoordinates(item)
  const ticketPreviewItems = tickets.slice(0, 3)
  const hiddenTicketCount = Math.max(0, tickets.length - ticketPreviewItems.length)

  async function confirmDeleteItem() {
    setIsDeleting(true)
    setActionError(null)
    try {
      await deleteItineraryItemCascade(item.id)
      setIsDeleteConfirmOpen(false)
      onItemDeleted()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : '删除行程点失败')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="space-y-5 pb-2">
      <Card className="space-y-4" data-testid="item-detail-core">
        {actionError ? (
          <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
            {actionError}
          </div>
        ) : null}
        <div className="space-y-2">
          <p className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700">
            <Clock3 className="size-3.5" />
            {formatDate(day.date)} · {describeItemTime(item)}
          </p>
          <h2 className="text-2xl font-semibold leading-tight text-slate-950">{item.title}</h2>
          {item.transportMode ? (
            <span className="inline-flex rounded-full bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-500 ring-1 ring-slate-100">
              {transportModeLabels[item.transportMode]}
            </span>
          ) : null}
        </div>

        <div className="space-y-2">
          <DetailRow
            icon={<MapPin className="size-4" />}
            label={item.locationName || '地点未填写'}
            value={item.address}
          />
          <DetailRow
            icon={<Navigation className="size-4" />}
            label={hasCoordinates ? '已保存坐标' : '暂无坐标'}
            value={hasCoordinates ? '可使用外部地图导航' : '外部地图导航暂不可用'}
          />
          {transportDescription ? (
            <DetailRow
              icon={<ChevronRight className="size-4" />}
              label="从上一站到此处"
              value={transportDescription}
            />
          ) : null}
        </div>

        {item.notes ? (
          <section className="rounded-2xl bg-slate-50 px-3 py-3">
            <p className="text-xs font-semibold text-slate-400">备注</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{item.notes}</p>
          </section>
        ) : null}
      </Card>

      <section className="space-y-3" data-testid="item-detail-tickets">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-950">票据</h3>
            <p className="mt-0.5 text-xs text-slate-500">{tickets.length} 张已绑定</p>
          </div>
          <Button
            className="min-h-9 px-3"
            onClick={() => navigateTo('tickets', { tripId: trip.id, itemId: item.id })}
            variant="secondary"
          >
            添加票据
          </Button>
        </div>
        {isLoadingRelations ? (
          <div className="space-y-2">
            <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
            <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
          </div>
        ) : tickets.length === 0 ? (
          <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-4 text-sm leading-6 text-slate-500">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-slate-500 ring-1 ring-slate-100">
                <Ticket className="size-5" />
              </span>
              <span>
                <span className="block font-semibold text-slate-950">暂无绑定票据</span>
                可在票据库添加门票、车票、二维码截图或 PDF。
              </span>
            </div>
          </div>
        ) : (
          <Card className="space-y-1 py-2">
            {ticketPreviewItems.map((ticket) => (
              <TicketCompactRow
                key={ticket.id}
                onClick={() => setPreviewTicket(ticket)}
                ticket={ticket}
              />
            ))}
            {hiddenTicketCount > 0 ? (
              <button
                className="flex min-h-10 w-full items-center justify-center rounded-xl text-sm font-semibold text-sky-700 active:bg-sky-50"
                onClick={() => navigateTo('tickets', { tripId: trip.id, itemId: item.id })}
                type="button"
              >
                查看全部票据（还有 {hiddenTicketCount} 张）
              </button>
            ) : null}
          </Card>
        )}
      </section>

      <section className="space-y-3" data-testid="item-detail-navigation">
        <h3 className="text-base font-semibold text-slate-950">外部导航</h3>
        {hasCoordinates ? (
          <div className="grid grid-cols-2 gap-2">
            <a
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-3 text-sm font-semibold text-slate-900 ring-1 ring-slate-200/80 active:scale-[0.98]"
              href={buildAppleMapsUrl(item)}
              rel="noreferrer"
              target="_blank"
            >
              <Navigation className="size-4" />
              Apple 地图
            </a>
            <a
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-3 text-sm font-semibold text-slate-900 ring-1 ring-slate-200/80 active:scale-[0.98]"
              href={buildGoogleMapsUrl(item)}
              rel="noreferrer"
              target="_blank"
            >
              <ExternalLink className="size-4" />
              Google 地图
            </a>
          </div>
        ) : (
          <div className="rounded-2xl bg-white/70 px-4 py-3 text-sm leading-6 text-slate-500 ring-1 ring-white/80">
            暂无坐标，无法从这里打开外部地图导航。可以先编辑这个地点并补充坐标。
          </div>
        )}
      </section>

      <Button
        className="w-full text-red-600"
        disabled={isDeleting}
        icon={<Trash2 className="size-4" />}
        onClick={() => setIsDeleteConfirmOpen(true)}
        variant="ghost"
      >
        删除行程点
      </Button>

      {previewTicket ? (
        <TicketPreview
          key={previewTicket.id}
          onClose={() => setPreviewTicket(null)}
          ticket={previewTicket}
        />
      ) : null}

      <ConfirmDialog
        body="删除后，绑定到该行程点的票据记录也会被移除。"
        confirmLabel="删除行程点"
        loading={isDeleting}
        onCancel={() => {
          if (!isDeleting) {
            setIsDeleteConfirmOpen(false)
          }
        }}
        onConfirm={() => void confirmDeleteItem()}
        open={isDeleteConfirmOpen}
        title={`确认删除「${item.title}」吗？`}
      />
    </div>
  )
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode
  label: string
  value?: string
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-slate-50 px-3 py-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-white text-slate-500 ring-1 ring-slate-100">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block break-words text-sm font-semibold text-slate-950">{label}</span>
        {value ? <span className="mt-0.5 block break-words text-sm leading-5 text-slate-500">{value}</span> : null}
      </span>
    </div>
  )
}

function TicketCompactRow({
  ticket,
  onClick,
}: {
  ticket: TicketMeta
  onClick: () => void
}) {
  return (
    <button
      className="flex min-h-12 w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition active:bg-slate-50"
      data-testid="item-ticket-entry"
      onClick={onClick}
      type="button"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-slate-500 ring-1 ring-slate-100">
        <FileText className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-950">{getTicketDisplayTitle(ticket)}</span>
        <span className="block truncate text-xs text-slate-500">
          {describeTicketMetaLine(ticket)} · {formatTicketCreatedAt(ticket.createdAt)}
        </span>
      </span>
      <span className="shrink-0 text-xs font-semibold text-sky-600">查看</span>
    </button>
  )
}

function normalizeSourceView(value: string | null): 'schedule' | 'map' {
  return value === 'map' ? 'map' : 'schedule'
}
