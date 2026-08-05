import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  ChevronRight,
  Clock3,
  ExternalLink,
  MapPin,
  MapPinned,
  Navigation,
  NotebookPen,
  Pencil,
  Save,
  Search,
  ShieldCheck,
  Ticket,
  Trash2,
  X,
} from 'lucide-react'
import {
  deleteItineraryItemCascade,
  getItineraryItem,
  listItemsByDay,
  listTicketsByItem,
  updateItineraryItem,
} from '../../db'
import { TicketPreview } from '../TicketPreview'
import { TicketThumbnail } from '../tickets/TicketThumbnail'
import { ItemContentEnrichmentCard } from '../ai/TripContentEnrichmentPanel'
import { Button } from '../ui/Button'
import { Collapsible } from '../ui/Collapsible'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { useModalAccessibility } from '../ui/useModalAccessibility'
import { buildAppleMapsUrl, buildGoogleMapsUrl } from '../../lib/mapLinks'
import { describeItemTime } from '../../lib/itinerary'
import { formatDate } from '../../lib/dates'
import { navigateTo } from '../../lib/routes'
import { getTicketCategoryLabel, getTicketDisplayTitle } from '../../lib/tickets'
import {
  formatFlexibility,
  formatMobility,
  formatPriority,
  formatWeather,
} from '../../lib/ai/globalAiCommandRouter'
import { buildItemFieldContext } from '../../lib/itemFieldContext'
import {
  ProviderProxyClientError,
  fetchProviderProxyPlaceLookup,
  getProviderProxyConfig,
} from '../../lib/providerProxyClient'
import {
  PROVIDER_PROXY_PLACE_LOOKUP_OPERATION,
  type ProviderProxyPlaceLookupResult,
} from '../../lib/ai/providerProxyContract'
import type {
  Day,
  ItineraryItem,
  ItineraryReplanPreference,
  ReplanFlexibility,
  ReplanMobilitySuitability,
  ReplanPriority,
  ReplanWeatherSuitability,
  TicketMeta,
  Trip,
} from '../../types'

type ItemDetailContentProps = {
  trip: Trip
  day: Day
  item: ItineraryItem
  onItemDeleted: () => void
  onItemUpdated: (item: ItineraryItem) => void
  sourceView: 'schedule' | 'map'
}

