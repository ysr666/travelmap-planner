import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, CheckCircle2, Clock3, Loader2, NotebookText, RotateCw, Route, Ticket } from 'lucide-react'
import { listItemsByDay, listTicketsByTrip } from '../db'
import { TripCover } from '../components/trip/TripCover'
import { ImportRouteGenerationPanel } from '../components/trip/ImportRouteGenerationPanel'
import { TripMoreMenu } from '../components/trip/TripMoreMenu'
import { TripMapPreview } from '../components/trip/TripMapPreview'
import { TripDailyTravelTipCard } from '../components/trip/TripDailyTravelTipCard'
import { TripOperationsPanel } from '../components/trip/TripOperationsPanel'
import { TripReadinessCenterPanel } from '../components/trip/TripReadinessCenterPanel'
import { TravelBackupPanel } from '../components/trip/TravelBackupPanel'
import { AiTripEditPanel } from '../components/ai/AiTripEditPanel'
import { SmartTripWorkspacePanel } from '../components/ai/SmartTripWorkspacePanel'
import { TripBriefCard } from '../components/ai/TripBriefCard'
import { TripContentEnrichmentPanel } from '../components/ai/TripContentEnrichmentPanel'
import { TravelInboxPanel } from '../components/ai/TravelInboxPanel'
import { CloudSnapshotCheckPrompts } from '../components/cloud/CloudSnapshotCheckPrompts'
import { AutoSnapshotBackupStatus } from '../components/cloud/AutoSnapshotBackupStatus'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Collapsible } from '../components/ui/Collapsible'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { EmptyState } from '../components/ui/EmptyState'
import { SkeletonLine } from '../components/ui/SkeletonLine'
import { useTripData } from '../hooks/useTripData'
import { ensureDaysForTrip, formatDate, formatDateRange } from '../lib/dates'
import { buildTripContext } from '../lib/ai/aiTripContext'
import { getRouteParams, navigateTo } from '../lib/routes'
import { analyzeTripContext } from '../lib/tripCheck'
import { getStoredTravelProfile } from '../lib/travelProfile'
import { buildTripBrief } from '../lib/travelBrief'
import { buildTripDailyTravelTip } from '../lib/ai/tripDailyTravelTip'
import { generateRoutePreviewsForTrip, type RouteGenerationBatchResult } from '../lib/routeGeneration'
import { getPersistentRouteProvider, loadTripRoutePreparation, type TripRoutePreparation } from '../lib/routePreparation'
import { ROUTE_CACHE_CHANGED_EVENT } from '../lib/routeCache'
import { getRoutingConfig, ROUTING_CONFIG_CHANGED_EVENT } from '../lib/routing'
import { getCloudSyncQueueSummary, type CloudSyncQueueSummary } from '../lib/cloudSyncQueueSummary'
import { listTicketBlobSyncStatesByTrip } from '../lib/objectSyncLocal'
import { buildTripReadinessModel } from '../lib/tripReadiness'
import { buildTripOperationsModel, type TripOperationsInboxSummary } from '../lib/tripOperationsAgent'
import { getZonedPlainDate, resolveDayTimeZone, resolveTripTimeZone } from '../lib/timeZone'
import { getActiveTravelInboxPreview, listTravelInboxEntriesByTrip } from '../lib/ai/travelInbox'
import { listTravelInboxAccountSources } from '../lib/ai/travelInboxOrganization'
import type { Day, TicketBlobSyncState, TicketMeta, TravelInboxAccountSource } from '../types'

