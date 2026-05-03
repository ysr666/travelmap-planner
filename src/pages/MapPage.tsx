import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { AlertCircle, ArrowDown, ArrowLeft, ExternalLink, LocateFixed, MapPin, Navigation } from 'lucide-react'
import { getDay, getTrip, listItemsByDay } from '../db'
import { DayMap } from '../components/DayMap'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { buildAppleMapsUrl, buildGoogleMapsUrl, hasValidCoordinates } from '../lib/mapLinks'
import { describeItemTime, describePreviousTransport } from '../lib/itinerary'
import { formatDate } from '../lib/dates'
import { getRouteParams, navigateTo } from '../lib/routes'
import type { Day, ItineraryItem, Trip } from '../types'

type SheetState = 'collapsed' | 'middle' | 'expanded'

type SnapPoints = Record<SheetState, number>

const DEFAULT_SNAP_POINTS: SnapPoints = {
  collapsed: 220,
  middle: 450,
  expanded: 760,
}

const SNAP_STATES: SheetState[] = ['collapsed', 'middle', 'expanded']
export function MapPage() {
  const params = getRouteParams()
  const tripId = params.get('tripId')
  const dayId = params.get('dayId')
  const [trip, setTrip] = useState<Trip | null>(null)
  const [day, setDay] = useState<Day | null>(null)
  const [items, setItems] = useState<ItineraryItem[]>([])
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [sheetState, setSheetState] = useState<SheetState>('middle')
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

  const handleSelectItem = useCallback((item: ItineraryItem) => {
    setSelectedItemId(item.id)
    setSheetState((current) => (current === 'collapsed' ? 'middle' : current))

    if (!hasValidCoordinates(item)) {
      setNotice('该行程点暂无坐标，可去时间轴编辑坐标。')
    } else {
      setNotice(null)
    }

    window.setTimeout(() => {
      itemRefs.current[item.id]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }, 100)
  }, [])

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
    <div className="app-viewport relative overflow-hidden bg-[#eaf2f9]">
      <div className="absolute inset-0 z-0">
        {items.length === 0 ? (
          <MapEmptyBackdrop
            body="返回时间轴添加酒店、景点、交通或餐厅后，再查看地图。"
            title="今天还没有行程点"
          />
        ) : (
          <DayMap
            heightClassName="h-full min-h-0"
            items={items}
            onMapError={(message) => setMapError(message)}
            onSelectItem={handleSelectItem}
            selectedItemId={selectedItemId}
            surface="fullscreen"
          />
        )}
      </div>

      <MapHeader day={day} itemCount={items.length} mappedCount={mappedItems.length} trip={trip} />

      <MapBottomSheet
        day={day}
        itemRefs={itemRefs}
        items={items}
        mapError={mapError}
        mappedCount={mappedItems.length}
        notice={notice}
        onSelectItem={handleSelectItem}
        selectedItem={selectedItem}
        selectedItemId={selectedItemId}
        setSheetState={setSheetState}
        sheetState={sheetState}
        trip={trip}
      />
    </div>
  )
}

function MapHeader({
  trip,
  day,
  itemCount,
  mappedCount,
}: {
  trip: Trip
  day: Day
  itemCount: number
  mappedCount: number
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <div className="pointer-events-auto mx-auto flex items-center gap-2 rounded-2xl border border-white/70 bg-white/88 p-2 shadow-[0_10px_28px_rgba(47,65,88,0.10)] backdrop-blur-xl">
        <button
          aria-label="返回时间轴"
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-slate-700 ring-1 ring-slate-200/80 active:scale-[0.98]"
          onClick={() => navigateTo('timeline', { tripId: trip.id, dayId: day.id })}
          type="button"
        >
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-sky-600">{trip.title}</p>
          <h2 className="truncate text-base font-semibold leading-tight text-slate-950">
            {day.title}
          </h2>
          <p className="truncate text-xs text-slate-500">
            {formatDate(day.date)} · {itemCount} 个行程 · {mappedCount} 个坐标
          </p>
        </div>
      </div>
    </div>
  )
}

