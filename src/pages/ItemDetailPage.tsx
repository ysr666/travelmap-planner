import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  Clock3,
  Edit3,
  ExternalLink,
  FileArchive,
  FileImage,
  FileText,
  Link2,
  MapPin,
  MapPinned,
  Navigation,
  Search,
  Ticket,
  Trash2,
} from 'lucide-react'
import {
  deleteItineraryItemCascade,
  getDay,
  getItineraryItem,
  getTrip,
  listItemsByDay,
  listTicketsByItem,
  updateItineraryItem,
} from '../db'
import { TicketPreview } from '../components/TicketPreview'
import {
  buildAppleMapsUrl,
  buildGoogleMapsUrl,
  hasValidCoordinates,
} from '../lib/mapLinks'
import { describeItemTime, describePreviousTransport, sortItineraryItems, transportModeLabels } from '../lib/itinerary'
import { formatDate } from '../lib/dates'
import { navigateTo } from '../lib/routes'
import {
  getTicketDisplayTitle,
} from '../lib/tickets'
import {
  getTicketDisplayMeta,
  type TicketDisplayIconKind,
  type TicketDisplayToneKey,
} from '../lib/ticketDisplay'
import type { Day, ItineraryItem, TicketMeta, Trip } from '../types'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { EmptyState } from '../components/ui/EmptyState'
import { SkeletonLine } from '../components/ui/SkeletonLine'
import { getRouteParams } from '../lib/routes'
import {
  ProviderProxyClientError,
  fetchProviderProxyPlaceLookup,
  getProviderProxyConfig,
} from '../lib/providerProxyClient'
import {
  PROVIDER_PROXY_PLACE_LOOKUP_OPERATION,
  type ProviderProxyPlaceLookupResult,
} from '../lib/providerProxyContract'

type ItemDetailContentProps = {
  trip: Trip
  day: Day
  item: ItineraryItem
  onItemDeleted: () => void
  onItemUpdated: (item: ItineraryItem) => void
  sourceView: 'schedule' | 'map'
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
      <header className="z-30 shrink-0 border-b tm-row bg-surface/88 px-4 pb-3 pt-[max(0.9rem,env(safe-area-inset-top))] backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3">
          <button
            aria-label={backLabel}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-slate-700 ring-1 ring-slate-200/80 transition active:scale-[0.98] tm-surface tm-focus dark:text-slate-200 dark:ring-slate-700/80"
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
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-slate-700 ring-1 ring-slate-200/80 transition active:scale-[0.98] tm-surface tm-focus dark:text-slate-200 dark:ring-slate-700/80"
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
            key={item.id}
            onItemDeleted={goBackToDay}
            onItemUpdated={setItem}
            sourceView={sourceView}
            trip={trip}
          />
        </div>
      </main>
    </div>
  )
}

