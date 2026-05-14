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
import { AlertCircle, ArrowDown, ArrowLeft, ChevronDown, ExternalLink, LocateFixed, MapPin, Navigation } from 'lucide-react'
import { DayMap, type DayMapHandle } from '../DayMap'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { updateItineraryItem } from '../../db'
import { buildAppleMapsUrl, buildGoogleMapsUrl, hasValidCoordinates } from '../../lib/mapLinks'
import { describeItemTime, describePreviousTransport, sortItineraryItems } from '../../lib/itinerary'
import { formatDate } from '../../lib/dates'
import {
  ROUTING_CONFIG_CHANGED_EVENT,
  fetchDayRoute,
  getRoutingConfig,
  isRoutingConfigured,
  type DayRouteResult,
  type RoutingConfig,
} from '../../lib/routing'
import {
  ROUTE_CACHE_CHANGED_EVENT,
  buildCurrentRouteCacheIdentity,
  clearRouteCache,
  loadRouteCache,
  pruneStaleRouteCachesForDay,
  saveRouteCache,
  type RouteCacheEntry,
} from '../../lib/routeCache'
import { buildDayPrewarmQueue, shouldSkipMapPrewarm } from '../../lib/mapPrewarm'
import { markMapStartup } from '../../lib/mapStartupMetrics'
import type { Day, ItineraryItem, TransportMode, Trip } from '../../types'

type SheetState = 'collapsed' | 'middle' | 'expanded'
type SelectSource = 'marker' | 'list'
type RouteUiState = 'straight' | 'loading' | 'road' | 'cached' | 'mixed' | 'failed'
type RouteDisplayMode = 'straight' | 'road'
type RoadTransportMode = Extract<TransportMode, 'walk' | 'car' | 'bus'>

type SnapPoints = Record<SheetState, number>

type DayMapViewProps = {
  trip: Trip
  day: Day
  items: ItineraryItem[]
  allDays?: Day[]
  dayItemsByDayId?: Record<string, ItineraryItem[]>
  embedded?: boolean
  isVisible?: boolean
  prewarmEnabled?: boolean
  showFloatingHeader?: boolean
  resizeSignal?: number
  onBackToTimeline?: () => void
  onOpenItem: (item: ItineraryItem) => void
  onEditItem?: (item: ItineraryItem) => void
  onItemsChange?: () => Promise<void> | void
}

const DEFAULT_SNAP_POINTS: SnapPoints = {
  collapsed: 220,
  middle: 450,
  expanded: 760,
}

const SNAP_STATES: SheetState[] = ['collapsed', 'middle', 'expanded']
const ROAD_TRANSPORT_MODES: RoadTransportMode[] = ['walk', 'car', 'bus']
const ROAD_TRANSPORT_LABELS: Record<RoadTransportMode, string> = {
  walk: '步行',
  car: '驾车',
  bus: '公交',
}

