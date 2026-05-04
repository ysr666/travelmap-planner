import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import { AlertCircle, ArrowDown, ArrowLeft, ExternalLink, LocateFixed, MapPin, Navigation } from 'lucide-react'
import { DayMap } from '../DayMap'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { buildAppleMapsUrl, buildGoogleMapsUrl, hasValidCoordinates } from '../../lib/mapLinks'
import { describeItemTime, describePreviousTransport } from '../../lib/itinerary'
import { formatDate } from '../../lib/dates'
import type { Day, ItineraryItem, Trip } from '../../types'

type SheetState = 'collapsed' | 'middle' | 'expanded'
type SelectSource = 'marker' | 'list'

type SnapPoints = Record<SheetState, number>

type DayMapViewProps = {
  trip: Trip
  day: Day
  items: ItineraryItem[]
  embedded?: boolean
  showFloatingHeader?: boolean
  resizeSignal?: number
  onBackToTimeline?: () => void
  onOpenItem: (item: ItineraryItem) => void
  onEditItem?: (item: ItineraryItem) => void
}

const DEFAULT_SNAP_POINTS: SnapPoints = {
  collapsed: 220,
  middle: 450,
  expanded: 760,
}

const SNAP_STATES: SheetState[] = ['collapsed', 'middle', 'expanded']