export function ItemDetailContent({ trip, day, item, onItemDeleted, onItemUpdated, sourceView }: ItemDetailContentProps) {
  const defaultPlaceLookupQuery = buildPlaceLookupQuery(item)
  const [dayItems, setDayItems] = useState<ItineraryItem[]>([])
  const [tickets, setTickets] = useState<TicketMeta[]>([])
  const [previewTicket, setPreviewTicket] = useState<TicketMeta | null>(null)
  const [isLoadingRelations, setIsLoadingRelations] = useState(true)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)
  const [isPlaceLookupOpen, setIsPlaceLookupOpen] = useState(false)
  const [placeLookupQuery, setPlaceLookupQuery] = useState(() => defaultPlaceLookupQuery)
  const [placeLookupResults, setPlaceLookupResults] = useState<ProviderProxyPlaceLookupResult[]>([])
  const [placeLookupError, setPlaceLookupError] = useState<string | null>(null)
  const [isPlaceLookupLoading, setIsPlaceLookupLoading] = useState(false)
  const [pendingPlaceCandidate, setPendingPlaceCandidate] = useState<ProviderProxyPlaceLookupResult | null>(null)
  const [isApplyingPlaceLookup, setIsApplyingPlaceLookup] = useState(false)
  const placeLookupAutoSearchKeyRef = useRef<string | null>(null)
  const placeLookupInFlightKeyRef = useRef<string | null>(null)
  const placeLookupCompletedKeyRef = useRef<string | null>(null)
  const [preferenceForm, setPreferenceForm] = useState(() => buildPreferenceFormState(item.replanPreference))
  const [isSavingPreference, setIsSavingPreference] = useState(false)
  const [preferenceMessage, setPreferenceMessage] = useState<string | null>(null)

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
      // Related records are supplemental to the core item view.
    } finally {
      setIsLoadingRelations(false)
    }
  }, [day.id, item.id])

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadRelations(), 0)
    return () => window.clearTimeout(timeout)
  }, [loadRelations])

  const fieldContext = buildItemFieldContext({ day, dayItems, item, tickets })
  const previousItem = fieldContext.previousItem
  const nextItem = fieldContext.nextItem
  const transportDescription = fieldContext.transportDescription

  async function confirmDeleteItem() {
    setIsDeleting(true)
    try {
      await deleteItineraryItemCascade(item.id, {
        ...(dayItems.some((candidate) => candidate.id === item.id)
          ? { expectedCurrentItemIds: dayItems.map((candidate) => candidate.id) }
          : {}),
        expectedItemUpdatedAt: item.updatedAt,
        tripId: trip.id,
      })
      setIsDeleteConfirmOpen(false)
      onItemDeleted()
    } catch {
      // The existing flow intentionally keeps destructive failures quiet.
    } finally {
      setIsDeleting(false)
    }
  }

  async function searchPlaceCandidates(queryOverride?: string) {
    const query = (queryOverride ?? placeLookupQuery).trim()
    if (!query) {
      setPlaceLookupError('请输入地点名称或地址。')
      setPlaceLookupResults([])
      return
    }
    const requestKey = `${item.id}|${query}`
    if (placeLookupInFlightKeyRef.current === requestKey || placeLookupCompletedKeyRef.current === requestKey) return

    const config = getProviderProxyConfig()
    if (!config.proxyUrl) {
      setPlaceLookupError('当前未配置地点查询服务。')
      setPlaceLookupResults([])
      placeLookupCompletedKeyRef.current = requestKey
      return
    }

    placeLookupInFlightKeyRef.current = requestKey
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
      if (response.results.length === 0) setPlaceLookupError('没有找到可用候选地点。')
    } catch (caught) {
      setPlaceLookupResults([])
      setPlaceLookupError(caught instanceof ProviderProxyClientError ? caught.message : '地点查询失败，请稍后再试。')
    } finally {
      placeLookupInFlightKeyRef.current = null
      placeLookupCompletedKeyRef.current = requestKey
      setIsPlaceLookupLoading(false)
    }
  }

  async function confirmApplyPlaceLookup() {
    if (!pendingPlaceCandidate) return

    setIsApplyingPlaceLookup(true)
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
      if (!updated) throw new Error('未找到该行程点。')
      onItemUpdated(updated)
      setPendingPlaceCandidate(null)
      setPlaceLookupResults([])
      setPlaceLookupError(null)
      setIsPlaceLookupOpen(false)
    } catch {
      // The existing flow intentionally keeps write failures quiet.
    } finally {
      setIsApplyingPlaceLookup(false)
    }
  }

  async function saveReplanPreference() {
    setIsSavingPreference(true)
    setPreferenceMessage(null)
    try {
      const nextPreference = normalizePreferenceFormState(preferenceForm)
      const updated = await updateItineraryItem(item.id, {
        replanPreference: Object.keys(nextPreference).length > 0 ? nextPreference : undefined,
      })
      if (!updated) throw new Error('未找到行程点。')
      onItemUpdated(updated)
      setPreferenceMessage('已保存，后续重排会优先读取这些偏好。')
    } catch {
      setPreferenceMessage('保存失败，请稍后再试。')
    } finally {
      setIsSavingPreference(false)
    }
  }

  function togglePlaceLookup() {
    setIsPlaceLookupOpen((open) => {
      const next = !open
      if (!next) return next

      const nextQuery = placeLookupQuery.trim() || defaultPlaceLookupQuery
      if (!placeLookupQuery.trim()) setPlaceLookupQuery(nextQuery)
      const autoSearchKey = `${item.id}|${nextQuery}`
      if (nextQuery && placeLookupAutoSearchKeyRef.current !== autoSearchKey) {
        placeLookupAutoSearchKeyRef.current = autoSearchKey
        window.setTimeout(() => void searchPlaceCandidates(nextQuery), 0)
      }
      return next
    })
  }

  const primaryTicket = tickets[0]

  return (
    <>
      <div className="item-detail-content">
        <section className="item-detail-intro" data-testid="item-detail-core">
          <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-on-surface-variant">
            {transportDescription ? <Navigation className="size-4 shrink-0" /> : <Clock3 className="size-4 shrink-0" />}
            <span className="min-w-0 truncate">
              {transportDescription ? `${transportDescription} · 出发 ${describeItemTime(item)}` : describeItemTime(item)}
            </span>
          </p>
          <h1 className="mt-3 break-words text-[2rem] font-bold leading-[1.18] text-on-surface [overflow-wrap:anywhere]">{item.title}</h1>
          <p className="mt-3 min-w-0 break-words text-base leading-6 text-on-surface-variant [overflow-wrap:anywhere]">
            {item.address || item.locationName || '地点待补充'}
          </p>
          <a className="mt-6 inline-flex min-h-14 w-full min-w-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-base font-semibold text-on-primary transition active:scale-[0.99] tm-focus" href={buildGoogleMapsUrl(item)} rel="noreferrer" target="_blank">
            <Navigation className="size-5 shrink-0" />
            <span className="truncate">开始导航</span>
          </a>

          {isLoadingRelations ? (
            <div className="mt-4 h-[72px] animate-pulse rounded-lg bg-surface-container-high" />
          ) : (
            <button
              aria-label={primaryTicket ? '打开票据' : '添加票据'}
              className="item-detail-ticket-callout mt-4 tm-focus"
              onClick={() => {
                if (primaryTicket) setPreviewTicket(primaryTicket)
                else navigateTo('tickets', { tripId: trip.id, itemId: item.id })
              }}
              type="button"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface text-on-surface-variant"><Ticket className="size-5" /></span>
              <span className="min-w-0 flex-1 text-left">
                <strong className="block truncate text-sm font-semibold text-on-surface">{primaryTicket ? getTicketDisplayTitle(primaryTicket) : '暂无关联票据'}</strong>
                <small className="mt-0.5 block truncate text-xs text-on-surface-variant">
                  {primaryTicket ? (primaryTicket.note || `${getTicketCategoryLabel(primaryTicket)} · 已就绪`) : '为这个地点添加票据'}
                </small>
              </span>
              <span className="shrink-0 text-sm font-semibold text-primary">{primaryTicket ? '打开票据' : '添加票据'}</span>
              <ChevronRight className="size-4 shrink-0 text-primary" />
            </button>
          )}
        </section>

        <section className="item-detail-section">
          <h2 className="item-detail-section-title">现场操作</h2>
          <div className="mt-3 divide-y divide-outline-variant">
            <button className="item-detail-info-row w-full text-left tm-focus" data-testid="item-add-onsite-photo" onClick={() => navigateTo('tickets', { tripId: trip.id, itemId: item.id })} type="button">
              <Camera className="size-5 shrink-0 text-on-surface-variant" />
              <span className="min-w-0 flex-1 text-sm font-semibold text-on-surface">添加现场照片</span>
              <ChevronRight className="size-4 shrink-0 text-on-surface-variant" />
            </button>
            <button
              className="item-detail-info-row w-full text-left tm-focus"
              data-testid="item-record-note"
              onClick={() => navigateTo('item/edit', { tripId: trip.id, dayId: day.id, itemId: item.id, view: sourceView })}
              type="button"
            >
              <NotebookPen className="size-5 shrink-0 text-on-surface-variant" />
              <span className="min-w-0 flex-1 text-sm font-semibold text-on-surface">记录灵感</span>
              <ChevronRight className="size-4 shrink-0 text-on-surface-variant" />
            </button>
          </div>
        </section>

        <section className="item-detail-section">
          <h2 className="item-detail-section-title">地点信息</h2>
          <div className="mt-3 divide-y divide-outline-variant">
            <div className="item-detail-info-row">
              <MapPin className="mt-0.5 size-5 shrink-0 text-on-surface-variant" />
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-semibold text-on-surface [overflow-wrap:anywhere]">{item.locationName || '地点名称待补充'}</p>
                <p className="mt-0.5 break-words text-xs leading-5 text-on-surface-variant [overflow-wrap:anywhere]">{item.lat != null && item.lng != null ? '已定位，可直接导航' : '坐标待补充'}</p>
              </div>
            </div>
            <div className="item-detail-info-row">
              <Clock3 className="mt-0.5 size-5 shrink-0 text-on-surface-variant" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-on-surface">{formatDate(day.date)}</p>
                <p className="mt-0.5 text-xs text-on-surface-variant">{describeItemTime(item)}</p>
              </div>
            </div>
            <button className="item-detail-info-row w-full text-left tm-focus" data-testid="item-place-lookup-toggle" onClick={togglePlaceLookup} type="button">
              <Search className="size-5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 text-sm font-semibold text-on-surface">查找地点信息</span>
              <ChevronRight className={`size-4 shrink-0 text-on-surface-variant transition-transform ${isPlaceLookupOpen ? 'rotate-90' : ''}`} />
            </button>
          </div>

          {isPlaceLookupOpen ? (
            <div className="mt-3 space-y-3 border-t border-outline-variant pt-4" data-testid="item-place-lookup-panel">
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="min-w-0 flex-1">
                  <span className="sr-only">地点查询关键词</span>
                  <input
                    className="min-h-11 w-full min-w-0 rounded-lg border border-outline-variant bg-surface px-3 text-sm font-medium text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    data-testid="item-place-lookup-query"
                    maxLength={200}
                    onChange={(event) => {
                      placeLookupInFlightKeyRef.current = null
                      placeLookupCompletedKeyRef.current = null
                      setPlaceLookupQuery(event.currentTarget.value)
                    }}
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
                <Button className="shrink-0 px-3" data-testid="item-place-lookup-search" disabled={!placeLookupQuery.trim() || isPlaceLookupLoading} icon={<Search className="size-4" />} loading={isPlaceLookupLoading} onClick={() => void searchPlaceCandidates()}>
                  搜索
                </Button>
              </div>
              {placeLookupError ? <p className="rounded-lg bg-error-container px-3 py-2 text-sm font-medium text-on-error-container" data-testid="item-place-lookup-error">{placeLookupError}</p> : null}
              {placeLookupResults.length > 0 ? (
                <div className="divide-y divide-outline-variant" data-testid="item-place-lookup-results">
                  {placeLookupResults.map((candidate) => (
                    <button className="flex w-full min-w-0 items-start gap-3 py-3 text-left tm-focus" data-testid="item-place-lookup-result" key={candidate.placeId} onClick={() => setPendingPlaceCandidate(candidate)} type="button">
                      <MapPinned className="mt-0.5 size-5 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1">
                        <strong className="block break-words text-sm text-on-surface [overflow-wrap:anywhere]">{candidate.displayName}</strong>
                        <small className="mt-0.5 block break-words text-xs leading-5 text-on-surface-variant [overflow-wrap:anywhere]">{candidate.formattedAddress}</small>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="item-detail-section" data-testid="item-detail-tickets">
          <div className="flex items-center justify-between gap-3">
            <h2 className="item-detail-section-title">关联票据</h2>
            <button className="min-h-11 shrink-0 px-2 text-sm font-semibold text-primary tm-focus" data-testid="item-ticket-view-all" onClick={() => navigateTo('tickets', { tripId: trip.id, itemId: item.id })} type="button">查看全部</button>
          </div>
          {isLoadingRelations ? (
            <div className="mt-3 h-16 animate-pulse rounded-lg bg-surface-container-high" />
          ) : tickets.length === 0 ? (
            <button className="item-detail-info-row mt-2 w-full border-y border-outline-variant text-left tm-focus" onClick={() => navigateTo('tickets', { tripId: trip.id, itemId: item.id })} type="button">
              <Ticket className="size-5 shrink-0 text-on-surface-variant" />
              <span className="min-w-0 flex-1 text-sm text-on-surface-variant">暂无关联票据</span>
              <span className="text-sm font-semibold text-primary">添加</span>
              <ChevronRight className="size-4 shrink-0 text-on-surface-variant" />
            </button>
          ) : (
            <div className="mt-2 divide-y divide-outline-variant border-y border-outline-variant">
              {tickets.slice(0, 3).map((ticket) => (
                <button className="flex min-h-20 w-full min-w-0 items-center gap-3 py-2 text-left tm-focus" data-testid="item-ticket-entry" key={ticket.id} onClick={() => setPreviewTicket(ticket)} type="button">
                  <TicketThumbnail className="h-16 w-12 shrink-0" ticket={ticket} />
                  <span className="min-w-0 flex-1">
                    <strong className="line-clamp-2 break-words text-sm leading-5 text-on-surface [overflow-wrap:anywhere]">{getTicketDisplayTitle(ticket)}</strong>
                    <small className="mt-1 block break-words text-xs text-on-surface-variant [overflow-wrap:anywhere]">{getTicketCategoryLabel(ticket)} · {ticket.fileType === 'pdf' ? 'PDF' : ticket.fileType === 'image' ? '图片' : '文件'}</small>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-on-surface-variant" />
                </button>
              ))}
            </div>
          )}
        </section>

        {item.notes ? (
          <section className="item-detail-section">
            <h2 className="item-detail-section-title">备注</h2>
            <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-on-surface [overflow-wrap:anywhere]">{item.notes}</p>
          </section>
        ) : null}

        <Collapsible className="item-detail-more" testId="item-detail-more" title="更多">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <a className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-outline-variant text-sm font-semibold text-on-surface tm-focus" href={buildAppleMapsUrl(item)} rel="noreferrer" target="_blank"><Navigation className="size-4" />Apple 地图</a>
              <a className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-outline-variant text-sm font-semibold text-on-surface tm-focus" href={buildGoogleMapsUrl(item)} rel="noreferrer" target="_blank"><ExternalLink className="size-4" />Google 地图</a>
            </div>

            <ItemContentEnrichmentCard
              day={day}
              item={item}
              onApplied={async () => {
                const updated = await getItineraryItem(item.id)
                if (updated) onItemUpdated(updated)
                await loadRelations()
              }}
              trip={trip}
            />

            <details className="rounded-lg border border-outline-variant">
              <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm font-semibold text-on-surface"><ShieldCheck className="size-4 text-primary" />重排偏好</summary>
              <div className="space-y-3 border-t border-outline-variant p-3" data-testid="item-replan-preferences">
                <div className="grid gap-3 sm:grid-cols-2">
                  <PreferenceSelect label="移动性" onChange={(value) => setPreferenceForm((current) => ({ ...current, flexibility: value }))} options={[{ label: '自动判断', value: '' }, { label: formatFlexibility('fixed'), value: 'fixed' }, { label: formatFlexibility('movable'), value: 'movable' }, { label: formatFlexibility('optional'), value: 'optional' }]} value={preferenceForm.flexibility} />
                  <PreferenceSelect label="优先级" onChange={(value) => setPreferenceForm((current) => ({ ...current, priority: value }))} options={[{ label: '自动判断', value: '' }, { label: formatPriority('must_keep'), value: 'must_keep' }, { label: formatPriority('high'), value: 'high' }, { label: formatPriority('normal'), value: 'normal' }, { label: formatPriority('low'), value: 'low' }]} value={preferenceForm.priority} />
                  <PreferenceSelect label="天气" onChange={(value) => setPreferenceForm((current) => ({ ...current, weatherSuitability: value }))} options={[{ label: '未设置', value: '' }, { label: formatWeather('any_weather'), value: 'any_weather' }, { label: formatWeather('avoid_rain'), value: 'avoid_rain' }, { label: formatWeather('indoor_preferred'), value: 'indoor_preferred' }]} value={preferenceForm.weatherSuitability} />
                  <PreferenceSelect label="体力" onChange={(value) => setPreferenceForm((current) => ({ ...current, mobilitySuitability: value }))} options={[{ label: '未设置', value: '' }, { label: formatMobility('normal'), value: 'normal' }, { label: formatMobility('easy'), value: 'easy' }, { label: formatMobility('demanding'), value: 'demanding' }]} value={preferenceForm.mobilitySuitability} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <PreferenceNumber label="最短停留（分钟）" onChange={(value) => setPreferenceForm((current) => ({ ...current, minimumStayMinutes: value }))} value={preferenceForm.minimumStayMinutes} />
                  <PreferenceNumber label="前后缓冲（分钟）" onChange={(value) => setPreferenceForm((current) => ({ ...current, bufferMinutes: value }))} value={preferenceForm.bufferMinutes} />
                </div>
                <Button icon={<Save className="size-4" />} loading={isSavingPreference} onClick={() => void saveReplanPreference()} variant="secondary">保存偏好</Button>
                {preferenceMessage ? <p className="text-xs text-on-surface-variant">{preferenceMessage}</p> : null}
              </div>
            </details>

            <div className="grid grid-cols-2 gap-2">
              <button className="flex min-h-12 min-w-0 items-center gap-2 rounded-lg border border-outline-variant px-3 text-left disabled:opacity-45 tm-focus" data-testid="item-field-previous-stop" disabled={!previousItem} onClick={() => previousItem && navigateTo('item', { tripId: trip.id, dayId: day.id, itemId: previousItem.id, view: sourceView })} type="button">
                <ArrowLeft className="size-4 shrink-0" /><span className="min-w-0 truncate text-sm">{previousItem?.title || '上一站'}</span>
              </button>
              <button className="flex min-h-12 min-w-0 items-center justify-end gap-2 rounded-lg border border-outline-variant px-3 text-right disabled:opacity-45 tm-focus" data-testid="item-field-next-stop" disabled={!nextItem} onClick={() => nextItem && navigateTo('item', { tripId: trip.id, dayId: day.id, itemId: nextItem.id, view: sourceView })} type="button">
                <span className="min-w-0 truncate text-sm">{nextItem?.title || '下一站'}</span><ArrowRight className="size-4 shrink-0" />
              </button>
            </div>

            <Button className="w-full" icon={<Trash2 className="size-4" />} onClick={() => setIsDeleteConfirmOpen(true)} variant="destructive">删除行程点</Button>
          </div>
        </Collapsible>
      </div>

      {previewTicket ? <TicketPreview key={previewTicket.id} onChangeTicket={setPreviewTicket} onClose={() => setPreviewTicket(null)} ticket={previewTicket} tickets={tickets} /> : null}

      <ConfirmDialog
        body="仅移除行程点；票据、账本和订单保留，可撤销。"
        confirmLabel="删除行程点"
        loading={isDeleting}
        onCancel={() => { if (!isDeleting) setIsDeleteConfirmOpen(false) }}
        onConfirm={() => void confirmDeleteItem()}
        open={isDeleteConfirmOpen}
        title={`确认删除「${item.title}」吗？`}
      />

      <ConfirmDialog
        body={pendingPlaceCandidate ? `将当前行程点更新为：\n${pendingPlaceCandidate.displayName}\n${pendingPlaceCandidate.formattedAddress}${isValidPlaceLocation(pendingPlaceCandidate.location) ? `\n坐标：${pendingPlaceCandidate.location.lat.toFixed(5)}, ${pendingPlaceCandidate.location.lng.toFixed(5)}` : ''}` : ''}
        confirmLabel="更新地点"
        icon={<MapPinned className="size-5" />}
        loading={isApplyingPlaceLookup}
        onCancel={() => { if (!isApplyingPlaceLookup) setPendingPlaceCandidate(null) }}
        onConfirm={() => void confirmApplyPlaceLookup()}
        open={Boolean(pendingPlaceCandidate)}
        testId="item-place-lookup-confirm-dialog"
        title="确认使用这个地点吗？"
      />
    </>
  )
}

export function ItemHeaderMoreMenu({
  day,
  item,
  onClose,
  open,
  sourceView,
  trip,
}: {
  day: Day
  item: ItineraryItem
  onClose: () => void
  open: boolean
  sourceView: 'schedule' | 'map'
  trip: Trip
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()

  useModalAccessibility({ containerRef: dialogRef, initialFocusRef: closeButtonRef, onClose, open })
  if (!open) return null

  return (
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      className="fixed inset-0 z-[120] flex items-end justify-center bg-surface-dim/24 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm"
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
      ref={dialogRef}
      role="dialog"
      tabIndex={-1}
    >
      <div className="w-full max-w-[430px] rounded-lg bg-surface p-2 shadow-[0_-10px_28px_rgba(38,53,76,0.14)]" data-testid="item-header-more-menu">
        <div className="flex min-h-12 items-center justify-between px-3">
          <h2 className="text-sm font-semibold text-on-surface" id={titleId}>地点操作</h2>
          <button aria-label="关闭地点操作" className="flex size-11 items-center justify-center rounded-lg text-on-surface-variant tm-focus" onClick={onClose} ref={closeButtonRef} type="button"><X className="size-4" /></button>
        </div>
        <ItemHeaderMenuButton icon={<Pencil className="size-4" />} label="编辑行程点" onClick={() => navigateTo('item/edit', { tripId: trip.id, dayId: day.id, itemId: item.id, view: sourceView })} />
        <ItemHeaderMenuButton icon={<Ticket className="size-4" />} label="全部票据" onClick={() => navigateTo('tickets', { tripId: trip.id, itemId: item.id })} />
        <a className="item-header-menu-row tm-focus" href={buildAppleMapsUrl(item)} rel="noreferrer" target="_blank"><span className="item-header-menu-icon"><Navigation className="size-4" /></span><span className="min-w-0 flex-1 truncate">Apple 地图</span><ExternalLink className="size-4 shrink-0 text-on-surface-variant" /></a>
        <a className="item-header-menu-row tm-focus" href={buildGoogleMapsUrl(item)} rel="noreferrer" target="_blank"><span className="item-header-menu-icon"><Navigation className="size-4" /></span><span className="min-w-0 flex-1 truncate">Google 地图</span><ExternalLink className="size-4 shrink-0 text-on-surface-variant" /></a>
      </div>
    </div>
  )
}

function ItemHeaderMenuButton({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button className="item-header-menu-row tm-focus" onClick={onClick} type="button">
      <span className="item-header-menu-icon">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <ChevronRight className="size-4 shrink-0 text-on-surface-variant" />
    </button>
  )
}

function buildPlaceLookupQuery(item: ItineraryItem) {
  const parts = [item.locationName, item.address, item.title]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
  return Array.from(new Set(parts)).join(' ')
}

type PreferenceFormState = {
  bufferMinutes: string
  flexibility: '' | ReplanFlexibility
  minimumStayMinutes: string
  mobilitySuitability: '' | ReplanMobilitySuitability
  priority: '' | ReplanPriority
  weatherSuitability: '' | ReplanWeatherSuitability
}

function buildPreferenceFormState(preference?: ItineraryReplanPreference): PreferenceFormState {
  return {
    bufferMinutes: preference?.bufferMinutes?.toString() ?? '',
    flexibility: preference?.flexibility ?? '',
    minimumStayMinutes: preference?.minimumStayMinutes?.toString() ?? '',
    mobilitySuitability: preference?.mobilitySuitability ?? '',
    priority: preference?.priority ?? '',
    weatherSuitability: preference?.weatherSuitability ?? '',
  }
}

function normalizePreferenceFormState(form: PreferenceFormState): ItineraryReplanPreference {
  const preference: ItineraryReplanPreference = {}
  if (form.flexibility) preference.flexibility = form.flexibility
  if (form.priority) preference.priority = form.priority
  if (form.weatherSuitability) preference.weatherSuitability = form.weatherSuitability
  if (form.mobilitySuitability) preference.mobilitySuitability = form.mobilitySuitability
  const minimumStayMinutes = parsePreferenceMinutes(form.minimumStayMinutes, 720)
  if (minimumStayMinutes != null) preference.minimumStayMinutes = minimumStayMinutes
  const bufferMinutes = parsePreferenceMinutes(form.bufferMinutes, 240)
  if (bufferMinutes != null) preference.bufferMinutes = bufferMinutes
  return preference
}

function parsePreferenceMinutes(value: string, max: number) {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const numberValue = Number(trimmed)
  if (!Number.isFinite(numberValue) || numberValue <= 0) return undefined
  return Math.min(max, Math.round(numberValue))
}

function PreferenceSelect<T extends string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string
  onChange: (value: T | '') => void
  options: Array<{ label: string; value: T | '' }>
  value: T | ''
}) {
  return (
    <label className="block min-w-0 text-xs font-semibold text-on-surface-variant">
      {label}
      <select className="mt-1 min-h-11 w-full rounded-xl border border-outline-variant/40 bg-surface px-3 text-sm font-medium text-on-surface outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10" onChange={(event) => onChange(event.currentTarget.value as T | '')} value={value}>
        {options.map((option) => <option key={option.value || 'empty'} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  )
}

function PreferenceNumber({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string }) {
  return (
    <label className="block min-w-0 text-xs font-semibold text-on-surface-variant">
      {label}
      <input className="mt-1 min-h-11 w-full rounded-xl border border-outline-variant/40 bg-surface px-3 text-sm font-medium text-on-surface outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10" min={0} onChange={(event) => onChange(event.currentTarget.value)} type="number" value={value} />
    </label>
  )
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