export function DayMapView({
  trip,
  day,
  items,
  allDays,
  dayItemsByDayId,
  embedded = false,
  isVisible = true,
  prewarmEnabled = false,
  showFloatingHeader = true,
  resizeSignal,
  onBackToTimeline,
  onOpenItem,
  onEditItem,
  onItemsChange,
}: DayMapViewProps) {
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [sheetState, setSheetState] = useState<SheetState>('collapsed')
  const [notice, setNotice] = useState<string | null>(null)
  const [mapError, setMapError] = useState<string | null>(null)
  const [routingConfig, setRoutingConfig] = useState<RoutingConfig>(() => getRoutingConfig())
  const [routeResult, setRouteResult] = useState<DayRouteResult | null>(null)
  const [routeUiState, setRouteUiState] = useState<RouteUiState>('straight')
  const [routeDisplayMode, setRouteDisplayMode] = useState<RouteDisplayMode>('straight')
  const [routeWarnings, setRouteWarnings] = useState<string[]>([])
  const [routeControlsOpen, setRouteControlsOpen] = useState(false)
  const [mapBaseLoading, setMapBaseLoading] = useState(() => items.some(hasValidCoordinates))
  const [roadModeOverride, setRoadModeOverride] = useState<{
    dayId: string
    mode: RoadTransportMode
    segmentItemId: string
  } | null>(null)
  const [cacheRefreshToken, setCacheRefreshToken] = useState(0)
  const routeAbortRef = useRef<AbortController | null>(null)
  const dayMapRef = useRef<DayMapHandle | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const pendingRouteEditNoticeRef = useRef<string[] | null>(null)
  const [mapReadyToken, setMapReadyToken] = useState(0)

  const mappedItems = useMemo(() => items.filter(hasValidCoordinates), [items])
  const orderedItems = useMemo(() => sortItineraryItems(items), [items])
  const selectedItem = useMemo(() => {
    return items.find((item) => item.id === selectedItemId) ?? mappedItems[0] ?? items[0] ?? null
  }, [items, mappedItems, selectedItemId])
  const activeSegmentItem = useMemo(() => {
    if (orderedItems.length < 2) {
      return null
    }

    const selectedIndex = selectedItemId
      ? orderedItems.findIndex((item) => item.id === selectedItemId)
      : -1

    if (selectedIndex > 0) {
      return orderedItems[selectedIndex]
    }

    return orderedItems[1]
  }, [orderedItems, selectedItemId])
  const storedRoadMode = getRoadTransportMode(activeSegmentItem)
  const activeRoadMode = roadModeOverride?.dayId === day.id && roadModeOverride.segmentItemId === activeSegmentItem?.id
    ? roadModeOverride.mode
    : storedRoadMode
  const routeCacheIdentity = useMemo(
    () => buildCurrentRouteCacheIdentity({
      tripId: trip.id,
      dayId: day.id,
      items,
      provider: 'openrouteservice',
    }),
    [day.id, items, trip.id],
  )
  const routeIdentityKey = routeCacheIdentity.signature
  const routeLineStrings = routeDisplayMode === 'road' ? routeResult?.lineStrings : undefined
  const routeConfigured = isRoutingConfigured(routingConfig)
  const routeCacheRefreshKey = `${cacheRefreshToken}:${routingConfig.provider}:${routingConfig.configured}:${routingConfig.source}`
  const prewarmItemsByDayId = useMemo(
    () => ({
      ...(dayItemsByDayId ?? {}),
      [day.id]: items,
    }),
    [day.id, dayItemsByDayId, items],
  )
  const prewarmQueue = useMemo(
    () =>
      buildDayPrewarmQueue({
        currentDayId: day.id,
        days: allDays ?? [day],
        itemsByDayId: prewarmItemsByDayId,
      }),
    [allDays, day, prewarmItemsByDayId],
  )
  const prewarmQueueKey = useMemo(
    () =>
      prewarmQueue
        .map((target) => `${target.dayId}:${target.bounds.flat().map((value) => value.toFixed(5)).join(',')}`)
        .join('|'),
    [prewarmQueue],
  )
  const cancelDayMapPrewarm = useCallback(() => {
    dayMapRef.current?.cancelPrewarm()
  }, [])

  useEffect(() => {
    function refreshConfig() {
      setRoutingConfig(getRoutingConfig())
    }

    window.addEventListener(ROUTING_CONFIG_CHANGED_EVENT, refreshConfig)
    window.addEventListener('storage', refreshConfig)
    return () => {
      window.removeEventListener(ROUTING_CONFIG_CHANGED_EVENT, refreshConfig)
      window.removeEventListener('storage', refreshConfig)
    }
  }, [])

  useEffect(() => {
    function refreshRouteCache() {
      setCacheRefreshToken((current) => current + 1)
    }

    window.addEventListener(ROUTE_CACHE_CHANGED_EVENT, refreshRouteCache)
    return () => {
      window.removeEventListener(ROUTE_CACHE_CHANGED_EVENT, refreshRouteCache)
    }
  }, [])

  useEffect(() => {
    routeAbortRef.current?.abort()
    routeAbortRef.current = null
    let cancelled = false

    async function refreshCachedRoute() {
      try {
        const prunedCount = await pruneStaleRouteCachesForDay(trip.id, day.id, routeIdentityKey)
        const cached = await loadRouteCache(routeIdentityKey)
        if (cancelled) {
          return
        }
        if (cached) {
          setRouteResult(buildRouteResultFromCache(cached))
          setRouteWarnings(['使用本地缓存路线。', ...cached.warnings])
          setRouteUiState('cached')
          setRouteDisplayMode('road')
          return
        }
        setRouteResult(null)
        setRouteDisplayMode('straight')
        if (pendingRouteEditNoticeRef.current) {
          setRouteWarnings(pendingRouteEditNoticeRef.current)
          pendingRouteEditNoticeRef.current = null
        } else {
          setRouteWarnings(prunedCount > 0 ? ['路线已过期，请重新生成。'] : [])
        }
        setRouteUiState('straight')
      } catch {
        if (cancelled) {
          return
        }
        setRouteResult(null)
        setRouteWarnings(['读取本地路线缓存失败，已显示直线连接。'])
        setRouteUiState('straight')
      }
    }

    void refreshCachedRoute()

    return () => {
      cancelled = true
    }
  }, [day.id, routeCacheRefreshKey, routeIdentityKey, trip.id])

  useEffect(() => {
    return () => {
      routeAbortRef.current?.abort()
      cancelDayMapPrewarm()
    }
  }, [cancelDayMapPrewarm])

  useEffect(() => {
    if (!prewarmEnabled) {
      dayMapRef.current?.cancelPrewarm()
      markMapStartup('prewarm skipped: map visible')
      return
    }

    if (prewarmQueue.length === 0) {
      markMapStartup('prewarm skipped: no coords')
      return
    }

    const connection = getNetworkInformation()
    if (shouldSkipMapPrewarm(connection)) {
      markMapStartup(connection?.saveData ? 'prewarm skipped: saveData' : 'prewarm skipped: slow network', {
        effectiveType: connection?.effectiveType,
      })
      return
    }

    if (!dayMapRef.current?.isReady()) {
      return
    }

    let cancelled = false
    const cancelIdle = schedulePrewarmIdleTask(() => {
      if (cancelled || !prewarmEnabled) {
        return
      }

      void dayMapRef.current?.prewarmBounds(prewarmQueue)
    })

    return () => {
      cancelled = true
      cancelIdle()
      cancelDayMapPrewarm()
    }
  }, [cancelDayMapPrewarm, mapReadyToken, prewarmEnabled, prewarmQueue, prewarmQueueKey])

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

  async function handleGenerateRoadRoute(forceRefresh = false) {
    const latestConfig = getRoutingConfig()
    setRoutingConfig(latestConfig)
    setRouteDisplayMode('road')
    if (!isRoutingConfigured(latestConfig)) {
      setRouteWarnings([
        routeResult ? '路线服务未配置，无法重新生成；当前仍可查看已有路线。' : '路线服务未配置，已显示直线连接。',
      ])
      if (!routeResult) {
        setRouteUiState('straight')
      }
      return
    }

    const previousResult = routeResult
    const previousState = routeUiState
    routeAbortRef.current?.abort()
    const controller = new AbortController()
    routeAbortRef.current = controller
    setRouteUiState('loading')
    setRouteWarnings([])

    try {
      const result = await fetchDayRoute(items, latestConfig, {
        signal: controller.signal,
        forceRefresh,
      })
      if (controller.signal.aborted) {
        return
      }
      const nextWarnings = [...result.warnings]
      if (hasRoadSegments(result)) {
        const saveResult = await saveRouteCache({
          tripId: trip.id,
          dayId: day.id,
          provider: 'openrouteservice',
          signature: routeCacheIdentity.signature,
          coordinateKey: routeCacheIdentity.coordinateKey,
          modeKey: routeCacheIdentity.modeKey,
          lineStrings: result.lineStrings,
          warnings: result.warnings,
          status: (result.status === 'road' || result.status === 'mixed' ? result.status : 'road') as 'road' | 'mixed',
          distanceMeters: sumOptional(result.segments.map((segment) => segment.distanceMeters)),
          durationSeconds: sumOptional(result.segments.map((segment) => segment.durationSeconds)),
        })
        if (!saveResult.saved) {
          nextWarnings.push(saveResult.warning)
        }
      }
      setRouteResult(result)
      setRouteWarnings(nextWarnings)
      setRouteUiState(result.status === 'straight' ? 'failed' : result.status)
      setRouteDisplayMode('road')
    } catch (caught) {
      if (controller.signal.aborted) {
        return
      }
      setRouteResult(previousResult)
      setRouteUiState(previousResult ? previousState : 'failed')
      setRouteWarnings([
        ...(previousResult ? ['重新生成失败，仍可使用已有缓存路线。'] : []),
        caught instanceof Error
          ? `${caught.message} 已回退直线。`
          : '道路路线生成失败，已回退直线。',
      ])
    } finally {
      if (routeAbortRef.current === controller) {
        routeAbortRef.current = null
      }
    }
  }

  function handleResetToStraight() {
    routeAbortRef.current?.abort()
    routeAbortRef.current = null
    setRouteResult(null)
    setRouteWarnings([])
    setRouteUiState('straight')
    setRouteDisplayMode('straight')
  }

  function handleSelectRoadDisplay() {
    setRouteDisplayMode('road')
    if (!activeSegmentItem) {
      setRouteWarnings(['至少需要两个地点才能设置道路交通方式。'])
    }
  }

  async function handleChangeRoadTransportMode(mode: RoadTransportMode) {
    setRouteDisplayMode('road')
    if (!activeSegmentItem) {
      setRouteWarnings(['至少需要两个地点才能设置道路交通方式。'])
      return
    }
    setRoadModeOverride({ dayId: day.id, mode, segmentItemId: activeSegmentItem.id })

    if (activeSegmentItem.previousTransportMode === mode) {
      setRouteWarnings(mode === 'bus' ? ['公交为道路近似。'] : [])
      return
    }

    try {
      await updateItineraryItem(activeSegmentItem.id, { previousTransportMode: mode })
      setRouteResult(null)
      setRouteUiState('straight')
      const nextWarnings = [
        '交通方式已更新，点击重新生成。',
        ...(mode === 'bus' ? ['公交为道路近似。'] : []),
      ]
      pendingRouteEditNoticeRef.current = nextWarnings
      setRouteWarnings(nextWarnings)
      await onItemsChange?.()
    } catch (caught) {
      const storedMode = getRoadTransportMode(activeSegmentItem)
      setRoadModeOverride(storedMode ? { dayId: day.id, mode: storedMode, segmentItemId: activeSegmentItem.id } : null)
      setRouteWarnings([caught instanceof Error ? caught.message : '更新交通方式失败。'])
    }
  }

  async function handleClearRouteCache() {
    setRouteResult(null)
    setRouteUiState('straight')
    setRouteDisplayMode('straight')
    try {
      await clearRouteCache()
      setRouteWarnings(['路线缓存已清理。'])
    } catch (caught) {
      setRouteWarnings([caught instanceof Error ? caught.message : '清理路线缓存失败。'])
    }
  }

  function handleOpenRouteControls() {
    setSheetState((current) => (current === 'collapsed' ? 'middle' : current))
    setRouteControlsOpen(true)
  }

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
            ref={dayMapRef}
            heightClassName="h-full min-h-0"
            items={items}
            onBaseLoadingChange={setMapBaseLoading}
            onMapError={(message) => setMapError(message)}
            onMapReady={() => setMapReadyToken((current) => current + 1)}
            onSelectItem={(item) => handleSelectItem(item, 'marker')}
            routeLineStrings={routeLineStrings}
            resizeSignal={resizeSignal}
            selectedItemId={selectedItemId}
            surface="fullscreen"
          />
        )}
      </div>

      {isVisible && mappedItems.length > 0 && !mapBaseLoading && !mapError ? (
        <RouteStatusChip
          activeRoadMode={activeRoadMode}
          configured={routeConfigured}
          displayMode={routeDisplayMode}
          onClick={handleOpenRouteControls}
          showBelowHeader={showFloatingHeader}
          state={routeUiState}
          warnings={routeWarnings}
        />
      ) : null}

      {isVisible && showFloatingHeader ? (
        <MapHeader
          day={day}
          itemCount={items.length}
          mappedCount={mappedItems.length}
          onBackToTimeline={onBackToTimeline}
          trip={trip}
        />
      ) : null}

      {isVisible ? (
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
          routeDisplayMode={routeDisplayMode}
          routeState={routeUiState}
          routeWarnings={routeWarnings}
          routeConfigured={routeConfigured}
          routeControlsOpen={routeControlsOpen}
          routeDetailsResetKey={routeIdentityKey}
          activeRoadMode={activeRoadMode}
          activeSegmentItem={activeSegmentItem}
          onChangeRoadTransportMode={(mode) => void handleChangeRoadTransportMode(mode)}
          onClearRouteCache={() => void handleClearRouteCache()}
          onGenerateRoadRoute={() => void handleGenerateRoadRoute(routeUiState !== 'straight')}
          onResetToStraight={handleResetToStraight}
          onSelectRoadDisplay={handleSelectRoadDisplay}
          setRouteControlsOpen={setRouteControlsOpen}
          selectedItem={selectedItem}
          selectedItemId={selectedItemId}
          setSheetState={setSheetState}
          sheetState={sheetState}
          stageRef={rootRef}
          trip={trip}
        />
      ) : null}
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
  routeDisplayMode: RouteDisplayMode
  routeState: RouteUiState
  routeWarnings: string[]
  routeConfigured: boolean
  routeControlsOpen: boolean
  routeDetailsResetKey: string
  activeRoadMode: RoadTransportMode | null
  activeSegmentItem: ItineraryItem | null
  setRouteControlsOpen: (open: boolean | ((current: boolean) => boolean)) => void
  onGenerateRoadRoute: () => void
  onResetToStraight: () => void
  onSelectRoadDisplay: () => void
  onChangeRoadTransportMode: (mode: RoadTransportMode) => void
  onClearRouteCache: () => void
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
  routeDisplayMode,
  routeState,
  routeWarnings,
  routeConfigured,
  routeControlsOpen,
  routeDetailsResetKey,
  activeRoadMode,
  activeSegmentItem,
  setRouteControlsOpen,
  onGenerateRoadRoute,
  onResetToStraight,
  onSelectRoadDisplay,
  onChangeRoadTransportMode,
  onClearRouteCache,
  itemRefs,
  stageRef,
}: MapBottomSheetProps) {
  const [snapPoints, setSnapPoints] = useState<SnapPoints>(() => getSheetSnapPoints())
  const snapPointsRef = useRef<SnapPoints>(snapPoints)
  const listScrollRef = useRef<HTMLDivElement | null>(null)
  const dragStartYRef = useRef(0)
  const dragStartHeightRef = useRef(0)
  const dragStartStateRef = useRef<SheetState>('collapsed')
  const dragStartTimeRef = useRef(0)
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
    dragStartStateRef.current = sheetState
    dragStartTimeRef.current = Date.now()
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
    const nextState = getStableSheetState({
      dragDelta: dragDeltaRef.current,
      dragDuration: Date.now() - dragStartTimeRef.current,
      height: currentHeight,
      snapPoints: snapPointsRef.current,
      startHeight: dragStartHeightRef.current,
      startState: dragStartStateRef.current,
    })
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

  return (
    <section
      className={`absolute bottom-0 left-3 right-3 z-40 flex min-h-0 flex-col rounded-t-3xl border border-white/70 bg-white/94 shadow-[0_-10px_28px_rgba(47,65,88,0.10)] backdrop-blur-xl ${
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
        <div className="h-1 w-10 rounded-full bg-slate-300/80" />
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-2 flex shrink-0 items-start justify-between gap-3 px-4">
          <div className="min-w-0 flex-1">
            {sheetState !== 'collapsed' ? (
              <p className="truncate text-xs font-semibold text-sky-600">
                {formatDate(day.date)}
              </p>
            ) : null}
            <h2 className="truncate text-base font-semibold text-slate-950">{day.title}</h2>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              {sheetState === 'collapsed'
                ? `${items.length} 个行程点 · ${getSheetRouteSummary(routeState, routeWarnings)}`
                : `${items.length} 个行程点 · ${mappedCount} 个带坐标`}
            </p>
          </div>
          <Button
            className={`shrink-0 whitespace-nowrap rounded-full bg-slate-50/70 ${sheetState === 'collapsed' || sheetState === 'expanded' ? 'min-h-8 px-2.5 text-xs' : 'min-h-8 px-3 text-xs'}`}
            icon={<Navigation className="size-3.5" />}
            onClick={onBackToTimeline}
            variant={sheetState === 'middle' ? 'secondary' : 'ghost'}
          >
            日程
          </Button>
        </div>

        <div className="shrink-0 space-y-2 px-4">
          {sheetState !== 'collapsed' ? (
            <RouteControlsSummary
              open={routeControlsOpen}
              onToggle={() => setRouteControlsOpen((current) => !current)}
              state={routeState}
              warnings={routeWarnings}
            />
          ) : null}

          {sheetState !== 'collapsed' && routeControlsOpen ? (
            <RouteControlsSection
              activeRoadMode={activeRoadMode}
              activeSegmentItem={activeSegmentItem}
              configured={routeConfigured}
              displayMode={routeDisplayMode}
              key={routeDetailsResetKey}
              onChangeRoadTransportMode={onChangeRoadTransportMode}
              onClearRouteCache={onClearRouteCache}
              onGenerateRoadRoute={onGenerateRoadRoute}
              onResetToStraight={onResetToStraight}
              onSelectRoadDisplay={onSelectRoadDisplay}
              state={routeState}
              warnings={routeWarnings}
            />
          ) : null}

          {mapError ? (
            <div className="rounded-xl bg-amber-50/70 px-3 py-2 text-sm text-amber-700">
              {mapError}
            </div>
          ) : null}

          {notice ? (
            <div className="flex items-start gap-2 rounded-xl bg-slate-50/70 px-3 py-2 text-sm text-slate-600">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-slate-400" />
              <span>{notice}</span>
            </div>
          ) : null}

          {selectedItem && sheetState === 'collapsed' ? (
            <CompactItemLine
              item={selectedItem}
              onSelectItem={(item) => onSelectItem(item, 'list')}
              selected={selectedItem.id === selectedItemId}
            />
          ) : selectedItem && sheetState === 'middle' ? (
            <SelectedItemCard
              compact
              day={day}
              item={selectedItem}
              onEditItem={onEditItem}
              onOpenItem={onOpenItem}
              trip={trip}
            />
          ) : sheetState !== 'expanded' ? (
            <p className="rounded-xl bg-slate-50/70 px-3 py-4 text-sm text-slate-500">
              {items.length === 0
                ? '这一天还没有行程点。'
                : '选择地图标记或列表行程查看详情。'}
            </p>
          ) : null}
        </div>

        {sheetState === 'expanded' ? (
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
        ) : sheetState === 'middle' ? (
          <div className="mt-3 px-4" data-testid="map-sheet-preview-list">
            <ItineraryPreviewList
              itemRefs={itemRefs}
              items={items}
              onSelectItem={onSelectItem}
              selectedItemId={selectedItemId}
            />
            <p className="mt-2 text-center text-xs text-slate-400">
              上拉查看完整行程
            </p>
          </div>
        ) : (
          <p className="mt-2 px-4 text-center text-xs text-slate-400">
            上拉查看行程
          </p>
        )}
      </div>
    </section>
  )
}

function RouteStatusChip({
  state,
  configured,
  displayMode,
  warnings,
  activeRoadMode,
  showBelowHeader,
  onClick,
}: {
  state: RouteUiState
  configured: boolean
  displayMode: RouteDisplayMode
  warnings: string[]
  activeRoadMode: RoadTransportMode | null
  showBelowHeader: boolean
  onClick: () => void
}) {
  const chip = getRouteChipStatus(state, configured, warnings, displayMode, activeRoadMode)

  return (
    <div className={`pointer-events-none absolute left-3 z-40 ${showBelowHeader ? 'top-24' : 'top-3'}`}>
      <button
        aria-label="打开路线设置"
        className={`pointer-events-auto flex min-h-8 max-w-[15rem] items-center gap-1.5 rounded-full border border-white/70 bg-white/90 px-2.5 py-1 text-[11px] font-semibold shadow-[0_6px_16px_rgba(47,65,88,0.08)] backdrop-blur-xl transition active:scale-[0.98] ${chip.className}`}
        data-testid="route-chip"
        onClick={onClick}
        type="button"
      >
        <span className={`size-1.5 shrink-0 rounded-full opacity-80 ${routeStatusDotClassName(state, configured)}`} />
        <span className="min-w-0 truncate" data-testid="route-status-pill">{chip.label}</span>
        <ChevronDown className="size-3 shrink-0 text-slate-400" />
      </button>
    </div>
  )
}

function RouteControlsSummary({
  open,
  onToggle,
  state,
  warnings,
}: {
  open: boolean
  onToggle: () => void
  state: RouteUiState
  warnings: string[]
}) {
  return (
    <button
      aria-expanded={open}
      className="flex w-full items-center justify-between gap-3 rounded-xl bg-slate-50/60 px-3 py-1.5 text-left text-xs transition active:scale-[0.99]"
      data-testid="route-more-toggle"
      onClick={onToggle}
      type="button"
    >
      <span className="font-semibold text-slate-700">路线</span>
      <span className="min-w-0 flex-1 truncate text-right text-slate-500">{getSheetRouteSummary(state, warnings)}</span>
      <ChevronDown className={`size-3.5 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
  )
}

function RouteControlsSection({
  state,
  configured,
  displayMode,
  warnings,
  activeRoadMode,
  activeSegmentItem,
  onGenerateRoadRoute,
  onResetToStraight,
  onSelectRoadDisplay,
  onChangeRoadTransportMode,
  onClearRouteCache,
}: {
  state: RouteUiState
  configured: boolean
  displayMode: RouteDisplayMode
  warnings: string[]
  activeRoadMode: RoadTransportMode | null
  activeSegmentItem: ItineraryItem | null
  onGenerateRoadRoute: () => void
  onResetToStraight: () => void
  onSelectRoadDisplay: () => void
  onChangeRoadTransportMode: (mode: RoadTransportMode) => void
  onClearRouteCache: () => void
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const canGenerate = configured && state !== 'loading'
  const chip = getRouteChipStatus(state, configured, warnings, displayMode, activeRoadMode)
  const warningSummary = getRouteWarningSummary(warnings, configured, activeRoadMode)
  const hasDetails = warnings.length > 0 || !configured || activeRoadMode === 'bus' || state !== 'straight'

  return (
    <div
      className="space-y-1.5 rounded-xl bg-white/60 px-2.5 py-2 text-xs text-slate-600 ring-1 ring-slate-100/80"
      data-testid="route-controls-section"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold text-slate-800">路线</span>
        <span className={`min-w-0 truncate text-right font-semibold ${chip.className}`}>{chip.label}</span>
      </div>

      <div className="flex items-center gap-2">
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-0.5 rounded-full bg-slate-100/70 p-0.5">
          <button
            className={`min-h-7 rounded-full px-2 text-xs font-semibold transition active:scale-[0.98] ${
              displayMode === 'straight' ? 'bg-white/95 text-slate-900 ring-1 ring-slate-200/70' : 'text-slate-500'
            }`}
            data-testid="route-mode-segment-straight"
            onClick={onResetToStraight}
            type="button"
          >
            直线
          </button>
          <button
            className={`min-h-7 rounded-full px-2 text-xs font-semibold transition active:scale-[0.98] ${
              displayMode === 'road' ? 'bg-white/95 text-slate-900 ring-1 ring-slate-200/70' : 'text-slate-500'
            }`}
            data-testid="route-mode-segment-road"
            onClick={onSelectRoadDisplay}
            type="button"
          >
            道路
          </button>
        </div>
        <button
          className="min-h-7 shrink-0 rounded-full bg-sky-600/90 px-2.5 text-xs font-semibold text-white shadow-[0_4px_10px_rgba(22,119,255,0.12)] transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="route-generate-button"
          disabled={!canGenerate}
          onClick={onGenerateRoadRoute}
          type="button"
        >
          {compactRouteActionLabel(state, configured)}
        </button>
      </div>

      <div className="flex items-center gap-1 overflow-x-auto pb-0.5 app-scrollbar">
        {ROAD_TRANSPORT_MODES.map((mode) => (
          <button
            className={`min-h-7 shrink-0 rounded-full px-2.5 text-xs font-semibold transition active:scale-[0.98] ${
              activeRoadMode === mode ? 'bg-sky-50 text-sky-700 ring-1 ring-sky-200/80' : 'bg-slate-50/70 text-slate-500'
            }`}
            data-testid={`route-transport-${mode}`}
            disabled={!activeSegmentItem}
            key={mode}
            onClick={() => onChangeRoadTransportMode(mode)}
            type="button"
          >
            {ROAD_TRANSPORT_LABELS[mode]}
          </button>
        ))}
        {!activeSegmentItem ? (
          <span className="shrink-0 text-slate-400">需要至少两个地点</span>
        ) : null}
      </div>

      {warningSummary || hasDetails ? (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-50/60 px-2.5 py-1.5 [overflow-wrap:anywhere]">
          <span className="min-w-0 truncate text-slate-500" data-testid="route-warning-summary">
            {warningSummary ?? '路线详情'}
          </span>
          {hasDetails ? (
            <button
              className="shrink-0 font-semibold text-sky-600 active:scale-[0.98]"
              data-testid="route-details-toggle"
              onClick={() => setDetailsOpen((current) => !current)}
              type="button"
            >
              {detailsOpen ? '收起详情' : '查看详情'}
            </button>
          ) : null}
        </div>
      ) : null}

      {detailsOpen ? (
        <div className="space-y-1.5 rounded-xl bg-slate-50/55 px-2.5 py-2">
          <div className="space-y-1 leading-5 text-slate-500 [overflow-wrap:anywhere]" data-testid="route-more-panel">
            <p>{routeSourceDetail(state, configured)}</p>
            {!configured ? <p>未配置 ORS 时，可以查看已有缓存路线，但不能重新生成。</p> : null}
            {activeRoadMode === 'bus' || hasBusWarning(warnings) ? (
              <p>公交为道路近似，不含站点、班次、换乘和实时交通。</p>
            ) : null}
          </div>

          {warnings.length > 0 ? (
            <div className="space-y-1 [overflow-wrap:anywhere]" data-testid="route-warning-details">
              {warnings.map((warning) => (
                <p className="break-words text-amber-600" key={warning}>
                  {warning}
                </p>
              ))}
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              className="min-h-7 rounded-full bg-white/80 px-2.5 font-semibold text-slate-600 ring-1 ring-slate-200/70 active:scale-[0.98]"
              data-testid="route-reset-button"
              onClick={onResetToStraight}
              type="button"
            >
              回到直线
            </button>
            <button
              className="min-h-7 rounded-full px-2.5 font-semibold text-slate-400 active:scale-[0.98]"
              onClick={onClearRouteCache}
              type="button"
            >
              清理缓存
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function CompactItemLine({
  item,
  selected,
  onSelectItem,
}: {
  item: ItineraryItem
  selected: boolean
  onSelectItem: (item: ItineraryItem) => void
}) {
  return (
    <button
      className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition active:bg-slate-50 ${
        selected ? 'bg-sky-50/70 text-slate-950' : 'bg-white/70 text-slate-700'
      }`}
      onClick={() => onSelectItem(item)}
      type="button"
    >
      <MapPin className="size-3.5 shrink-0 text-sky-500" />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{item.title}</span>
      <span className="shrink-0 text-xs text-slate-400">{describeItemTime(item)}</span>
    </button>
  )
}

function compactRouteActionLabel(state: RouteUiState, configured: boolean) {
  if (state === 'loading') {
    return '生成中'
  }
  if (!configured) {
    return '无法生成'
  }
  if (state === 'failed') {
    return '重试'
  }
  if (state === 'road' || state === 'cached' || state === 'mixed') {
    return '重新生成'
  }
  return '生成'
}

function getRouteWarningSummary(
  warnings: string[],
  configured: boolean,
  activeRoadMode: RoadTransportMode | null,
) {
  if (!configured) {
    return '未配置 ORS'
  }
  if (activeRoadMode === 'bus' || hasBusWarning(warnings)) {
    return '公交近似'
  }
  if (warnings.some((warning) => warning.includes('路线已过期'))) {
    return '路线已过期'
  }
  if (warnings.some((warning) => warning.includes('交通方式已更新'))) {
    return '路线需更新'
  }

  const actionableWarnings = warnings.filter((warning) => !warning.includes('使用本地缓存路线'))
  if (actionableWarnings.length > 0) {
    return `${actionableWarnings.length} 条路线提示`
  }
  return null
}

function getRouteChipStatus(
  state: RouteUiState,
  configured: boolean,
  warnings: string[],
  displayMode: RouteDisplayMode,
  activeRoadMode: RoadTransportMode | null,
) {
  const warningCount = warnings.length
  if (displayMode === 'road' && (activeRoadMode === 'bus' || hasBusWarning(warnings))) {
    return {
      label: state === 'cached' ? '公交近似 · 缓存' : '公交近似',
      className: 'text-amber-600',
    }
  }
  if (warnings.some((warning) => warning.includes('交通方式已更新'))) {
    return { label: '路线需更新', className: 'text-amber-600' }
  }
  if (warnings.some((warning) => warning.includes('路线已过期'))) {
    return { label: '路线已过期', className: 'text-amber-600' }
  }
  if (state === 'loading') {
    return { label: '正在生成路线', className: 'text-sky-600' }
  }
  if (state === 'cached') {
    return { label: '道路路线 · 本地缓存', className: 'text-slate-700' }
  }
  if (state === 'road') {
    return { label: '道路路线', className: 'text-slate-700' }
  }
  if (state === 'mixed') {
    return { label: `部分失败${warningCount > 0 ? ` · ${warningCount} 条提示` : ''}`, className: 'text-amber-600' }
  }
  if (state === 'failed') {
    return { label: '无法生成路线', className: 'text-amber-600' }
  }
  if (displayMode === 'road' && !configured) {
    return { label: '无法生成路线', className: 'text-slate-500' }
  }
  return { label: '直线连接', className: 'text-slate-600' }
}

function getSheetRouteSummary(state: RouteUiState, warnings: string[]) {
  if (state === 'cached') {
    return '本地缓存'
  }
  if (state === 'road') {
    return '已生成'
  }
  if (state === 'mixed') {
    return '部分回退'
  }
  if (state === 'failed') {
    return '已回退'
  }
  if (warnings.some((warning) => warning.includes('交通方式已更新'))) {
    return '待重新生成'
  }
  if (warnings.some((warning) => warning.includes('路线已过期'))) {
    return '已过期'
  }
  return '查看顺序'
}

function routeSourceDetail(state: RouteUiState, configured: boolean) {
  if (state === 'cached') {
    return '来源：本地路线缓存。'
  }
  if (state === 'road' || state === 'mixed') {
    return '来源：第三方路线服务，结果仅供参考。'
  }
  if (!configured) {
    return '来源：直线连接。'
  }
  return '来源：本地直线连接，点击生成后才请求路线服务。'
}

function hasBusWarning(warnings: string[]) {
  return warnings.some((warning) => warning.includes('公交'))
}

function getRoadTransportMode(item: ItineraryItem | null): RoadTransportMode | null {
  const mode = item?.previousTransportMode
  return mode === 'walk' || mode === 'car' || mode === 'bus' ? mode : null
}

function routeStatusDotClassName(state: RouteUiState, configured: boolean) {
  if (state === 'loading') {
    return 'bg-sky-400'
  }
  if (state === 'road' || state === 'cached') {
    return 'bg-sky-500'
  }
  if (state === 'mixed' || state === 'failed') {
    return 'bg-amber-400'
  }
  return configured ? 'bg-slate-400' : 'bg-slate-300'
}

function buildRouteResultFromCache(entry: RouteCacheEntry): DayRouteResult {
  const hasFailureWarnings = entry.warnings.some(
    (w) => w.includes('回退') || w.includes('失败') || w.includes('不可用'),
  )
  return {
    segments: [],
    lineStrings: entry.lineStrings,
    warnings: entry.warnings,
    provider: entry.provider,
    status: entry.status ?? (hasFailureWarnings ? 'mixed' : 'road'),
    cacheKey: entry.signature,
  }
}

function hasRoadSegments(result: DayRouteResult) {
  return result.segments.some((segment) => segment.kind === 'road')
}

function sumOptional(values: Array<number | undefined>) {
  const numbers = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (numbers.length === 0) {
    return undefined
  }
  return numbers.reduce((sum, value) => sum + value, 0)
}

function requestMapResize() {
  window.requestAnimationFrame(() => {
    window.dispatchEvent(new Event('resize'))
  })
}

function schedulePrewarmIdleTask(task: () => void) {
  type IdleWindow = Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number
    cancelIdleCallback?: (handle: number) => void
  }

  const idleWindow = window as IdleWindow
  if (typeof idleWindow.requestIdleCallback === 'function') {
    const handle = idleWindow.requestIdleCallback(task, { timeout: 3200 })
    return () => idleWindow.cancelIdleCallback?.(handle)
  }

  const timeout = window.setTimeout(task, 1200)
  return () => window.clearTimeout(timeout)
}

function getNetworkInformation() {
  type NavigatorWithConnection = Navigator & {
    connection?: {
      effectiveType?: string
      saveData?: boolean
    }
  }

  return (navigator as NavigatorWithConnection).connection ?? null
}

function ItineraryPreviewList({
  items,
  selectedItemId,
  onSelectItem,
  itemRefs,
}: {
  items: ItineraryItem[]
  selectedItemId: string | null
  onSelectItem: (item: ItineraryItem, source: SelectSource) => void
  itemRefs: MutableRefObject<Record<string, HTMLButtonElement | null>>
}) {
  const previewItems = items.slice(0, 3)
  if (previewItems.length === 0) {
    return (
      <p className="py-3 text-sm text-slate-500">
        这一天还没有行程点。
      </p>
    )
  }

  return (
    <div className="space-y-1.5">
      {previewItems.map((item, index) => (
        <button
          className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition active:bg-slate-50 ${
            selectedItemId === item.id ? 'bg-sky-50/70 ring-1 ring-sky-100/80' : 'bg-white/35 ring-1 ring-transparent'
          }`}
          key={item.id}
          onClick={() => onSelectItem(item, 'list')}
          ref={(node) => {
            itemRefs.current[item.id] = node
          }}
          type="button"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-100/80 text-xs font-bold text-slate-500">
            {index + 1}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-slate-900">{item.title}</span>
            <span className="block truncate text-xs text-slate-400">{item.locationName || item.address || '地点未填写'}</span>
          </span>
          <span className="shrink-0 text-xs text-slate-400">{describeItemTime(item)}</span>
        </button>
      ))}
      {items.length > previewItems.length ? (
        <p className="px-2 pt-1 text-xs text-slate-400">
          还有 {items.length - previewItems.length} 个行程点
        </p>
      ) : null}
    </div>
  )
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
      <p className="rounded-xl bg-slate-50/70 px-3 py-4 text-sm text-slate-500">
        这一天还没有行程点。
      </p>
    )
  }

  return (
    <div className="space-y-1.5 pb-8">
      {items.map((item, index) => {
        const previousTransportDescription = describePreviousTransport(item)
        const hasCoordinates = hasValidCoordinates(item)

        return (
          <div className="space-y-1.5" key={item.id}>
            {index > 0 && previousTransportDescription ? (
              <TransportSegment description={previousTransportDescription} />
            ) : null}
            <button
              className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition active:bg-slate-50 ${
                selectedItemId === item.id ? 'bg-sky-50/70 ring-1 ring-sky-100/80' : 'bg-white/35 ring-1 ring-transparent'
              }`}
              onClick={() => onSelectItem(item, 'list')}
              ref={(node) => {
                itemRefs.current[item.id] = node
              }}
              type="button"
            >
              <span
                className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                  hasCoordinates ? 'bg-sky-50 text-sky-700 ring-1 ring-sky-100/80' : 'bg-slate-100/80 text-slate-400'
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
                  className="min-h-8 rounded-full px-3 text-xs"
                  onClick={() => onOpenItem(item)}
                  variant="secondary"
                >
                  详情
                </Button>
                <Button
                  className="min-h-8 rounded-full px-3 text-xs"
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
    <div className="rounded-xl bg-slate-50/60 px-3 py-2.5 ring-1 ring-slate-100/70">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-sky-600">{describeItemTime(item)}</p>
          <h3 className="mt-0.5 truncate text-sm font-semibold text-slate-950">{item.title}</h3>
          <p className="mt-0.5 truncate text-xs text-slate-500">{item.locationName || '地点未填写'}</p>
        </div>
        <Button
          className="min-h-8 shrink-0 rounded-full px-2.5 text-xs"
          onClick={() => onOpenItem(item)}
          variant="ghost"
        >
          详情
        </Button>
      </div>
      {!compact ? (
        <p className="mt-1 line-clamp-1 text-xs text-slate-400">{item.address || '地址未填写'}</p>
      ) : null}
      <div className="mt-2 flex gap-2">
        <a
          className={`inline-flex min-h-8 flex-1 items-center justify-center gap-1 rounded-xl px-2 text-xs font-semibold ${
            hasCoordinates ? 'bg-white/80 text-slate-700 ring-1 ring-slate-200/70' : 'bg-slate-100/70 text-slate-400'
          }`}
          href={hasCoordinates ? buildAppleMapsUrl(item) : undefined}
          rel="noreferrer"
          target="_blank"
        >
          <LocateFixed className="size-3.5" />
          Apple
        </a>
        <a
          className={`inline-flex min-h-8 flex-1 items-center justify-center gap-1 rounded-xl px-2 text-xs font-semibold ${
            hasCoordinates ? 'bg-white/80 text-slate-700 ring-1 ring-slate-200/70' : 'bg-slate-100/70 text-slate-400'
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
          className="mt-2 w-full min-h-8 rounded-full text-xs"
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
  const collapsed = Math.max(150, Math.round(baseHeight * 0.21))
  const middle = Math.max(collapsed + 82, Math.round(baseHeight * 0.54))
  const expanded = Math.max(middle + 96, Math.round(baseHeight - expandedTopGap))

  return {
    collapsed,
    middle,
    expanded,
  }
}

function getStableSheetState({
  height,
  dragDelta,
  dragDuration,
  snapPoints,
  startHeight,
  startState,
}: {
  height: number
  dragDelta: number
  dragDuration: number
  snapPoints: SnapPoints
  startHeight: number
  startState: SheetState
}): SheetState {
  const deltaHeight = height - startHeight
  const absoluteDrag = Math.abs(dragDelta)
  const velocity = absoluteDrag / Math.max(1, dragDuration)
  const snapSpan = Math.max(1, snapPoints.expanded - snapPoints.collapsed)
  const smallDragThreshold = clamp(Math.round(snapSpan * 0.08), 34, 44)
  const velocityThreshold = 0.56
  const middleDeadZone = clamp(Math.round(snapSpan * 0.22), 72, 148)
  const isFast = velocity >= velocityThreshold
  const direction: 'up' | 'down' = dragDelta < 0 ? 'up' : 'down'

  if (absoluteDrag < smallDragThreshold && !isFast) {
    return startState
  }

  if (!isFast && Math.abs(height - snapPoints.middle) <= middleDeadZone) {
    return 'middle'
  }

  if (isFast) {
    const isLargeFling = absoluteDrag >= snapSpan * 0.36
    if (startState === 'collapsed' && direction === 'up' && isLargeFling) {
      return 'expanded'
    }
    if (startState === 'expanded' && direction === 'down' && isLargeFling) {
      return 'collapsed'
    }

    return adjacentSheetState(startState, direction)
  }

  if (startState === 'middle') {
    const upThreshold = Math.max(76, (snapPoints.expanded - snapPoints.middle) * 0.38)
    const downThreshold = Math.max(76, (snapPoints.middle - snapPoints.collapsed) * 0.38)
    if (deltaHeight > upThreshold) {
      return 'expanded'
    }
    if (deltaHeight < -downThreshold) {
      return 'collapsed'
    }
    return 'middle'
  }

  if (startState === 'collapsed') {
    const upThreshold = Math.max(64, (snapPoints.middle - snapPoints.collapsed) * 0.38)
    return deltaHeight > upThreshold ? 'middle' : 'collapsed'
  }

  const downThreshold = Math.max(64, (snapPoints.expanded - snapPoints.middle) * 0.38)
  return deltaHeight < -downThreshold ? 'middle' : 'expanded'
}

function adjacentSheetState(startState: SheetState, direction: 'up' | 'down'): SheetState {
  const index = SNAP_STATES.indexOf(startState)

  if (direction === 'up') {
    return SNAP_STATES[Math.min(SNAP_STATES.length - 1, index + 1)]
  }

  return SNAP_STATES[Math.max(0, index - 1)]
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function TransportSegment({ description }: { description: string }) {
  return (
    <div className="mx-1 flex w-fit max-w-[calc(100%-0.5rem)] items-center gap-1.5 rounded-full bg-slate-50/75 px-2.5 py-1 text-[11px] font-medium text-slate-500 ring-1 ring-slate-100/70">
      <ArrowDown className="size-3 shrink-0 text-slate-400" />
      <span className="min-w-0 truncate">{description}</span>
    </div>
  )
}
