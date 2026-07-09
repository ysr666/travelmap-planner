import { AlertTriangle, ArrowLeft, CalendarDays, Home, Map as MapIcon, MapPin, MoreHorizontal, Route, Settings, ShieldCheck, Ticket } from 'lucide-react'
import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { listItemsByDay, listTicketsByTrip, listTripDisruptionEventsByTrip, listTripReplanRecordsByTrip, updateDay } from '../db'
import { DayBriefCard } from '../components/ai/DayBriefCard'
import { TripLiveModeCard } from '../components/trip/TripLiveModeCard'
import { DaySelector } from '../components/trip/DaySelector'
import { DayTimelineView } from '../components/trip/DayTimelineView'
import { BottomSheet } from '../components/ui/BottomSheet'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { SkeletonLine } from '../components/ui/SkeletonLine'
import { useTripData } from '../hooks/useTripData'
import { useLiveClock } from '../hooks/useLiveClock'
import { useTripIntelligencePersistence } from '../hooks/useTripIntelligencePersistence'
import { DEFAULT_MAP_STYLE } from '../lib/mapConfig'
import { markMapStartup, resetMapStartupTrace } from '../lib/mapStartupMetrics'
import { buildTripContext } from '../lib/ai/aiTripContext'
import { getRouteParams, navigateTo } from '../lib/routes'
import { analyzeTripContext } from '../lib/tripCheck'
import { getStoredTravelProfile } from '../lib/travelProfile'
import { buildDayBrief } from '../lib/travelBrief'
import { buildTripDailyTravelTip } from '../lib/ai/tripDailyTravelTip'
import { buildTripReadinessModel } from '../lib/tripReadiness'
import { buildTripOperationsModel } from '../lib/tripOperationsAgent'
import {
  type TripOperationsLocalState,
} from '../lib/tripOperationsState'
import { navigateToTripOperationsRecommendation } from '../lib/tripOperationsNavigation'
import { buildTripLiveModel } from '../lib/tripLiveMode'
import { buildTripIntelligenceModel, type TripIntelligenceSuggestion } from '../lib/tripIntelligence'
import { RestoreTripIntelligenceSuggestionButton, TripIntelligenceSuggestionControls } from '../components/trip/TripIntelligenceSuggestionControls'
import { formatShortDate } from '../lib/dates'
import { getPersistentRouteProvider, loadTripRoutePreparation, type TripRoutePreparation } from '../lib/routePreparation'
import { ROUTE_CACHE_CHANGED_EVENT } from '../lib/routeCache'
import { getRoutingConfig, ROUTING_CONFIG_CHANGED_EVENT } from '../lib/routing'
import { getZonedPlainDate, normalizeTimeZone, resolveDayTimeZone } from '../lib/timeZone'
import { TimeZoneSelect } from '../components/ui/TimeZoneSelect'
import type { Day, ItineraryItem, TicketMeta, Trip, TripDisruptionEvent, TripReplanRecord } from '../types'

type DayWorkspaceView = 'schedule' | 'map'

function importDayMapView() {
  return import('../components/trip/DayMapView').then((module) => ({ default: module.DayMapView }))
}

let dayMapViewLoadPromise: ReturnType<typeof importDayMapView> | null = null
let mapStylePreloadStarted = false

const loadDayMapView = () => {
  if (!dayMapViewLoadPromise) {
    markMapStartup('DayMapView chunk requested')
    dayMapViewLoadPromise = importDayMapView().then((module) => {
      markMapStartup('DayMapView chunk loaded')
      return module
    })
  }

  return dayMapViewLoadPromise
}

const LazyDayMapView = lazy(loadDayMapView)

