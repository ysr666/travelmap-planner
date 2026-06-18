import { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  Info,
  Map,
  Clock3,
  ExternalLink,
  MapPin,
  MapPinned,
  Navigation,
  Save,
  Search,
  ShieldCheck,
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
import { ItemContentEnrichmentCard } from '../components/ai/TripContentEnrichmentPanel'
import {
  buildAppleMapsUrl,
  buildGoogleMapsUrl,
  hasValidCoordinates,
} from '../lib/mapLinks'
import { describeItemTime, describePreviousTransport } from '../lib/itinerary'
import { formatDate } from '../lib/dates'
import { navigateTo } from '../lib/routes'
import {
  getTicketCategoryLabel,
  getTicketDisplayTitle,
} from '../lib/tickets'
import {
  formatFlexibility,
  formatMobility,
  formatPriority,
  formatWeather,
} from '../lib/ai/globalAiCommandRouter'
import type { Day, ItineraryItem, ItineraryReplanPreference, ReplanFlexibility, ReplanMobilitySuitability, ReplanPriority, ReplanWeatherSuitability, TicketMeta, Trip } from '../types'
import { Button } from '../components/ui/Button'
import { getPlaceHeroVisual } from '../lib/placeHeroVisual'
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
} from '../lib/ai/providerProxyContract'

