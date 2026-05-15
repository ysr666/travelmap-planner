import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, CalendarDays, Edit3, ExternalLink, FileText, MapPin, Navigation, Ticket, Trash2 } from 'lucide-react'
import {
  deleteItineraryItemCascade,
  getDay,
  getItineraryItem,
  getTrip,
  listItemsByDay,
  listTicketsByItem,
} from '../db'
import { TicketPreview } from '../components/TicketPreview'
import {
  buildAppleMapsDirectionsUrl,
  buildAppleMapsUrl,
  buildGoogleMapsDirectionsUrl,
  buildGoogleMapsUrl,
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
import { Collapsible } from '../components/ui/Collapsible'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { EmptyState } from '../components/ui/EmptyState'
import { ListRow } from '../components/ui/ListRow'
import { SectionHeader } from '../components/ui/SectionHeader'
import { SkeletonLine } from '../components/ui/SkeletonLine'
import { getRouteParams } from '../lib/routes'

type ItemDetailContentProps = {
  trip: Trip
  day: Day
  item: ItineraryItem
  onItemDeleted: () => void
  sourceView?: 'schedule' | 'map'
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
            aria-label="返回每日行程"
            className="flex size-10 items-center justify-center rounded-xl bg-white text-slate-700 ring-1 ring-slate-200/80 active:scale-[0.98]"
            onClick={goBackToDay}
            type="button"
          >
            <ArrowLeft className="size-5" />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-xl font-semibold leading-tight text-slate-950">
            行程点详情
          </h1>
          <div className="size-10" />
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-4 app-scrollbar">
        <div className="page-transition">
          <ItemDetailContent
            day={day}
            item={item}
            onItemDeleted={goBackToDay}
            sourceView={sourceView}
            trip={trip}
          />
        </div>
      </main>
    </div>
  )
}

