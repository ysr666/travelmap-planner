import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft, CalendarDays, ChevronRight, HardDriveDownload, NotebookText, RotateCw, Ticket } from 'lucide-react'
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
    </div>
  )
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
