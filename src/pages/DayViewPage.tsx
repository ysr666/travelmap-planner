import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, CalendarDays, MapPin } from 'lucide-react'
import { listItemsByDay, listTicketsByTrip } from '../db'
import { DaySelector } from '../components/trip/DaySelector'
import { DayTimelineView } from '../components/trip/DayTimelineView'
import { TripMoreMenu } from '../components/trip/TripMoreMenu'
import { TripNav } from '../components/AppShell'
import { DayBriefCard } from '../components/ai/DayBriefCard'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { SkeletonLine } from '../components/ui/SkeletonLine'
import { useTripData } from '../hooks/useTripData'
import { formatDateKey, formatShortDateWithWeekday } from '../lib/dates'
import { buildTripContext } from '../lib/ai/aiTripContext'
import { DEFAULT_MAP_STYLE } from '../lib/mapConfig'
import { markMapStartup, resetMapStartupTrace } from '../lib/mapStartupMetrics'
import { getRouteParams, navigateTo } from '../lib/routes'
import { analyzeTripContext } from '../lib/tripCheck'
import { getStoredTravelProfile } from '../lib/travelProfile'
import { buildDayBrief } from '../lib/travelBrief'
import type { Day, ItineraryItem, TicketMeta } from '../types'

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
    isLoading,
    error,
    setItemsByDay,
    refreshItems,
  } = useTripData({ tripId, dayId: requestedDayId })

  const [hasOpenedMap, setHasOpenedMap] = useState(() => view === 'map')
  const [mapResizeToken, setMapResizeToken] = useState(0)
  const [ticketMetas, setTicketMetas] = useState<TicketMeta[]>([])
  const mapPreloadStartedRef = useRef(false)
  const backgroundMapWarmupStartedRef = useRef(false)
  const tripIdForTickets = trip?.id

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

    if (requestedDayId !== selectedDay.id) {
      navigateTo('day', { tripId, dayId: selectedDay.id, view })
    }
  }, [isLoading, requestedDayId, selectedDay, trip, tripId, view])

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
    if (isLoading || !tripIdForTickets) {
      return
    }

    let cancelled = false
    void listTicketsByTrip(tripIdForTickets).then((tickets) => {
      if (!cancelled) {
        setTicketMetas(tickets)
      }
    }).catch(() => {
      if (!cancelled) {
        setTicketMetas([])
      }
    })

    return () => {
      cancelled = true
    }
  }, [isLoading, tripIdForTickets])

  useEffect(() => {
    if (view !== 'map' || !hasOpenedMap) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      setMapResizeToken((current) => current + 1)
    })

    return () => window.cancelAnimationFrame(frame)
  }, [hasOpenedMap, selectedDay?.id, view])

  const selectedDayIndex = useMemo(() => {
    return selectedDay ? days.findIndex((day) => day.id === selectedDay.id) : -1
  }, [days, selectedDay])

  const dayBrief = useMemo(() => {
    if (!trip || !selectedDay) {
      return null
    }

    const context = buildTripContext({
      days: [selectedDay],
      items,
      nowPlainDate: formatDateKey(new Date()),
      profile: getStoredTravelProfile(),
      selectedDayId: selectedDay.id,
      tickets: ticketMetas,
      trip,
    })
    return buildDayBrief(context, analyzeTripContext(context), selectedDay.id)
  }, [items, selectedDay, ticketMetas, trip])

  function handleSelectDay(day: Day) {
    navigateTo('day', { tripId: day.tripId, dayId: day.id, view })
  }

  function handleSwitchView(nextView: DayWorkspaceView) {
    if (!trip || !selectedDay) {
      return
    }
    if (nextView === 'map') {
      setHasOpenedMap(true)
    }
    navigateTo('day', { tripId: trip.id, dayId: selectedDay.id, view: nextView })
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

  const isMapView = view === 'map'

  return (
    <div
      className={`flex h-full min-h-0 flex-col overflow-hidden ${
        isMapView ? 'gap-2 pb-0' : 'gap-4 pb-[max(1rem,env(safe-area-inset-bottom))]'
      }`}
    >
      {/* Header - matches reference 12_2/code.html */}
      <header className="shrink-0 bg-surface/80 backdrop-blur-md border-b border-outline-variant/30 flex items-center justify-between px-4 h-14">
        <button
          aria-label="返回旅行总览"
          className="text-primary hover:bg-surface-variant/50 active:opacity-70 transition-opacity p-2 -ml-2 rounded-full flex items-center justify-center"
          onClick={() => navigateTo('trip', { tripId: trip.id })}
          type="button"
        >
          <ArrowLeft className="size-5" />
        </button>
        <h1 className="font-headline-sm text-headline-sm text-primary">
          第 {days.findIndex(d => d.id === selectedDay.id) + 1} 天 · {formatShortWorkspaceDate(selectedDay.date)}
        </h1>
        <TripMoreMenu tripId={trip.id} />
      </header>

      {/* Full-screen map area with floating controls */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* Floating DaySelector - top of map */}
        <div className="absolute top-2 left-0 right-0 z-20 px-4">
          <DaySelector
            days={days}
            density="compact"
            onSelectDay={handleSelectDay}
            selectedDayId={selectedDay.id}
          />
        </div>

        {/* Floating view toggle - left side */}
        <div className="absolute top-14 left-4 z-20">
          <div className="flex bg-surface-container-lowest/90 backdrop-blur p-1 rounded-full shadow-sm border border-outline-variant/20">
            <button
              className={`px-4 py-1.5 rounded-full font-label-sm text-label-sm transition ${view === 'schedule' ? 'bg-surface-variant text-on-surface' : 'text-on-surface-variant'}`}
              onClick={() => handleSwitchView('schedule')}
              type="button"
            >
              日程
            </button>
            <button
              className={`px-4 py-1.5 rounded-full font-label-sm text-label-sm transition ${view === 'map' ? 'bg-surface-variant text-on-surface' : 'text-on-surface-variant'}`}
              onClick={() => handleSwitchView('map')}
              type="button"
            >
              地图
            </button>
          </div>
        </div>

        {/* Schedule view */}
        <div
          aria-hidden={isMapView}
          className={`absolute inset-0 min-h-0 overflow-y-auto pr-1 app-scrollbar transition-opacity duration-200 motion-reduce:transition-none pt-20 ${
            isMapView ? 'invisible pointer-events-none opacity-0' : 'visible opacity-100'
          }`}
        >
          <div className="space-y-4 pb-4">
            {dayBrief ? <DayBriefCard brief={dayBrief} /> : null}
            <DayTimelineView
              compact
              day={selectedDay}
              items={items}
              onItemsChange={refreshItems}
              onOpenItem={(item) =>
                navigateTo('item', { tripId: trip.id, dayId: selectedDay.id, itemId: item.id, view })
              }
              onSwitchToMap={() => handleSwitchView('map')}
              sourceView={view}
              trip={trip}
            />
          </div>
        </div>

        {/* Map view */}
        {hasOpenedMap ? (
          <div
            aria-hidden={!isMapView}
            className={`absolute inset-y-0 -left-4 -right-4 min-h-0 overflow-hidden transition-opacity duration-200 motion-reduce:transition-none ${
              isMapView ? 'visible opacity-100' : 'invisible pointer-events-none opacity-0'
            }`}
          >
            <Suspense fallback={isMapView ? <MapLoadingFallback day={selectedDay} items={items} /> : <HiddenMapLoadingFallback />}>
              <LazyDayMapView
                allDays={days}
                day={selectedDay}
                dayItemsByDayId={itemsByDay}
                embedded
                isVisible={isMapView}
                items={items}
                onBackToSchedule={() => handleSwitchView('schedule')}
                onEditItem={() => handleSwitchView('schedule')}
                onItemsChange={refreshItems}
                onOpenItem={(item) =>
                  navigateTo('item', {
                    tripId: trip.id,
                    dayId: selectedDay.id,
                    itemId: item.id,
                    view,
                  })
                }
                resizeSignal={mapResizeToken}
                prewarmEnabled={!isMapView}
                showFloatingHeader={false}
                trip={trip}
              />
            </Suspense>
          </div>
        ) : null}
      </div>

      {selectedDay ? (
        <p className="sr-only">
          当前第 {selectedDayIndex + 1} 天
        </p>
      ) : null}

      {!isMapView ? (
        <div className="shrink-0">
          <TripNav
            activeRoute="day"
            activeView={view}
            dayId={selectedDay.id}
            firstDayId={days[0]?.id}
            tripId={trip.id}
          />
        </div>
      ) : null}
    </div>
  )
}

