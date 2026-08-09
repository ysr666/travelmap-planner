import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { ArrowLeft, Building2, ChevronLeft, ChevronRight, Clock3, Crosshair, Info, Locate, MapPin, Navigation, RefreshCw, Route, Ticket, X } from 'lucide-react'
import { DayMap, type DayMapHandle } from '../DayMap'
import { EmptyState } from '../ui/EmptyState'
import { hasValidCoordinates } from '../../lib/mapLinks'
import { describeItemTime } from '../../lib/itinerary'
import { formatDate } from '../../lib/dates'
import { DEFAULT_DAY_MAP_PADDING, normalizeEdgeInsets, type ScreenRect } from '../../lib/dayMapViewport'
import type { EdgeInsets } from '../../lib/mapEngine'
import {
  buildDayMapExperience,
  type DayMapRouteInput,
  type DayMapRoutePresentation,
  type DayMapStopPresentation,
} from '../../lib/dayMapExperience'
import {
  ROUTING_CONFIG_CHANGED_EVENT,
  getRoutingConfig,
  type DayRouteResult,
  type LngLat,
  type RoutingConfig,
} from '../../lib/routing'
import { generateAndCacheDayRoutePreview } from '../../lib/routeGeneration'
import { getPersistentRouteProvider } from '../../lib/routePreparation'
import {
  ROUTE_CACHE_CHANGED_EVENT,
  buildCurrentRouteCacheIdentity,
  listRouteCachesForDay,
  loadRouteCache,
  type RouteCacheEntry,
} from '../../lib/routeCache'
import { buildDayPrewarmQueue, shouldSkipMapPrewarm } from '../../lib/mapPrewarm'
import { markMapStartup } from '../../lib/mapStartupMetrics'
import type { Day, ItineraryItem, Trip } from '../../types'

type UserLocationStatus = 'idle' | 'loading' | 'ready' | 'error'

type DayMapViewProps = {
  trip: Trip
  day: Day
  items: ItineraryItem[]
  allDays?: Day[]
  dayItemsByDayId?: Record<string, ItineraryItem[]>
  embedded?: boolean
  isVisible?: boolean
  minimalOverlay?: boolean
  showDefaultMarkerCard?: boolean
  prewarmEnabled?: boolean
  showFloatingHeader?: boolean
  resizeSignal?: number
  onBackToSchedule?: () => void
  onOpenItem: (item: ItineraryItem) => void
  onOpenTickets?: (item: ItineraryItem) => void
}

const FAR_USER_LOCATION_MESSAGE = '当前位置距离行程较远，已优先回到当天行程范围'
const LOCATION_UNAVAILABLE_MESSAGE = '暂时无法取得位置，请稍后重试。'
const LOCATION_PERMISSION_MESSAGE = '定位失败，请在地址栏允许位置后重试'
const MAP_OVERLAY_GAP = 12
const MARKER_EDGE_RESERVE = 112
const MARKER_CARD_FALLBACK_HEIGHT = 236

