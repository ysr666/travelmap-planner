import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft, CalendarDays, CheckCircle2, ChevronRight, HardDriveDownload, Loader2, NotebookText, RotateCw, Route as RouteIcon, Ticket } from 'lucide-react'
import { listItemsByDay, listTicketsByTrip } from '../db'
import { TripCover } from '../components/trip/TripCover'
import { TripMoreMenu } from '../components/trip/TripMoreMenu'
import { TripMapPreview } from '../components/trip/TripMapPreview'
import { TravelBackupPanel } from '../components/trip/TravelBackupPanel'
import { TripNav } from '../components/AppShell'
import { TripBriefCard } from '../components/ai/TripBriefCard'
import { AutoSnapshotBackupStatus } from '../components/cloud/AutoSnapshotBackupStatus'
import { CloudSnapshotCheckPrompts } from '../components/cloud/CloudSnapshotCheckPrompts'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Collapsible } from '../components/ui/Collapsible'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { EmptyState } from '../components/ui/EmptyState'
import { SkeletonLine } from '../components/ui/SkeletonLine'
import { useTripData } from '../hooks/useTripData'
import { ensureDaysForTrip, formatDate, formatDateKey, formatDateRange } from '../lib/dates'
import { formatChineseDayOrdinal } from '../lib/dayOrdinal'
import { buildTripContext } from '../lib/aiTripContext'
import { getRouteParams, navigateTo } from '../lib/routes'
import { analyzeTripContext } from '../lib/tripCheck'
import { getStoredTravelProfile } from '../lib/travelProfile'
import { buildTripBrief } from '../lib/travelBrief'
import { generateRoutePreviewsForTrip, type RouteGenerationBatchResult } from '../lib/routeGeneration'
import { getPersistentRouteProvider, loadTripRoutePreparation, type TripRoutePreparation } from '../lib/routePreparation'
import { ROUTE_CACHE_CHANGED_EVENT } from '../lib/routeCache'
import { getRoutingConfig, ROUTING_CONFIG_CHANGED_EVENT } from '../lib/routing'
import type { Day, TicketMeta } from '../types'

