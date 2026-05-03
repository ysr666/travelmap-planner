import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, HardDriveDownload, Map, NotebookText, RotateCw, Ticket } from 'lucide-react'
import { ensureDaysForTrip, formatDate, formatDateRange, getDayGenerationState } from '../lib/dates'
import { getRouteParams, navigateTo } from '../lib/routes'
import { getTrip, listDaysByTrip, listItemsByTrip } from '../db'
import type { Day, ItineraryItem, Trip } from '../types'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { SectionHeader } from '../components/ui/SectionHeader'
import { TripNav } from '../components/AppShell'

export function TripOverviewPage() {
  const [trip, setTrip] = useState<Trip | null>(null)
  const [days, setDays] = useState<Day[]>([])
  const [items, setItems] = useState<ItineraryItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isGeneratingDays, setIsGeneratingDays] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const tripId = getRouteParams().get('tripId')

  const itemsByDay = useMemo(() => {
    return items.reduce<Record<string, number>>((acc, item) => {
      acc[item.dayId] = (acc[item.dayId] ?? 0) + 1
      return acc
    }, {})
  }, [items])

  const generationState = trip ? getDayGenerationState(trip, days) : null
  const firstDay = days[0]

  const refreshTrip = useCallback(async () => {
    if (!tripId) {
      setTrip(null)
      setDays([])
      setItems([])
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
        setItems([])
        setLoadError('没有找到这个旅行，请返回首页重新选择。')
        return
      }

      const [foundDays, foundItems] = await Promise.all([
        listDaysByTrip(tripId),
        listItemsByTrip(tripId),
      ])
      setTrip(foundTrip)
      setDays(foundDays)
      setItems(foundItems)
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : '读取旅行失败')
    } finally {
      setIsLoading(false)
    }
  }, [tripId])

  useEffect(() => {
    const timeout = window.setTimeout(() => void refreshTrip(), 0)
    return () => window.clearTimeout(timeout)
  }, [refreshTrip])

  async function handleGenerateDays() {
    if (!trip || !generationState || generationState.disabled) {
      return
    }

    setIsGeneratingDays(true)
    setActionError(null)
    try {
      const nextDays = await ensureDaysForTrip(trip)
      setDays(nextDays)
      setItems(await listItemsByTrip(trip.id))
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : '生成每日行程失败')
    } finally {
      setIsGeneratingDays(false)
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-5">
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
          title="无法打开旅行"
        />
        <Button className="w-full" onClick={() => navigateTo('home')} variant="secondary">
          返回首页
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <Card className="space-y-3">
        <div>
          <p className="text-xs font-semibold text-sky-600">{trip.destination}</p>
          <h2 className="mt-1 text-xl font-semibold leading-tight text-slate-950">
            {trip.title}
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            {formatDateRange(trip.startDate, trip.endDate)}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <OverviewMetric label="天数" value={days.length.toString()} />
          <OverviewMetric label="行程" value={items.length.toString()} />
          <OverviewMetric
            label="已定位"
            value={items.filter((item) => item.lat !== undefined && item.lng !== undefined).length.toString()}
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Button
            className="whitespace-nowrap px-2 text-xs"
            disabled={!firstDay}
            icon={<Map className="size-4" />}
            onClick={() =>
              firstDay
                ? navigateTo('map', { tripId: trip.id, dayId: firstDay.id })
                : undefined
            }
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
            onClick={() => navigateTo('settings', { tripId: trip.id })}
            variant="secondary"
          >
            备份
          </Button>
        </div>
      </Card>

      <TripNav activeRoute="overview" firstDayId={firstDay?.id} tripId={trip.id} />

      <section className="space-y-3">
        <SectionHeader title="每日行程" />
        {actionError ? (
          <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
            {actionError}
          </div>
        ) : null}
        <Button
          className="w-full"
          disabled={!generationState || generationState.disabled}
          icon={<RotateCw className="size-4" />}
          loading={isGeneratingDays}
          onClick={() => void handleGenerateDays()}
          variant={generationState?.disabled ? 'secondary' : 'primary'}
        >
          {generationState?.label ?? '生成日期范围'}
        </Button>
        {days.length === 0 ? (
          <EmptyState
            body="点击生成日期范围后，会按旅行开始和结束日期创建每日行程。"
            icon={<CalendarDays className="size-6" />}
            title="还没有每日行程"
          />
        ) : (
          <Card className="space-y-1 p-2">
            {days.map((day) => (
              <div
                className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-xl p-2 transition hover:bg-slate-50"
                key={day.id}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                    <CalendarDays className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-950">
                      {formatDate(day.date)}
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-slate-500">
                      {day.title} · {itemsByDay[day.id] ?? 0} 个点
                    </span>
                  </span>
                </div>
                <Button
                  className="min-h-10 shrink-0 px-3 text-xs whitespace-nowrap"
                  onClick={() => navigateTo('timeline', { tripId: trip.id, dayId: day.id })}
                  variant="secondary"
                >
                  日程
                </Button>
                <Button
                  className="min-h-10 shrink-0 px-3 text-xs whitespace-nowrap"
                  icon={<Map className="size-4" />}
                  onClick={() => navigateTo('map', { tripId: trip.id, dayId: day.id })}
                  variant="secondary"
                >
                  地图
                </Button>
              </div>
            ))}
          </Card>
        )}
      </section>

      <Card className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
          <NotebookText className="size-4" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-950">旅行备注</h3>
          <p className="mt-1 text-sm leading-6 text-slate-500">{trip.notes || '暂无备注。'}</p>
        </div>
      </Card>
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

function SkeletonLine({ className = '' }: { className?: string }) {
  return <div className={`h-4 animate-pulse rounded-full bg-slate-100 ${className}`} />
}