export function DayMapView({
  trip,
  day,
  items,
  allDays,
  dayItemsByDayId,
  embedded = false,
  isVisible = true,
  minimalOverlay = false,
  showDefaultMarkerCard = true,
  prewarmEnabled = false,
  showFloatingHeader = true,
  resizeSignal,
  onBackToSchedule,
  onOpenItem,
  onOpenTickets,
}: DayMapViewProps) {
  const [selectedItemSelection, setSelectedItemSelection] = useState<{
    dayId: string
    itemId: string
  } | null>(null)
  const [mapError, setMapError] = useState<string | null>(null)
  const [routingConfig, setRoutingConfig] = useState<RoutingConfig>(() => getRoutingConfig())
  const [routeResult, setRouteResult] = useState<DayRouteResult | null>(null)
  const [routeCacheEntry, setRouteCacheEntry] = useState<RouteCacheEntry | null>(null)
  const [routeRefreshStatus, setRouteRefreshStatus] = useState<'error' | 'idle' | 'loading'>('idle')
  const [mapBaseLoading, setMapBaseLoading] = useState(() => items.some(hasValidCoordinates))
  const [markerCardSelection, setMarkerCardSelection] = useState<{
    dayId: string
    itemId: string
  } | null>(null)
  const [markerCardDismissedDayId, setMarkerCardDismissedDayId] = useState<string | null>(null)
  const [userLocation, setUserLocation] = useState<LngLat | null>(null)
  const [userLocationStatus, setUserLocationStatus] = useState<UserLocationStatus>('idle')
  const [mapControlNotice, setMapControlNotice] = useState<{
    dayId: string
    message: string
  } | null>(null)
  const [cacheRefreshToken, setCacheRefreshToken] = useState(0)
  const dayMapRef = useRef<DayMapHandle | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const markerCardRef = useRef<HTMLDivElement | null>(null)
  const floatingControlsRef = useRef<HTMLDivElement | null>(null)
  const mapControlNoticeRef = useRef<HTMLDivElement | null>(null)
  const routeStatusRef = useRef<HTMLButtonElement | HTMLDivElement | null>(null)
  const pendingUserLocationRecenterRef = useRef(false)
  const [mapReadyToken, setMapReadyToken] = useState(0)
  const [mapViewportPadding, setMapViewportPadding] = useState<EdgeInsets>(() =>
    getFallbackMapPadding({ includeMarkerCard: false, showFloatingHeader }),
  )
  const [markerFocusPadding, setMarkerFocusPadding] = useState<EdgeInsets>(() =>
    getFallbackMapPadding({ includeMarkerCard: false, showFloatingHeader }),
  )

  const selectedItemId = selectedItemSelection?.dayId === day.id ? selectedItemSelection.itemId : null
  const routeInput = useMemo(
    () => buildDayMapRouteInput(routeResult, routeCacheEntry),
    [routeCacheEntry, routeResult],
  )
  const mapExperience = useMemo(() => buildDayMapExperience({
    items,
    providerConfigured: Boolean(getPersistentRouteProvider(routingConfig)),
    route: routeInput,
    selectedItemId,
  }), [items, routeInput, routingConfig, selectedItemId])
  const mappedItems = useMemo(() => mapExperience.stops.map((stop) => stop.item), [mapExperience.stops])
  const selectedItemSource = selectedItemId ? 'marker' : null
  const markerCardItemId = markerCardSelection?.dayId === day.id ? markerCardSelection.itemId : null
  const mapControlNoticeMessage = mapControlNotice?.dayId === day.id ? mapControlNotice.message : null
  const markerCardStop = useMemo(() => {
    if (!markerCardItemId) {
      if (!showDefaultMarkerCard) {
        return null
      }
      return markerCardDismissedDayId === day.id ? null : (mapExperience.stops[0] ?? null)
    }
    return mapExperience.stops.find((stop) => stop.item.id === markerCardItemId) ?? null
  }, [day.id, mapExperience.stops, markerCardDismissedDayId, markerCardItemId, showDefaultMarkerCard])
  const markerCardItemIndex = markerCardStop ? markerCardStop.sequence - 1 : -1
  const previousMarkerCardStop = markerCardItemIndex > 0 ? mapExperience.stops[markerCardItemIndex - 1] : null
  const nextMarkerCardStop = markerCardItemIndex >= 0 && markerCardItemIndex < mapExperience.stops.length - 1
    ? mapExperience.stops[markerCardItemIndex + 1]
    : null
  const markerCardVisible = Boolean(
    isVisible
    && markerCardStop
    && !mapBaseLoading
    && !mapError,
  )
  const configuredRouteProvider = getPersistentRouteProvider(routingConfig)
  const routeCacheIdentities = useMemo(
    () => (configuredRouteProvider ? [configuredRouteProvider] : ['openrouteservice', 'google'] as const)
      .map((provider) => buildCurrentRouteCacheIdentity({
        tripId: trip.id,
        dayId: day.id,
        items,
        provider,
      })),
    [configuredRouteProvider, day.id, items, trip.id],
  )
  const routeIdentityKey = routeCacheIdentities.map((identity) => identity.signature).join('|')
  const routeLineStrings = mapExperience.route.lineStrings
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
  const cancelDayMapPrewarm = useCallback((options?: { restoreCamera?: boolean }) => {
    dayMapRef.current?.cancelPrewarm(options)
  }, [])
  const setCurrentMapControlNotice = useCallback((message: string | null) => {
    setMapControlNotice(message ? { dayId: day.id, message } : null)
  }, [day.id])
  const getCurrentMapPadding = useCallback((includeMarkerCard: boolean) => {
    const stageRect = toScreenRect(rootRef.current?.getBoundingClientRect() ?? null)
    const fallbackPadding = getFallbackMapPadding({
      includeMarkerCard,
      showFloatingHeader,
    })

    return getMeasuredMapPadding({
      controlNoticeRect: toScreenRect(mapControlNoticeRef.current?.getBoundingClientRect() ?? null),
      fallbackPadding,
      floatingControlsRect: toScreenRect(floatingControlsRef.current?.getBoundingClientRect() ?? null),
      markerCardRect: includeMarkerCard
        ? toScreenRect(markerCardRef.current?.getBoundingClientRect() ?? null)
        : null,
      routeStatusRect: toScreenRect(routeStatusRef.current?.getBoundingClientRect() ?? null),
      stageRect,
    })
  }, [showFloatingHeader])

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
    queueMicrotask(() => {
      setSelectedItemSelection(null)
      setMarkerCardSelection(null)
      setMarkerCardDismissedDayId(null)
      setMapControlNotice(null)
      setRouteRefreshStatus('idle')
    })
  }, [day.id])

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
    let cancelled = false

    async function refreshCachedRoute() {
      try {
        const validSignatures = new Set(routeCacheIdentities.map((identity) => identity.signature))
        const entries = (await listRouteCachesForDay(trip.id, day.id))
          .filter((entry) => validSignatures.has(entry.signature))
          .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt))
        const cached = entries[0] ? await loadRouteCache(entries[0].signature) : null
        if (cancelled) {
          return
        }
        if (cached) {
          setRouteCacheEntry(cached)
          setRouteResult(buildRouteResultFromCache(cached))
          return
        }
        setRouteCacheEntry(null)
        setRouteResult(null)
      } catch {
        if (cancelled) {
          return
        }
        setRouteCacheEntry(null)
        setRouteResult(null)
      }
    }

    void refreshCachedRoute()

    return () => {
      cancelled = true
    }
  }, [day.id, routeCacheIdentities, routeCacheRefreshKey, routeIdentityKey, trip.id])

  useEffect(() => {
    return () => {
      cancelDayMapPrewarm({ restoreCamera: false })
    }
  }, [cancelDayMapPrewarm])

  useEffect(() => {
    if (!prewarmEnabled) {
      dayMapRef.current?.cancelPrewarm({ restoreCamera: false })
      if (isVisible) {
        dayMapRef.current?.recenter({
          padding: getCurrentMapPadding(markerCardVisible),
        })
      }
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
      cancelDayMapPrewarm({ restoreCamera: false })
    }
  }, [cancelDayMapPrewarm, getCurrentMapPadding, isVisible, mapReadyToken, markerCardVisible, prewarmEnabled, prewarmQueue, prewarmQueueKey])

  const applyMapRecenterNotice = useCallback((result: ReturnType<DayMapHandle['recenter']> | undefined) => {
    if (!result) {
      setCurrentMapControlNotice('地图还在准备中，请稍后再试。')
      return
    }

    if (result.excludedUserLocationForDistance) {
      setCurrentMapControlNotice(FAR_USER_LOCATION_MESSAGE)
      return
    }

    if (!result.usedItineraryPoints && !result.includedUserLocation) {
      setCurrentMapControlNotice('暂无可回到的地图坐标。')
      return
    }

    setCurrentMapControlNotice(null)
  }, [setCurrentMapControlNotice])

  useEffect(() => {
    if (!pendingUserLocationRecenterRef.current || !userLocation || !dayMapRef.current?.isReady()) {
      return
    }

    pendingUserLocationRecenterRef.current = false
    applyMapRecenterNotice(dayMapRef.current.recenter({
      padding: getCurrentMapPadding(markerCardVisible),
    }))
  }, [applyMapRecenterNotice, day.id, getCurrentMapPadding, mapReadyToken, markerCardVisible, userLocation])

  const handleSelectItem = useCallback((item: ItineraryItem) => {
    setMarkerCardDismissedDayId(null)
    setSelectedItemSelection({
      dayId: day.id,
      itemId: item.id,
    })

    if (!hasValidCoordinates(item)) {
      setCurrentMapControlNotice('该行程点暂无坐标，可去日程编辑坐标。')
    } else {
      setCurrentMapControlNotice(null)
    }

    setMarkerCardSelection({
      dayId: day.id,
      itemId: item.id,
    })
  }, [day.id, setCurrentMapControlNotice])

  function handleRecenterMap() {
    applyMapRecenterNotice(dayMapRef.current?.recenter({
      padding: getCurrentMapPadding(markerCardVisible),
    }))
  }

  function handleRequestUserLocation() {
    if (!navigator.geolocation) {
      setUserLocationStatus('error')
      setCurrentMapControlNotice(LOCATION_UNAVAILABLE_MESSAGE)
      return
    }

    setUserLocationStatus('loading')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextLocation: LngLat = [position.coords.longitude, position.coords.latitude]
        if (!isFiniteLngLat(nextLocation)) {
          setUserLocationStatus('error')
          setCurrentMapControlNotice(LOCATION_UNAVAILABLE_MESSAGE)
          return
        }

        pendingUserLocationRecenterRef.current = true
        setUserLocation(nextLocation)
        setUserLocationStatus('ready')
      },
      (error) => {
        pendingUserLocationRecenterRef.current = false
        setUserLocation(null)
        setUserLocationStatus('error')
        setCurrentMapControlNotice(
          error.code === error.PERMISSION_DENIED
            ? LOCATION_PERMISSION_MESSAGE
            : LOCATION_UNAVAILABLE_MESSAGE,
        )
      },
      {
        enableHighAccuracy: false,
        maximumAge: 60_000,
        timeout: 8_000,
      },
    )
  }

  async function handleRefreshRoute() {
    if (routeRefreshStatus === 'loading' || !mapExperience.route.canRefresh) return
    const config = getRoutingConfig()
    if (!getPersistentRouteProvider(config)) {
      setRouteRefreshStatus('error')
      setCurrentMapControlNotice('路线服务暂不可用。')
      return
    }

    setRouteRefreshStatus('loading')
    setCurrentMapControlNotice(null)
    try {
      const outcome = await generateAndCacheDayRoutePreview({
        config,
        day,
        items,
        tripId: trip.id,
      })
      if (!outcome.result || (outcome.result.status !== 'road' && outcome.result.status !== 'mixed')) {
        setRouteRefreshStatus('error')
        setCurrentMapControlNotice('道路路线暂不可用，已保留当前显示。')
        return
      }
      setRouteCacheEntry(outcome.cacheEntry ?? null)
      setRouteResult(outcome.result)
      setRouteRefreshStatus('idle')
      setCurrentMapControlNotice('路线已更新。')
    } catch {
      setRouteRefreshStatus('error')
      setCurrentMapControlNotice('道路路线暂不可用，已保留当前显示。')
    }
  }

  const updateMapOverlayPadding = useCallback(() => {
    const nextBasePadding = getCurrentMapPadding(false)
    const nextFocusPadding = getCurrentMapPadding(markerCardVisible)

    setMapViewportPadding((current) => (
      edgeInsetsEqual(current, nextBasePadding) ? current : nextBasePadding
    ))
    setMarkerFocusPadding((current) => (
      edgeInsetsEqual(current, nextFocusPadding) ? current : nextFocusPadding
    ))
  }, [getCurrentMapPadding, markerCardVisible, setMapViewportPadding, setMarkerFocusPadding])

  useLayoutEffect(() => {
    const resizeObserver = new ResizeObserver(updateMapOverlayPadding)
    const observedElements = [
      rootRef.current,
      markerCardRef.current,
      mapControlNoticeRef.current,
      floatingControlsRef.current,
      routeStatusRef.current,
    ].filter((element): element is HTMLDivElement => element !== null)

    observedElements.forEach((element) => resizeObserver.observe(element))
    window.addEventListener('resize', updateMapOverlayPadding)
    window.visualViewport?.addEventListener('resize', updateMapOverlayPadding)
    const measureFrame = window.requestAnimationFrame(updateMapOverlayPadding)
    const measureTimeout = window.setTimeout(updateMapOverlayPadding, 0)

    return () => {
      window.cancelAnimationFrame(measureFrame)
      window.clearTimeout(measureTimeout)
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateMapOverlayPadding)
      window.visualViewport?.removeEventListener('resize', updateMapOverlayPadding)
    }
  }, [resizeSignal, updateMapOverlayPadding])

  return (
    <div ref={rootRef} className={`${embedded ? 'relative h-full min-h-0' : 'app-viewport relative'} min-h-0 overflow-hidden bg-map-bg`}>
      <div className="absolute inset-0 z-0">
        {items.length === 0 ? (
          <MapEmptyBackdrop
            body="添加酒店、景点、交通或餐厅后，再查看地图。"
            title="今天还没有行程点"
          />
        ) : (
          <DayMap
            ref={dayMapRef}
            activeRouteLineKind={mapExperience.route.activeLineKind}
            activeRouteLineStrings={mapExperience.route.activeLineStrings}
            connectUserLocationToFirst
            heightClassName="h-full min-h-0"
            items={items}
            markerLabel="sequence"
            onBaseLoadingChange={setMapBaseLoading}
            onMapError={(message) => setMapError(message)}
            onMapReady={() => setMapReadyToken((current) => current + 1)}
            onSelectItem={handleSelectItem}
            markerFocusPadding={markerFocusPadding}
            routeLineKind={mapExperience.route.lineKind}
            routeLineStrings={routeLineStrings}
            resizeSignal={resizeSignal}
            selectedItemId={selectedItemId}
            selectedItemSource={selectedItemSource}
            surface="fullscreen"
            userLocation={userLocation}
            viewportPadding={mapViewportPadding}
          />
        )}

        {markerCardVisible && markerCardStop ? (
          <MarkerPreviewCard
            containerRef={markerCardRef}
            dayLabel={formatDate(day.date)}
            itemIndex={markerCardItemIndex}
            stop={markerCardStop}
            onClose={() => {
              setMarkerCardSelection(null)
              setSelectedItemSelection(null)
              setMarkerCardDismissedDayId(day.id)
            }}
            onOpenItem={onOpenItem}
            onOpenTickets={onOpenTickets}
            onSelectStop={(stop) => handleSelectItem(stop.item)}
            nextStop={nextMarkerCardStop}
            previousStop={previousMarkerCardStop}
            route={mapExperience.route}
            totalItems={mapExperience.stops.length}
          />
        ) : null}
      </div>

      {isVisible && items.length > 0 && !mapBaseLoading && !mapError ? (
        <MapRouteStatus
          containerRef={routeStatusRef}
          onRefresh={() => void handleRefreshRoute()}
          refreshStatus={routeRefreshStatus}
          route={mapExperience.route}
          showFloatingHeader={showFloatingHeader}
        />
      ) : null}

      {isVisible && !minimalOverlay && items.length > 0 && !mapBaseLoading && !mapError ? (
        <MapFloatingControls
          containerRef={floatingControlsRef}
          locationStatus={userLocationStatus}
          onRecenter={handleRecenterMap}
          onRequestUserLocation={handleRequestUserLocation}
        />
      ) : null}

      {isVisible && mapControlNoticeMessage && !mapBaseLoading && !mapError ? (
        <MapControlNotice
          containerRef={mapControlNoticeRef}
          message={mapControlNoticeMessage}
        />
      ) : null}

      {isVisible && showFloatingHeader ? (
        <MapHeader
          day={day}
          itemCount={items.length}
          mappedCount={mappedItems.length}
          onBackToSchedule={onBackToSchedule}
          trip={trip}
        />
      ) : null}
    </div>
  )
}

