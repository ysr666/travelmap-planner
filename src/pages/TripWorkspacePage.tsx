import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, CalendarDays, Map, MapPin, Route, RotateCw } from 'lucide-react'
import { getTrip, listDaysByTrip, listItemsByDay } from '../db'
import { DaySelector } from '../components/trip/DaySelector'
import { DayTimelineView } from '../components/trip/DayTimelineView'
import { TripCover } from '../components/trip/TripCover'
import { TripMoreMenu } from '../components/trip/TripMoreMenu'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { ensureDaysForTrip, formatDateRange } from '../lib/dates'
import { DEFAULT_MAP_STYLE } from '../lib/mapConfig'
import { markMapStartup, resetMapStartupTrace } from '../lib/mapStartupMetrics'
import { getRouteParams, navigateTo } from '../lib/routes'
import type { Day, ItineraryItem, Trip } from '../types'

type WorkspaceView = 'schedule' | 'map'

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

export function TripWorkspacePage() {
  const params = getRouteParams()
  const tripId = params.get('tripId')
  const requestedDayId = params.get('dayId')
  const hasViewParam = params.has('view')
  const view = normalizeView(params.get('view'))
  const [trip, setTrip] = useState<Trip | null>(null)
  const [days, setDays] = useState<Day[]>([])
  const [selectedDay, setSelectedDay] = useState<Day | null>(null)
  const [items, setItems] = useState<ItineraryItem[]>([])
  const [dayItemsByDayId, setDayItemsByDayId] = useState<Record<string, ItineraryItem[]>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isGeneratingDays, setIsGeneratingDays] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [hasOpenedMap, setHasOpenedMap] = useState(() => view === 'map')
  const [mapResizeToken, setMapResizeToken] = useState(0)
  const mapPreloadStartedRef = useRef(false)
  const backgroundMapWarmupStartedRef = useRef(false)

  useEffect(() => {
    resetMapStartupTrace()
  }, [])

  useEffect(() => {
    backgroundMapWarmupStartedRef.current = false
  }, [tripId])

  const refreshWorkspace = useCallback(async () => {
    if (!tripId) {
      setLoadError('缺少旅行 ID，请从首页选择一个旅行。')
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setLoadError(null)
    setActionError(null)
    try {
      const foundTrip = await getTrip(tripId)
      if (!foundTrip) {
        setTrip(null)
        setDays([])
        setSelectedDay(null)
        setItems([])
        setDayItemsByDayId({})
        setLoadError('没有找到这个旅行，请返回首页重新选择。')
        return
      }

      const foundDays = await listDaysByTrip(tripId)
      const nextSelectedDay = pickSelectedDay(foundTrip, foundDays, requestedDayId)
      const nextItems = nextSelectedDay ? await listItemsByDay(nextSelectedDay.id) : []

      setTrip(foundTrip)
      setDays(foundDays)
      setSelectedDay(nextSelectedDay)
      setItems(nextItems)
      setDayItemsByDayId(nextSelectedDay ? { [nextSelectedDay.id]: nextItems } : {})

      if (nextSelectedDay && requestedDayId !== nextSelectedDay.id) {
        navigateTo('trip', { tripId, dayId: nextSelectedDay.id, view })
      } else if (nextSelectedDay && !hasViewParam) {
        navigateTo('trip', { tripId, dayId: nextSelectedDay.id, view })
      }
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : '读取旅行工作台失败')
    } finally {
      setIsLoading(false)
    }
  }, [hasViewParam, requestedDayId, tripId, view])

  const refreshItems = useCallback(async () => {
    if (!selectedDay) {
      return
    }
    const nextItems = await listItemsByDay(selectedDay.id)
    setItems(nextItems)
    setDayItemsByDayId((current) => ({
      ...current,
      [selectedDay.id]: nextItems,
    }))
  }, [selectedDay])

  useEffect(() => {
    const timeout = window.setTimeout(() => void refreshWorkspace(), 0)
    return () => window.clearTimeout(timeout)
  }, [refreshWorkspace])

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

        setDayItemsByDayId(Object.fromEntries(entries))
        markMapStartup('prewarm day items loaded', { days: entries.length })
      }).catch(() => {
        markMapStartup('prewarm day items load ignored failure')
      })
    })

    return () => {
      cancelled = true
      cancelIdle()
    }
  }, [days, daysKey, isLoading, trip])

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

  async function handleGenerateDays() {
    if (!trip) {
      return
    }

    setIsGeneratingDays(true)
    setActionError(null)
    try {
      const nextDays = await ensureDaysForTrip(trip)
      const nextSelectedDay = pickSelectedDay(trip, nextDays, null)
      setDays(nextDays)
      setSelectedDay(nextSelectedDay)
      const nextItems = nextSelectedDay ? await listItemsByDay(nextSelectedDay.id) : []
      setItems(nextItems)
      setDayItemsByDayId(nextSelectedDay ? { [nextSelectedDay.id]: nextItems } : {})
      if (nextSelectedDay) {
        navigateTo('trip', { tripId: trip.id, dayId: nextSelectedDay.id, view })
      }
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : '生成每日行程失败')
    } finally {
      setIsGeneratingDays(false)
    }
  }

  function handleSelectDay(day: Day) {
    navigateTo('trip', { tripId: day.tripId, dayId: day.id, view })
  }

  function handleSwitchView(nextView: WorkspaceView) {
    if (!trip || !selectedDay) {
      return
    }
    if (nextView === 'map') {
      setHasOpenedMap(true)
    }
    navigateTo('trip', { tripId: trip.id, dayId: selectedDay.id, view: nextView })
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

  if (loadError || !trip) {
    return (
      <div className="space-y-5">
        <EmptyState
          body={loadError || '请从首页选择一个旅行。'}
          icon={<CalendarDays className="size-6" />}
          title="无法打开旅行工作台"
        />
        <Button className="w-full" onClick={() => navigateTo('home')} variant="secondary">
          返回首页
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
      <header className={`shrink-0 ${isMapView ? 'space-y-1.5' : 'space-y-3'}`}>
        <div className="flex items-center justify-between gap-3">
          <button
            aria-label="返回首页"
            className={`${isMapView ? 'size-9' : 'size-10'} flex items-center justify-center rounded-xl bg-white text-slate-700 ring-1 ring-slate-200/80 active:scale-[0.98]`}
            onClick={() => navigateTo('home')}
            type="button"
          >
            <ArrowLeft className={isMapView ? 'size-4' : 'size-5'} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-sky-600">
              {isMapView && selectedDay ? formatShortWorkspaceDate(selectedDay.date) : trip.destination || '目的地未定'}
            </p>
            <h1 className={`truncate font-semibold leading-tight text-slate-950 ${isMapView ? 'text-base' : 'text-xl'}`}>
              {trip.title}
            </h1>
            <p className="truncate text-xs text-slate-500">
              {isMapView && selectedDay ? selectedDay.title : formatDateRange(trip.startDate, trip.endDate)}
            </p>
          </div>
          <TripMoreMenu tripId={trip.id} />
        </div>
        {!isMapView ? <TripCover trip={trip} variant="compact" /> : null}
      </header>

      {days.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto app-scrollbar">
          <Card className="space-y-4">
            <TripCover trip={trip} variant="hero" />
            <EmptyState
              body="先按旅行日期生成每日行程，然后开始添加地点、交通段和票据。"
              icon={<CalendarDays className="size-6" />}
              title="这趟旅行还没有每日行程"
            />
            {actionError ? (
              <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-600">
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
      ) : selectedDay ? (
        <>
          <div className={`shrink-0 ${isMapView ? 'space-y-1.5' : 'space-y-3'}`}>
            <DaySelector
              days={days}
              density={isMapView ? 'compact' : 'regular'}
              onSelectDay={handleSelectDay}
              selectedDayId={selectedDay.id}
            />
            <div className={`grid grid-cols-2 bg-white ring-1 ring-slate-200/80 ${
              isMapView ? 'rounded-xl p-1' : 'rounded-2xl p-1.5'
            }`}>
              <ViewButton active={view === 'schedule'} compact={isMapView} icon={<Route className="size-4" />} label="日程" onClick={() => handleSwitchView('schedule')} testId="view-switch-schedule" />
              <ViewButton active={view === 'map'} compact={isMapView} icon={<Map className="size-4" />} label="地图" onClick={() => handleSwitchView('map')} testId="view-switch-map" />
            </div>
          </div>

          <div className="relative min-h-0 flex-1 overflow-hidden">
            <div
              aria-hidden={isMapView}
              className={`absolute inset-0 min-h-0 overflow-y-auto pr-1 app-scrollbar transition-opacity duration-200 motion-reduce:transition-none ${
                isMapView ? 'invisible pointer-events-none opacity-0' : 'visible opacity-100'
              }`}
            >
              <DayTimelineView
                compact
                day={selectedDay}
                items={items}
                onItemsChange={refreshItems}
                onOpenItem={(item) =>
                  navigateTo('item', { tripId: trip.id, dayId: selectedDay.id, itemId: item.id })
                }
                onSwitchToMap={() => handleSwitchView('map')}
                trip={trip}
              />
            </div>

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
                    dayItemsByDayId={dayItemsByDayId}
                    embedded
                    isVisible={isMapView}
                    items={items}
                    onBackToTimeline={() => handleSwitchView('schedule')}
                    onEditItem={() => handleSwitchView('schedule')}
                    onItemsChange={refreshItems}
                    onOpenItem={(item) =>
                      navigateTo('item', {
                        tripId: trip.id,
                        dayId: selectedDay.id,
                        itemId: item.id,
                        fromView: 'map',
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

          <p className="sr-only">
            当前第 {selectedDayIndex + 1} 天
          </p>
        </>
      ) : null}
    </div>
  )
}

function ViewButton({
  active,
  compact = false,
  icon,
  label,
  onClick,
  testId,
}: {
  active: boolean
  compact?: boolean
  icon: ReactNode
  label: string
  onClick: () => void
  testId?: string
}) {
  return (
    <button
      className={`flex items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-[0.98] ${
        compact ? 'min-h-8 text-xs' : 'min-h-10 text-sm'
      } ${
        active ? 'bg-[#1677ff] text-white shadow-sm' : 'text-slate-500'
      }`}
      data-testid={testId}
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
  )
}

function pickSelectedDay(trip: Trip, days: Day[], requestedDayId: string | null) {
  if (days.length === 0) {
    return null
  }

  const requestedDay = requestedDayId ? days.find((day) => day.id === requestedDayId) : undefined
  if (requestedDay) {
    return requestedDay
  }

  const today = formatDateKey(new Date())
  if (today >= trip.startDate && today <= trip.endDate) {
    const todayDay = days.find((day) => day.date === today)
    if (todayDay) {
      return todayDay
    }
  }

  return [...days].sort((a, b) => a.sortOrder - b.sortOrder)[0]
}

function normalizeView(value: string | null): WorkspaceView {
  return value === 'map' ? 'map' : 'schedule'
}

function formatDateKey(date: Date) {
  const pad = (value: number) => value.toString().padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function formatShortWorkspaceDate(date: string) {
  const parsed = new Date(`${date}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) {
    return '日期未定'
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).format(parsed)
}

function SkeletonLine({ className = '' }: { className?: string }) {
  return <div className={`h-4 animate-pulse rounded-full bg-slate-100 ${className}`} />
}

function MapLoadingFallback({ day, items }: { day: Day; items: ItineraryItem[] }) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#eaf2f9] p-4" data-testid="map-loading-fallback">
      <div className="rounded-2xl bg-white/85 p-4 shadow-[0_12px_32px_rgba(47,65,88,0.10)] ring-1 ring-white/80">
        <SkeletonLine className="w-1/2" />
        <p className="mt-3 text-sm font-medium text-slate-600">
          地图加载中，本地行程仍可查看。
        </p>
      </div>
      <div className="mt-auto max-h-[54%] min-h-0 rounded-t-3xl bg-white/90 p-4 shadow-[0_-14px_36px_rgba(47,65,88,0.12)] ring-1 ring-white/80">
        <div className="mx-auto mb-4 h-1.5 w-11 rounded-full bg-slate-300" />
        <p className="text-xs font-semibold text-sky-600">{formatShortWorkspaceDate(day.date)}</p>
        <h2 className="mt-1 truncate text-base font-semibold text-slate-950">{day.title}</h2>
        <p className="mt-1 text-xs text-slate-500">{items.length} 个行程点，本地列表可先查看。</p>
        <div className="mt-3 min-h-0 overflow-y-auto app-scrollbar">
          <div className="space-y-2 pb-3">
            {items.slice(0, 4).map((item, index) => (
              <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2" key={item.id}>
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-bold text-sky-700">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-950">{item.title}</span>
                  <span className="flex items-center gap-1 truncate text-xs text-slate-500">
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
  return <div className="h-full min-h-0 bg-[#eaf2f9]" data-testid="map-loading-fallback" />
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