type ItemDetailContentProps = {
  trip: Trip
  day: Day
  item: ItineraryItem
  onItemDeleted: () => void
  onItemUpdated: (item: ItineraryItem) => void
  onBack: () => void
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
          setError(caught instanceof Error ? (caught as Error).message : '加载行程点失败')
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
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden" data-testid="item-detail-page">
      <header className="absolute inset-x-0 top-0 z-50 flex h-16 items-center justify-between border-b-[0.5px] border-outline-variant/30 bg-surface/70 px-4 backdrop-blur-xl">
        <button
          aria-label="返回上一页"
          className="flex size-11 items-center justify-center rounded-full text-primary transition-colors hover:bg-surface-container-high/50 active:scale-95"
          onClick={goBackToDay}
          type="button"
        >
          <ArrowLeft className="size-5" />
        </button>
        <div className="font-headline-md text-headline-md font-bold text-on-surface">详情</div>
        <button
          aria-label="编辑行程点"
          className="flex size-11 items-center justify-center rounded-full text-primary transition-colors hover:bg-surface-container-high/50 active:scale-95"
          onClick={() => navigateTo('item/edit', { tripId: trip.id, dayId: day.id, itemId: item.id, view: sourceView })}
          type="button"
        >
          <span className="text-sm font-semibold">编辑</span>
        </button>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-32 pt-16 app-scrollbar">
        <div className="mx-auto max-w-3xl space-y-8">
          <ItemDetailContent
            day={day}
            item={item}
            key={item.id}
            onBack={goBackToDay}
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

export function ItemDetailContent({ trip, day, item, onItemDeleted, onItemUpdated, onBack, sourceView }: ItemDetailContentProps) {
  const [dayItems, setDayItems] = useState<ItineraryItem[]>([])
  const [tickets, setTickets] = useState<TicketMeta[]>([])
  const [previewTicket, setPreviewTicket] = useState<TicketMeta | null>(null)
  const [isLoadingRelations, setIsLoadingRelations] = useState(true)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)
  const [isPlaceLookupOpen, setIsPlaceLookupOpen] = useState(false)
  const [placeLookupQuery, setPlaceLookupQuery] = useState(() => buildPlaceLookupQuery(item))
  const [placeLookupResults, setPlaceLookupResults] = useState<ProviderProxyPlaceLookupResult[]>([])
  const [placeLookupError, setPlaceLookupError] = useState<string | null>(null)
  const [isPlaceLookupLoading, setIsPlaceLookupLoading] = useState(false)
  const [pendingPlaceCandidate, setPendingPlaceCandidate] = useState<ProviderProxyPlaceLookupResult | null>(null)
  const [isApplyingPlaceLookup, setIsApplyingPlaceLookup] = useState(false)
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
    } catch { // silently ignore
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

  async function confirmDeleteItem() {
    setIsDeleting(true)
    try {
      await deleteItineraryItemCascade(item.id)
      setIsDeleteConfirmOpen(false)
      onItemDeleted()
    } catch {
      // silently ignore
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
    } catch {
      // silently ignore
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

  const heroVisual = getPlaceHeroVisual(item)

  return (
    <>
      {/* Hero Header - matches reference _1/code.html */}
      <section className="relative w-full h-[320px] md:h-[400px] -mx-4" data-testid="item-detail-hero">
        <div className={`absolute inset-0 bg-gradient-to-br ${heroVisual.gradientClass}`} />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
        <div className="absolute bottom-6 left-gutter right-gutter">
          <h1 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface mb-2">{item.title}</h1>
          {item.locationName ? (
            <div className="inline-flex items-center gap-2 text-on-surface-variant font-body-md text-body-md bg-surface/50 backdrop-blur-md px-3 py-1.5 rounded-full border border-outline-variant/30">
              <Clock3 className="size-4" />
              <span>{describeItemTime(item)} · {item.locationName}</span>
            </div>
          ) : null}
        </div>
      </section>

      {/* 基础信息 section - matches reference */}
      <section data-testid="item-detail-core">
        <h2 className="font-label-sm text-label-sm text-on-surface-variant mb-3 pl-1 uppercase tracking-wider">基础信息</h2>
        <div className="bg-surface-container rounded-xl border border-outline-variant/30 overflow-hidden shadow-sm">
          {/* Location */}
          <div className="flex items-center p-4 border-b border-outline-variant/30 hover:bg-surface-container-high transition-colors cursor-pointer group active:scale-[0.99]">
            <div className="w-10 h-10 rounded-full bg-primary-container/20 flex items-center justify-center text-primary mr-4 group-hover:bg-primary-container/30 transition-colors">
              <MapPin className="size-5" />
            </div>
            <div className="flex-1">
              <div className="font-body-lg text-body-lg text-on-surface">{item.locationName || '地点未填写'}</div>
              <div className="font-body-md text-body-md text-on-surface-variant mt-0.5">{item.address || ''}</div>
              <div className="font-label-sm text-label-sm text-on-surface-variant mt-1">
                {hasCoordinates ? `${item.lat?.toFixed(5)}, ${item.lng?.toFixed(5)}` : '暂无坐标'}
              </div>
            </div>
            <ChevronRight className="size-5 text-outline-variant group-hover:text-primary transition-colors" />
          </div>
          {/* Time */}
          <div className="flex items-center p-4 border-b border-outline-variant/30 hover:bg-surface-container-high transition-colors group active:scale-[0.99]">
            <div className="w-10 h-10 rounded-full bg-surface-container-highest flex items-center justify-center text-on-surface-variant mr-4">
              <Clock3 className="size-5" />
            </div>
            <div className="flex-1">
              <div className="font-body-lg text-body-lg text-on-surface">{formatDate(day.date)}</div>
              <div className="font-body-md text-body-md text-on-surface-variant mt-0.5">{describeItemTime(item)}</div>
            </div>
          </div>
          {/* Notes */}
          {item.notes ? (
            <div className="flex items-start p-4 hover:bg-surface-container-high transition-colors">
              <div className="w-10 h-10 rounded-full bg-surface-container-highest flex items-center justify-center text-on-surface-variant mr-4 shrink-0">
                <Info className="size-5" />
              </div>
              <div className="flex-1 pt-2">
                <div className="font-body-md text-body-md text-on-surface-variant leading-relaxed whitespace-pre-wrap break-words">
                  {item.notes}
                </div>
              </div>
            </div>
          ) : null}
          {/* Place Lookup Toggle */}
          <div className="p-4 border-t border-outline-variant/30">
            <Button
              className="w-full min-h-11"
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
          </div>
        </div>
      </section>

      <section data-testid="item-replan-preferences">
        <h2 className="font-label-sm text-label-sm text-on-surface-variant mb-3 pl-1 uppercase tracking-wider">重排偏好</h2>
        <div className="space-y-3 rounded-xl border border-outline-variant/30 bg-surface-container p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-container/20 text-primary">
              <ShieldCheck className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-body-lg text-body-lg font-semibold text-on-surface">给自适应重排看的轻量规则</p>
              <p className="mt-1 text-sm leading-6 tm-muted">不改变当前行程；只影响之后遇到延误、天气或跳过时，系统怎样保留或移动这个点。</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <PreferenceSelect
              label="移动性"
              onChange={(value) => setPreferenceForm((current) => ({ ...current, flexibility: value }))}
              options={[
                { label: '自动判断', value: '' },
                { label: formatFlexibility('fixed'), value: 'fixed' },
                { label: formatFlexibility('movable'), value: 'movable' },
                { label: formatFlexibility('optional'), value: 'optional' },
              ]}
              value={preferenceForm.flexibility}
            />
            <PreferenceSelect
              label="优先级"
              onChange={(value) => setPreferenceForm((current) => ({ ...current, priority: value }))}
              options={[
                { label: '自动判断', value: '' },
                { label: formatPriority('must_keep'), value: 'must_keep' },
                { label: formatPriority('high'), value: 'high' },
                { label: formatPriority('normal'), value: 'normal' },
                { label: formatPriority('low'), value: 'low' },
              ]}
              value={preferenceForm.priority}
            />
            <PreferenceSelect
              label="天气"
              onChange={(value) => setPreferenceForm((current) => ({ ...current, weatherSuitability: value }))}
              options={[
                { label: '未设置', value: '' },
                { label: formatWeather('any_weather'), value: 'any_weather' },
                { label: formatWeather('avoid_rain'), value: 'avoid_rain' },
                { label: formatWeather('indoor_preferred'), value: 'indoor_preferred' },
              ]}
              value={preferenceForm.weatherSuitability}
            />
            <PreferenceSelect
              label="体力"
              onChange={(value) => setPreferenceForm((current) => ({ ...current, mobilitySuitability: value }))}
              options={[
                { label: '未设置', value: '' },
                { label: formatMobility('normal'), value: 'normal' },
                { label: formatMobility('easy'), value: 'easy' },
                { label: formatMobility('demanding'), value: 'demanding' },
              ]}
              value={preferenceForm.mobilitySuitability}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <PreferenceNumber
              label="最短停留（分钟）"
              onChange={(value) => setPreferenceForm((current) => ({ ...current, minimumStayMinutes: value }))}
              value={preferenceForm.minimumStayMinutes}
            />
            <PreferenceNumber
              label="前后缓冲（分钟）"
              onChange={(value) => setPreferenceForm((current) => ({ ...current, bufferMinutes: value }))}
              value={preferenceForm.bufferMinutes}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button className="min-h-11 px-3 text-xs" icon={<Save className="size-4" />} loading={isSavingPreference} onClick={() => void saveReplanPreference()} variant="secondary">保存偏好</Button>
            {preferenceMessage ? <span className="text-xs font-semibold text-on-surface-variant">{preferenceMessage}</span> : null}
          </div>
        </div>
      </section>

      <section data-testid="item-detail-navigation">
        <h2 className="font-label-sm text-label-sm text-on-surface-variant mb-3 pl-1 uppercase tracking-wider">地图导航</h2>
        <div className="rounded-xl border border-outline-variant/30 bg-surface-container p-4 shadow-sm">
          {hasCoordinates ? (
            <div className="grid grid-cols-2 gap-3">
              <a
                className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary text-on-primary font-label-sm text-label-sm transition active:scale-[0.98]"
                href={buildAppleMapsUrl(item)}
                rel="noreferrer"
                target="_blank"
              >
                <Navigation className="size-4" />
                Apple 地图
              </a>
              <a
                className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-outline-variant/40 bg-surface-container-high text-primary font-label-sm text-label-sm transition active:scale-[0.98]"
                href={buildGoogleMapsUrl(item)}
                rel="noreferrer"
                target="_blank"
              >
                <ExternalLink className="size-4" />
                Google 地图
              </a>
            </div>
          ) : (
            <p className="font-body-md text-body-md text-on-surface-variant">
              无法从这里打开外部地图导航。请先补充这个行程点的坐标。
            </p>
          )}
        </div>
      </section>

      {/* Place Lookup Panel */}
      {isPlaceLookupOpen ? (
        <section className="space-y-3 rounded-xl bg-surface-container px-4 py-3 border border-outline-variant/30" data-testid="item-place-lookup-panel">
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="min-w-0 flex-1">
              <span className="sr-only">地点查询关键词</span>
              <input
                className="min-h-11 w-full min-w-0 rounded-xl border border-outline-variant/30 bg-white px-3 text-sm font-medium text-on-surface outline-none transition placeholder:text-outline focus:border-sky-300 focus:ring-2 focus:ring-sky-100 dark:border-outline-variant/30 dark:bg-surface-dim dark:text-on-surface dark:focus:border-sky-700 dark:focus:ring-sky-900/40"
                data-testid="item-place-lookup-query"
                maxLength={200}
                onChange={(event) => setPlaceLookupQuery(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') { event.preventDefault(); void searchPlaceCandidates() }
                }}
                placeholder="地点名称或地址"
                value={placeLookupQuery}
              />
            </label>
            <Button className="shrink-0 px-3" data-testid="item-place-lookup-search" disabled={!placeLookupQuery.trim()} icon={<Search className="size-4" />} loading={isPlaceLookupLoading} onClick={() => void searchPlaceCandidates()} variant="primary">搜索</Button>
          </div>
          {placeLookupError ? <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-sm font-medium leading-5 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300" data-testid="item-place-lookup-error">{placeLookupError}</div> : null}
          {placeLookupResults.length > 0 ? (
            <div className="space-y-2" data-testid="item-place-lookup-results">
              {placeLookupResults.map((candidate) => (
                <button className="flex w-full min-w-0 items-start gap-3 rounded-xl bg-white px-3 py-3 text-left ring-1 ring-outline-variant/30 transition hover:ring-sky-200 active:scale-[0.99] tm-focus dark:bg-surface-dim/70 dark:ring-outline-variant/30 dark:hover:ring-sky-800" data-testid="item-place-lookup-result" key={candidate.placeId} onClick={() => setPendingPlaceCandidate(candidate)} type="button">
                  <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-container/20 text-primary"><MapPinned className="size-5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-body-lg text-body-lg text-on-surface">{candidate.displayName}</span>
                    <span className="mt-0.5 block break-words font-body-md text-body-md text-on-surface-variant">{candidate.formattedAddress}</span>
                    {candidate.googleMapsUri ? <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary"><ExternalLink className="size-3" />Google Maps</span> : null}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <ItemContentEnrichmentCard
        day={day}
        item={item}
        onApplied={async () => {
          const updated = await getItineraryItem(item.id)
          if (updated) {
            onItemUpdated(updated)
          }
          await loadRelations()
        }}
        trip={trip}
      />

      {/* 交通 section - matches reference */}
      {transportDescription ? (
        <section>
          <h2 className="font-label-sm text-label-sm text-on-surface-variant mb-3 pl-1 uppercase tracking-wider">交通</h2>
          <div className="bg-surface-container rounded-xl border border-outline-variant/30 overflow-hidden shadow-sm">
            <div className="flex items-center p-4 hover:bg-surface-container-high transition-colors">
              <div className="w-10 h-10 rounded-lg bg-surface-container-highest flex items-center justify-center text-on-surface-variant mr-4 shrink-0">
                <Navigation className="size-5" />
              </div>
              <div className="flex-1">
                <div className="font-body-lg text-body-lg text-on-surface">从上一站到此处</div>
                <div className="font-body-md text-body-md text-on-surface-variant mt-0.5">{transportDescription}</div>
              </div>
              {hasCoordinates ? (
                <a className="inline-flex min-h-11 items-center rounded-xl px-3 font-body-md text-body-md text-primary tm-focus" href={buildGoogleMapsUrl(item)} rel="noreferrer" target="_blank">导航</a>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {/* 票据 section - horizontal scroll cards */}
      <section data-testid="item-detail-tickets">
        <div className="flex justify-between items-end mb-3 pl-1">
          <div>
            <h2 className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">现场票据</h2>
            {!isLoadingRelations ? (
              <p className="mt-1 font-body-md text-body-md text-on-surface-variant">{tickets.length} 张已绑定</p>
            ) : null}
          </div>
          <button
            className="flex min-h-11 items-center gap-1 rounded-xl px-3 text-primary font-label-sm text-label-sm transition-opacity active:opacity-70 tm-focus"
            data-testid="item-ticket-view-all"
            onClick={() => navigateTo('tickets', { tripId: trip.id })}
            type="button"
          >
            查看全部 {tickets.length > 3 ? <span>+{tickets.length - 3}</span> : null}<ChevronRight className="size-4" />
          </button>
        </div>
        {isLoadingRelations ? (
          <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2">
            <div className="min-w-[260px] h-40 animate-pulse rounded-xl bg-surface-container" />
            <div className="min-w-[260px] h-40 animate-pulse rounded-xl bg-surface-container" />
          </div>
        ) : tickets.length === 0 ? (
          <div className="bg-surface-container rounded-xl border border-outline-variant/30 p-4 text-center">
            <div className="font-body-md text-body-md text-on-surface-variant">暂无绑定票据</div>
          </div>
        ) : (
          <div className="flex overflow-x-auto no-scrollbar gap-4 pb-2 -mx-4 px-4 md:mx-0 md:px-0">
            {tickets.slice(0, 3).map((ticket) => (
              <button
                key={ticket.id}
                className="ticket-cutout relative min-w-[260px] flex-shrink-0 bg-surface-container-high border border-outline-variant/30 rounded-xl overflow-hidden shadow-lg active:scale-[0.98] transition-transform duration-200 cursor-pointer text-left"
                data-testid="item-ticket-entry"
                onClick={() => setPreviewTicket(ticket)}
                type="button"
              >
                <div className="h-2 w-full bg-primary-container" />
                <div className="p-4">
                  <div className="flex justify-between items-start mb-4">
                    <div className="w-10 h-10 rounded bg-primary-container/20 flex items-center justify-center text-primary">
                      <Ticket className="size-5" />
                    </div>
                    <span className="px-2 py-1 rounded bg-secondary-container/20 text-secondary-fixed-dim font-label-sm text-[11px] border border-secondary-container/30">已生效</span>
                  </div>
                  <h3 className="font-headline-md text-headline-md text-on-surface mb-1">{getTicketDisplayTitle(ticket)}</h3>
                  <p className="font-body-md text-body-md text-on-surface-variant mb-6">{getTicketCategoryLabel(ticket)} · {ticket.fileType === 'pdf' ? 'PDF 文件' : ticket.fileType === 'image' ? '图片' : '文件'}</p>
                  <div className="border-t border-dashed border-outline-variant/50 w-full my-3" />
                  <div className="flex justify-between items-center pt-1">
                    <span className="font-body-md text-body-md text-on-surface-variant">点击预览</span>
                    <ChevronRight className="size-4 text-outline-variant" />
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      <section>
        <Button
          className="w-full"
          icon={<Trash2 className="size-4" />}
          onClick={() => setIsDeleteConfirmOpen(true)}
          variant="destructive"
        >
          删除行程点
        </Button>
      </section>

      {/* Bottom Action Area - matches reference: 3 buttons */}
      <div className="fixed bottom-0 left-1/2 z-50 flex w-full max-w-[600px] -translate-x-1/2 items-center justify-between gap-3 border-t-[0.5px] border-outline-variant/30 bg-surface-dim/90 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-xl">
        <button
          aria-label="上一项"
          className="flex items-center justify-center h-12 w-12 rounded-xl bg-surface-container border border-outline-variant/30 text-on-surface-variant active:scale-90 transition-all hover:text-on-surface"
          data-testid="item-previous-button"
          disabled={!previousItem}
          onClick={() => previousItem && navigateTo('item', { tripId: trip.id, dayId: day.id, itemId: previousItem.id, view: sourceView })}
          type="button"
        >
          <ArrowLeft className="size-5" />
        </button>
        <button
          aria-label={sourceView === 'map' ? '返回地图' : '返回日程'}
          className="flex-1 h-12 bg-primary-container text-on-primary-container font-headline-md text-[16px] rounded-xl flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-[0_0_20px_rgba(62,144,255,0.2)]"
          onClick={onBack}
          type="button"
        >
          <Map className="size-5" />
          {sourceView === 'map' ? '返回地图' : '返回日程'}
        </button>
        <button
          aria-label="下一项"
          className="flex items-center justify-center h-12 w-12 rounded-xl bg-surface-container border border-outline-variant/30 text-on-surface-variant active:scale-90 transition-all hover:text-on-surface"
          data-testid="item-next-button"
          disabled={!nextItem}
          onClick={() => nextItem && navigateTo('item', { tripId: trip.id, dayId: day.id, itemId: nextItem.id, view: sourceView })}
          type="button"
        >
          <ArrowLeft className="size-5 rotate-180" />
        </button>
      </div>

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
    </>
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
      <select
        className="mt-1 min-h-11 w-full rounded-xl border border-outline-variant/40 bg-surface px-3 text-sm font-medium text-on-surface outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
        onChange={(event) => onChange(event.currentTarget.value as T | '')}
        value={value}
      >
        {options.map((option) => <option key={option.value || 'empty'} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  )
}

function PreferenceNumber({
  label,
  onChange,
  value,
}: {
  label: string
  onChange: (value: string) => void
  value: string
}) {
  return (
    <label className="block min-w-0 text-xs font-semibold text-on-surface-variant">
      {label}
      <input
        className="mt-1 min-h-11 w-full rounded-xl border border-outline-variant/40 bg-surface px-3 text-sm font-medium text-on-surface outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
        min={0}
        onChange={(event) => onChange(event.currentTarget.value)}
        type="number"
        value={value}
      />
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

function normalizeSourceView(value: string | null): 'schedule' | 'map' {
  return value === 'map' ? 'map' : 'schedule'
}
