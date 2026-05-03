import { useCallback, useEffect, useState } from 'react'
import { Clock3 } from 'lucide-react'
import { getDay, getTrip, listItemsByDay } from '../db'
import { DayTimelineView } from '../components/trip/DayTimelineView'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { TripNav } from '../components/AppShell'
import { formatDate } from '../lib/dates'
import { getRouteParams, navigateTo } from '../lib/routes'
import type { Day, ItineraryItem, Trip } from '../types'

export function DayTimelinePage() {
  const params = getRouteParams()
  const tripId = params.get('tripId')
  const dayId = params.get('dayId')
  const [trip, setTrip] = useState<Trip | null>(null)
  const [day, setDay] = useState<Day | null>(null)
  const [items, setItems] = useState<ItineraryItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const refreshDay = useCallback(async () => {
    if (!tripId || !dayId) {
      setLoadError('缺少旅行或日期参数，请从旅行总览进入每日时间轴。')
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setLoadError(null)
    try {
      const [foundTrip, foundDay, foundItems] = await Promise.all([
        getTrip(tripId),
        getDay(dayId),
        listItemsByDay(dayId),
      ])

      if (!foundTrip || !foundDay || foundDay.tripId !== tripId) {
        setTrip(null)
        setDay(null)
        setItems([])
        setLoadError('没有找到这个日期，请返回旅行总览重新选择。')
        return
      }

      setTrip(foundTrip)
      setDay(foundDay)
      setItems(foundItems)
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : '读取时间轴失败')
    } finally {
      setIsLoading(false)
    }
  }, [dayId, tripId])

  useEffect(() => {
    const timeout = window.setTimeout(() => void refreshDay(), 0)
    return () => window.clearTimeout(timeout)
  }, [refreshDay])

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

  if (loadError || !trip || !day) {
    return (
      <div className="space-y-5">
        <EmptyState
          body={loadError || '请从旅行总览选择某一天。'}
          icon={<Clock3 className="size-6" />}
          title="无法打开时间轴"
        />
        <Button
          className="w-full"
          onClick={() => (tripId ? navigateTo('overview', { tripId }) : navigateTo('home'))}
          variant="secondary"
        >
          {tripId ? '返回旅行总览' : '返回首页'}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <Card className="space-y-1">
        <p className="text-sm font-semibold text-sky-600">{formatDate(day.date)}</p>
        <h2 className="text-xl font-semibold text-slate-950">{day.title}</h2>
        <p className="text-sm text-slate-500">
          {trip.title} · {items.length} 个行程点
        </p>
      </Card>

      <TripNav activeRoute="timeline" dayId={day.id} tripId={trip.id} />

      <DayTimelineView
        day={day}
        items={items}
        onItemsChange={refreshDay}
        onOpenItem={(item) => navigateTo('item', { tripId: trip.id, dayId: day.id, itemId: item.id })}
        onSwitchToMap={() => navigateTo('map', { tripId: trip.id, dayId: day.id })}
        trip={trip}
      />
    </div>
  )
}

function SkeletonLine({ className = '' }: { className?: string }) {
  return <div className={`h-4 animate-pulse rounded-full bg-slate-100 ${className}`} />
}