function normalizeDayView(value: string | null): DayWorkspaceView {
  return value === 'map' ? 'map' : 'schedule'
}

function formatShortWorkspaceDate(date: string) {
  return formatShortDateWithWeekday(date)
}

function MapLoadingFallback({ day, items }: { day: Day; items: ItineraryItem[] }) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-map-bg p-4" data-testid="map-loading-fallback">
      <div className="rounded-2xl tm-surface p-4">
        <SkeletonLine className="w-1/2" />
        <p className="mt-3 text-sm font-medium text-on-surface-variant dark:text-outline-variant">
          地图加载中，本地行程仍可查看。
        </p>
      </div>
      <div className="mt-auto max-h-[54%] min-h-0 rounded-t-3xl tm-surface p-4">
        <div className="mx-auto mb-4 h-1.5 w-11 rounded-full bg-slate-300/70 dark:bg-slate-600/70" />
        <p className="text-xs font-semibold text-sky-600 dark:text-sky-300">{formatShortWorkspaceDate(day.date)}</p>
        <h2 className="mt-1 truncate text-base font-semibold text-on-surface dark:text-on-surface">{day.title}</h2>
        <p className="mt-1 text-xs tm-muted">{items.length} 个行程点，本地列表可先查看。</p>
        <div className="mt-3 min-h-0 overflow-y-auto app-scrollbar">
          <div className="space-y-2 pb-3">
            {items.slice(0, 4).map((item, index) => (
              <div className="flex items-center gap-3 rounded-xl bg-surface-container-low/80 px-3 py-2 dark:bg-surface-container-highest/50" key={item.id}>
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sky-100/80 text-xs font-bold text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-on-surface dark:text-on-surface">{item.title}</span>
                  <span className="flex items-center gap-1 truncate text-xs tm-muted">
                    <MapPin className="size-3.5 shrink-0" />
                    {item.locationName || item.address || '地点未填写'}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function HiddenMapLoadingFallback() {
  return <div className="h-full min-h-0 bg-map-bg" data-testid="map-loading-fallback" />
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
