import { ArrowLeft, CalendarDays, Home, Map as MapIcon, MoreHorizontal, Route, Settings, Ticket } from 'lucide-react'
import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { listItemsByDay } from '../db'
import { DayBriefCard } from '../components/ai/DayBriefCard'
import { DaySelector } from '../components/trip/DaySelector'
import { DayTimelineView } from '../components/trip/DayTimelineView'
import { BottomSheet } from '../components/ui/BottomSheet'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { SkeletonLine } from '../components/ui/SkeletonLine'
import { useTripData } from '../hooks/useTripData'
import { DEFAULT_MAP_STYLE } from '../lib/mapConfig'
import { markMapStartup, resetMapStartupTrace } from '../lib/mapStartupMetrics'
import { buildTripContext } from '../lib/ai/aiTripContext'
import { getRouteParams, navigateTo } from '../lib/routes'
import { analyzeTripContext } from '../lib/tripCheck'
import { getStoredTravelProfile } from '../lib/travelProfile'
import { buildDayBrief } from '../lib/travelBrief'
import { formatDateKey } from '../lib/dates'
import type { Day, ItineraryItem } from '../types'

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
    refreshItems,
  } = useTripData({ tripId, dayId: requestedDayId })

  const [hasOpenedMap, setHasOpenedMap] = useState(() => view === 'map')
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false)
  const [mapResizeToken, setMapResizeToken] = useState(0)
  const mapPreloadStartedRef = useRef(false)
  const backgroundMapWarmupStartedRef = useRef(false)

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
    if (view !== 'map' || !hasOpenedMap) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      setMapResizeToken((current) => current + 1)
    })

    return () => window.cancelAnimationFrame(frame)
  }, [hasOpenedMap, selectedDay?.id, view])



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


  const dayIndex = days.findIndex(d => d.id === selectedDay.id) + 1
  const dayDateStr = formatShortWorkspaceDate(selectedDay.date)
  const isMapView = view === 'map'
  const dayBrief = buildDayBrief(
    buildTripContext({
      days,
      items: allItems.length > 0 ? allItems : items,
      nowPlainDate: formatDateKey(new Date()),
      profile: getStoredTravelProfile(),
      selectedDayId: selectedDay.id,
      tickets: [],
      trip,
    }),
    analyzeTripContext(buildTripContext({
      days,
      items: allItems.length > 0 ? allItems : items,
      nowPlainDate: formatDateKey(new Date()),
      profile: getStoredTravelProfile(),
      selectedDayId: selectedDay.id,
      tickets: [],
      trip,
    })),
    selectedDay.id,
  )

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      {/* ── TopAppBar ── 参考 12_2/code.html: 127-135 行 */}
      <header className="absolute inset-x-0 top-0 z-50 flex h-14 items-center border-b border-outline-variant/30 bg-surface/80 px-4 backdrop-blur-md">
        <button
          aria-label="总览"
          className="-ml-2 flex size-10 shrink-0 items-center justify-center rounded-full text-primary transition-opacity hover:bg-surface-variant/50 active:opacity-70"
          onClick={() => navigateTo('trip', { tripId: trip.id })}
          type="button"
        >
          <ArrowLeft className="size-5" />
        </button>
        <h1 className="min-w-0 flex-1 truncate px-3 text-center font-headline-sm text-headline-sm text-primary">第 {dayIndex} 天 · {dayDateStr}</h1>
        <button
          aria-expanded={isMoreMenuOpen}
          aria-label="更多操作"
          className="-mr-2 flex size-10 shrink-0 items-center justify-center rounded-full text-primary transition-opacity hover:bg-surface-variant/50 active:opacity-70"
          onClick={() => setIsMoreMenuOpen(true)}
          type="button"
        >
          <MoreHorizontal className="size-5" />
        </button>
      </header>

      <DayMoreMenu
        onClose={() => setIsMoreMenuOpen(false)}
        open={isMoreMenuOpen}
        tripId={trip.id}
      />

      {isMapView ? (
        <main className="relative h-full min-h-0 w-full overflow-hidden bg-map-bg">
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
        </main>
      ) : (
        <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-28 pt-20 app-scrollbar">
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
        </main>
      )}
    </div>
  )
}

function DayMoreMenu({ onClose, open, tripId }: { onClose: () => void; open: boolean; tripId: string }) {
  function goToTrip() {
    navigateTo('trip', { tripId })
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

  return (
    <BottomSheet maxHeight="min(25rem, calc(100dvh - 2rem))" onClose={onClose} open={open} title="更多操作">
      <div className="space-y-1 pb-2" data-testid="day-more-menu">
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
          className={`flex min-h-9 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-semibold transition active:scale-[0.98] ${
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
          className={`flex min-h-9 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-semibold transition active:scale-[0.98] ${
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
  try {
    const d = new Date(date + 'T00:00:00')
    return `${d.getMonth() + 1}月${d.getDate()}日`
  } catch {
    return date
  }
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