export function TripWorkspacePage() {
  const params = getRouteParams()
  const tripId = params.get('tripId')
  const requestedDayId = params.get('dayId')
  const requestedView = params.get('view')
  const {
    trip,
    days,
    selectedDay,
    itemsByDay,
    allItems,
    isLoading,
    error,
    setDays,
    setSelectedDay,
    setItems,
    setItemsByDay,
    refresh,
  } = useTripData({ tripId, dayId: requestedDayId })

  const [isGeneratingDays, setIsGeneratingDays] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [ticketMetas, setTicketMetas] = useState<TicketMeta[]>([])
  const [loadedTripContextKey, setLoadedTripContextKey] = useState('')
  const [routePreparation, setRoutePreparation] = useState<TripRoutePreparation | null>(null)
  const [routePreparationLoading, setRoutePreparationLoading] = useState(false)
  const [routePreparationVersion, setRoutePreparationVersion] = useState(0)
  const [routeGenerationConfirmOpen, setRouteGenerationConfirmOpen] = useState(false)
  const [routeGenerationLoading, setRouteGenerationLoading] = useState(false)
  const [routeGenerationResult, setRouteGenerationResult] = useState<RouteGenerationBatchResult | null>(null)
  const [routeGenerationError, setRouteGenerationError] = useState<string | null>(null)

  const tripContextKey = useMemo(() => {
    if (!trip || days.length === 0) {
      return ''
    }

    return `${trip.id}:${days.map((day) => day.id).join('|')}`
  }, [days, trip])

  useEffect(() => {
    if (!isLoading && trip && selectedDay && (requestedView === 'schedule' || requestedView === 'map')) {
      navigateTo('day', { tripId: trip.id, dayId: selectedDay.id, view: requestedView })
    }
  }, [isLoading, requestedView, selectedDay, trip])

  useEffect(() => {
    if (isLoading || !trip || days.length === 0) {
      return
    }

    let cancelled = false
    const currentTripContextKey = tripContextKey
    void Promise.all([
      Promise.all(
        days.map(async (day) => {
          const dayItems = await listItemsByDay(day.id)
          return [day.id, dayItems] as const
        }),
      ),
      listTicketsByTrip(trip.id),
    ]).then(([entries, tickets]) => {
      if (!cancelled) {
        setItemsByDay(Object.fromEntries(entries))
        setTicketMetas(tickets)
        setLoadedTripContextKey(currentTripContextKey)
      }
    }).catch(() => {
      if (!cancelled) {
        setTicketMetas([])
        setLoadedTripContextKey('')
      }
      // Trip Home can still render without aggregate item counts.
    })

    return () => {
      cancelled = true
    }
  }, [days, isLoading, setItemsByDay, trip, tripContextKey])

  useEffect(() => {
    function refreshRoutePreparation() {
      setRoutePreparationVersion((version) => version + 1)
    }

    window.addEventListener(ROUTE_CACHE_CHANGED_EVENT, refreshRoutePreparation)
    window.addEventListener(ROUTING_CONFIG_CHANGED_EVENT, refreshRoutePreparation)
    window.addEventListener('storage', refreshRoutePreparation)
    return () => {
      window.removeEventListener(ROUTE_CACHE_CHANGED_EVENT, refreshRoutePreparation)
      window.removeEventListener(ROUTING_CONFIG_CHANGED_EVENT, refreshRoutePreparation)
      window.removeEventListener('storage', refreshRoutePreparation)
    }
  }, [])

  useEffect(() => {
    if (!trip || !tripContextKey || loadedTripContextKey !== tripContextKey) {
      queueMicrotask(() => {
        setRoutePreparation(null)
        setRoutePreparationLoading(false)
      })
      return
    }

    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) {
        setRoutePreparationLoading(true)
      }
    })
    void loadTripRoutePreparation({
      days,
      itemsByDay,
      provider: getPersistentRouteProvider(getRoutingConfig()),
      tripId: trip.id,
    }).then((preparation) => {
      if (!cancelled) {
        setRoutePreparation(preparation)
      }
    }).catch(() => {
      if (!cancelled) {
        setRoutePreparation(null)
      }
    }).finally(() => {
      if (!cancelled) {
        setRoutePreparationLoading(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [days, itemsByDay, loadedTripContextKey, routePreparationVersion, trip, tripContextKey])

  const itemsByDayCount = useMemo(() => {
    return allItems.reduce<Record<string, number>>((acc, item) => {
      acc[item.dayId] = (acc[item.dayId] ?? 0) + 1
      return acc
    }, {})
  }, [allItems])

  const tripBrief = useMemo(() => {
    if (!trip || !tripContextKey || loadedTripContextKey !== tripContextKey) {
      return null
    }

    const context = buildTripContext({
      days,
      items: allItems,
      nowPlainDate: formatDateKey(new Date()),
      profile: getStoredTravelProfile(),
      selectedDayId: selectedDay?.id,
      tickets: ticketMetas,
      trip,
    })
    return buildTripBrief(context, analyzeTripContext(context))
  }, [allItems, days, loadedTripContextKey, selectedDay?.id, ticketMetas, trip, tripContextKey])

  async function handleGenerateDays() {
    if (!trip) {
      return
    }

    setIsGeneratingDays(true)
    setActionError(null)
    try {
      const nextDays = await ensureDaysForTrip(trip)
      const nextSelectedDay = nextDays[0] ?? null
      const nextItems = nextSelectedDay ? await listItemsByDay(nextSelectedDay.id) : []
      setDays(nextDays)
      setSelectedDay(nextSelectedDay)
      setItems(nextItems)
      setItemsByDay(nextSelectedDay ? { [nextSelectedDay.id]: nextItems } : {})
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : '生成每日行程失败')
    } finally {
      setIsGeneratingDays(false)
    }
  }

  async function handleConfirmGenerateRoutes() {
    if (!trip || !routePreparation?.canGenerate) {
      return
    }

    setRouteGenerationLoading(true)
    setRouteGenerationError(null)
    setRouteGenerationResult(null)
    try {
      const result = await generateRoutePreviewsForTrip({
        config: getRoutingConfig(),
        days,
        itemsByDay,
        tripId: trip.id,
      })
      setRouteGenerationResult(result)
      setRouteGenerationConfirmOpen(false)
      setRoutePreparationVersion((version) => version + 1)
    } catch (caught) {
      setRouteGenerationError(caught instanceof Error ? caught.message : '路线预览生成失败。')
    } finally {
      setRouteGenerationLoading(false)
    }
  }

  function openDay(day: Day, view: 'schedule' | 'map' = 'schedule') {
    navigateTo('day', { tripId: day.tripId, dayId: day.id, view })
  }

  if (isLoading) {
    return (
      <div className="h-full min-h-0 space-y-4 overflow-hidden">
        <Card className="space-y-3">
          <SkeletonLine className="w-2/3" />
          <SkeletonLine className="w-full" />
          <SkeletonLine className="w-1/2" />
        </Card>
      </div>
    )
  }

  if (error || !trip) {
    return (
      <div className="space-y-5">
        <EmptyState
          body={error || '请从首页选择一个旅行。'}
          icon={<CalendarDays className="size-6" />}
          title="无法打开旅行总览"
        />
        <Button className="w-full" onClick={() => navigateTo('home')} variant="secondary">
          返回首页
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden pb-[max(1rem,env(safe-area-inset-bottom))]">
      <header className="shrink-0 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <button
            aria-label="返回首页"
            className="flex size-10 items-center justify-center rounded-xl tm-surface text-slate-700 active:scale-[0.98] dark:text-slate-200 tm-focus"
            onClick={() => navigateTo('home')}
            type="button"
          >
            <ArrowLeft className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-sky-600">
              {trip.destination || '目的地未定'}
            </p>
            <h1 className="truncate text-xl font-semibold leading-tight text-slate-950 dark:text-slate-100">
              {trip.title}
            </h1>
            <p className="truncate text-xs text-slate-500">
              {formatDateRange(trip.startDate, trip.endDate)}
            </p>
          </div>
          <TripMoreMenu tripId={trip.id} />
        </div>
      </header>

      {days.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto app-scrollbar">
          <Card className="space-y-4" variant="grouped">
            <TripCover trip={trip} variant="hero" />
            <EmptyState
              body="先按旅行日期生成每日行程，然后开始添加地点、交通段和票据。"
              icon={<CalendarDays className="size-6" />}
              title="这趟旅行还没有每日行程"
            />
            {actionError ? (
              <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-600 dark:bg-red-500/10 dark:text-red-300">
                {actionError}
              </p>
            ) : null}
            <Button
              className="w-full"
              icon={<RotateCw className="size-4" />}
              loading={isGeneratingDays}
              onClick={() => void handleGenerateDays()}
            >
              生成每日行程
            </Button>
          </Card>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pr-1 app-scrollbar">
          <div className="space-y-4 pb-4">
            <Card className="space-y-3" variant="grouped">
              <div className="flex items-start gap-3">
                <TripCover className="h-20 w-24 shrink-0 rounded-xl" trip={trip} variant="compact" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-sky-600">{trip.destination || '目的地未定'}</p>
                  <h2 className="mt-1 line-clamp-2 text-lg font-semibold leading-snug text-slate-950 dark:text-slate-100">
                    {trip.title}
                  </h2>
                  <p className="mt-1 text-sm tm-muted">
                    {formatDateRange(trip.startDate, trip.endDate)}
                  </p>
                  <div className="mt-2">
                    <AutoSnapshotBackupStatus tripId={trip.id} />
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <OverviewStatChip label={`${days.length} 天`} />
                <OverviewStatChip label={`${allItems.length} 个行程点`} />
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <OverviewAction
                  icon={<Ticket className="size-4" />}
                  onClick={() => navigateTo('tickets', { tripId: trip.id })}
                >
                  票据库
                </OverviewAction>
                <OverviewAction
                  icon={<HardDriveDownload className="size-4" />}
                  onClick={() => document.getElementById('travel-backup-panel')?.scrollIntoView({ behavior: 'smooth' })}
                >
                  备份
                </OverviewAction>
              </div>
            </Card>
            <CloudSnapshotCheckPrompts maxItems={1} tripId={trip.id} variant="trip" />

            {tripBrief ? <TripBriefCard brief={tripBrief} /> : null}

              <TripMapPreview
                days={days}
                itemsByDay={itemsByDay}
                onItemsReordered={async () => {
                  await refresh()
                }}
                onOpenMap={(targetDay) => openDay(targetDay, 'map')}
                routeDataReady={loadedTripContextKey === tripContextKey}
                selectedDay={selectedDay}
                tripId={trip.id}
              />

            <RoutePreparationPanel
              error={routeGenerationError}
              loading={routePreparationLoading}
              onGenerate={() => setRouteGenerationConfirmOpen(true)}
              preparation={routePreparation}
              result={routeGenerationResult}
              submitting={routeGenerationLoading}
            />

            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-100">每日行程</h3>
              <Card className="divide-y tm-row" padding="none" variant="grouped">
                {days.map((day, index) => (
                  <div
                    className="flex cursor-pointer items-center gap-3 px-4 py-3 transition hover:bg-slate-50/70 active:bg-slate-100/80 dark:hover:bg-slate-800/40 dark:active:bg-slate-800/70"
                    key={day.id}
                    onClick={() => openDay(day, 'schedule')}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') openDay(day, 'schedule')
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <span className="flex min-h-8 w-14 shrink-0 items-center justify-center rounded-lg bg-sky-50/80 px-2 text-xs font-bold text-sky-600 dark:bg-sky-500/10 dark:text-sky-300">
                      {formatChineseDayOrdinal(index + 1)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-950 dark:text-slate-100">
                        {formatDate(day.date)}
                      </span>
                      <span className="mt-0.5 block truncate text-xs tm-muted">
                        {day.title}
                      </span>
                      <span className="mt-0.5 block truncate text-xs tm-muted">
                        {itemsByDayCount[day.id] ?? itemsByDay[day.id]?.length ?? 0} 个行程点
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-slate-300" />
                  </div>
                ))}
              </Card>
            </section>

            {trip.notes ? (
              <Card className="flex items-start gap-3" variant="grouped">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-50/80 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300">
                  <NotebookText className="size-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-100">旅行备注</h3>
                  <p className="mt-1 text-sm leading-6 tm-muted">{trip.notes}</p>
                </div>
              </Card>
            ) : null}

            <Collapsible title="备份与恢复">
              <TravelBackupPanel trip={trip} />
            </Collapsible>
          </div>
        </div>
      )}

      <div className="shrink-0">
        <TripNav
          activeRoute="trip"
          dayId={selectedDay?.id}
          firstDayId={days[0]?.id}
          tripId={trip.id}
        />
      </div>

      <ConfirmDialog
        body={buildRouteGenerationConfirmBody(routePreparation)}
        cancelLabel="暂不生成"
        confirmLabel="确认生成"
        icon={<RouteIcon className="size-5" />}
        loading={routeGenerationLoading}
        onCancel={() => {
          if (!routeGenerationLoading) {
            setRouteGenerationConfirmOpen(false)
          }
        }}
        onConfirm={() => void handleConfirmGenerateRoutes()}
        open={routeGenerationConfirmOpen}
        title={`生成 ${routePreparation?.targetDayIds.length ?? 0} 天路线预览？`}
      />
    </div>
  )
}

function RoutePreparationPanel({
  error,
  loading,
  onGenerate,
  preparation,
  result,
  submitting,
}: {
  error: string | null
  loading: boolean
  onGenerate: () => void
  preparation: TripRoutePreparation | null
  result: RouteGenerationBatchResult | null
  submitting: boolean
}) {
  const eligibleCount = preparation?.eligibleDayCount ?? 0
  const targetCount = preparation?.targetDayIds.length ?? 0
  const cachedCount = preparation?.cachedDayCount ?? 0
  const hasUnavailableProvider = Boolean(preparation && !preparation.providerConfigured && eligibleCount > cachedCount)
  const canGenerate = Boolean(preparation?.canGenerate && !submitting)

  return (
    <Card className="space-y-3" data-testid="route-preparation-panel" variant="grouped">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <RouteIcon className="size-4 shrink-0 text-sky-600 dark:text-sky-300" />
            <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-100">路线准备</h3>
          </div>
          <p className="mt-1 text-xs leading-5 tm-muted" data-testid="route-preparation-summary">
            {describeRoutePreparation(preparation, loading)}
          </p>
          {cachedCount > 0 ? (
            <p className="mt-0.5 text-[11px] leading-5 tm-muted">已有 {cachedCount} 天路线缓存</p>
          ) : null}
          {hasUnavailableProvider ? (
            <p className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-300" data-testid="route-preparation-provider-warning">
              当前路线服务不可用
            </p>
          ) : null}
        </div>
        <Button
          className="min-h-9 shrink-0 px-3 text-xs"
          disabled={!canGenerate}
          icon={submitting ? <Loader2 className="size-3.5 animate-spin" /> : <RouteIcon className="size-3.5" />}
          loading={submitting}
          onClick={onGenerate}
          variant="secondary"
        >
          生成路线预览
        </Button>
      </div>
      {result ? (
        <p className="flex items-start gap-2 rounded-xl bg-sky-50/75 px-3 py-2 text-xs leading-5 text-sky-700 dark:bg-sky-500/10 dark:text-sky-200" data-testid="route-preparation-result">
          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
          <span>{describeRouteGenerationResult(result)}</span>
        </p>
      ) : null}
      {error ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-600 dark:bg-red-500/10 dark:text-red-300" data-testid="route-preparation-error">
          {error}
        </p>
      ) : null}
      {targetCount > 0 && preparation?.staleDayCount ? (
        <p className="text-[11px] leading-5 tm-muted">有 {preparation.staleDayCount} 天路线可能需要更新。</p>
      ) : null}
    </Card>
  )
}

function describeRoutePreparation(preparation: TripRoutePreparation | null, loading: boolean) {
  if (loading || !preparation) {
    return '正在检查路线缓存…'
  }
  if (preparation.eligibleDayCount === 0) {
    return '补充至少两个有坐标的行程点后，可生成路线预览。'
  }
  if (preparation.targetDayIds.length === 0 && preparation.cachedDayCount === preparation.eligibleDayCount) {
    return '路线预览已准备'
  }
  if (!preparation.providerConfigured) {
    return `可为 ${preparation.eligibleDayCount - preparation.cachedDayCount} 天生成路线预览`
  }
  return `可为 ${preparation.targetDayIds.length} 天生成路线预览`
}

function describeRouteGenerationResult(result: RouteGenerationBatchResult) {
  const parts = [`已生成 ${result.generatedCount} 天路线预览`]
  if (result.failedCount > 0) {
    parts.push(`${result.failedCount} 天失败`)
  }
  if (!result.previewCacheSaved && result.generatedCount > 0) {
    parts.push('地图预览缓存未更新')
  }
  return `${parts.join('，')}。`
}

function buildRouteGenerationConfirmBody(preparation: TripRoutePreparation | null) {
  const count = preparation?.targetDayIds.length ?? 0
  return `将调用路线服务生成路线预览，可能消耗 API 次数。只为有足够坐标的日期生成（共 ${count} 天），不会自动调整行程顺序，不会生成公交/地铁线路号。`
}

function OverviewStatChip({ label }: { label: string }) {
  return <Badge>{label}</Badge>
}

function OverviewAction({
  children,
  icon,
  onClick,
}: {
  children: string
  icon: ReactNode
  onClick: () => void
}) {
  return (
    <button
      className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-slate-50/80 px-2 text-xs font-semibold text-slate-600 ring-1 ring-slate-100/80 transition active:scale-[0.98] dark:bg-slate-800/50 dark:text-slate-300 dark:ring-slate-700/70 tm-focus"
      onClick={onClick}
      type="button"
    >
      {icon}
      <span className="truncate">{children}</span>
    </button>
  )
}