export function ItemDetailContent({ trip, day, item, onItemDeleted, onItemUpdated, sourceView }: ItemDetailContentProps) {
  const [dayItems, setDayItems] = useState<ItineraryItem[]>([])
  const [tickets, setTickets] = useState<TicketMeta[]>([])
  const [previewTicket, setPreviewTicket] = useState<TicketMeta | null>(null)
  const [isLoadingRelations, setIsLoadingRelations] = useState(true)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isPlaceLookupOpen, setIsPlaceLookupOpen] = useState(false)
  const [placeLookupQuery, setPlaceLookupQuery] = useState(() => buildPlaceLookupQuery(item))
  const [placeLookupResults, setPlaceLookupResults] = useState<ProviderProxyPlaceLookupResult[]>([])
  const [placeLookupError, setPlaceLookupError] = useState<string | null>(null)
  const [isPlaceLookupLoading, setIsPlaceLookupLoading] = useState(false)
  const [pendingPlaceCandidate, setPendingPlaceCandidate] = useState<ProviderProxyPlaceLookupResult | null>(null)
  const [isApplyingPlaceLookup, setIsApplyingPlaceLookup] = useState(false)

  const loadRelations = useCallback(async () => {
    setIsLoadingRelations(true)
    try {
      const [foundDayItems, foundTickets] = await Promise.all([
        listItemsByDay(day.id),
        listTicketsByItem(item.id),
      ])
      setDayItems(sortItineraryItems(foundDayItems))
      setTickets(foundTickets)
    } catch {
      // silently ignore
    } finally {
      setIsLoadingRelations(false)
    }
  }, [day.id, item.id])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadRelations()
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [loadRelations])

  const itemIndex = dayItems.findIndex((dayItem) => dayItem.id === item.id)
  const previousItem = itemIndex > 0 ? dayItems[itemIndex - 1] : null
  const nextItem = itemIndex >= 0 && itemIndex < dayItems.length - 1 ? dayItems[itemIndex + 1] : null
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

  async function searchPlaceCandidates() {
    const query = placeLookupQuery.trim()
    if (!query) {
      setPlaceLookupError('请输入地点名称或地址。')
      setPlaceLookupResults([])
      return
    }

    const config = getProviderProxyConfig()
    if (!config.proxyUrl) {
      setPlaceLookupError('当前未配置地点查询服务。')
      setPlaceLookupResults([])
      return
    }

    setIsPlaceLookupLoading(true)
    setPlaceLookupError(null)
    try {
      const response = await fetchProviderProxyPlaceLookup({
        locale: 'zh-CN',
        maxResults: 5,
        operation: PROVIDER_PROXY_PLACE_LOOKUP_OPERATION,
        query,
      }, config.proxyUrl)
      setPlaceLookupResults(response.results)
      if (response.results.length === 0) {
        setPlaceLookupError('没有找到可用候选地点。')
      }
    } catch (caught) {
      setPlaceLookupResults([])
      setPlaceLookupError(caught instanceof ProviderProxyClientError ? caught.message : '地点查询失败，请稍后再试。')
    } finally {
      setIsPlaceLookupLoading(false)
    }
  }

  async function confirmApplyPlaceLookup() {
    if (!pendingPlaceCandidate) {
      return
    }

    setIsApplyingPlaceLookup(true)
    setActionError(null)
    try {
      const patch: Partial<ItineraryItem> = {
        address: pendingPlaceCandidate.formattedAddress,
        locationName: pendingPlaceCandidate.displayName,
      }
      if (isValidPlaceLocation(pendingPlaceCandidate.location)) {
        patch.lat = pendingPlaceCandidate.location.lat
        patch.lng = pendingPlaceCandidate.location.lng
      }
      const updated = await updateItineraryItem(item.id, patch)
      if (!updated) {
        throw new Error('未找到该行程点。')
      }
      onItemUpdated(updated)
      setPendingPlaceCandidate(null)
      setPlaceLookupResults([])
      setPlaceLookupError(null)
      setIsPlaceLookupOpen(false)
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : '更新地点信息失败')
    } finally {
      setIsApplyingPlaceLookup(false)
    }
  }

  return (
    <div className="space-y-5 pb-2">
      <Card variant="grouped" className="space-y-4" data-testid="item-detail-core">
        {actionError ? (
          <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-600 dark:border-red-900/60 dark:bg-red-950/35 dark:text-red-300">
            {actionError}
          </div>
        ) : null}
        <div className="space-y-2">
          <p className="inline-flex items-center gap-1.5 rounded-full bg-sky-50/80 px-2.5 py-1 text-xs font-semibold text-sky-700 ring-1 ring-sky-100/80 dark:bg-sky-950/35 dark:text-sky-300 dark:ring-sky-900/50">
            <Clock3 className="size-3.5" />
            {formatDate(day.date)} · {describeItemTime(item)}
          </p>
          <h2 className="text-2xl font-semibold leading-tight text-slate-950 dark:text-slate-100">{item.title}</h2>
          {item.transportMode ? (
            <span className="tm-chip text-xs">
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

        <div className="space-y-3">
          <Button
            className="min-h-10 px-3"
            data-testid="item-place-lookup-toggle"
            icon={<Search className="size-4" />}
            onClick={() => {
              setIsPlaceLookupOpen((open) => {
                const next = !open
                if (next && !placeLookupQuery.trim()) {
                  setPlaceLookupQuery(buildPlaceLookupQuery(item))
                }
                return next
              })
            }}
            variant="secondary"
          >
            查找地点信息
          </Button>

          {isPlaceLookupOpen ? (
            <section
              className="space-y-3 rounded-2xl bg-slate-50/75 px-3 py-3 ring-1 ring-slate-100/70 dark:bg-slate-900/40 dark:ring-slate-800/70"
              data-testid="item-place-lookup-panel"
            >
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="min-w-0 flex-1">
                  <span className="sr-only">地点查询关键词</span>
                  <input
                    className="min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-sky-700 dark:focus:ring-sky-900/40"
                    data-testid="item-place-lookup-query"
                    maxLength={200}
                    onChange={(event) => setPlaceLookupQuery(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void searchPlaceCandidates()
                      }
                    }}
                    placeholder="地点名称或地址"
                    value={placeLookupQuery}
                  />
                </label>
                <Button
                  className="shrink-0 px-3"
                  data-testid="item-place-lookup-search"
                  disabled={!placeLookupQuery.trim()}
                  icon={<Search className="size-4" />}
                  loading={isPlaceLookupLoading}
                  onClick={() => void searchPlaceCandidates()}
                  variant="primary"
                >
                  搜索
                </Button>
              </div>

              {placeLookupError ? (
                <div
                  className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-sm font-medium leading-5 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300"
                  data-testid="item-place-lookup-error"
                >
                  {placeLookupError}
                </div>
              ) : null}

              {placeLookupResults.length > 0 ? (
                <div className="space-y-2" data-testid="item-place-lookup-results">
                  {placeLookupResults.map((candidate) => (
                    <button
                      className="flex w-full min-w-0 items-start gap-3 rounded-xl bg-white px-3 py-3 text-left ring-1 ring-slate-200/80 transition hover:ring-sky-200 active:scale-[0.99] tm-focus dark:bg-slate-950/70 dark:ring-slate-700/80 dark:hover:ring-sky-800"
                      data-testid="item-place-lookup-result"
                      key={candidate.placeId}
                      onClick={() => setPendingPlaceCandidate(candidate)}
                      type="button"
                    >
                      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600 ring-1 ring-sky-100 dark:bg-sky-950/35 dark:text-sky-300 dark:ring-sky-900/50">
                        <MapPinned className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-sm font-semibold text-slate-950 [overflow-wrap:anywhere] dark:text-slate-100">
                          {candidate.displayName}
                        </span>
                        <span className="mt-1 block break-words text-xs leading-5 tm-muted [overflow-wrap:anywhere]">
                          {candidate.formattedAddress}
                        </span>
                        {isValidPlaceLocation(candidate.location) ? (
                          <span className="mt-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">
                            {candidate.location.lat.toFixed(5)}, {candidate.location.lng.toFixed(5)}
                          </span>
                        ) : null}
                        {candidate.googleMapsUri ? (
                          <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-sky-600 dark:text-sky-300">
                            <ExternalLink className="size-3" />
                            Google Maps
                          </span>
                        ) : null}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>

        {item.notes ? (
          <section className="rounded-2xl bg-slate-50/75 px-3 py-3 ring-1 ring-slate-100/70 dark:bg-slate-900/40 dark:ring-slate-800/70">
            <p className="text-xs font-semibold tm-muted">备注</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600 dark:text-slate-300">{item.notes}</p>
          </section>
        ) : null}
      </Card>

      {dayItems.length > 1 ? (
        <ItemNeighborNavigation
          day={day}
          nextItem={nextItem}
          previousItem={previousItem}
          sourceView={sourceView}
          trip={trip}
        />
      ) : null}

      <section className="space-y-3" data-testid="item-detail-tickets">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-950 dark:text-slate-100">现场票据</h3>
            <p className="mt-0.5 text-xs tm-muted">{tickets.length} 张已绑定</p>
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
            <div className="h-10 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
            <div className="h-10 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
          </div>
        ) : tickets.length === 0 ? (
          <div className="rounded-2xl px-4 py-4 text-sm leading-6 tm-muted tm-group">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-sky-50/80 text-sky-600 ring-1 ring-sky-100/80 dark:bg-sky-950/35 dark:text-sky-300 dark:ring-sky-900/50">
                <Ticket className="size-5" />
              </span>
              <span>
                <span className="block font-semibold text-slate-950 dark:text-slate-100">暂无绑定票据</span>
                可在票据库添加二维码截图、门票、车票或订单 PDF。
              </span>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {ticketPreviewItems.map((ticket) => (
              <TicketCompactRow
                key={ticket.id}
                onClick={() => setPreviewTicket(ticket)}
                ticket={ticket}
              />
            ))}
            {hiddenTicketCount > 0 ? (
              <button
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border border-sky-100/80 bg-sky-50/70 px-3.5 py-2.5 text-left text-sm font-semibold text-sky-700 transition active:bg-sky-100 tm-focus dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-300 dark:active:bg-sky-950/50"
                data-testid="item-ticket-view-all"
                onClick={() => navigateTo('tickets', { tripId: trip.id })}
                type="button"
              >
                <span>查看全部票据</span>
                <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs dark:bg-slate-950/70">+{hiddenTicketCount}</span>
              </button>
            ) : null}
          </div>
        )}
      </section>

      <section className="space-y-3" data-testid="item-detail-navigation">
        <h3 className="text-base font-semibold text-slate-950 dark:text-slate-100">外部导航</h3>
        {hasCoordinates ? (
          <div className="grid grid-cols-2 gap-2">
            <a
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold text-slate-900 ring-1 ring-slate-200/80 transition active:scale-[0.98] tm-surface tm-focus dark:text-slate-100 dark:ring-slate-700/80"
              href={buildAppleMapsUrl(item)}
              rel="noreferrer"
              target="_blank"
            >
              <Navigation className="size-4" />
              Apple 地图
            </a>
            <a
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold text-slate-900 ring-1 ring-slate-200/80 transition active:scale-[0.98] tm-surface tm-focus dark:text-slate-100 dark:ring-slate-700/80"
              href={buildGoogleMapsUrl(item)}
              rel="noreferrer"
              target="_blank"
            >
              <ExternalLink className="size-4" />
              Google 地图
            </a>
          </div>
        ) : (
          <div className="rounded-2xl px-4 py-3 text-sm leading-6 tm-muted tm-group">
            暂无坐标，无法从这里打开外部地图导航。可以先编辑这个地点并补充坐标。
          </div>
        )}
      </section>

      <Button
        className="w-full"
        disabled={isDeleting}
        icon={<Trash2 className="size-4" />}
        onClick={() => setIsDeleteConfirmOpen(true)}
        variant="destructive"
      >
        删除行程点
      </Button>

      {previewTicket ? (
        <TicketPreview
          key={previewTicket.id}
          onChangeTicket={setPreviewTicket}
          onClose={() => setPreviewTicket(null)}
          ticket={previewTicket}
          tickets={tickets}
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

      <ConfirmDialog
        body={pendingPlaceCandidate
          ? `将当前行程点更新为：\n${pendingPlaceCandidate.displayName}\n${pendingPlaceCandidate.formattedAddress}${isValidPlaceLocation(pendingPlaceCandidate.location) ? `\n坐标：${pendingPlaceCandidate.location.lat.toFixed(5)}, ${pendingPlaceCandidate.location.lng.toFixed(5)}` : ''}`
          : ''}
        confirmLabel="更新地点"
        icon={<MapPinned className="size-5" />}
        loading={isApplyingPlaceLookup}
        onCancel={() => {
          if (!isApplyingPlaceLookup) {
            setPendingPlaceCandidate(null)
          }
        }}
        onConfirm={() => void confirmApplyPlaceLookup()}
        open={Boolean(pendingPlaceCandidate)}
        testId="item-place-lookup-confirm-dialog"
        title="确认使用这个地点吗？"
      />
    </div>
  )
}

function ItemNeighborNavigation({
  trip,
  day,
  previousItem,
  nextItem,
  sourceView,
}: {
  trip: Trip
  day: Day
  previousItem: ItineraryItem | null
  nextItem: ItineraryItem | null
  sourceView: 'schedule' | 'map'
}) {
  return (
    <div className="grid grid-cols-2 gap-2" data-testid="item-neighbor-nav">
      <NeighborButton
        direction="previous"
        item={previousItem}
        label="上一项"
        onClick={() => {
          if (previousItem) {
            navigateTo('item', { tripId: trip.id, dayId: day.id, itemId: previousItem.id, view: sourceView })
          }
        }}
      />
      <NeighborButton
        direction="next"
        item={nextItem}
        label="下一项"
        onClick={() => {
          if (nextItem) {
            navigateTo('item', { tripId: trip.id, dayId: day.id, itemId: nextItem.id, view: sourceView })
          }
        }}
      />
    </div>
  )
}

function NeighborButton({
  direction,
  item,
  label,
  onClick,
}: {
  direction: 'previous' | 'next'
  item: ItineraryItem | null
  label: string
  onClick: () => void
}) {
  const disabled = !item

  return (
    <button
      aria-disabled={disabled}
      className={`min-h-16 rounded-2xl px-3 py-2 text-left transition active:scale-[0.99] tm-group tm-focus ${
        disabled ? 'cursor-not-allowed opacity-45' : 'active:bg-slate-50 dark:active:bg-slate-800/70'
      }`}
      data-testid={`item-${direction}-button`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span className="block text-xs font-semibold text-sky-600 dark:text-sky-300">{label}</span>
      <span className="mt-1 block truncate text-sm font-semibold text-slate-950 dark:text-slate-100">
        {item ? item.title : direction === 'previous' ? '已经是第一项' : '已经是最后一项'}
      </span>
    </button>
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
    <div className="flex items-start gap-3 rounded-2xl bg-slate-50/75 px-3 py-3 ring-1 ring-slate-100/70 dark:bg-slate-900/40 dark:ring-slate-800/70">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-white/90 text-slate-500 ring-1 ring-slate-100 dark:bg-slate-950/60 dark:text-slate-400 dark:ring-slate-800">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block break-words text-sm font-semibold text-slate-950 dark:text-slate-100">{label}</span>
        {value ? <span className="mt-0.5 block break-words text-sm leading-5 tm-muted">{value}</span> : null}
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
  const visual = getTicketDisplayMeta(ticket)
  const secondary = visual.secondaryLine

  return (
    <button
      className="flex min-h-[4.25rem] w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition active:scale-[0.99] active:bg-slate-50 tm-group tm-focus dark:active:bg-slate-800/70"
      data-testid="item-ticket-entry"
      onClick={onClick}
      type="button"
    >
      <span className={`flex size-11 shrink-0 flex-col items-center justify-center rounded-2xl ring-1 ${ticketToneClasses[visual.toneKey]}`}>
        {renderTicketDisplayIcon(visual.iconKind)}
        <span className="mt-0.5 text-[10px] font-bold leading-none">{visual.typeLabel}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-950 dark:text-slate-100">{getTicketDisplayTitle(ticket)}</span>
        <span className="mt-0.5 block truncate text-xs font-semibold tm-muted">{visual.storageLabel}</span>
        {secondary ? (
          <span className="mt-0.5 block break-words text-xs leading-4 tm-muted [overflow-wrap:anywhere]">
            {secondary}
          </span>
        ) : null}
      </span>
      <span className="shrink-0 rounded-full bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700 dark:bg-sky-950/35 dark:text-sky-300">查看</span>
    </button>
  )
}

const ticketToneClasses: Record<TicketDisplayToneKey, string> = {
  amber: 'bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-950/35 dark:text-amber-300 dark:ring-amber-900/50',
  rose: 'bg-rose-50 text-rose-700 ring-rose-100 dark:bg-rose-950/35 dark:text-rose-300 dark:ring-rose-900/50',
  sky: 'bg-sky-50 text-sky-700 ring-sky-100 dark:bg-sky-950/35 dark:text-sky-300 dark:ring-sky-900/50',
  slate: 'bg-slate-50 text-slate-600 ring-slate-100 dark:bg-slate-900/60 dark:text-slate-300 dark:ring-slate-800',
  violet: 'bg-violet-50 text-violet-700 ring-violet-100 dark:bg-violet-950/35 dark:text-violet-300 dark:ring-violet-900/50',
}

function renderTicketDisplayIcon(iconKind: TicketDisplayIconKind) {
  if (iconKind === 'external') return <Link2 className="size-4" />
  if (iconKind === 'reference') return <MapPin className="size-4" />
  if (iconKind === 'image') return <FileImage className="size-4" />
  if (iconKind === 'pdf') return <FileText className="size-4" />
  return <FileArchive className="size-4" />
}

function buildPlaceLookupQuery(item: ItineraryItem) {
  const parts = [item.locationName, item.address, item.title]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
  return Array.from(new Set(parts)).join(' ')
}

function isValidPlaceLocation(location: ProviderProxyPlaceLookupResult['location'] | undefined): location is { lat: number; lng: number } {
  return Boolean(
    location
    && Number.isFinite(location.lat)
    && Number.isFinite(location.lng)
    && location.lat >= -90
    && location.lat <= 90
    && location.lng >= -180
    && location.lng <= 180,
  )
}

function normalizeSourceView(value: string | null): 'schedule' | 'map' {
  return value === 'map' ? 'map' : 'schedule'
}
