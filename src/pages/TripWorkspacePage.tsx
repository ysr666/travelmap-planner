import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CalendarDays, ChevronRight, HardDriveDownload, Map, NotebookText, RotateCw, Ticket } from 'lucide-react'
import { listItemsByDay } from '../db'
import { TripCover } from '../components/trip/TripCover'
import { TripMoreMenu } from '../components/trip/TripMoreMenu'
import { TravelBackupPanel } from '../components/trip/TravelBackupPanel'
import { TripNav } from '../components/AppShell'
import { AutoSnapshotBackupStatus } from '../components/cloud/AutoSnapshotBackupStatus'
import { CloudSnapshotCheckPrompts } from '../components/cloud/CloudSnapshotCheckPrompts'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Collapsible } from '../components/ui/Collapsible'
import { EmptyState } from '../components/ui/EmptyState'
import { SkeletonLine } from '../components/ui/SkeletonLine'
import { useTripData } from '../hooks/useTripData'
import { ensureDaysForTrip, formatDate, formatDateRange } from '../lib/dates'
import { formatChineseDayOrdinal } from '../lib/dayOrdinal'
import { getRouteParams, navigateTo } from '../lib/routes'
import type { Day } from '../types'

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
  } = useTripData({ tripId, dayId: requestedDayId })

  const [isGeneratingDays, setIsGeneratingDays] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

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
    void Promise.all(
      days.map(async (day) => {
        const dayItems = await listItemsByDay(day.id)
        return [day.id, dayItems] as const
      }),
    ).then((entries) => {
      if (!cancelled) {
        setItemsByDay(Object.fromEntries(entries))
      }
    }).catch(() => {
      // Trip Home can still render without aggregate item counts.
    })

    return () => {
      cancelled = true
    }
  }, [days, isLoading, setItemsByDay, trip])

  const itemsByDayCount = useMemo(() => {
    return allItems.reduce<Record<string, number>>((acc, item) => {
      acc[item.dayId] = (acc[item.dayId] ?? 0) + 1
      return acc
    }, {})
  }, [allItems])

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
            className="flex size-10 items-center justify-center rounded-xl bg-white text-slate-700 ring-1 ring-slate-200/80 active:scale-[0.98]"
            onClick={() => navigateTo('home')}
            type="button"
          >
            <ArrowLeft className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-sky-600">
              {trip.destination || '目的地未定'}
            </p>
            <h1 className="truncate text-xl font-semibold leading-tight text-slate-950">
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
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pr-1 app-scrollbar">
          <div className="space-y-4 pb-4">
            <Card className="space-y-3">
              <TripCover trip={trip} variant="hero" />
              <div>
                <p className="text-xs font-semibold text-sky-600">{trip.destination}</p>
                <h2 className="mt-1 text-xl font-semibold leading-tight text-slate-950">
                  {trip.title}
                </h2>
                <p className="mt-2 text-sm text-slate-500">
                  {formatDateRange(trip.startDate, trip.endDate)}
                </p>
                <div className="mt-2">
                  <AutoSnapshotBackupStatus tripId={trip.id} />
                </div>
              </div>
              <CloudSnapshotCheckPrompts maxItems={1} tripId={trip.id} variant="trip" />
              <div className="grid grid-cols-2 gap-3">
                <OverviewMetric label="天数" value={days.length.toString()} />
                <OverviewMetric label="行程点" value={allItems.length.toString()} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Button
                  className="whitespace-nowrap px-2 text-xs"
                  disabled={days.length === 0}
                  icon={<Map className="size-4" />}
                  onClick={() => {
                    const firstDay = days[0]
                    if (firstDay) openDay(firstDay, 'map')
                  }}
                >
                  地图
                </Button>
                <Button
                  className="whitespace-nowrap px-2 text-xs"
                  icon={<Ticket className="size-4" />}
                  onClick={() => navigateTo('tickets', { tripId: trip.id })}
                  variant="secondary"
                >
                  票据库
                </Button>
                <Button
                  className="whitespace-nowrap px-2 text-xs"
                  icon={<HardDriveDownload className="size-4" />}
                  onClick={() => document.getElementById('travel-backup-panel')?.scrollIntoView({ behavior: 'smooth' })}
                  variant="secondary"
                >
                  备份
                </Button>
              </div>
            </Card>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-950">每日行程</h3>
              <Card className="divide-y divide-slate-100 p-0">
                {days.map((day, index) => (
                  <div
                    className="flex cursor-pointer items-center gap-3 px-4 py-3 transition hover:bg-slate-50 active:bg-slate-100"
                    key={day.id}
                    onClick={() => openDay(day, 'schedule')}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') openDay(day, 'schedule')
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <span className="flex min-h-8 w-14 shrink-0 items-center justify-center rounded-lg bg-sky-50 px-2 text-xs font-bold text-sky-600">
                      {formatChineseDayOrdinal(index + 1)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-950">
                        {formatDate(day.date)}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-slate-500">
                        {day.title}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-slate-400">
                        {itemsByDayCount[day.id] ?? itemsByDay[day.id]?.length ?? 0} 个行程点
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-slate-300" />
                  </div>
                ))}
              </Card>
            </section>

            {trip.notes ? (
              <Card className="flex items-start gap-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                  <NotebookText className="size-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-950">旅行备注</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-500">{trip.notes}</p>
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
    </div>
  )
}

function OverviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2.5 text-center">
      <p className="text-lg font-semibold text-slate-950">{value}</p>
      <p className="text-xs font-semibold text-slate-400">{label}</p>
    </div>
  )
}