export function DayMapView({
  trip,
  day,
  items,
  embedded = false,
  showFloatingHeader = true,
  resizeSignal,
  onBackToTimeline,
  onOpenItem,
  onEditItem,
}: DayMapViewProps) {
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [sheetState, setSheetState] = useState<SheetState>('middle')
  const [notice, setNotice] = useState<string | null>(null)
  const [mapError, setMapError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  const mappedItems = useMemo(() => items.filter(hasValidCoordinates), [items])
  const selectedItem = useMemo(() => {
    return items.find((item) => item.id === selectedItemId) ?? mappedItems[0] ?? items[0] ?? null
  }, [items, mappedItems, selectedItemId])

  const handleSelectItem = useCallback((item: ItineraryItem, source: SelectSource) => {
    setSelectedItemId(item.id)
    if (source === 'marker') {
      setSheetState((current) => (current === 'collapsed' ? 'middle' : current))
    }

    if (!hasValidCoordinates(item)) {
      setNotice('该行程点暂无坐标，可去日程编辑坐标。')
    } else {
      setNotice(null)
    }

    if (source === 'marker') {
      window.setTimeout(() => {
        itemRefs.current[item.id]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }, 100)
    }
  }, [])

  return (
    <div ref={rootRef} className={`${embedded ? 'relative h-full min-h-0' : 'app-viewport relative'} min-h-0 overflow-hidden bg-[#eaf2f9]`}>
      <div className="absolute inset-0 z-0">
        {items.length === 0 ? (
          <MapEmptyBackdrop
            body="添加酒店、景点、交通或餐厅后，再查看地图。"
            title="今天还没有行程点"
          />
        ) : (
          <DayMap
            heightClassName="h-full min-h-0"
            items={items}
            onMapError={(message) => setMapError(message)}
            onSelectItem={(item) => handleSelectItem(item, 'marker')}
            resizeSignal={resizeSignal}
            selectedItemId={selectedItemId}
            surface="fullscreen"
          />
        )}
      </div>

      {showFloatingHeader ? (
        <MapHeader
          day={day}
          itemCount={items.length}
          mappedCount={mappedItems.length}
          onBackToTimeline={onBackToTimeline}
          trip={trip}
        />
      ) : null}

      <MapBottomSheet
        day={day}
        itemRefs={itemRefs}
        items={items}
        mapError={mapError}
        mappedCount={mappedItems.length}
        notice={notice}
        onBackToTimeline={onBackToTimeline}
        onEditItem={onEditItem}
        onOpenItem={onOpenItem}
        onSelectItem={handleSelectItem}
        selectedItem={selectedItem}
        selectedItemId={selectedItemId}
        setSheetState={setSheetState}
        sheetState={sheetState}
        stageRef={rootRef}
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
  onBackToTimeline,
}: {
  trip: Trip
  day: Day
  itemCount: number
  mappedCount: number
  onBackToTimeline?: () => void
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <div className="pointer-events-auto mx-auto flex items-center gap-2 rounded-2xl border border-white/70 bg-white/88 p-2 shadow-[0_10px_28px_rgba(47,65,88,0.10)] backdrop-blur-xl">
        <button
          aria-label="返回日程"
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-slate-700 ring-1 ring-slate-200/80 active:scale-[0.98]"
          onClick={onBackToTimeline}
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
  onSelectItem: (item: ItineraryItem, source: SelectSource) => void
  onOpenItem: (item: ItineraryItem) => void
  onEditItem?: (item: ItineraryItem) => void
  onBackToTimeline?: () => void
  itemRefs: MutableRefObject<Record<string, HTMLButtonElement | null>>
  stageRef: RefObject<HTMLDivElement | null>
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
  onOpenItem,
  onEditItem,
  onBackToTimeline,
  itemRefs,
  stageRef,
}: MapBottomSheetProps) {
  const [snapPoints, setSnapPoints] = useState<SnapPoints>(() => getSheetSnapPoints())
  const snapPointsRef = useRef<SnapPoints>(snapPoints)
  const listScrollRef = useRef<HTMLDivElement | null>(null)
  const dragStartYRef = useRef(0)
  const dragStartHeightRef = useRef(0)
  const dragDeltaRef = useRef(0)
  const [dragHeight, setDragHeight] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const updateSnapPoints = useCallback(() => {
    const stageHeight = stageRef.current?.getBoundingClientRect().height
    const nextSnapPoints = getSheetSnapPoints(stageHeight)
    snapPointsRef.current = nextSnapPoints
    setSnapPoints(nextSnapPoints)
  }, [stageRef])

  useEffect(() => {
    function handleResize() {
      updateSnapPoints()
    }

    const timeout = window.setTimeout(updateSnapPoints, 0)
    const resizeObserver = stageRef.current ? new ResizeObserver(handleResize) : null
    if (stageRef.current) {
      resizeObserver?.observe(stageRef.current)
    }
    window.addEventListener('resize', handleResize)
    window.visualViewport?.addEventListener('resize', handleResize)

    return () => {
      window.clearTimeout(timeout)
      resizeObserver?.disconnect()
      window.removeEventListener('resize', handleResize)
      window.visualViewport?.removeEventListener('resize', handleResize)
    }
  }, [stageRef, updateSnapPoints])

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

    if (nextState === 'expanded') {
      window.requestAnimationFrame(() => {
        listScrollRef.current?.scrollTo({ top: 0 })
      })
    }

    requestMapResize()
    window.setTimeout(requestMapResize, 280)
  }

  const showList = sheetState !== 'collapsed' || isDragging

  return (
    <section
      className={`absolute bottom-0 left-3 right-3 z-40 flex min-h-0 flex-col rounded-t-3xl border border-white/80 bg-white/95 shadow-[0_-14px_36px_rgba(47,65,88,0.14)] backdrop-blur-xl ${
        isDragging ? '' : 'transition-[height] duration-300 ease-out motion-reduce:duration-0'
      }`}
      data-testid="map-sheet"
      style={{ height: `${sheetHeight}px` }}
    >
      <div
        aria-label="拖动行程抽屉"
        className="flex h-11 shrink-0 touch-none cursor-grab items-center justify-center active:cursor-grabbing"
        data-testid="map-sheet-handle"
        onPointerCancel={finishDrag}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        role="button"
        tabIndex={0}
      >
        <div className="h-1.5 w-11 rounded-full bg-slate-300" />
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-3 flex shrink-0 items-start justify-between gap-3 px-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-sky-600">
              {formatDate(day.date)}
            </p>
            <h2 className="truncate text-base font-semibold text-slate-950">{day.title}</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {items.length} 个行程点 · {mappedCount} 个带坐标
            </p>
          </div>
          <Button
            className={`shrink-0 whitespace-nowrap rounded-xl ${sheetState === 'expanded' ? 'min-h-8 px-2.5 text-xs' : 'min-h-9 px-3 text-xs'}`}
            icon={<Navigation className="size-3.5" />}
            onClick={onBackToTimeline}
            variant={sheetState === 'expanded' ? 'ghost' : 'primary'}
          >
            日程
          </Button>
        </div>

        <div className="shrink-0 space-y-2 px-4">
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
            <SelectedItemCard
              compact={sheetState === 'collapsed'}
              day={day}
              item={selectedItem}
              onEditItem={onEditItem}
              onOpenItem={onOpenItem}
              trip={trip}
            />
          ) : sheetState !== 'expanded' ? (
            <p className="rounded-xl bg-slate-50 px-3 py-4 text-sm text-slate-500">
              {items.length === 0
                ? '这一天还没有行程点。'
                : '选择地图标记或列表行程查看详情。'}
            </p>
          ) : null}
        </div>

        {showList ? (
          <div
            className="mt-3 min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] app-scrollbar"
            ref={listScrollRef}
          >
            <ItineraryList
              itemRefs={itemRefs}
              items={items}
              onEditItem={onEditItem}
              onOpenItem={onOpenItem}
              onSelectItem={onSelectItem}
              selectedItemId={selectedItemId}
            />
          </div>
        ) : (
          <p className="mx-4 mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
            上拉查看完整行程，下拉专注查看地图。
          </p>
        )}
      </div>
    </section>
  )
}

