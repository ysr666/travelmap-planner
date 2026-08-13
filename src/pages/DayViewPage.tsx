import { CalendarDays } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  isAdaptiveTripReplanRecord,
  listItemsByDay,
  listTicketsByTrip,
  listTripDisruptionEventsByTrip,
  listTripReplanRecordsByTrip,
} from '../db'
import {
  DayWorkspace,
  type DayWorkspaceView,
} from '../components/trip/DayWorkspaceView'
import {
  loadDayMapView,
  preloadDayWorkspaceMapStyleJson,
  scheduleDayWorkspaceIdleTask,
  shouldSkipDayWorkspaceMapWarmup,
} from '../lib/dayWorkspaceMapLoader'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { SkeletonLine } from '../components/ui/SkeletonLine'
import { useLiveClock } from '../hooks/useLiveClock'
import { useTripData } from '../hooks/useTripData'
import { useTripIntelligencePersistence } from '../hooks/useTripIntelligencePersistence'
import { buildDayWorkspaceViewModel } from '../lib/dayWorkspaceViewModel'
import { markMapStartup, resetMapStartupTrace } from '../lib/mapStartupMetrics'
import { ROUTE_CACHE_CHANGED_EVENT } from '../lib/routeCache'
import { getPersistentRouteProvider, loadTripRoutePreparation, type TripRoutePreparation } from '../lib/routePreparation'
import { getRouteParams, navigateTo } from '../lib/routes'
import { getRoutingConfig, ROUTING_CONFIG_CHANGED_EVENT } from '../lib/routing'
import type { TripOperationsLocalState } from '../lib/tripOperationsState'
import type { TicketMeta, TripDisruptionEvent, TripReplanRecord } from '../types'

