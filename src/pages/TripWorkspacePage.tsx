import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft, CalendarDays, Map, Route, RotateCw } from 'lucide-react'
import { getTrip, listDaysByTrip, listItemsByDay } from '../db'
import { DayMapView } from '../components/trip/DayMapView'
import { DaySelector } from '../components/trip/DaySelector'
import { DayTimelineView } from '../components/trip/DayTimelineView'
import { TripCover } from '../components/trip/TripCover'
import { TripMoreMenu } from '../components/trip/TripMoreMenu'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { ensureDaysForTrip, formatDateRange } from '../lib/dates'
import { getRouteParams, navigateTo } from '../lib/routes'
import type { Day, ItineraryItem, Trip } from '../types'

type WorkspaceView = 'schedule' | 'map'

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
  const [isLoading, setIsLoading] = useState(true)
  const [isGeneratingDays, setIsGeneratingDays] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

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
    setItems(await listItemsByDay(selectedDay.id))
  }, [selectedDay])

  useEffect(() => {
    const timeout = window.setTimeout(() => void refreshWorkspace(), 0)
    return () => window.clearTimeout(timeout)
  }, [refreshWorkspace])

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
      setItems(nextSelectedDay ? await listItemsByDay(nextSelectedDay.id) : [])
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

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden pb-[max(1rem,env(safe-area-inset-bottom))]">
      <header className="shrink-0 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <button
            aria-label="返回首页"
            className="flex size-10 items-center justify-center rounded-xl bg-white text-slate-700 ring-1 ring-slate-200/80 active:scale-[0.98]"
            onClick={() => navigateTo('home')}
            type="button"
          >
            <ArrowLeft className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-sky-600">{trip.destination || '目的地未定'}</p>
            <h1 className="truncate text-xl font-semibold leading-tight text-slate-950">{trip.title}</h1>
            <p className="truncate text-xs text-slate-500">{formatDateRange(trip.startDate, trip.endDate)}</p>
          </div>
          <TripMoreMenu tripId={trip.id} />
        </div>
        <TripCover trip={trip} variant="compact" />
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
          <div className="shrink-0 space-y-3">
            <DaySelector days={days} onSelectDay={handleSelectDay} selectedDayId={selectedDay.id} />
            <div className="grid grid-cols-2 rounded-2xl bg-white p-1.5 ring-1 ring-slate-200/80">
              <ViewButton active={view === 'schedule'} icon={<Route className="size-4" />} label="日程" onClick={() => handleSwitchView('schedule')} />
              <ViewButton active={view === 'map'} icon={<Map className="size-4" />} label="地图" onClick={() => handleSwitchView('map')} />
            </div>
          </div>

          {view === 'schedule' ? (
            <div className="min-h-0 flex-1 overflow-y-auto pr-1 app-scrollbar">
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
          ) : (
            <div className="-mx-4 min-h-0 flex-1 overflow-hidden">
              <DayMapView
                day={selectedDay}
                embedded
                items={items}
                onBackToTimeline={() => handleSwitchView('schedule')}
                onEditItem={() => handleSwitchView('schedule')}
                onOpenItem={(item) =>
                  navigateTo('item', {
                    tripId: trip.id,
                    dayId: selectedDay.id,
                    itemId: item.id,
                    fromView: 'map',
                  })
                }
                showFloatingHeader={false}
                trip={trip}
              />
            </div>
          )}

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
  icon,
  label,
  onClick,
}: {
  active: boolean
  icon: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      className={`flex min-h-10 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition active:scale-[0.98] ${
        active ? 'bg-[#1677ff] text-white shadow-sm' : 'text-slate-500'
      }`}
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

function SkeletonLine({ className = '' }: { className?: string }) {
  return <div className={`h-4 animate-pulse rounded-full bg-slate-100 ${className}`} />
}