function MarkerPreviewCard({
  containerRef,
  dayLabel,
  itemIndex,
  nextStop,
  onClose,
  onOpenItem,
  onOpenTickets,
  onSelectStop,
  previousStop,
  route,
  stop,
  totalItems,
}: {
  containerRef?: RefObject<HTMLDivElement | null>
  dayLabel: string
  itemIndex: number
  nextStop: DayMapStopPresentation | null
  onClose: () => void
  onOpenItem: (item: ItineraryItem) => void
  onOpenTickets?: (item: ItineraryItem) => void
  onSelectStop: (stop: DayMapStopPresentation) => void
  previousStop: DayMapStopPresentation | null
  route: DayMapRoutePresentation
  stop: DayMapStopPresentation
  totalItems: number
}) {
  const item = stop.item
  const canOpenTickets = stop.ticketCount > 0 && Boolean(onOpenTickets)
  const journeyLabel = stop.transportLabel
    ?? (route.geometryKind === 'road' ? route.detail : null)

  return (
    <div
      aria-label={`已选择 ${item.title}`}
      className="day-map-place-sheet"
      ref={containerRef}
      role="region"
    >
      <div
        className="day-map-place-sheet-panel"
        data-testid="map-marker-card"
      >
        <div className="day-map-place-sheet-topline">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-on-primary">
              {Math.max(0, itemIndex) + 1}
            </span>
            <p className="truncate text-xs font-semibold text-primary">
              {dayLabel} · 第 {Math.max(0, itemIndex) + 1}/{Math.max(1, totalItems)} 站
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              aria-label="上一站"
              className="day-map-place-sheet-icon tm-focus"
              data-testid="map-marker-card-prev"
              disabled={!previousStop}
              onClick={() => previousStop && onSelectStop(previousStop)}
              type="button"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              aria-label="下一站"
              className="day-map-place-sheet-icon tm-focus"
              data-testid="map-marker-card-next"
              disabled={!nextStop}
              onClick={() => nextStop && onSelectStop(nextStop)}
              type="button"
            >
              <ChevronRight className="size-4" />
            </button>
            <button
              aria-label="关闭地点卡片"
              className="day-map-place-sheet-icon tm-focus"
              data-testid="map-marker-card-close"
              onClick={onClose}
              type="button"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
        <h3 className="mt-1 min-w-0 break-words text-xl font-semibold leading-7 text-on-surface">
          {item.title}
        </h3>
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-on-surface-variant">
          <span className="flex min-w-0 items-center gap-1.5">
            <Clock3 className="size-4 shrink-0" />
            <span>{describeItemTime(item)}</span>
          </span>
          {journeyLabel ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <Route className="size-4 shrink-0" />
              <span>{journeyLabel}</span>
            </span>
          ) : null}
          {stop.ticketCount > 0 ? (
            <span className="font-medium text-primary">{stop.ticketCount} 张票据</span>
          ) : null}
        </div>
        {item.locationName || item.address ? (
          <p className="mt-2 flex min-w-0 items-start gap-1.5 text-sm leading-5 text-on-surface-variant">
            <MapPin className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 break-words">{item.address || item.locationName}</span>
          </p>
        ) : null}
        <div className={`mt-4 grid gap-2 ${canOpenTickets ? 'grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,1fr)]' : 'grid-cols-2'}`}>
          <a
            className="inline-flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-lg bg-primary px-2 text-sm font-semibold text-on-primary transition active:scale-[0.98] tm-focus"
            data-testid="map-marker-card-navigate"
            href={stop.navigationHref}
            rel="noreferrer"
            target="_blank"
          >
            <Navigation className="size-4 shrink-0" />
            <span className="truncate">开始导航</span>
          </a>
          {canOpenTickets ? (
            <button
              aria-label={`打开 ${item.title} 的票据`}
              className="inline-flex min-h-12 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-outline-variant bg-surface px-2 text-sm font-semibold text-on-surface transition active:scale-[0.98] tm-focus"
              data-testid="map-marker-card-tickets"
              onClick={() => onOpenTickets?.(item)}
              type="button"
            >
              <Ticket className="size-4 shrink-0" />
              <span className="truncate">票据</span>
            </button>
          ) : null}
          <button
            className="inline-flex min-h-12 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-outline-variant bg-surface px-2 text-sm font-semibold text-on-surface transition active:scale-[0.98] tm-focus"
            data-testid="map-marker-card-open"
            onClick={() => onOpenItem(item)}
            type="button"
          >
            <Info className="size-4 shrink-0" />
            <span className="truncate">详情</span>
          </button>
        </div>
      </div>
    </div>
  )
}