export function DayViewPage({ routeHash }: { routeHash?: string } = {}) {
  const params = getRouteParams(routeHash)
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
  const {
    isLoaded: isTripIntelligenceStateLoaded,
    localState: tripOperationsLocalState,
    restoreSuggestionState,
    setSuggestionState,
    suggestionStates: tripIntelligenceSuggestionStates,
    updateLocalState: updateTripOperationsLocalState,
  } = useTripIntelligencePersistence(trip?.id ?? null)

  useEffect(() => {
    resetMapStartupTrace()
  }, [])

  useEffect(() => {
    backgroundMapWarmupStartedRef.current = false
  }, [tripId])

  useEffect(() => {
    if (isLoading || !trip || !selectedDay || !tripId) return

    const requestedDayExists = requestedDayId ? days.some((day) => day.id === requestedDayId) : false
    if (requestedDayId && requestedDayExists) return

    if (requestedDayId !== selectedDay.id) {
      navigateTo('day', { tripId, dayId: selectedDay.id, view })
    }
  }, [days, isLoading, requestedDayId, selectedDay, trip, tripId, view])

  useEffect(() => {
    if (view !== 'map' || hasOpenedMap) return

    const frame = window.requestAnimationFrame(() => setHasOpenedMap(true))
    return () => window.cancelAnimationFrame(frame)
  }, [hasOpenedMap, view])

  useEffect(() => {
    if (isLoading || !trip || days.length === 0 || mapPreloadStartedRef.current) return

    mapPreloadStartedRef.current = true
    return scheduleDayWorkspaceIdleTask(() => {
      markMapStartup('idle preload started')
      void loadDayMapView()
      void preloadDayWorkspaceMapStyleJson()
    })
  }, [days.length, isLoading, trip])

  useEffect(() => {
    if (
      isLoading
      || !trip
      || !selectedDay
      || hasOpenedMap
      || view === 'map'
      || backgroundMapWarmupStartedRef.current
      || shouldSkipDayWorkspaceMapWarmup()
    ) return

    backgroundMapWarmupStartedRef.current = true
    let cancelled = false
    const cancelIdle = scheduleDayWorkspaceIdleTask(() => {
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
    if (isLoading || !trip || days.length === 0) return

    let cancelled = false
    const cancelIdle = scheduleDayWorkspaceIdleTask(() => {
      markMapStartup('prewarm day items load requested', { days: days.length })
      void Promise.all(
        days.map(async (day) => {
          const dayItems = await listItemsByDay(day.id)
          return [day.id, dayItems] as const
        }),
      ).then((entries) => {
        if (cancelled) return
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
      setTripReplanRecords(records.filter(isAdaptiveTripReplanRecord))
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
    if (view !== 'map' || !hasOpenedMap) return

    const frame = window.requestAnimationFrame(() => setMapResizeToken((current) => current + 1))
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
      queueMicrotask(() => setRoutePreparation(null))
      return
    }

    let cancelled = false
    void loadTripRoutePreparation({
      days: [selectedDay],
      itemsByDay: { [selectedDay.id]: items },
      provider: getPersistentRouteProvider(getRoutingConfig()),
      tripId: trip.id,
    }).then((preparation) => {
      if (!cancelled) setRoutePreparation(preparation)
    }).catch(() => {
      if (!cancelled) setRoutePreparation(null)
    })

    return () => {
      cancelled = true
    }
  }, [isLoading, items, routePreparationVersion, selectedDay, trip])

  function handleSwitchView(nextView: DayWorkspaceView) {
    if (!trip || !selectedDay) return
    if (nextView === 'map') setHasOpenedMap(true)
    navigateTo('day', { tripId: trip.id, dayId: selectedDay.id, view: nextView })
  }

  function handleTripOperationsLocalStateChange(nextState: TripOperationsLocalState) {
    if (trip) updateTripOperationsLocalState(nextState)
  }

  async function handleLiveModeChanged() {
    await refresh()
    if (!trip) return
    try {
      const [events, records] = await Promise.all([
        listTripDisruptionEventsByTrip(trip.id),
        listTripReplanRecordsByTrip(trip.id),
      ])
      setTripDisruptionEvents(events)
      setTripReplanRecords(records.filter(isAdaptiveTripReplanRecord))
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
        <Button className="w-full" onClick={() => navigateTo('home')} variant="secondary">返回首页</Button>
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
        <Button className="w-full" onClick={() => navigateTo('trip', { tripId: trip.id })} variant="secondary">返回旅行总览</Button>
      </div>
    )
  }

  const model = buildDayWorkspaceViewModel({
    allItems,
    days,
    items,
    itemsByDay,
    liveNow,
    routePreparation,
    selectedDay,
    suggestionStates: tripIntelligenceSuggestionStates,
    tickets,
    trip,
    tripDisruptionEvents,
    tripOperationsLocalState,
    tripReplanRecords,
  })

  return (
    <DayWorkspace
      allItems={allItems}
      days={days}
      hasOpenedMap={hasOpenedMap}
      isMoreMenuOpen={isMoreMenuOpen}
      isTripIntelligenceStateLoaded={isTripIntelligenceStateLoaded}
      items={items}
      itemsByDay={itemsByDay}
      liveNow={liveNow}
      mapResizeToken={mapResizeToken}
      model={model}
      onCloseMoreMenu={() => setIsMoreMenuOpen(false)}
      onDayUpdated={() => void refresh()}
      onLiveModeChanged={handleLiveModeChanged}
      onLocalStateChange={handleTripOperationsLocalStateChange}
      onOpenMoreMenu={() => setIsMoreMenuOpen(true)}
      onRefreshItems={refreshItems}
      onRestoreSuggestion={(suggestion) => void restoreSuggestionState(suggestion.key)}
      onSetSuggestionState={(suggestion, status) => void setSuggestionState({ status, suggestion })}
      onSwitchView={handleSwitchView}
      selectedDay={selectedDay}
      tickets={tickets}
      trip={trip}
      tripOperationsLocalState={tripOperationsLocalState}
      view={view}
    />
  )
}

function normalizeDayView(value: string | null): DayWorkspaceView {
  return value === 'schedule' ? 'schedule' : 'map'
}