function requestMapResize() {
  window.requestAnimationFrame(() => {
    window.dispatchEvent(new Event('resize'))
  })
}

function ItineraryList({
  items,
  selectedItemId,
  onSelectItem,
  onOpenItem,
  onEditItem,
  itemRefs,
}: {
  items: ItineraryItem[]
  selectedItemId: string | null
  onSelectItem: (item: ItineraryItem, source: SelectSource) => void
  onOpenItem: (item: ItineraryItem) => void
  onEditItem?: (item: ItineraryItem) => void
  itemRefs: MutableRefObject<Record<string, HTMLButtonElement | null>>
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
              onClick={() => onSelectItem(item, 'list')}
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
                  onClick={() => onOpenItem(item)}
                  variant="secondary"
                >
                  详情
                </Button>
                <Button
                  className="min-h-9 px-3 text-xs"
                  onClick={() => (onEditItem ? onEditItem(item) : undefined)}
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
  onOpenItem,
  onEditItem,
}: {
  item: ItineraryItem
  trip: Trip
  day: Day
  compact?: boolean
  onOpenItem: (item: ItineraryItem) => void
  onEditItem?: (item: ItineraryItem) => void
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
          onClick={() => onOpenItem(item)}
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
          onClick={() => (onEditItem ? onEditItem(item) : undefined)}
          variant="secondary"
        >
          去日程编辑坐标
        </Button>
      ) : null}
      <p className="sr-only">
        {trip.title} {day.title}
      </p>
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

function getSheetSnapPoints(stageHeight?: number): SnapPoints {
  if (typeof window === 'undefined') {
    return DEFAULT_SNAP_POINTS
  }

  const baseHeight = stageHeight && stageHeight > 0
    ? stageHeight
    : window.visualViewport?.height ?? window.innerHeight
  const expandedTopGap = 10
  const collapsed = Math.max(150, Math.round(baseHeight * 0.26))
  const middle = Math.max(collapsed + 82, Math.round(baseHeight * 0.54))
  const expanded = Math.max(middle + 96, Math.round(baseHeight - expandedTopGap))

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

function TransportSegment({ description }: { description: string }) {
  return (
    <div className="mx-2 flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-500">
      <ArrowDown className="size-3 shrink-0 text-slate-400" />
      <span className="min-w-0 truncate">{description}</span>
    </div>
  )
}