type MapBottomSheetProps = {
  trip: Trip
  day: Day
  items: ItineraryItem[]
  selectedItem: ItineraryItem | null
  selectedItemId: string | null
  mappedCount: number
  notice: string | null
  mapError: string | null
  sheetState: SheetState
  setSheetState: (state: SheetState | ((current: SheetState) => SheetState)) => void
  onSelectItem: (item: ItineraryItem) => void
  itemRefs: React.MutableRefObject<Record<string, HTMLButtonElement | null>>
}

function MapBottomSheet({
  trip,
  day,
  items,
  selectedItem,
  selectedItemId,
  mappedCount,
  notice,
  mapError,
  sheetState,
  setSheetState,
  onSelectItem,
  itemRefs,
}: MapBottomSheetProps) {
  const [snapPoints, setSnapPoints] = useState<SnapPoints>(() => getSheetSnapPoints())
  const snapPointsRef = useRef<SnapPoints>(snapPoints)
  const dragStartYRef = useRef(0)
  const dragStartHeightRef = useRef(0)
  const dragDeltaRef = useRef(0)
  const [dragHeight, setDragHeight] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const updateSnapPoints = useCallback(() => {
    const nextSnapPoints = getSheetSnapPoints()
    snapPointsRef.current = nextSnapPoints
    setSnapPoints(nextSnapPoints)
  }, [])

  useEffect(() => {
    function handleResize() {
      updateSnapPoints()
    }

    window.addEventListener('resize', handleResize)
    window.visualViewport?.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      window.visualViewport?.removeEventListener('resize', handleResize)
    }
  }, [updateSnapPoints])

  const sheetHeight = dragHeight ?? snapPoints[sheetState]

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault()
    updateSnapPoints()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragStartYRef.current = event.clientY
    dragStartHeightRef.current = sheetHeight
    dragDeltaRef.current = 0
    setIsDragging(true)
    setDragHeight(sheetHeight)
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!isDragging) {
      return
    }

    event.preventDefault()
    const dragDelta = event.clientY - dragStartYRef.current
    dragDeltaRef.current = dragDelta
    const snapPoints = snapPointsRef.current
    const nextHeight = clamp(
      dragStartHeightRef.current - dragDelta,
      snapPoints.collapsed,
      snapPoints.expanded,
    )
    setDragHeight(nextHeight)
  }

  function finishDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!isDragging) {
      return
    }

    event.preventDefault()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    const currentHeight = dragHeight ?? sheetHeight
    const nextState = getNearestSheetState(currentHeight, dragDeltaRef.current, snapPointsRef.current)
    setSheetState(nextState)
    setDragHeight(null)
    setIsDragging(false)

    window.setTimeout(() => window.dispatchEvent(new Event('resize')), 280)
  }

  const showList = sheetState !== 'collapsed' || isDragging

  return (
    <section
      className={`absolute inset-x-0 bottom-0 z-40 flex min-h-0 flex-col rounded-t-[1.35rem] border border-white/80 bg-white/95 shadow-[0_-18px_48px_rgba(47,65,88,0.16)] backdrop-blur-xl ${
        isDragging ? '' : 'transition-[height] duration-300 ease-out motion-reduce:duration-0'
      }`}
      data-testid="map-bottom-sheet"
      style={{ height: `${sheetHeight}px` }}
    >
      <div
        aria-label="拖动行程抽屉"
        className="flex h-11 shrink-0 touch-none cursor-grab items-center justify-center active:cursor-grabbing"
        onPointerCancel={finishDrag}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        role="button"
        tabIndex={0}
      >
        <div className="h-1.5 w-11 rounded-full bg-slate-300" />
      </div>

      <div className="min-h-0 flex-1 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-sky-600">
              {formatDate(day.date)}
            </p>
            <h2 className="truncate text-base font-semibold text-slate-950">{day.title}</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {items.length} 个行程点 · {mappedCount} 个带坐标
            </p>
          </div>
          <Button
            className="min-h-10 shrink-0 px-3 whitespace-nowrap"
            icon={<Navigation className="size-4" />}
            onClick={() => navigateTo('timeline', { tripId: trip.id, dayId: day.id })}
          >
            时间轴
          </Button>
        </div>

        <div className="space-y-2">
          {mapError ? (
            <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {mapError}
            </div>
          ) : null}

          {notice ? (
            <div className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-slate-400" />
              <span>{notice}</span>
            </div>
          ) : null}

          {selectedItem && sheetState !== 'expanded' ? (
            <SelectedItemCard item={selectedItem} trip={trip} day={day} compact={sheetState === 'collapsed'} />
          ) : (
            <p className="rounded-xl bg-slate-50 px-3 py-4 text-sm text-slate-500">
              {items.length === 0
                ? '这一天还没有行程点。'
                : sheetState === 'expanded'
                  ? '完整行程列表'
                  : '选择地图标记或列表行程查看详情。'}
            </p>
          )}
        </div>

        {showList ? (
          <div
            className={`mt-3 min-h-0 overflow-y-auto pr-1 app-scrollbar ${
              sheetState === 'expanded' ? 'h-[calc(100%_-_7rem)]' : 'h-[calc(100%_-_12rem)]'
            }`}
          >
            <ItineraryList
              day={day}
              itemRefs={itemRefs}
              items={items}
              onSelectItem={onSelectItem}
              selectedItemId={selectedItemId}
              trip={trip}
            />
          </div>
        ) : (
          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
            上拉查看完整行程，下拉专注查看地图。
          </p>
        )}
      </div>
    </section>
  )
}