export function DayViewPage() {
  const params = getRouteParams()
  const tripId = params.get('tripId')
  const requestedDayId = params.get('dayId')
  const view = normalizeDayView(params.get('view'))

  const {
    trip,
    days,
    selectedDay,
    items,
    itemsByDay,
    allItems,
    isLoading,
    error,
    setItemsByDay,
    refresh,
    refreshItems,
  } = useTripData({ tripId, dayId: requestedDayId })

  const [hasOpenedMap, setHasOpenedMap] = useState(() => view === 'map')
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false)
  const [mapResizeToken, setMapResizeToken] = useState(0)
  const [routePreparation, setRoutePreparation] = useState<TripRoutePreparation | null>(null)
  const [routePreparationVersion, setRoutePreparationVersion] = useState(0)
  const [tickets, setTickets] = useState<TicketMeta[]>([])
  const [tripDisruptionEvents, setTripDisruptionEvents] = useState<TripDisruptionEvent[]>([])
  const [tripReplanRecords, setTripReplanRecords] = useState<TripReplanRecord[]>([])
  const liveNow = useLiveClock()
  const mapPreloadStartedRef = useRef(false)
  const backgroundMapWarmupStartedRef = useRef(false)
  const tripOperationsStateTripId = trip?.id ?? null
  const {
    isLoaded: isTripIntelligenceStateLoaded,
    localState: tripOperationsLocalState,
    restoreSuggestionState,
    setSuggestionState,
    suggestionStates: tripIntelligenceSuggestionStates,
    updateLocalState: updateTripOperationsLocalState,
  } = useTripIntelligencePersistence(tripOperationsStateTripId)

  useEffect(() => {
    resetMapStartupTrace()
  }, [])

  useEffect(() => {
    backgroundMapWarmupStartedRef.current = false
  }, [tripId])

  useEffect(() => {
    if (isLoading || !trip || !selectedDay || !tripId) {
      return
    }

    const requestedDayExists = requestedDayId ? days.some((day) => day.id === requestedDayId) : false
    if (requestedDayId && requestedDayExists) {
      return
    }

    if (requestedDayId !== selectedDay.id) {
      navigateTo('day', { tripId, dayId: selectedDay.id, view })
    }
  }, [days, isLoading, requestedDayId, selectedDay, trip, tripId, view])

  useEffect(() => {
    if (view !== 'map' || hasOpenedMap) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      setHasOpenedMap(true)
    })

    return () => window.cancelAnimationFrame(frame)
  }, [hasOpenedMap, view])

  useEffect(() => {
    if (isLoading || !trip || days.length === 0 || mapPreloadStartedRef.current) {
      return
    }

    mapPreloadStartedRef.current = true
    return scheduleIdleTask(() => {
      markMapStartup('idle preload started')
      void loadDayMapView()
      void preloadMapStyleJson()
    })
  }, [days.length, isLoading, trip])

  useEffect(() => {
    if (
      isLoading ||
      !trip ||
      !selectedDay ||
      hasOpenedMap ||
      view === 'map' ||
      backgroundMapWarmupStartedRef.current ||
      shouldSkipWorkspaceMapWarmup()
    ) {
      return
    }

    backgroundMapWarmupStartedRef.current = true
    let cancelled = false
    const cancelIdle = scheduleIdleTask(() => {
      markMapStartup('hidden map warm mount requested')
      void loadDayMapView().then(() => {
        if (!cancelled) {
          setHasOpenedMap(true)
          markMapStartup('hidden map warm mount started')
        }
      })
    })

    return () => {
      cancelled = true
      cancelIdle()
    }
  }, [hasOpenedMap, isLoading, selectedDay, trip, view])

  const daysKey = useMemo(() => days.map((day) => day.id).join('|'), [days])

  useEffect(() => {
    if (isLoading || !trip || days.length === 0) {
      return
    }

    let cancelled = false
    const cancelIdle = scheduleIdleTask(() => {
      markMapStartup('prewarm day items load requested', { days: days.length })
      void Promise.all(
        days.map(async (day) => {
          const dayItems = await listItemsByDay(day.id)
          return [day.id, dayItems] as const
        }),
      ).then((entries) => {
        if (cancelled) {
          return
        }

        setItemsByDay(Object.fromEntries(entries))
        markMapStartup('prewarm day items loaded', { days: entries.length })
      }).catch(() => {
        markMapStartup('prewarm day items load ignored failure')
      })
    })

    return () => {
      cancelled = true
      cancelIdle()
    }
  }, [days, daysKey, isLoading, setItemsByDay, trip])

  useEffect(() => {
    if (!trip) {
      queueMicrotask(() => setTickets([]))
      return
    }
    let cancelled = false
    void listTicketsByTrip(trip.id).then((records) => {
      if (!cancelled) setTickets(records)
    }).catch(() => {
      if (!cancelled) setTickets([])
    })
    return () => {
      cancelled = true
    }
  }, [trip])

  useEffect(() => {
    if (!trip) {
      queueMicrotask(() => {
        setTripDisruptionEvents([])
        setTripReplanRecords([])
      })
      return
    }
    let cancelled = false
    void Promise.all([
      listTripDisruptionEventsByTrip(trip.id),
      listTripReplanRecordsByTrip(trip.id),
    ]).then(([events, records]) => {
      if (cancelled) return
      setTripDisruptionEvents(events)
      setTripReplanRecords(records)
    }).catch(() => {
      if (cancelled) return
      setTripDisruptionEvents([])
      setTripReplanRecords([])
    })
    return () => {
      cancelled = true
    }
  }, [trip])

  useEffect(() => {
    if (view !== 'map' || !hasOpenedMap) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      setMapResizeToken((current) => current + 1)
    })

    return () => window.cancelAnimationFrame(frame)
  }, [hasOpenedMap, selectedDay?.id, view])

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
    if (isLoading || !trip || !selectedDay) {
      queueMicrotask(() => {
        setRoutePreparation(null)
      })
      return
    }

    let cancelled = false
    void loadTripRoutePreparation({
      days: [selectedDay],
      itemsByDay: { [selectedDay.id]: items },
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
    })

    return () => {
      cancelled = true
    }
  }, [isLoading, items, routePreparationVersion, selectedDay, trip])



  function handleSwitchView(nextView: DayWorkspaceView) {
    if (!trip || !selectedDay) {
      return
    }
    if (nextView === 'map') {
      setHasOpenedMap(true)
    }
    navigateTo('day', { tripId: trip.id, dayId: selectedDay.id, view: nextView })
  }

  function handleTripOperationsLocalStateChange(nextState: TripOperationsLocalState) {
    if (!trip) {
      return
    }
    updateTripOperationsLocalState(nextState)
  }

  async function handleLiveModeChanged() {
    await refresh()
    if (!trip) {
      return
    }
    try {
      const [events, records] = await Promise.all([
        listTripDisruptionEventsByTrip(trip.id),
        listTripReplanRecordsByTrip(trip.id),
      ])
      setTripDisruptionEvents(events)
      setTripReplanRecords(records)
    } catch {
      setTripDisruptionEvents([])
      setTripReplanRecords([])
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
          body={error || '请从旅行总览进入每日行程。'}
          icon={<CalendarDays className="size-6" />}
          title="无法打开每日行程"
        />
        <Button className="w-full" onClick={() => navigateTo('home')} variant="secondary">
          返回首页
        </Button>
      </div>
    )
  }

  if (!selectedDay) {
    return (
      <div className="space-y-5">
        <EmptyState
          body="这趟旅行还没有每日行程，请先回到旅行总览生成每日行程。"
          icon={<CalendarDays className="size-6" />}
          title="暂无每日行程"
        />
        <Button className="w-full" onClick={() => navigateTo('trip', { tripId: trip.id })} variant="secondary">
          返回旅行总览
        </Button>
      </div>
    )
  }


  const dayIndex = days.findIndex(d => d.id === selectedDay.id) + 1
  const dayDateStr = formatShortWorkspaceDate(selectedDay.date)
  const isMapView = view === 'map'
  const selectedRouteDay = routePreparation?.days.find((routeDay) => routeDay.day.id === selectedDay.id) ?? null
  const tripContextForDay = buildTripContext({
    days,
    items: allItems.length > 0 ? allItems : items,
    nowPlainDate: getZonedPlainDate(new Date(), resolveDayTimeZone(trip, selectedDay)),
    profile: getStoredTravelProfile(),
    selectedDayId: selectedDay.id,
    tickets,
    trip,
  })
  const tripCheckForDay = analyzeTripContext(tripContextForDay)
  const dayBrief = buildDayBrief(tripContextForDay, tripCheckForDay, selectedDay.id)
  const dailyTipModel = buildTripDailyTravelTip({
    days,
    itemsByDay,
    now: liveNow,
    routePreparation,
    trip,
    tripCheck: tripCheckForDay,
  })
  const readinessModel = buildTripReadinessModel({
    allItems: allItems.length > 0 ? allItems : items,
    dailyTipModel,
    days,
    itemsByDay,
    routePreparation,
    tickets,
    trip,
    tripCheck: tripCheckForDay,
  })
  const tripOperationsModel = buildTripOperationsModel({
    allItems: allItems.length > 0 ? allItems : items,
    dailyTipModel,
    days,
    dispositions: tripOperationsLocalState.dispositions,
    itemsByDay,
    now: liveNow,
    readinessModel,
    routePreparation,
    tickets,
    trip,
    tripDisruptionEvents,
    tripReplanRecords,
  })
  const dayLiveModel = buildTripLiveModel({
    day: selectedDay,
    items,
    now: liveNow,
    operations: { recommendations: tripOperationsModel.activeRecommendations },
    routeDay: selectedRouteDay,
    tickets,
    trip,
  })
  const dayContextItems = allItems.length > 0 ? allItems : items
  const dayContextItemById = new Map(dayContextItems.map((item) => [item.id, item]))
  const dayLiveReplanRecord = selectLatestActiveDayReplanRecord(tripReplanRecords, selectedDay.id)
  const dayIntelligenceModel = buildTripIntelligenceModel({
    items: dayContextItems,
    liveModel: dayLiveModel,
    liveReplanRecord: dayLiveReplanRecord,
    operationsModel: tripOperationsModel,
    readinessModel,
    suggestionStates: tripIntelligenceSuggestionStates,
  })
  const dayIntelligenceSuggestions = dayIntelligenceModel.forDay(selectedDay.id).slice(0, 5)
  const hiddenDayIntelligenceSuggestions = dayIntelligenceModel.allSuggestions.filter((suggestion) => {
    if (suggestion.status !== 'ignored' && suggestion.status !== 'later') return false
    if (suggestion.affectedDayIds.includes(selectedDay.id)) return true
    return suggestion.affectedItemIds.some((itemId) => dayContextItemById.get(itemId)?.dayId === selectedDay.id)
  })

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      {/* ── TopAppBar ── 参考 12_2/code.html: 127-135 行 */}
      <header className="absolute inset-x-0 top-0 z-50 flex h-14 items-center border-b border-outline-variant/30 bg-surface/80 px-4 backdrop-blur-md">
        <button
          aria-label="总览"
          className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-full text-primary transition-opacity hover:bg-surface-variant/50 active:opacity-70"
          data-testid="day-back-to-trip"
          onClick={() => navigateTo('trip', { tripId: trip.id })}
          type="button"
        >
          <ArrowLeft className="size-5" />
        </button>
        <h1 className="min-w-0 flex-1 truncate px-3 text-center font-headline-sm text-headline-sm text-primary">第 {dayIndex} 天 · {dayDateStr}</h1>
        <button
          aria-expanded={isMoreMenuOpen}
          aria-label="更多操作"
          className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-full text-primary transition-opacity hover:bg-surface-variant/50 active:opacity-70"
          onClick={() => setIsMoreMenuOpen(true)}
          type="button"
        >
          <MoreHorizontal className="size-5" />
        </button>
      </header>

      <DayMoreMenu
        day={selectedDay}
        key={`${selectedDay.id}:${selectedDay.timeZone ?? ''}`}
        onDayUpdated={() => void refresh()}
        onClose={() => setIsMoreMenuOpen(false)}
        open={isMoreMenuOpen}
        trip={trip}
        tripId={trip.id}
      />

      {isMapView ? (
        <div className="relative h-full min-h-0 w-full overflow-hidden bg-map-bg">
          {hasOpenedMap ? (
            <Suspense fallback={<MapLoadingFallback day={selectedDay} items={items} />}>
              <LazyDayMapView
                allDays={days}
                day={selectedDay}
                dayItemsByDayId={itemsByDay}
                embedded
                isVisible
                items={items}
                onBackToSchedule={() => handleSwitchView('schedule')}
                onOpenItem={(item) => navigateTo('item', { tripId: trip.id, dayId: selectedDay.id, itemId: item.id, view: 'map' })}
                prewarmEnabled={false}
                resizeSignal={mapResizeToken}
                showFloatingHeader={false}
                trip={trip}
              />
            </Suspense>
          ) : (
            <MapLoadingFallback day={selectedDay} items={items} />
          )}
          <ViewSwitch
            activeView={view}
            floating
            onSwitch={handleSwitchView}
          />
          <div className="pointer-events-none absolute inset-x-0 top-[124px] z-30 px-4 [&_a]:pointer-events-auto [&_button]:pointer-events-auto">
            <DaySelector
              days={days}
              density="compact"
              getDayHref={(day) => buildDayHref(trip.id, day.id, view)}
              onSelectDay={(day) => navigateTo('day', { tripId: trip.id, dayId: day.id, view })}
              selectedDayId={selectedDay.id}
            />
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-28 pt-20 app-scrollbar">
          <div className="mx-auto w-full max-w-3xl space-y-section-gap">
            <DaySelector
              days={days}
              getDayHref={(day) => buildDayHref(trip.id, day.id, view)}
              onSelectDay={(day) => navigateTo('day', { tripId: trip.id, dayId: day.id, view })}
              selectedDayId={selectedDay.id}
            />

            <section className="space-y-stack-gap">
              <div>
                <p className="font-label-sm text-label-sm text-primary uppercase tracking-wider">第 {dayIndex} 天</p>
                <h2 className="font-headline-lg-mobile text-headline-lg-mobile text-primary">{selectedDay.title}</h2>
                <p className="mt-1 font-body-md text-body-md text-on-surface-variant">{dayDateStr}</p>
              </div>
              <ViewSwitch
                activeView={view}
                onSwitch={handleSwitchView}
              />
            </section>

            {isTripIntelligenceStateLoaded ? (
              <DayContextIntelligenceCard
                dayId={selectedDay.id}
                hiddenSuggestions={hiddenDayIntelligenceSuggestions}
                itemById={dayContextItemById}
                onIgnore={(suggestion) => void setSuggestionState({ status: 'ignored', suggestion })}
                onLater={(suggestion) => void setSuggestionState({ status: 'later', suggestion })}
                onRestore={(suggestion) => void restoreSuggestionState(suggestion.key)}
                suggestions={dayIntelligenceSuggestions}
                tripId={trip.id}
              />
            ) : null}

            {isTripIntelligenceStateLoaded ? <TripLiveModeCard
              allItems={allItems.length > 0 ? allItems : items}
              day={selectedDay}
              days={days}
              items={items}
              localState={tripOperationsLocalState}
              now={liveNow}
              onChanged={handleLiveModeChanged}
              onLocalStateChange={handleTripOperationsLocalStateChange}
              onOpenItem={(item) => navigateTo('item', { tripId: trip.id, dayId: selectedDay.id, itemId: item.id, view: 'schedule' })}
              onOpenMap={() => handleSwitchView('map')}
              onOpenOperation={(recommendation) => navigateToTripOperationsRecommendation(recommendation, trip.id)}
              onOpenTickets={(item) => navigateTo('tickets', { itemId: item.id, tripId: trip.id })}
              operationsRecommendations={tripOperationsModel.activeRecommendations}
              routeDay={selectedRouteDay}
              tickets={tickets}
              trip={trip}
            /> : null}

            {dayBrief ? <DayBriefCard brief={dayBrief} /> : null}

            <DayTimelineView
              compact
              day={selectedDay}
              items={items}
              onItemsChange={refreshItems}
              onOpenItem={(item) => navigateTo('item', { tripId: trip.id, dayId: selectedDay.id, itemId: item.id, view: 'schedule' })}
              sourceView="schedule"
              trip={trip}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function DayContextIntelligenceCard({
  dayId,
  hiddenSuggestions,
  itemById,
  onIgnore,
  onLater,
  onRestore,
  suggestions,
  tripId,
}: {
  dayId: string
  hiddenSuggestions: TripIntelligenceSuggestion[]
  itemById: Map<string, ItineraryItem>
  onIgnore: (suggestion: TripIntelligenceSuggestion) => void
  onLater: (suggestion: TripIntelligenceSuggestion) => void
  onRestore: (suggestion: TripIntelligenceSuggestion) => void
  suggestions: TripIntelligenceSuggestion[]
  tripId: string
}) {
  if (suggestions.length === 0 && hiddenSuggestions.length === 0) {
    return null
  }

  return (
    <Card className="space-y-2" data-testid="day-intelligence-card" variant="grouped">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-on-surface">今天要处理</p>
        </div>
        <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-on-primary-fixed dark:text-primary-fixed-dim">{suggestions.length} 项</span>
      </div>
      {suggestions[0] ? (
        <p className="line-clamp-1 text-xs leading-5 tm-muted">{suggestions[0].title}</p>
      ) : null}
      <details className="rounded-lg bg-surface-container-high/55 px-3 py-2">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-xs font-semibold text-on-surface marker:hidden">
          <span>查看处理项</span>
          <span className="tm-muted">{suggestions.length + hiddenSuggestions.length} 项</span>
        </summary>
        <div className="mt-2 divide-y divide-outline-variant/20">
          {suggestions.map((suggestion) => (
            <div className="flex min-h-16 items-start gap-3 px-0 py-3" data-testid="day-intelligence-suggestion" key={suggestion.id}>
              <span className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg ${getDaySuggestionIconTone(suggestion)}`}>
                {getDaySuggestionIcon(suggestion)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-semibold text-on-surface [overflow-wrap:anywhere]">{suggestion.title}</p>
                <p className="mt-0.5 line-clamp-2 break-words text-xs leading-5 tm-muted [overflow-wrap:anywhere]">{suggestion.message}</p>
              </div>
              <Button
                className="shrink-0 px-3 text-xs"
                onClick={() => openDaySuggestion(suggestion, { dayId, itemById, tripId })}
                variant="secondary"
              >
                {suggestion.action?.label ?? '查看'}
              </Button>
              <TripIntelligenceSuggestionControls onIgnore={onIgnore} onLater={onLater} suggestion={suggestion} />
            </div>
          ))}
          {hiddenSuggestions.length > 0 ? (
            <details className="py-2">
              <summary className="flex min-h-11 cursor-pointer items-center text-xs font-semibold tm-muted">已隐藏建议（{hiddenSuggestions.length}）</summary>
            <div className="mt-2 space-y-1">
              {hiddenSuggestions.map((suggestion) => (
                <div className="flex min-h-11 items-center justify-between gap-2" key={suggestion.key}>
                  <span className="min-w-0 truncate text-xs tm-muted">{suggestion.title}</span>
                  <RestoreTripIntelligenceSuggestionButton onRestore={onRestore} suggestion={suggestion} />
                </div>
              ))}
            </div>
            </details>
          ) : null}
        </div>
      </details>
    </Card>
  )
}

function getDaySuggestionIcon(suggestion: TripIntelligenceSuggestion) {
  if (suggestion.scope === 'ticket') return <Ticket className="size-4" />
  if (suggestion.scope === 'live') return <AlertTriangle className="size-4" />
  if (suggestion.requiresConfirmation || suggestion.requiresPreview) return <ShieldCheck className="size-4" />
  if (suggestion.scope === 'item') return <MapPin className="size-4" />
  return <Route className="size-4" />
}

function getDaySuggestionIconTone(suggestion: TripIntelligenceSuggestion) {
  if (suggestion.severity === 'high') return 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-200'
  if (suggestion.severity === 'medium') return 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200'
  return 'bg-primary/10 text-on-primary-fixed dark:text-primary-fixed-dim'
}

function openDaySuggestion(
  suggestion: TripIntelligenceSuggestion,
  context: {
    dayId: string
    itemById: Map<string, ItineraryItem>
    tripId: string
  },
) {
  const sourceActionKind = suggestion.action?.sourceActionKind
  if (
    suggestion.scope === 'live'
    || sourceActionKind === 'open_adaptive_replan'
    || sourceActionKind === 'replan_apply_option'
    || sourceActionKind === 'replan_undo'
  ) {
    if (scrollToDayElement('trip-live-mode-card')) return
  }

  if (suggestion.scope === 'ticket' || suggestion.action?.targetRoute === 'tickets' || sourceActionKind === 'open_tickets') {
    navigateTo('tickets', { tripId: context.tripId })
    return
  }

  if (sourceActionKind === 'generate_routes' || sourceActionKind === 'open_route_panel' || sourceActionKind === 'open_readiness') {
    navigateTo('trip', { tripId: context.tripId })
    return
  }

  const itemId = suggestion.affectedItemIds[0]
  if (itemId) {
    const item = context.itemById.get(itemId)
    navigateTo('item', {
      dayId: item?.dayId ?? context.dayId,
      itemId,
      tripId: context.tripId,
      view: 'schedule',
    })
    return
  }

  if (suggestion.affectedDayIds[0]) {
    navigateTo('day', {
      dayId: suggestion.affectedDayIds[0],
      tripId: context.tripId,
      view: 'schedule',
    })
    return
  }

  navigateTo('trip', { tripId: context.tripId })
}

function scrollToDayElement(id: string) {
  const element = document.getElementById(id)
  if (!element) return false
  element.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  return true
}

const ACTIVE_DAY_REPLAN_RECORD_STATUSES = new Set<TripReplanRecord['status']>(['preview', 'applied', 'conflict'])

function selectLatestActiveDayReplanRecord(records: TripReplanRecord[], dayId: string) {
  return records
    .filter((record) => ACTIVE_DAY_REPLAN_RECORD_STATUSES.has(record.status) && dayReplanRecordTouchesDay(record, dayId))
    .sort((left, right) => (right.updatedAt - left.updatedAt) || (right.createdAt - left.createdAt))[0] ?? null
}

function dayReplanRecordTouchesDay(record: TripReplanRecord, dayId: string) {
  return record.beforeSnapshot.days.some((snapshotDay) => snapshotDay.id === dayId)
    || record.beforeSnapshot.items.some((item) => item.dayId === dayId)
    || Boolean(record.afterSnapshot?.days.some((snapshotDay) => snapshotDay.id === dayId))
    || Boolean(record.afterSnapshot?.items.some((item) => item.dayId === dayId))
    || Boolean(record.selectedDiff?.routeImpacts.some((impact) => impact.dayId === dayId))
    || Boolean(record.selectedDiff?.itemChanges.some((change) => change.before.dayId === dayId || change.after.dayId === dayId))
}

function DayMoreMenu({
  day,
  onClose,
  onDayUpdated,
  open,
  trip,
  tripId,
}: {
  day: Day
  onClose: () => void
  onDayUpdated: () => void
  open: boolean
  trip: Trip
  tripId: string
}) {
  const [timeZone, setTimeZone] = useState(() => resolveDayTimeZone(trip, day))
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function goToTrip() {
    navigateTo('trip', { tripId })
  }

  function handleClose() {
    setTimeZone(resolveDayTimeZone(trip, day))
    setSaveError(null)
    onClose()
  }

  function goToTickets() {
    navigateTo('tickets', { tripId })
  }

  function goToSettings() {
    navigateTo('settings')
  }

  function goToHome() {
    navigateTo('home')
  }

  async function handleSaveTimeZone() {
    const normalized = normalizeTimeZone(timeZone)
    if (!normalized) {
      setSaveError('请输入有效 IANA 时区，例如 Europe/Paris')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      await updateDay(day.id, {
        timeZone: normalized,
        timeZoneSource: 'manual',
      })
      onDayUpdated()
      handleClose()
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : '保存当天时区失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet maxHeight="min(25rem, calc(100dvh - 2rem))" onClose={handleClose} open={open} title="更多操作">
      <div className="space-y-1 pb-2" data-testid="day-more-menu">
        <div className="space-y-3 rounded-xl bg-surface-container-low p-3">
          <TimeZoneSelect
            description="默认继承旅行时区，可单独覆盖"
            label="当天时区"
            onChange={setTimeZone}
            source={day.timeZoneSource ?? trip.timeZoneSource}
            value={timeZone}
          />
          {saveError ? <p className="text-xs font-medium text-red-600 dark:text-red-300">{saveError}</p> : null}
          <Button className="w-full" loading={saving} onClick={() => void handleSaveTimeZone()} variant="secondary">
            保存当天时区
          </Button>
        </div>
        <DayMoreMenuItem icon={<Route className="size-4" />} label="旅行总览" onClick={goToTrip} />
        <DayMoreMenuItem icon={<Ticket className="size-4" />} label="票据库" onClick={goToTickets} />
        <DayMoreMenuItem icon={<Settings className="size-4" />} label="设置" onClick={goToSettings} />
        <DayMoreMenuItem icon={<Home className="size-4" />} label="返回首页" onClick={goToHome} />
      </div>
    </BottomSheet>
  )
}

function DayMoreMenuItem({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold text-on-surface transition active:bg-surface-container-low"
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      type="button"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-surface-container-low text-on-surface-variant">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
}

function normalizeDayView(value: string | null): DayWorkspaceView {
  return value === 'schedule' ? 'schedule' : 'map'
}

function buildDayHref(tripId: string, dayId: string, view: DayWorkspaceView) {
  return `#/day?${new URLSearchParams({ tripId, dayId, view }).toString()}`
}

function ViewSwitch({
  activeView,
  floating = false,
  onSwitch,
}: {
  activeView: DayWorkspaceView
  floating?: boolean
  onSwitch: (view: DayWorkspaceView) => void
}) {
  return (
    <div className={`${floating ? 'absolute left-4 top-[72px] z-30 shadow-lg' : 'relative'} rounded-full border border-outline-variant/30 bg-surface/90 p-1 backdrop-blur-xl`}>
      <div className="grid grid-cols-2 gap-1">
        <button
          className={`flex min-h-11 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-semibold transition active:scale-[0.98] ${
            activeView === 'map' ? 'bg-surface-container-high text-on-surface' : 'text-on-surface-variant'
          }`}
          data-testid="view-switch-map"
          onClick={() => onSwitch('map')}
          type="button"
        >
          <MapIcon className="size-4" />
          地图
        </button>
        <button
          className={`flex min-h-11 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-semibold transition active:scale-[0.98] ${
            activeView === 'schedule' ? 'bg-surface-container-high text-on-surface' : 'text-on-surface-variant'
          }`}
          data-testid="view-switch-schedule"
          onClick={() => onSwitch('schedule')}
          type="button"
        >
          <Route className="size-4" />
          列表
        </button>
      </div>
    </div>
  )
}

function formatShortWorkspaceDate(date: string): string {
  return formatShortDate(date)
}

function MapLoadingFallback({ day, items }: { day: Day; items: ItineraryItem[] }) {
  const previewItem = items[0] ?? null

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-map-bg p-4" data-testid="map-loading-fallback">
      <div className="absolute left-4 right-4 top-20 rounded-2xl tm-surface p-4">
        <SkeletonLine className="w-1/2" />
        <p className="mt-3 text-sm font-medium text-on-surface-variant dark:text-outline-variant">
          地图加载中，本地行程仍可查看。
        </p>
      </div>
      {previewItem ? (
        <div className="absolute bottom-[calc(56px+env(safe-area-inset-bottom,20px)+16px)] left-4 right-4 z-30 rounded-2xl border border-outline-variant/30 bg-surface-container-high/95 p-4 shadow-2xl backdrop-blur-md">
          <div className="flex items-center gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/20 text-primary">
              <CalendarDays className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-primary">{formatShortWorkspaceDate(day.date)} · {items.length} 个行程点</p>
              <h2 className="mt-0.5 truncate text-base font-semibold text-on-surface dark:text-on-surface">{previewItem.title}</h2>
              <p className="mt-0.5 truncate text-xs tm-muted">{previewItem.locationName || previewItem.address || day.title}</p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function scheduleIdleTask(task: () => void) {
  type IdleWindow = Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number
    cancelIdleCallback?: (handle: number) => void
  }

  const idleWindow = window as IdleWindow
  if (typeof idleWindow.requestIdleCallback === 'function') {
    const handle = idleWindow.requestIdleCallback(task, { timeout: 2500 })
    return () => idleWindow.cancelIdleCallback?.(handle)
  }

  const timeout = window.setTimeout(task, 900)
  return () => window.clearTimeout(timeout)
}

async function preloadMapStyleJson() {
  if (mapStylePreloadStarted || typeof fetch === 'undefined') {
    return
  }

  mapStylePreloadStarted = true
  markMapStartup('style json preload requested', { styleUrl: DEFAULT_MAP_STYLE })
  try {
    await fetch(DEFAULT_MAP_STYLE, { cache: 'force-cache' })
    markMapStartup('style json preload completed')
  } catch {
    markMapStartup('style json preload ignored failure')
  }
}

function shouldSkipWorkspaceMapWarmup() {
  type NavigatorWithConnection = Navigator & {
    connection?: {
      effectiveType?: string
      saveData?: boolean
    }
  }

  const connection = (navigator as NavigatorWithConnection).connection
  if (!connection) {
    return false
  }

  if (connection.saveData) {
    markMapStartup('hidden map warm mount skipped: saveData')
    return true
  }

  if (connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g') {
    markMapStartup('hidden map warm mount skipped: slow network', {
      effectiveType: connection.effectiveType,
    })
    return true
  }

  return false
}