export function TripWorkspacePage() {
  const params = getRouteParams()
  const tripId = params.get('tripId')
  const requestedDayId = params.get('dayId')
  const requestedView = params.get('view')
  const hasPostImportRoutePrompt = params.get('postImportRoutePrompt') === '1'
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
  const [ticketBlobSyncStates, setTicketBlobSyncStates] = useState<TicketBlobSyncState[]>([])
  const [cloudSyncQueueSummary, setCloudSyncQueueSummary] = useState<CloudSyncQueueSummary | null>(null)
  const [tripOperationsInboxSummary, setTripOperationsInboxSummary] = useState<TripOperationsInboxSummary | null>(null)
  const [loadedTripContextKey, setLoadedTripContextKey] = useState('')
  const [routePreparation, setRoutePreparation] = useState<TripRoutePreparation | null>(null)
  const [routePreparationLoading, setRoutePreparationLoading] = useState(false)
  const [routePreparationVersion, setRoutePreparationVersion] = useState(0)
  const [readinessDataVersion, setReadinessDataVersion] = useState(0)
  const [routeGenerationConfirmOpen, setRouteGenerationConfirmOpen] = useState(false)
  const [routeGenerationLoading, setRouteGenerationLoading] = useState(false)
  const [routeGenerationResult, setRouteGenerationResult] = useState<RouteGenerationBatchResult | null>(null)
  const [routeGenerationError, setRouteGenerationError] = useState<string | null>(null)
  const [dismissedImportRoutePromptTripId, setDismissedImportRoutePromptTripId] = useState<string | null>(null)
  const [completedImportRoutePromptTripId, setCompletedImportRoutePromptTripId] = useState<string | null>(null)

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
      listTicketBlobSyncStatesByTrip(trip.id),
      getCloudSyncQueueSummary(trip.id),
      listTravelInboxEntriesByTrip(trip.id),
      getActiveTravelInboxPreview(trip.id),
      listTravelInboxAccountSources(),
    ]).then(([entries, tickets, blobSyncStates, syncSummary, inboxEntries, inboxPreview, accountSources]) => {
      if (!cancelled) {
        setItemsByDay(Object.fromEntries(entries))
        setTicketMetas(tickets)
        setTicketBlobSyncStates(blobSyncStates)
        setCloudSyncQueueSummary(syncSummary)
        setTripOperationsInboxSummary(buildTripOperationsInboxSummary({
          accountSources,
          errorEntryCount: inboxEntries.filter((entry) => entry.status === 'error').length,
          previewCheckedCount: inboxPreview?.checkedDiffIds.length ?? 0,
          readyEntryCount: inboxEntries.filter((entry) => entry.status === 'ready' || entry.status === 'previewed').length,
          tripId: trip.id,
        }))
        setLoadedTripContextKey(currentTripContextKey)
      }
    }).catch(() => {
      if (!cancelled) {
        setTicketMetas([])
        setTicketBlobSyncStates([])
        setCloudSyncQueueSummary(null)
        setTripOperationsInboxSummary(null)
        setLoadedTripContextKey('')
      }
      // Trip Home can still render without aggregate item counts.
    })

    return () => {
      cancelled = true
    }
  }, [days, isLoading, readinessDataVersion, setItemsByDay, trip, tripContextKey])

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


  const tripContext = useMemo(() => {
    if (!trip || !tripContextKey || loadedTripContextKey !== tripContextKey) {
      return null
    }

    return buildTripContext({
      days,
      items: allItems,
      nowPlainDate: getZonedPlainDate(
        new Date(),
        selectedDay ? resolveDayTimeZone(trip, selectedDay) : resolveTripTimeZone(trip),
      ),
      profile: getStoredTravelProfile(),
      selectedDayId: selectedDay?.id,
      tickets: ticketMetas,
      trip,
    })
  }, [allItems, days, loadedTripContextKey, selectedDay, ticketMetas, trip, tripContextKey])

  const tripCheckResult = useMemo(() => {
    return tripContext ? analyzeTripContext(tripContext) : null
  }, [tripContext])

  const tripBrief = useMemo(() => {
    return tripContext && tripCheckResult ? buildTripBrief(tripContext, tripCheckResult) : null
  }, [tripCheckResult, tripContext])

  const dailyTipModel = useMemo(() => {
    if (!trip || !tripCheckResult) {
      return null
    }
    return buildTripDailyTravelTip({
      days,
      itemsByDay,
      routePreparation,
      trip,
      tripCheck: tripCheckResult,
    })
  }, [days, itemsByDay, routePreparation, trip, tripCheckResult])

  const readinessModel = useMemo(() => {
    if (!trip || !tripContextKey || loadedTripContextKey !== tripContextKey) {
      return null
    }
    return buildTripReadinessModel({
      allItems,
      cloudSummary: cloudSyncQueueSummary,
      dailyTipModel,
      days,
      itemsByDay,
      routePreparation,
      ticketBlobSyncStates,
      tickets: ticketMetas,
      trip,
      tripCheck: tripCheckResult,
    })
  }, [
    allItems,
    cloudSyncQueueSummary,
    dailyTipModel,
    days,
    itemsByDay,
    loadedTripContextKey,
    routePreparation,
    ticketBlobSyncStates,
    ticketMetas,
    trip,
    tripCheckResult,
    tripContextKey,
  ])

  const tripOperationsModel = useMemo(() => {
    if (!trip || !readinessModel) {
      return null
    }
    return buildTripOperationsModel({
      allItems,
      cloudSummary: cloudSyncQueueSummary,
      dailyTipModel,
      days,
      inboxSummary: tripOperationsInboxSummary,
      itemsByDay,
      readinessModel,
      routePreparation,
      ticketBlobSyncStates,
      tickets: ticketMetas,
      trip,
    })
  }, [
    allItems,
    cloudSyncQueueSummary,
    dailyTipModel,
    days,
    itemsByDay,
    readinessModel,
    routePreparation,
    ticketBlobSyncStates,
    ticketMetas,
    trip,
    tripOperationsInboxSummary,
  ])

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

  function clearPostImportRoutePrompt({ hide }: { hide: boolean }) {
    if (!trip) {
      return
    }
    if (hide) {
      setDismissedImportRoutePromptTripId(trip.id)
      setCompletedImportRoutePromptTripId(null)
    } else {
      setCompletedImportRoutePromptTripId(trip.id)
    }
    if (hasPostImportRoutePrompt) {
      navigateTo('trip', { tripId: trip.id })
    }
  }

  async function handleReadinessChanged(options: { refreshTripData?: boolean } = {}) {
    setReadinessDataVersion((version) => version + 1)
    setRoutePreparationVersion((version) => version + 1)
    if (options.refreshTripData) {
      await refresh()
    }
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
    <>
      {/* Trip title in main content area - matches reference 12_1/code.html */}
      <section className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-headline-lg text-headline-lg text-primary tracking-tight">{trip.title}</h2>
          <p className="font-body-md text-body-md text-on-surface-variant mt-2 flex items-center gap-2">
            <CalendarDays className="size-4" />
            {formatDateRange(trip.startDate, trip.endDate)}
          </p>
        </div>
        <TripMoreMenu tripId={trip.id} />
      </section>

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
        <div className="min-h-0 flex-1 overflow-y-auto app-scrollbar">
          <div className="space-y-section-gap pb-4">
            {/* Overview Section - matches reference 12_1/code.html */}
            <section className="flex flex-col gap-stack-gap">
              <div className="flex items-baseline justify-between">
                <h3 className="font-headline-md text-headline-md text-on-surface">今日概览</h3>
                {selectedDay ? (
                  <span className="font-label-sm text-label-sm text-primary uppercase tracking-wider">
                    第 {days.findIndex(d => d.id === selectedDay.id) + 1} 天
                  </span>
                ) : null}
              </div>
              <p className="font-body-md text-body-md text-on-surface-variant">{selectedDay?.title || "选择一天开始探索"}</p>
              {/* Map Preview Card */}
              <TripMapPreview
                days={days}
                itemsByDay={itemsByDay}
                onItemsReordered={async () => { await refresh() }}
                onOpenMap={(targetDay) => openDay(targetDay, 'map')}
                routeDataReady={loadedTripContextKey === tripContextKey}
                selectedDay={selectedDay}
                tripId={trip.id}
              />
              <TripDailyTravelTipCard
                days={days}
                itemsByDay={itemsByDay}
                onOpenContentEnrichment={() => document.getElementById('trip-content-enrichment-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                onOpenDay={(targetDay) => openDay(targetDay, 'schedule')}
                onOpenRouteGeneration={() => {
                  if (routePreparation?.canGenerate) {
                    setRouteGenerationConfirmOpen(true)
                  }
                }}
                onSaved={async () => { await refresh() }}
                routePreparation={routePreparation}
                trip={trip}
                tripCheck={tripCheckResult}
              />
              {/* Action Buttons */}
              <div className="flex gap-3 mt-2">
                <button
                  className="flex-1 bg-primary text-on-primary py-3.5 px-4 rounded-xl font-label-sm text-label-sm flex items-center justify-center gap-2 active:scale-95 transition shadow-md"
                  onClick={() => selectedDay && openDay(selectedDay, 'schedule')}
                  type="button"
                >
                  <CalendarDays className="size-4" />
                  进入日视图
                </button>
                <button
                  className="flex-1 bg-surface-container-high text-primary py-3.5 px-4 rounded-xl border border-outline-variant/50 font-label-sm text-label-sm flex items-center justify-center gap-2 hover:bg-surface-container-highest transition-colors active:scale-95"
                  data-testid="trip-action-ticket-library"
                  onClick={() => navigateTo('tickets', { tripId: trip.id })}
                  type="button"
                >
                  <Ticket className="size-4" />
                  票据库
                </button>
              </div>
            </section>

            {readinessModel && tripOperationsModel ? (
              <TripOperationsPanel
                allItems={allItems}
                dailyTipModel={dailyTipModel}
                days={days}
                itemsByDay={itemsByDay}
                model={tripOperationsModel}
                onChanged={handleReadinessChanged}
                readinessModel={readinessModel}
                trip={trip}
              />
            ) : null}

            {readinessModel ? (
              <TripReadinessCenterPanel
                allItems={allItems}
                dailyTipModel={dailyTipModel}
                days={days}
                itemsByDay={itemsByDay}
                key={trip.id}
                model={readinessModel}
                onChanged={handleReadinessChanged}
                trip={trip}
              />
            ) : null}

            <DailyItineraryList
              days={days}
              itemsByDay={itemsByDay}
              onOpenDay={(day) => openDay(day, 'schedule')}
              selectedDayId={selectedDay?.id}
            />

            {/* Schedule Section - timeline with vertical line */}
            {selectedDay ? (
            <section className="flex flex-col gap-stack-gap">
              <h3 className="font-headline-md text-headline-md text-on-surface">今天的安排</h3>
              <div className="bg-surface-container rounded-xl border-[0.5px] border-outline-variant/30 overflow-hidden flex flex-col relative">
                {/* Timeline vertical line */}
                <div className="absolute left-[39px] top-6 bottom-6 w-[1px] bg-outline-variant/40 z-0" />
                {(itemsByDay[selectedDay.id] || []).map((item, index) => {
                  const isLast = index === (itemsByDay[selectedDay.id]?.length ?? 0) - 1
                  return (
                    <div
                      className="flex items-stretch p-4 relative z-10 group hover:bg-surface-container-high/50 transition-colors cursor-pointer"
                      key={item.id}
                      onClick={() => navigateTo('item', { tripId: trip.id, dayId: selectedDay.id, itemId: item.id })}
                      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') navigateTo('item', { tripId: trip.id, dayId: selectedDay.id, itemId: item.id }) }}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="flex flex-col items-center mr-4 w-12 pt-1">
                        {index === 0 ? (
                          <div className="w-3 h-3 rounded-full bg-primary ring-4 ring-surface-container group-hover:ring-surface-container-high z-10 shadow-[0_0_8px_rgba(170,199,255,0.6)]" />
                        ) : (
                          <div className="w-3 h-3 rounded-full bg-surface-variant border-[1.5px] border-outline ring-4 ring-surface-container group-hover:ring-surface-container-high z-10" />
                        )}
                      </div>
                      <div className={`flex-1 ${isLast ? '' : 'pb-4 border-b border-outline-variant/20'}`}>
                        <div className="flex justify-between items-start mb-1">
                          <h4 className="font-body-lg text-body-lg text-on-surface font-medium">
                            {item.title}
                          </h4>
                          {index === 0 ? (
                            <span className="bg-primary/20 text-primary px-2 py-0.5 rounded-full font-label-sm text-label-sm border border-primary/30">进行中</span>
                          ) : (
                            <span className="bg-surface-container-highest text-on-surface-variant px-2 py-0.5 rounded-full font-label-sm text-label-sm border border-outline-variant/50">已预订</span>
                          )}
                        </div>
                        <p className="font-body-md text-body-md text-on-surface-variant flex items-center gap-1">
                          <Clock3 className="size-3.5" />
                          {item.startTime || '10:00'}{item.endTime ? ` – ${item.endTime}` : ''}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
            ) : null}

            {/* Extra panels (not in reference design, but useful functionality) */}
            <div className="flex min-w-0 justify-end">
              <AutoSnapshotBackupStatus tripId={trip.id} visibility="active-only" />
            </div>
            <CloudSnapshotCheckPrompts maxItems={1} tripId={trip.id} variant="trip" />
            {tripBrief ? <TripBriefCard brief={tripBrief} /> : null}
            {dismissedImportRoutePromptTripId !== trip.id && (hasPostImportRoutePrompt || completedImportRoutePromptTripId === trip.id) ? (
              <ImportRouteGenerationPanel
                onDismiss={() => clearPostImportRoutePrompt({ hide: true })}
                onGenerated={() => clearPostImportRoutePrompt({ hide: false })}
                showDismiss
                tripId={trip.id}
              />
            ) : null}
            <div id="trip-content-enrichment-panel">
              <TripContentEnrichmentPanel allItems={allItems} days={days} onApplied={async () => { await refresh() }} trip={trip} />
            </div>
            <div className="flex justify-end">
              <Button onClick={() => navigateTo('inbox')} variant="ghost">查看账号旅行收件箱</Button>
            </div>
            <div id="trip-travel-inbox-panel">
              <TravelInboxPanel allItems={allItems} days={days} key={trip.id} onApplied={async () => { await refresh() }} tickets={ticketMetas} trip={trip} />
            </div>
            <SmartTripWorkspacePanel allItems={allItems} days={days} itemsByDay={itemsByDay} onApplied={async () => { await refresh() }} trip={trip} />
            <AiTripEditPanel allItems={allItems} days={days} onApplied={async () => { await refresh() }} trip={trip} />
            <RoutePreparationPanel error={routeGenerationError} loading={routePreparationLoading} onGenerate={() => setRouteGenerationConfirmOpen(true)} preparation={routePreparation} result={routeGenerationResult} submitting={routeGenerationLoading} />

            {trip.notes ? (
              <Card className="flex items-start gap-3" variant="grouped">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-50/80 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300">
                  <NotebookText className="size-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-on-surface dark:text-on-surface">旅行备注</h3>
                  <p className="mt-1 text-sm leading-6 tm-muted">{trip.notes}</p>
                </div>
              </Card>
            ) : null}

            <div id="trip-sync-archive-section">
              <Collapsible title="同步与归档">
                <TravelBackupPanel trip={trip} />
              </Collapsible>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        body={buildRouteGenerationConfirmBody(routePreparation)}
        cancelLabel="暂不生成"
        confirmLabel="确认生成"
        icon={<Route className="size-5" />}
        loading={routeGenerationLoading}
        onCancel={() => {
          if (!routeGenerationLoading) {
            setRouteGenerationConfirmOpen(false)
          }
        }}
        onConfirm={() => void handleConfirmGenerateRoutes()}
        open={routeGenerationConfirmOpen}
        testId="route-generation-confirm-dialog"
        title={`生成 ${routePreparation?.targetDayIds.length ?? 0} 天路线预览？`}
      />
    </>
  )
}

function buildTripOperationsInboxSummary({
  accountSources,
  errorEntryCount,
  previewCheckedCount,
  readyEntryCount,
  tripId,
}: {
  accountSources: TravelInboxAccountSource[]
  errorEntryCount: number
  previewCheckedCount: number
  readyEntryCount: number
  tripId: string
}): TripOperationsInboxSummary {
  const scopedAccountSources = accountSources.filter((source) => source.targetTripId === tripId || source.classification?.targetTripId === tripId)
  return {
    accountErrorCount: scopedAccountSources.filter((source) => source.status === 'error').length,
    accountNeedsAssignmentCount: scopedAccountSources.filter((source) => source.status === 'needs_assignment').length,
    accountPreviewCount: scopedAccountSources.filter((source) => source.status === 'preview_ready').length,
    errorEntryCount,
    readyEntryCount,
    selectedPreviewDiffCount: previewCheckedCount,
  }
}

function DailyItineraryList({
  days,
  itemsByDay,
  onOpenDay,
  selectedDayId,
}: {
  days: Day[]
  itemsByDay: Record<string, { id: string }[]>
  onOpenDay: (day: Day) => void
  selectedDayId?: string | null
}) {
  return (
    <section className="flex flex-col gap-stack-gap">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-headline-md text-headline-md text-on-surface">每日行程</h3>
        <span className="font-label-sm text-label-sm text-on-surface-variant">{days.length} 天</span>
      </div>
      <div className="-mx-1 overflow-x-auto px-1 py-1 app-scrollbar" data-testid="trip-day-selector">
        <div className="flex min-w-max gap-2">
        {days.map((day, index) => {
          const itemCount = itemsByDay[day.id]?.length ?? 0
          const active = day.id === selectedDayId
          return (
            <button
              aria-current={active ? 'page' : undefined}
              className={`relative z-10 flex min-h-[8.5rem] w-[10.5rem] shrink-0 flex-col justify-between rounded-2xl border p-3 text-left transition active:scale-[0.98] ${
                active
                  ? 'border-primary/35 bg-primary text-on-primary shadow-[0_8px_18px_var(--color-primary-shadow)]'
                  : 'border-outline-variant/30 bg-surface-container text-on-surface hover:bg-surface-container-high'
              }`}
              data-testid="trip-day-link"
              key={day.id}
              onClick={() => onOpenDay(day)}
              type="button"
            >
              <span className="flex items-center justify-between gap-2">
                <span className={`font-label-sm text-label-sm uppercase tracking-wider ${active ? 'text-on-primary/80' : 'text-primary'}`}>
                  Day {index + 1}
                </span>
                {active ? (
                  <span className="rounded-full bg-on-primary/15 px-2 py-0.5 font-label-sm text-[11px] text-on-primary">
                    当前
                  </span>
                ) : null}
              </span>
              <span className="min-w-0">
                <span className={`line-clamp-2 font-body-lg text-body-lg font-medium ${active ? 'text-on-primary' : 'text-on-surface'}`}>
                  {day.title}
                </span>
                <span className={`mt-2 block font-label-sm text-label-sm ${active ? 'text-on-primary/75' : 'text-on-surface-variant'}`}>
                  {formatDate(day.date)}
                </span>
                <span className={`mt-1 block font-label-sm text-label-sm ${active ? 'text-on-primary/75' : 'text-on-surface-variant'}`}>
                  {itemCount} 个行程点
                </span>
              </span>
            </button>
          )
        })}
        </div>
      </div>
    </section>
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
    <Card className="space-y-3" data-testid="route-preparation-panel" id="route-preparation-panel" variant="grouped">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Route className="size-4 shrink-0 text-sky-600 dark:text-sky-300 dark:text-sky-300" />
            <h3 className="text-sm font-semibold text-on-surface dark:text-on-surface">路线准备</h3>
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
          className="min-h-11 shrink-0 px-3 text-xs"
          disabled={!canGenerate}
          icon={submitting ? <Loader2 className="size-3.5 animate-spin" /> : <Route className="size-3.5" />}
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