function ItineraryList({
  trip,
  day,
  items,
  selectedItemId,
  onSelectItem,
  itemRefs,
}: {
  trip: Trip
  day: Day
  items: ItineraryItem[]
  selectedItemId: string | null
  onSelectItem: (item: ItineraryItem) => void
  itemRefs: React.MutableRefObject<Record<string, HTMLButtonElement | null>>
}) {
  if (items.length === 0) {
    return (
      <p className="rounded-xl bg-slate-50 px-3 py-4 text-sm text-slate-500">
        这一天还没有行程点。
      </p>
    )
  }

  return (
    <div className="space-y-2 pb-8">
      {items.map((item, index) => {
        const previousTransportDescription = describePreviousTransport(item)
        const hasCoordinates = hasValidCoordinates(item)

        return (
          <div className="space-y-1.5" key={item.id}>
            {index > 0 && previousTransportDescription ? (
              <TransportSegment description={previousTransportDescription} />
            ) : null}
            <button
              className={`flex w-full items-center gap-3 rounded-xl p-2 text-left transition active:bg-slate-50 ${
                selectedItemId === item.id ? 'bg-sky-50 ring-1 ring-sky-100' : ''
              }`}
              onClick={() => onSelectItem(item)}
              ref={(node) => {
                itemRefs.current[item.id] = node
              }}
              type="button"
            >
              <span
                className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                  hasCoordinates ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-400'
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
              <span className="shrink-0 text-xs font-semibold text-slate-400">
                {describeItemTime(item)}
              </span>
            </button>
            {!hasCoordinates ? (
              <div className="ml-11 flex gap-2">
                <Button
                  className="min-h-9 px-3 text-xs"
                  onClick={() => navigateTo('item', { tripId: trip.id, dayId: day.id, itemId: item.id })}
                  variant="secondary"
                >
                  详情
                </Button>
                <Button
                  className="min-h-9 px-3 text-xs"
                  onClick={() => navigateTo('timeline', { tripId: trip.id, dayId: day.id })}
                  variant="ghost"
                >
                  编辑坐标
                </Button>
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function SelectedItemCard({
  item,
  trip,
  day,
  compact = false,
}: {
  item: ItineraryItem
  trip: Trip
  day: Day
  compact?: boolean
}) {
  const hasCoordinates = hasValidCoordinates(item)

  return (
    <div className="rounded-xl bg-sky-50/80 p-3 ring-1 ring-sky-100">
      <p className="text-xs font-semibold text-sky-600">{describeItemTime(item)}</p>
      <h3 className="mt-1 truncate text-base font-semibold text-slate-950">{item.title}</h3>
      <p className="mt-1 truncate text-sm text-slate-500">{item.locationName || '地点未填写'}</p>
      {!compact ? (
        <p className="mt-1 line-clamp-2 text-xs text-slate-400">{item.address || '地址未填写'}</p>
      ) : null}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Button
          className="min-h-10 px-2 text-xs"
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
          className="mt-2 w-full min-h-10"
          onClick={() => navigateTo('timeline', { tripId: trip.id, dayId: day.id })}
          variant="secondary"
        >
          去时间轴编辑坐标
        </Button>
      ) : null}
    </div>
  )
}

function MapEmptyBackdrop({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-[#eaf2f9] p-6">
      <EmptyState
        body={body}
        icon={<MapPin className="size-6" />}
        title={title}
      />
    </div>
  )
}

function getSheetSnapPoints(): SnapPoints {
  if (typeof window === 'undefined') {
    return DEFAULT_SNAP_POINTS
  }

  const viewportHeight = window.visualViewport?.height ?? window.innerHeight
  const expandedTopGap = 12
  const collapsed = Math.max(176, Math.round(viewportHeight * 0.26))
  const middle = Math.max(collapsed + 96, Math.round(viewportHeight * 0.54))
  const expanded = Math.max(middle + 120, Math.round(viewportHeight - expandedTopGap))

  return {
    collapsed,
    middle,
    expanded,
  }
}

function getNearestSheetState(height: number, dragDelta: number, snapPoints: SnapPoints): SheetState {
  if (Math.abs(dragDelta) > 90) {
    if (dragDelta < 0) {
      return nextSheetState(height, snapPoints, 'up')
    }
    return nextSheetState(height, snapPoints, 'down')
  }

  return SNAP_STATES.reduce((nearest, state) => {
    const currentDistance = Math.abs(height - snapPoints[state])
    const nearestDistance = Math.abs(height - snapPoints[nearest])
    return currentDistance < nearestDistance ? state : nearest
  }, 'middle' as SheetState)
}

function nextSheetState(height: number, snapPoints: SnapPoints, direction: 'up' | 'down'): SheetState {
  const nearest = getNearestWithoutDirection(height, snapPoints)
  const index = SNAP_STATES.indexOf(nearest)

  if (direction === 'up') {
    return SNAP_STATES[Math.min(SNAP_STATES.length - 1, index + 1)]
  }

  return SNAP_STATES[Math.max(0, index - 1)]
}

function getNearestWithoutDirection(height: number, snapPoints: SnapPoints): SheetState {
  return SNAP_STATES.reduce((nearest, state) => {
    const currentDistance = Math.abs(height - snapPoints[state])
    const nearestDistance = Math.abs(height - snapPoints[nearest])
    return currentDistance < nearestDistance ? state : nearest
  }, 'middle' as SheetState)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function SkeletonLine({ className = '' }: { className?: string }) {
  return <div className={`h-4 animate-pulse rounded-full bg-slate-100 ${className}`} />
}

function TransportSegment({ description }: { description: string }) {
  return (
    <div className="mx-2 flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-500">
      <ArrowDown className="size-3 shrink-0 text-slate-400" />
      <span className="min-w-0 truncate">{description}</span>
    </div>
  )
}
