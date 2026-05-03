import { useEffect, useState } from 'react'
import { MapPin } from 'lucide-react'
import { getDay, getTrip, listItemsByDay } from '../db'
import { DayMapView } from '../components/trip/DayMapView'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { getRouteParams, navigateTo } from '../lib/routes'
import type { Day, ItineraryItem, Trip } from '../types'

export function MapPage() {
  const params = getRouteParams()
  const tripId = params.get('tripId')
  const dayId = params.get('dayId')
  const [trip, setTrip] = useState<Trip | null>(null)
  const [day, setDay] = useState<Day | null>(null)
  const [items, setItems] = useState<ItineraryItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    async function loadMapContext() {
      if (!tripId || !dayId) {
        if (isMounted) {
          setLoadError('缺少旅行或日期参数，请从时间轴进入地图。')
          setIsLoading(false)
        }
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

        if (!isMounted) {
          return
        }

        if (!foundTrip || !foundDay || foundDay.tripId !== tripId) {
          setLoadError('没有找到这个日期，请返回时间轴重新选择。')
          setTrip(null)
          setDay(null)
          setItems([])
          return
        }

        setTrip(foundTrip)
        setDay(foundDay)
        setItems(foundItems)
      } catch (caught) {
        if (isMounted) {
          setLoadError(caught instanceof Error ? caught.message : '读取地图数据失败')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void loadMapContext()

    return () => {
      isMounted = false
    }
  }, [tripId, dayId])

  if (isLoading) {
    return (
      <div className="app-viewport overflow-hidden bg-[#eaf2f9] px-4 pt-[max(5rem,env(safe-area-inset-top))]">
        <div className="rounded-2xl border border-white/80 bg-white/90 p-4 shadow-[0_8px_22px_rgba(47,65,88,0.05)]">
          <SkeletonLine className="w-2/3" />
          <SkeletonLine className="mt-3 w-full" />
          <SkeletonLine className="mt-3 w-1/2" />
        </div>
        <div className="mt-3 h-[58dvh] rounded-2xl bg-white/70" />
      </div>
    )
  }

  if (loadError || !trip || !day) {
    return (
      <div className="app-viewport overflow-hidden bg-[#eaf2f9] px-4 pt-[max(5rem,env(safe-area-inset-top))]">
        <EmptyState
          body={loadError || '请从时间轴进入某一天的地图。'}
          icon={<MapPin className="size-6" />}
          title="无法打开地图"
        />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Button onClick={() => navigateTo('home')} variant="secondary">
            返回首页
          </Button>
          <Button
            disabled={!tripId}
            onClick={() => (tripId ? navigateTo('overview', { tripId }) : undefined)}
          >
            返回总览
          </Button>
        </div>
      </div>
    )
  }

  return (
    <DayMapView
      day={day}
      items={items}
      onBackToTimeline={() => navigateTo('timeline', { tripId: trip.id, dayId: day.id })}
      onEditItem={() => navigateTo('timeline', { tripId: trip.id, dayId: day.id })}
      onOpenItem={(item) => navigateTo('item', { tripId: trip.id, dayId: day.id, itemId: item.id, fromView: 'map' })}
      trip={trip}
    />
  )
}

function SkeletonLine({ className = '' }: { className?: string }) {
  return <div className={`h-4 animate-pulse rounded-full bg-slate-100 ${className}`} />
}