export function ItemDetailContent({ trip, day, item, onItemDeleted, sourceView = 'schedule' }: ItemDetailContentProps) {
  const [dayItems, setDayItems] = useState<ItineraryItem[]>([])
  const [tickets, setTickets] = useState<TicketMeta[]>([])
  const [previewTicket, setPreviewTicket] = useState<TicketMeta | null>(null)
  const [isLoadingRelations, setIsLoadingRelations] = useState(true)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const loadRelations = useCallback(async () => {
    setIsLoadingRelations(true)
    try {
      const [foundDayItems, foundTickets] = await Promise.all([
        listItemsByDay(day.id),
        listTicketsByItem(item.id),
      ])
      setDayItems(foundDayItems)
      setTickets(foundTickets)
    } catch {
      // silently ignore
    } finally {
      setIsLoadingRelations(false)
    }
  }, [day.id, item.id])

  const didLoadRef = useRef(false)
  useEffect(() => {
    if (didLoadRef.current) return
    didLoadRef.current = true
    void loadRelations()
  }, [loadRelations])

  const itemIndex = useMemo(() => {
    return dayItems.findIndex((dayItem) => dayItem.id === item.id)
  }, [dayItems, item.id])
  const previousItem = itemIndex > 0 ? dayItems[itemIndex - 1] : null

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
      <Card className="space-y-3">
        {actionError ? (
          <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
            {actionError}
          </div>
        ) : null}
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-sky-600">
              {formatDate(day.date)} · {describeItemTime(item)}
            </p>
            <h2 className="mt-1 text-xl font-semibold leading-tight text-slate-950">{item.title}</h2>
          </div>
          {item.transportMode ? (
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-xs font-semibold text-sky-600">
              {transportModeLabels[item.transportMode]}
            </span>
          ) : null}
        </div>
        {item.locationName || item.address ? (
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="flex items-start gap-2 text-sm font-semibold text-slate-950">
              <MapPin className="mt-0.5 size-4 shrink-0 text-slate-400" />
              {item.locationName || '地点未填写'}
            </p>
            {item.address ? (
              <p className="mt-1 pl-6 text-sm leading-6 text-slate-500">{item.address}</p>
            ) : null}
          </div>
        ) : null}
        {item.notes ? (
          <p className="text-sm leading-6 text-slate-500">{item.notes}</p>
        ) : null}
        {itemIndex > 0 ? (
          <Collapsible title="从上一站到此">
            <PreviousTransportCard
              item={item}
              previousItem={previousItem}
            />
          </Collapsible>
        ) : null}
        <a
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 text-sm font-semibold text-white shadow-[0_6px_16px_var(--color-primary-shadow)]"
          href={isIOS() ? buildAppleMapsUrl(item) : buildGoogleMapsUrl(item)}
          rel="noreferrer"
          target="_blank"
        >
          {isIOS() ? <Navigation className="size-4" /> : <ExternalLink className="size-4" />}
          {isIOS() ? 'Apple 地图' : 'Google 地图'}
        </a>
        <Collapsible title="其他地图">
          <a
            className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-white px-3 text-sm font-semibold text-slate-900 ring-1 ring-slate-200/80"
            href={isIOS() ? buildGoogleMapsUrl(item) : buildAppleMapsUrl(item)}
            rel="noreferrer"
            target="_blank"
          >
            {isIOS() ? <ExternalLink className="size-4" /> : <Navigation className="size-4" />}
            {isIOS() ? 'Google 地图' : 'Apple 地图'}
          </a>
        </Collapsible>
        <div className="grid grid-cols-2 gap-3">
          <Button
            icon={<Edit3 className="size-4" />}
            onClick={() => navigateTo('item/edit', { tripId: trip.id, dayId: day.id, itemId: item.id, view: sourceView })}
          >
            编辑
          </Button>
          <Button
            className="text-red-600"
            disabled={isDeleting}
            icon={<Trash2 className="size-4" />}
            onClick={() => setIsDeleteConfirmOpen(true)}
            variant="secondary"
          >
            删除
          </Button>
        </div>
      </Card>

      <section className="space-y-3">
        <SectionHeader
          action="添加票据"
          onAction={() => navigateTo('tickets', { tripId: trip.id, itemId: item.id })}
          title={`绑定票据（${tickets.length}）`}
        />
        {isLoadingRelations ? (
          <div className="space-y-2">
            <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
            <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
          </div>
        ) : tickets.length === 0 ? (
          <EmptyState
            body="可以上传门票、车票、二维码截图或 PDF，并绑定到这个行程点。"
            icon={<Ticket className="size-6" />}
            title="暂无绑定票据"
          />
        ) : (
          <Card className="divide-y divide-slate-100 py-1">
            {tickets.map((ticket) => (
              <ListRow
                detail={`${describeTicketMetaLine(ticket)} · ${formatTicketCreatedAt(ticket.createdAt)}`}
                icon={<FileText className="size-5" />}
                key={ticket.id}
                meta="查看"
                onClick={() => setPreviewTicket(ticket)}
                title={getTicketDisplayTitle(ticket)}
              />
            ))}
          </Card>
        )}
      </section>

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

function PreviousTransportCard({
  item,
  previousItem,
}: {
  item: ItineraryItem
  previousItem: ItineraryItem | null
}) {
  const description = describePreviousTransport(item)
  const appleUrl = previousItem
    ? buildAppleMapsDirectionsUrl(previousItem, item, item.previousTransportMode)
    : null
  const googleUrl = previousItem
    ? buildGoogleMapsDirectionsUrl(previousItem, item, item.previousTransportMode)
    : null

  return (
    <div className="space-y-3">
      {description ? (
        <div className="space-y-1.5 text-sm text-slate-600">
          {item.previousTransportMode ? (
            <p>
              <span className="font-semibold text-slate-500">交通方式：</span>
              {transportModeLabels[item.previousTransportMode]}
            </p>
          ) : null}
          {item.previousTransportDurationMinutes !== undefined ? (
            <p>
              <span className="font-semibold text-slate-500">预计耗时：</span>
              {item.previousTransportDurationMinutes} 分钟
            </p>
          ) : null}
          {item.previousTransportNote ? (
            <p>
              <span className="font-semibold text-slate-500">交通备注：</span>
              {item.previousTransportNote}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm leading-6 text-slate-500">尚未填写交通信息。</p>
      )}

      {appleUrl && googleUrl ? (
        <a
          className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 text-xs font-semibold text-white"
          href={isIOS() ? appleUrl : googleUrl}
          rel="noreferrer"
          target="_blank"
        >
          {isIOS() ? <Navigation className="size-4" /> : <ExternalLink className="size-4" />}
          查看路线
        </a>
      ) : null}
    </div>
  )
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function normalizeSourceView(value: string | null): 'schedule' | 'map' {
  return value === 'map' ? 'map' : 'schedule'
}