function MapRouteStatus({
  containerRef,
  onRefresh,
  refreshStatus,
  route,
  showFloatingHeader,
}: {
  containerRef?: RefObject<HTMLButtonElement | HTMLDivElement | null>
  onRefresh: () => void
  refreshStatus: 'error' | 'idle' | 'loading'
  route: DayMapRoutePresentation
  showFloatingHeader: boolean
}) {
  const label = refreshStatus === 'loading'
    ? '正在更新路线'
    : refreshStatus === 'error'
      ? route.geometryKind === 'road' ? '道路路线（刷新失败）' : '道路路线暂不可用'
      : route.label
  const className = `absolute left-4 z-20 flex min-h-11 max-w-[calc(100%-6rem)] items-center gap-2 rounded-lg border border-outline-variant bg-surface/94 px-3 text-xs font-semibold text-on-surface shadow-sm backdrop-blur ${showFloatingHeader ? 'top-[5.75rem]' : 'top-[7.25rem]'}`
  const content = (
    <>
      <Route className="size-4 shrink-0 text-primary" />
      <span className="min-w-0 truncate" data-testid="map-route-status-label">{label}</span>
      {route.canRefresh ? (
        <RefreshCw className={`size-3.5 shrink-0 text-on-surface-variant ${refreshStatus === 'loading' ? 'animate-spin' : ''}`} />
      ) : null}
    </>
  )

  if (route.canRefresh) {
    return (
      <button
        aria-label={`重新计算路线，当前${label}，${route.detail}`}
        className={`${className} tm-focus`}
        data-route-state={route.geometryKind}
        data-testid="map-route-status"
        disabled={refreshStatus === 'loading'}
        onClick={onRefresh}
        ref={containerRef as RefObject<HTMLButtonElement | null>}
        title="重新计算路线"
        type="button"
      >
        {content}
      </button>
    )
  }

  return (
    <div
      aria-label={`${label}，${route.detail}`}
      className={className}
      data-route-state={route.geometryKind}
      data-testid="map-route-status"
      ref={containerRef as RefObject<HTMLDivElement | null>}
      role="status"
    >
      {content}
    </div>
  )
}

