import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDown, Clock3, ExternalLink, MapPin, Navigation, Plus, Ticket, Trash2 } from 'lucide-react'
import {
  createItineraryItem,
  deleteItineraryItemCascade,
  getDay,
  getTrip,
  listItemsByDay,
  updateItineraryItem,
} from '../db'
import { ItineraryItemForm, type ItineraryItemFormValue } from '../components/ItineraryItemForm'
import { describeItemTime, describePreviousTransport, transportModeLabels } from '../lib/itinerary'
import { buildAppleMapsDirectionsUrl, buildGoogleMapsDirectionsUrl } from '../lib/mapLinks'
import { formatDate } from '../lib/dates'
import { getRouteParams, navigateTo } from '../lib/routes'
import type { Day, ItineraryItem, Trip } from '../types'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { SectionHeader } from '../components/ui/SectionHeader'

export function DayTimelinePage() {
  const params = getRouteParams()
  const tripId = params.get('tripId')
  const dayId = params.get('dayId')
  const [trip, setTrip] = useState<Trip | null>(null)
  const [day, setDay] = useState<Day | null>(null)
  const [items, setItems] = useState<ItineraryItem[]>([])
  const [editingItem, setEditingItem] = useState<ItineraryItem | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const maxSortOrder = useMemo(() => {
    return items.reduce((max, item) => Math.max(max, item.sortOrder), 0)
  }, [items])

  const refreshDay = useCallback(async () => {
    if (!tripId || !dayId) {
      setLoadError('缺少旅行或日期参数，请从旅行总览进入每日时间轴。')
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setLoadError(null)
    setActionError(null)
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

  async function handleCreateItem(value: ItineraryItemFormValue) {
    if (!trip || !day) {
      return
    }

    setIsSubmitting(true)
    setActionError(null)
    try {
      await createItineraryItem({
        ...value,
        tripId: trip.id,
        dayId: day.id,
        ticketIds: [],
        sortOrder: maxSortOrder + 1,
      })
      setIsCreating(false)
      await refreshDay()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : '新增行程点失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleUpdateItem(value: ItineraryItemFormValue) {
    if (!editingItem) {
      return
    }

    setIsSubmitting(true)
    setActionError(null)
    try {
      await updateItineraryItem(editingItem.id, value)
      setEditingItem(null)
      await refreshDay()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : '更新行程点失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleDeleteItem(item: ItineraryItem) {
    const confirmed = window.confirm(`确定删除「${item.title}」吗？绑定到该行程点的票据记录也会删除。`)
    if (!confirmed) {
      return
    }

    setDeletingItemId(item.id)
    setActionError(null)
    try {
      await deleteItineraryItemCascade(item.id)
      if (editingItem?.id === item.id) {
        setEditingItem(null)
      }
      await refreshDay()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : '删除行程点失败')
    } finally {
      setDeletingItemId(null)
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
      <Card className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-sky-600">{formatDate(day.date)}</p>
          <h2 className="mt-1 text-2xl font-bold text-slate-950">{day.title}</h2>
          <p className="mt-1 text-sm text-slate-500">
            {trip.title} · {items.length} 个行程点
          </p>
        </div>
        <Button
          className="size-12 rounded-2xl px-0"
          icon={<Plus className="size-5" />}
          onClick={() => {
            setIsCreating(true)
            setEditingItem(null)
          }}
        >
          <span className="sr-only">新增</span>
        </Button>
      </Card>

      {isCreating ? (
        <Card>
          <div className="mb-4">
            <h3 className="text-lg font-bold text-slate-950">新增行程点</h3>
            <p className="mt-1 text-sm text-slate-500">可手动输入坐标，或粘贴含坐标的地图链接。</p>
          </div>
          <ItineraryItemForm
            loading={isSubmitting}
            onCancel={() => setIsCreating(false)}
            onSubmit={handleCreateItem}
            submitLabel="保存行程点"
          />
        </Card>
      ) : null}

      {editingItem ? (
        <Card>
          <div className="mb-4">
            <h3 className="text-lg font-bold text-slate-950">编辑行程点</h3>
            <p className="mt-1 text-sm text-slate-500">{editingItem.title}</p>
          </div>
          <ItineraryItemForm
            initialItem={editingItem}
            loading={isSubmitting}
            onCancel={() => setEditingItem(null)}
            onSubmit={handleUpdateItem}
            submitLabel="保存修改"
          />
        </Card>
      ) : null}

      {actionError ? (
        <div className="rounded-[24px] border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
          {actionError}
        </div>
      ) : null}

      <section className="space-y-3">
        <SectionHeader
          action="地图"
          onAction={() => navigateTo('map', { tripId: trip.id, dayId: day.id })}
          title="时间轴"
        />
        {items.length === 0 ? (
          <EmptyState
            body="点击右上角新增按钮，添加当天的酒店、景点、交通或餐厅。"
            icon={<Clock3 className="size-6" />}
            title="这一天还没有行程点"
          />
        ) : (
          <div className="space-y-3">
            {items.map((item, index) => {
              const previousItem = index > 0 ? items[index - 1] : null
              const previousTransportDescription = describePreviousTransport(item)

              return (
                <div className="space-y-2" key={item.id}>
                  {previousItem && previousTransportDescription ? (
                    <TransportSegment description={previousTransportDescription} />
                  ) : null}
                  <div className="grid w-full grid-cols-[2.8rem_1fr] gap-3">
                    <div className="relative flex justify-center">
                      <div className="z-10 flex size-9 items-center justify-center rounded-full bg-[#1677ff] text-sm font-bold text-white shadow-lg shadow-sky-200">
                        {index + 1}
                      </div>
                      {index !== items.length - 1 ? (
                        <div className="absolute top-9 h-[calc(100%+0.75rem)] w-px bg-slate-200" />
                      ) : null}
                    </div>
                    <Card className="p-4">
                      <button
                        className="w-full text-left"
                        onClick={() =>
                          navigateTo('item', {
                            tripId: trip.id,
                            dayId: day.id,
                            itemId: item.id,
                          })
                        }
                        type="button"
                      >
                        <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-400">
                          <Clock3 className="size-3.5" />
                          {describeItemTime(item)} ·{' '}
                          {item.transportMode ? transportModeLabels[item.transportMode] : '交通未定'}
                        </p>
                        <h3 className="mt-1 truncate text-lg font-bold text-slate-950">{item.title}</h3>
                        <p className="mt-1 flex items-start gap-1.5 text-sm leading-5 text-slate-500">
                          <MapPin className="mt-0.5 size-4 shrink-0" />
                          <span className="line-clamp-2">
                            {item.locationName || item.address || '地点未填写'}
                          </span>
                        </p>
                      </button>
                      {previousItem ? (
                        <DirectionsLinks fromItem={previousItem} toItem={item} />
                      ) : null}
                      <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
                        <span className="flex items-center gap-1 rounded-full bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-500">
                          <Ticket className="size-3.5" />
                          {item.ticketIds.length}
                        </span>
                        <div className="flex gap-2">
                          <Button
                            className="min-h-9 rounded-xl px-3"
                            onClick={() => {
                              setEditingItem(item)
                              setIsCreating(false)
                            }}
                            variant="secondary"
                          >
                            编辑
                          </Button>
                          <Button
                            className="min-h-9 rounded-xl px-3 text-red-600"
                            disabled={deletingItemId === item.id}
                            icon={<Trash2 className="size-4" />}
                            onClick={() => void handleDeleteItem(item)}
                            variant="secondary"
                          >
                            删除
                          </Button>
                        </div>
                      </div>
                    </Card>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

function SkeletonLine({ className = '' }: { className?: string }) {
  return <div className={`h-4 animate-pulse rounded-full bg-slate-100 ${className}`} />
}

function TransportSegment({ description }: { description: string }) {
  return (
    <div className="ml-[3.4rem] flex items-center gap-2 rounded-2xl bg-slate-50 px-3 py-2 text-xs font-semibold leading-5 text-slate-500">
      <ArrowDown className="size-3.5 shrink-0 text-slate-400" />
      <span className="min-w-0 truncate">{description}</span>
    </div>
  )
}

function DirectionsLinks({ fromItem, toItem }: { fromItem: ItineraryItem; toItem: ItineraryItem }) {
  const appleUrl = buildAppleMapsDirectionsUrl(fromItem, toItem, toItem.previousTransportMode)
  const googleUrl = buildGoogleMapsDirectionsUrl(fromItem, toItem, toItem.previousTransportMode)

  if (!appleUrl || !googleUrl) {
    return (
      <p className="mt-3 rounded-2xl bg-slate-50 px-3 py-2 text-xs font-medium text-slate-400">
        上一站或当前地点信息不足
      </p>
    )
  }

  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      <a
        className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl bg-sky-50 px-2 text-xs font-semibold text-sky-700"
        href={appleUrl}
        rel="noreferrer"
        target="_blank"
      >
        <Navigation className="size-3.5" />
        Apple 路线
      </a>
      <a
        className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl bg-white px-2 text-xs font-semibold text-slate-700 ring-1 ring-slate-200"
        href={googleUrl}
        rel="noreferrer"
        target="_blank"
      >
        <ExternalLink className="size-3.5" />
        Google 路线
      </a>
    </div>
  )
}
