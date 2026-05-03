import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, ArrowDown, ExternalLink, LocateFixed, MapPin, Navigation } from 'lucide-react'
import { getDay, getTrip, listItemsByDay } from '../db'
import { BottomDrawer } from '../components/BottomDrawer'
import { DayMap } from '../components/DayMap'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { buildAppleMapsUrl, buildGoogleMapsUrl, hasValidCoordinates } from '../lib/mapLinks'
import { describeItemTime, describePreviousTransport } from '../lib/itinerary'
import { formatDate } from '../lib/dates'
import { getRouteParams, navigateTo } from '../lib/routes'
import type { Day, ItineraryItem, Trip } from '../types'

type DrawerMode = 'compact' | 'balanced' | 'expanded'

const drawerModes: Array<{ id: DrawerMode; label: string }> = [
  { id: 'compact', label: '地图' },
  { id: 'balanced', label: '平衡' },
  { id: 'expanded', label: '列表' },
]

const mapHeightByMode: Record<DrawerMode, string> = {
  compact: 'h-[56dvh] min-h-[360px]',
  balanced: 'h-[42dvh] min-h-[300px]',
  expanded: 'h-[25dvh] min-h-[210px]',
}

const drawerHeightByMode: Record<DrawerMode, string> = {
  compact: 'max-h-[30dvh]',
  balanced: 'max-h-[46dvh]',
  expanded: 'max-h-[64dvh]',
}