function MapHeader({
  trip,
  day,
  itemCount,
  mappedCount,
  onBackToSchedule,
}: {
  trip: Trip
  day: Day
  itemCount: number
  mappedCount: number
  onBackToSchedule?: () => void
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <div className="pointer-events-auto mx-auto flex items-center gap-2 rounded-2xl p-2 backdrop-blur-xl tm-surface">
        <button
          aria-label="返回日程"
          className="flex size-11 shrink-0 items-center justify-center rounded-xl text-on-surface ring-1 ring-outline-variant/30 transition active:scale-[0.98] tm-surface tm-focus dark:text-outline-variant dark:ring-outline-variant/30"
          onClick={onBackToSchedule}
          type="button"
        >
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-sky-600 dark:text-sky-300">{trip.title}</p>
          <h2 className="truncate text-base font-semibold leading-tight text-on-surface dark:text-on-surface">
            {day.title}
          </h2>
          <p className="truncate text-xs tm-muted">
            {formatDate(day.date)} · {itemCount} 个行程 · {mappedCount} 个坐标
          </p>
        </div>
      </div>
    </div>
  )
}

function MapFloatingControls({
  containerRef,
  locationStatus,
  onRecenter,
  onRequestUserLocation,
}: {
  containerRef?: RefObject<HTMLDivElement | null>
  locationStatus: UserLocationStatus
  onRecenter: () => void
  onRequestUserLocation: () => void
}) {
  const locationLoading = locationStatus === 'loading'

  return (
    <div ref={containerRef} className="absolute top-[calc(56px+16px)] right-4 flex flex-col gap-3 z-20">
      <button
        aria-label="回到当天行程范围"
        className="pointer-events-auto flex size-11 items-center justify-center rounded-full text-on-surface backdrop-blur-xl transition active:scale-[0.98] tm-surface tm-focus dark:text-outline-variant"
        data-testid="map-recenter-button"
        onClick={onRecenter}
        title="回到当天行程范围"
        type="button"
      >
        <Crosshair className="size-5" />
      </button>
      <button
        aria-label={locationLoading ? '正在获取当前位置' : '显示当前位置'}
        className="pointer-events-auto flex size-11 items-center justify-center rounded-full text-on-surface backdrop-blur-xl transition active:scale-[0.98] disabled:cursor-wait disabled:opacity-70 tm-surface tm-focus dark:text-outline-variant"
        data-testid="map-user-location-button"
        disabled={locationLoading}
        onClick={onRequestUserLocation}
        title={locationLoading ? '正在获取当前位置' : '显示当前位置'}
        type="button"
      >
        <Locate className={`size-5 ${locationLoading ? 'animate-pulse text-sky-600 dark:text-sky-300' : locationStatus === 'ready' ? 'text-sky-600 dark:text-sky-300' : ''}`} />
      </button>
    </div>
  )
}

function MapControlNotice({
  containerRef,
  message,
}: {
  containerRef?: RefObject<HTMLDivElement | null>
  message: string
}) {
  return (
      <div
        className="pointer-events-none absolute right-4 top-[11.25rem] z-20 flex min-h-11 w-fit max-w-[calc(100%-2rem)] items-center rounded-lg px-3 py-2 text-xs font-medium leading-5 text-on-surface-variant backdrop-blur-xl tm-surface dark:text-outline-variant"
        data-testid="map-location-notice"
        ref={containerRef}
      >
        <span className="min-w-0 [overflow-wrap:anywhere]">{message}</span>
      </div>
  )
}

function isFiniteLngLat([lng, lat]: LngLat) {
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lng >= -180 &&
    lng <= 180 &&
    lat >= -90 &&
    lat <= 90
  )
}

function buildDayMapRouteInput(
  result: DayRouteResult | null,
  cacheEntry: RouteCacheEntry | null,
): DayMapRouteInput | null {
  if (!result) return null
  return {
    distanceMeters: cacheEntry?.distanceMeters ?? sumRouteMetric(result.segments.map((segment) => segment.distanceMeters)),
    durationSeconds: cacheEntry?.durationSeconds ?? sumRouteMetric(result.segments.map((segment) => segment.durationSeconds)),
    lineStrings: result.lineStrings,
    provider: result.provider,
    status: result.status,
    warnings: result.warnings,
  }
}