export function MapPage() {
  const params = getRouteParams()
  const tripId = params.get('tripId')
  const dayId = params.get('dayId')
  const [trip, setTrip] = useState<Trip | null>(null)
  const [day, setDay] = useState<Day | null>(null)
  const [items, setItems] = useState<ItineraryItem[]>([])
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('balanced')
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [mapError, setMapError] = useState<string | null>(null)
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  const mappedItems = useMemo(() => items.filter(hasValidCoordinates), [items])
  const selectedItem = useMemo(() => {
    return items.find((item) => item.id === selectedItemId) ?? mappedItems[0] ?? items[0] ?? null
  }, [items, mappedItems, selectedItemId])

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
      setNotice(null)
      setMapError(null)
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
        setSelectedItemId(foundItems.find(hasValidCoordinates)?.id ?? foundItems[0]?.id ?? null)
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

  function handleSelectItem(item: ItineraryItem) {
    setSelectedItemId(item.id)
    setDrawerMode((current) => (current === 'compact' ? 'balanced' : current))

    if (!hasValidCoordinates(item)) {
      setNotice('该行程点暂无坐标，可去时间轴编辑坐标。')
    } else {
      setNotice(null)
    }

    window.setTimeout(() => {
      itemRefs.current[item.id]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }, 80)
  }

  if (isLoading) {
    return (
      <div className="min-h-svh bg-[#eaf2f9] px-4 pb-8 pt-24">
        <Card className="mb-3 space-y-3">
          <SkeletonLine className="w-2/3" />
          <SkeletonLine className="w-full" />
          <SkeletonLine className="w-1/2" />
        </Card>
        <div className="h-[42dvh] min-h-[300px] rounded-[28px] bg-white/70" />
      </div>
    )
  }

  if (loadError || !trip || !day) {
    return (
      <div className="min-h-svh bg-[#eaf2f9] px-4 pb-8 pt-24">
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
    <div className="min-h-svh overflow-x-hidden bg-[#eaf2f9] pb-4 pt-24">
      <div className="px-4">
        <Card className="mb-3 space-y-3">
          <div>
            <p className="text-xs font-semibold text-sky-600">{trip.title}</p>
            <div className="mt-1 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-2xl font-bold text-slate-950">{day.title}</h2>
                <p className="mt-1 text-sm text-slate-500">{formatDate(day.date)}</p>
              </div>
              <div className="shrink-0 rounded-2xl bg-sky-50 px-3 py-2 text-right">
                <p className="text-sm font-bold text-sky-700">{items.length} 个行程</p>
                <p className="text-xs font-semibold text-sky-500">{mappedItems.length} 个坐标</p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1 rounded-2xl bg-slate-100 p-1">
            {drawerModes.map((mode) => (
              <button
                className={`min-h-9 rounded-xl text-xs font-bold transition active:scale-[0.98] ${
                  drawerMode === mode.id ? 'bg-white text-[#1677ff] shadow-sm' : 'text-slate-500'
                }`}
                key={mode.id}
                onClick={() => setDrawerMode(mode.id)}
                type="button"
              >
                {mode.label}
              </button>
            ))}
          </div>
        </Card>

        {items.length === 0 ? (
          <div className={`${mapHeightByMode[drawerMode]} rounded-[28px] border border-white/80 bg-white/80 p-4 shadow-[0_16px_34px_rgba(47,65,88,0.08)]`}>
            <div className="flex h-full items-center justify-center">
              <EmptyState
                body="返回时间轴添加酒店、景点、交通或餐厅后，再查看地图。"
                icon={<MapPin className="size-6" />}
                title="今天还没有行程点"
              />
            </div>
          </div>
        ) : (
          <DayMap
            heightClassName={mapHeightByMode[drawerMode]}
            items={items}
            onMapError={(message) => setMapError(message)}
            onSelectItem={handleSelectItem}
            selectedItemId={selectedItemId}
          />
        )}
      </div>

      <BottomDrawer
        className={`mt-3 overflow-y-auto safe-bottom app-scrollbar ${drawerHeightByMode[drawerMode]} transition-[max-height] duration-300`}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-sky-600">
              {trip.title} · {formatDate(day.date)}
            </p>
            <h2 className="truncate text-xl font-bold text-slate-950">{day.title}</h2>
            <p className="mt-1 text-xs text-slate-500">
              {items.length} 个行程点 · {mappedItems.length} 个带坐标
            </p>
          </div>
          <Button
            className="min-h-10 shrink-0 rounded-2xl px-3 whitespace-nowrap"
            icon={<Navigation className="size-4" />}
            onClick={() => navigateTo('timeline', { tripId: trip.id, dayId: day.id })}
          >
            时间轴
          </Button>
        </div>

        {mapError ? (
          <div className="mb-3 rounded-2xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {mapError}
          </div>
        ) : null}

        {notice ? (
          <div className="mb-3 flex items-start gap-2 rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-slate-400" />
            <span>{notice}</span>
          </div>
        ) : null}

        {selectedItem ? (
          <SelectedItemCard item={selectedItem} trip={trip} day={day} />
        ) : null}

        <div className="mt-3 space-y-2">
          {items.length === 0 ? (
            <p className="rounded-2xl bg-slate-50 px-3 py-4 text-sm text-slate-500">
              这一天还没有行程点。
            </p>
          ) : (
            items.map((item, index) => {
              const previousTransportDescription = describePreviousTransport(item)

              return (
                <div className="space-y-1.5" key={item.id}>
                  {index > 0 && previousTransportDescription ? (
                    <TransportSegment description={previousTransportDescription} />
                  ) : null}
                  <button
                    className={`flex w-full items-center gap-3 rounded-2xl p-2 text-left transition active:bg-slate-50 ${
                      selectedItemId === item.id ? 'bg-sky-50' : ''
                    }`}
                    onClick={() => handleSelectItem(item)}
                    ref={(node) => {
                      itemRefs.current[item.id] = node
                    }}
                    type="button"
                  >
                    <span
                      className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                        hasValidCoordinates(item) ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-400'
                      }`}
                    >
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-950">
                        {item.title}
                      </span>
                      <span className="flex items-center gap-1 truncate text-xs text-slate-500">
                        <MapPin className="size-3.5 shrink-0" />
                        {item.locationName || item.address || '地点未填写'}
                      </span>
                    </span>
                    <span className="text-xs font-semibold text-slate-400">
                      {describeItemTime(item)}
                    </span>
                  </button>
                </div>
              )
            })
          )}
        </div>
      </BottomDrawer>
    </div>
  )
}

function SelectedItemCard({ item, trip, day }: { item: ItineraryItem; trip: Trip; day: Day }) {
  const hasCoordinates = hasValidCoordinates(item)

  return (
    <Card className="border-sky-100 bg-white p-3">
      <p className="text-xs font-semibold text-sky-600">{describeItemTime(item)}</p>
      <h3 className="mt-1 text-lg font-bold text-slate-950">{item.title}</h3>
      <p className="mt-1 text-sm text-slate-500">{item.locationName || '地点未填写'}</p>
      <p className="mt-1 line-clamp-2 text-xs text-slate-400">{item.address || '地址未填写'}</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Button
          className="min-h-10 rounded-xl px-2"
          onClick={() => navigateTo('item', { tripId: trip.id, dayId: day.id, itemId: item.id })}
          variant="secondary"
        >
          详情
        </Button>
        <a
          className={`inline-flex min-h-10 items-center justify-center gap-1 rounded-xl px-2 text-xs font-semibold ${
            hasCoordinates ? 'bg-[#1677ff] text-white' : 'bg-slate-100 text-slate-400'
          }`}
          href={hasCoordinates ? buildAppleMapsUrl(item) : undefined}
          rel="noreferrer"
          target="_blank"
        >
          <LocateFixed className="size-3.5" />
          Apple
        </a>
        <a
          className={`inline-flex min-h-10 items-center justify-center gap-1 rounded-xl px-2 text-xs font-semibold ${
            hasCoordinates ? 'bg-white text-slate-800 ring-1 ring-slate-200' : 'bg-slate-100 text-slate-400'
          }`}
          href={hasCoordinates ? buildGoogleMapsUrl(item) : undefined}
          rel="noreferrer"
          target="_blank"
        >
          <ExternalLink className="size-3.5" />
          Google
        </a>
      </div>
      {!hasCoordinates ? (
        <Button
          className="mt-2 w-full"
          onClick={() => navigateTo('timeline', { tripId: trip.id, dayId: day.id })}
          variant="secondary"
        >
          去时间轴编辑坐标
        </Button>
      ) : null}
    </Card>
  )
}

function SkeletonLine({ className = '' }: { className?: string }) {
  return <div className={`h-4 animate-pulse rounded-full bg-slate-100 ${className}`} />
}

function TransportSegment({ description }: { description: string }) {
  return (
    <div className="mx-2 flex items-center gap-1.5 rounded-xl bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-500">
      <ArrowDown className="size-3 shrink-0 text-slate-400" />
      <span className="min-w-0 truncate">{description}</span>
    </div>
  )
}