function sumRouteMetric(values: Array<number | undefined>) {
  const present = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return present.length > 0 ? present.reduce((sum, value) => sum + value, 0) : undefined
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

function MapEmptyBackdrop({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-map-bg p-6">
      <EmptyState
        body={body}
        icon={<Building2 className="size-6" />}
        title={title}
      />
    </div>
  )
}

function getFallbackMapPadding({
  includeMarkerCard,
  showFloatingHeader,
}: {
  includeMarkerCard: boolean
  showFloatingHeader: boolean
}): EdgeInsets {
  const top = showFloatingHeader ? 164 : 76
  const markerCardReserve = includeMarkerCard ? MARKER_CARD_FALLBACK_HEIGHT + 48 : 0

  return normalizeEdgeInsets({
    top,
    right: 76,
    bottom: MAP_OVERLAY_GAP + MARKER_EDGE_RESERVE + markerCardReserve,
    left: 20,
  }, DEFAULT_DAY_MAP_PADDING)
}

function getMeasuredMapPadding({
  controlNoticeRect,
  fallbackPadding,
  floatingControlsRect,
  markerCardRect,
  routeStatusRect,
  stageRect,
}: {
  controlNoticeRect: ScreenRect | null
  fallbackPadding: EdgeInsets
  floatingControlsRect: ScreenRect | null
  markerCardRect: ScreenRect | null
  routeStatusRect: ScreenRect | null
  stageRect: ScreenRect | null
}): EdgeInsets {
  const fallback = normalizeEdgeInsets(fallbackPadding)
  if (!stageRect) {
    return fallback
  }

  const measuredRight = Math.max(fallback.right, getRightInset(stageRect, floatingControlsRect))
  const next = normalizeEdgeInsets({
    top: Math.max(
      fallback.top,
      getTopInset(stageRect, floatingControlsRect),
      getTopInset(stageRect, controlNoticeRect),
      getTopInset(stageRect, routeStatusRect),
    ),
    right: measuredRight,
    bottom: Math.max(
      fallback.bottom,
      getBottomInset(stageRect, markerCardRect),
    ),
    left: Math.max(fallback.left, measuredRight),
  }, fallback)

  return constrainPaddingToStage(next, stageRect)
}

function toScreenRect(rect: DOMRect | null): ScreenRect | null {
  if (!rect) {
    return null
  }

  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  }
}

function getBottomInset(stageRect: ScreenRect, overlayRect: ScreenRect | null) {
  if (!overlayRect || overlayRect.bottom <= stageRect.top || overlayRect.top >= stageRect.bottom) {
    return 0
  }
  return Math.max(0, Math.ceil(stageRect.bottom - overlayRect.top + MAP_OVERLAY_GAP + MARKER_EDGE_RESERVE))
}

function getTopInset(stageRect: ScreenRect, overlayRect: ScreenRect | null) {
  if (!overlayRect || overlayRect.bottom <= stageRect.top || overlayRect.top >= stageRect.bottom) {
    return 0
  }
  return Math.max(0, Math.ceil(overlayRect.bottom - stageRect.top + MAP_OVERLAY_GAP))
}

function getRightInset(stageRect: ScreenRect, overlayRect: ScreenRect | null) {
  if (!overlayRect || overlayRect.right <= stageRect.left || overlayRect.left >= stageRect.right) {
    return 0
  }
  return Math.max(0, Math.ceil(stageRect.right - overlayRect.left + MAP_OVERLAY_GAP))
}

function constrainPaddingToStage(padding: EdgeInsets, stageRect: ScreenRect): EdgeInsets {
  const minSafeWidth = 120
  const minSafeHeight = 120
  const right = Math.min(padding.right, Math.max(0, stageRect.width - padding.left - minSafeWidth))
  const bottom = Math.min(padding.bottom, Math.max(0, stageRect.height - padding.top - minSafeHeight))

  return {
    top: padding.top,
    right,
    bottom,
    left: padding.left,
  }
}

function edgeInsetsEqual(a: EdgeInsets, b: EdgeInsets) {
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left
}
