import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AlertTriangle, MapPin, Navigation, Ticket } from 'lucide-react'
import { DEFAULT_MAP_STYLE, FALLBACK_MAP_STYLE } from '../lib/mapConfig'
import { getGoogleMapsApiKey, waitForGoogleMaps } from '../lib/googleMaps'
import { loadMapLibreAdapter } from '../lib/maplibreAdapterLoader'
import type {
  EdgeInsets,
  MapEngineAdapter,
  MapInstance,
  LngLat as MapLngLat,
  LngLatBounds,
  RouteLineKind,
} from '../lib/mapEngine'
import { markMapStartup } from '../lib/mapStartupMetrics'
import {
  DEFAULT_DAY_MAP_PADDING,
  MARKER_FOCUS_COMFORT_ZOOM,
  USER_LOCATION_DISTANCE_THRESHOLD_METERS,
  buildDayMapViewportPlan,
  getDistanceMeters,
  getMarkerFocusCorrection,
  isValidLngLat,
  normalizeEdgeInsets,
  type DayMapRecenterResult,
  type ScreenRect,
} from '../lib/dayMapViewport'
import { sortItineraryItemsByPlanOrder } from '../lib/itinerary'
import { getItemLngLat, type LngLat } from '../lib/routing'
import { getMarkerEmoji } from '../lib/markerEmoji'
import type { DayPrewarmTarget } from '../lib/mapPrewarm'
import type { ItineraryItem } from '../types'
import { EmptyState } from './ui/EmptyState'

type DayMapProps = {
  connectUserLocationToFirst?: boolean
  items: ItineraryItem[]
  mapEngine?: 'auto' | 'maplibre'
  mapStyleUrl?: string
  markerLabel?: 'category' | 'details' | 'sequence'
  selectedItemId?: string | null
  selectedItemSource?: 'marker' | 'list' | null
  heightClassName?: string
  surface?: 'card' | 'fullscreen'
  resizeSignal?: number
  viewportPadding?: EdgeInsets
  markerFocusPadding?: EdgeInsets
  originRouteLineString?: LngLat[]
  routeLineKind?: RouteLineKind
  routeLineStrings?: LngLat[][]
  userLocation?: LngLat | null
  onSelectItem: (item: ItineraryItem) => void
  onBaseLoadingChange?: (loading: boolean) => void
  onMapError?: (message: string) => void
  onMapReady?: () => void
}

export type DayMapHandle = {
  cancelPrewarm: (options?: { restoreCamera?: boolean }) => void
  isReady: () => boolean
  prewarmBounds: (targets: DayPrewarmTarget[]) => Promise<void>
  recenter: (options?: DayMapRecenterOptions) => DayMapRecenterResult
}

export type DayMapRecenterOptions = {
  focusSelected?: boolean
  padding?: EdgeInsets
}

type MarkerRecord = {
  itemId: string
  handle: { setLngLat(lngLat: MapLngLat): void; remove(): void }
  element: HTMLButtonElement
  content: HTMLSpanElement
  isDetailed: boolean
  isEmoji: boolean
  iconRoots: Root[]
}

type UserLocationMarkerRecord = {
  handle: { setLngLat(lngLat: MapLngLat): void; remove(): void }
  headingRoot: Root
  element: HTMLDivElement
}

type RouteDirectionMarkerRecord = {
  handle: { remove(): void }
  root: Root
}

type CameraState = {
  center: LngLat
  zoom: number
  bearing: number
  pitch: number
}

type PrewarmSession = {
  cancelled: boolean
  restoreCamera: CameraState
  restored: boolean
}

const MAP_ERROR_MESSAGE = '地图暂时无法加载，行程仍可查看。'
const GOOGLE_MAP_LOAD_BUDGET_MS = 3_500

async function loadDayMapAdapter(preference: NonNullable<DayMapProps['mapEngine']>): Promise<{
  adapter: MapEngineAdapter
  styleUrl?: string
}> {
  if (preference === 'auto' && getGoogleMapsApiKey()) {
    const googleReady = await waitForBooleanWithin(waitForGoogleMaps(), GOOGLE_MAP_LOAD_BUDGET_MS)
    if (googleReady) {
      const { GoogleMapsEngineAdapter } = await import('../lib/googleMapsAdapter')
      return { adapter: new GoogleMapsEngineAdapter() }
    }
  }

  return { adapter: await loadMapLibreAdapter() }
}

function waitForBooleanWithin(promise: Promise<boolean>, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const timeout = window.setTimeout(() => finish(false), timeoutMs)

    function finish(value: boolean) {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      resolve(value)
    }

    void promise.then(finish, () => finish(false))
  })
}

export const DayMap = forwardRef<DayMapHandle, DayMapProps>(function DayMap({
  connectUserLocationToFirst = false,
  items,
  mapEngine = 'maplibre',
  mapStyleUrl = DEFAULT_MAP_STYLE,
  markerLabel = 'category',
  selectedItemId,
  selectedItemSource,
  heightClassName = 'h-[52dvh] min-h-[360px]',
  surface = 'card',
  resizeSignal,
  viewportPadding,
  markerFocusPadding,
  originRouteLineString,
  routeLineKind = 'sequence',
  routeLineStrings,
  userLocation,
  onSelectItem,
  onBaseLoadingChange,
  onMapError,
  onMapReady,
}, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapInstance | null>(null)
  const markersRef = useRef<MarkerRecord[]>([])
  const userLocationMarkerRef = useRef<UserLocationMarkerRecord | null>(null)
  const routeDirectionMarkersRef = useRef<RouteDirectionMarkerRecord[]>([])
  const loadedRef = useRef(false)
  const fallbackTriedRef = useRef(false)
  const fitCoordinateKeyRef = useRef<string | null>(null)
  const onSelectItemRef = useRef(onSelectItem)
  const onBaseLoadingChangeRef = useRef(onBaseLoadingChange)
  const onMapErrorRef = useRef(onMapError)
  const onMapReadyRef = useRef(onMapReady)
  const selectedItemIdRef = useRef(selectedItemId)
  const coordinateKeyRef = useRef('')
  const routeLineStringsRef = useRef<LngLat[][] | undefined>(routeLineStrings)
  const routeLineKindRef = useRef<RouteLineKind>(routeLineKind)
  const originRouteLineStringRef = useRef<LngLat[] | undefined>(originRouteLineString)
  const userLocationRef = useRef<LngLat | null>(userLocation ?? null)
  const viewportPaddingRef = useRef<EdgeInsets>(DEFAULT_DAY_MAP_PADDING)
  const markerFocusPaddingRef = useRef<EdgeInsets>(DEFAULT_DAY_MAP_PADDING)
  const resizeFrameRef = useRef<number | null>(null)
  const markerFocusFrameRef = useRef<number | null>(null)
  const resizeFitTimeoutRef = useRef<number | null>(null)
  const prewarmSessionRef = useRef<PrewarmSession | null>(null)
  const initialItemCountRef = useRef(items.length)
  const validItems = useMemo(
    () => sortItineraryItemsByPlanOrder(items).filter((item) => getItemLngLat(item) !== null),
    [items],
  )
  const validItemsRef = useRef(validItems)
  const [mapError, setMapError] = useState<string | null>(null)
  const [isMapReady, setIsMapReady] = useState(false)

  const coordinateKey = useMemo(
    () =>
      validItems
        .map((item) =>
          [
            item.id,
            item.lat,
            item.lng,
            item.sortOrder,
            item.startTime ?? '',
          ].join(':'),
        )
        .join('|'),
    [validItems],
  )
  const routeLineKey = useMemo(
    () => `${routeLineKind}:${buildRouteLineKey(routeLineStrings)}::origin:${buildRouteLineKey(originRouteLineString ? [originRouteLineString] : undefined)}`,
    [originRouteLineString, routeLineKind, routeLineStrings],
  )
  const userLocationKey = useMemo(() => (
    userLocation ? `${userLocation[0].toFixed(6)},${userLocation[1].toFixed(6)}` : ''
  ), [userLocation])
  const hasMappableItems = validItems.length > 0
  const hasMapTargets = hasMappableItems || Boolean(userLocation)
  const showBaseLoading = hasMapTargets && !mapError && !isMapReady
  const normalizedViewportPadding = useMemo(
    () => normalizeEdgeInsets(viewportPadding, DEFAULT_DAY_MAP_PADDING),
    [viewportPadding],
  )
  const normalizedMarkerFocusPadding = useMemo(
    () => normalizeEdgeInsets(markerFocusPadding, normalizedViewportPadding),
    [markerFocusPadding, normalizedViewportPadding],
  )
  validItemsRef.current = validItems
  coordinateKeyRef.current = coordinateKey
  routeLineStringsRef.current = routeLineStrings
  routeLineKindRef.current = routeLineKind
  originRouteLineStringRef.current = originRouteLineString
  userLocationRef.current = userLocation ?? null
  selectedItemIdRef.current = selectedItemId
  viewportPaddingRef.current = normalizedViewportPadding
  markerFocusPaddingRef.current = normalizedMarkerFocusPadding

  const clearMarkers = useCallback(() => {
    markersRef.current.forEach(({ handle, iconRoots }) => {
      iconRoots.forEach(deferRootUnmount)
      handle.remove()
    })
    markersRef.current = []
  }, [])

  const clearUserLocationMarker = useCallback(() => {
    if (userLocationMarkerRef.current) {
      deferRootUnmount(userLocationMarkerRef.current.headingRoot)
    }
    userLocationMarkerRef.current?.handle.remove()
    userLocationMarkerRef.current = null
  }, [])

  const clearRouteDirectionMarkers = useCallback(() => {
    routeDirectionMarkersRef.current.forEach(({ handle, root }) => {
      deferRootUnmount(root)
      handle.remove()
    })
    routeDirectionMarkersRef.current = []
  }, [])

  const cleanupMap = useCallback(() => {
    const session = prewarmSessionRef.current
    if (session) {
      session.cancelled = true
      prewarmSessionRef.current = null
    }
    clearMarkers()
    clearUserLocationMarker()
    clearRouteDirectionMarkers()
    if (markerFocusFrameRef.current !== null) {
      window.cancelAnimationFrame(markerFocusFrameRef.current)
      markerFocusFrameRef.current = null
    }
    if (resizeFitTimeoutRef.current !== null) {
      window.clearTimeout(resizeFitTimeoutRef.current)
      resizeFitTimeoutRef.current = null
    }
    if (mapRef.current) {
      mapRef.current.remove()
      mapRef.current = null
    }
    loadedRef.current = false
    fitCoordinateKeyRef.current = null
  }, [clearMarkers, clearRouteDirectionMarkers, clearUserLocationMarker])

  const updateMarkerZoomScale = useCallback(() => {
    const map = mapRef.current
    if (!map) {
      return
    }

    const zoomScale = getMarkerScaleForZoom(map.getCamera().zoom)
    const selectedId = selectedItemIdRef.current
    markersRef.current.forEach(({ itemId, content }) => {
      const selectedBoost = itemId === selectedId ? 0.08 : 0
      content.style.transform = `scale(${Math.min(1.16, zoomScale + selectedBoost).toFixed(2)})`
    })
  }, [])

  const updateMarkerSelection = useCallback(() => {
    const selectedId = selectedItemIdRef.current
    markersRef.current.forEach(({ itemId, element, content, isDetailed, isEmoji }) => {
      const isSelected = itemId === selectedId
      content.className = markerContentClassName(isSelected, isEmoji, isDetailed)
      element.style.zIndex = isSelected ? '45' : '40'
    })
    updateMarkerZoomScale()
  }, [updateMarkerZoomScale])

  const scheduleMapResize = useCallback(() => {
    if (resizeFrameRef.current !== null) {
      return
    }

    resizeFrameRef.current = window.requestAnimationFrame(() => {
      resizeFrameRef.current = null
      const map = mapRef.current
      map?.resize()
      if (!map || !loadedRef.current) return

      if (resizeFitTimeoutRef.current !== null) {
        window.clearTimeout(resizeFitTimeoutRef.current)
      }
      resizeFitTimeoutRef.current = window.setTimeout(() => {
        resizeFitTimeoutRef.current = null
        const currentMap = mapRef.current
        if (!currentMap || !loadedRef.current) return
        const plan = buildDayMapViewportPlan({
          itineraryCoordinates: validItemsRef.current.map((item) => getItemLngLat(item)),
          userLocation: userLocationRef.current,
        })
        applyViewportPlan(
          currentMap,
          plan,
          getResponsiveDayMapPadding(
            viewportPaddingRef.current,
            markerLabel,
            containerRef.current?.clientWidth,
          ),
        )
        markMapStartup('resize viewport refit completed')
      }, 160)
    })
  }, [markerLabel])

  const restorePrewarmCamera = useCallback((session: PrewarmSession) => {
    if (session.restored) {
      return
    }

    const map = mapRef.current
    if (!map) {
      return
    }

    session.restored = true
    map.jumpTo(session.restoreCamera)
    markMapStartup('prewarm restored current camera')
  }, [])

  const cancelPrewarm = useCallback((options?: { restoreCamera?: boolean }) => {
    const session = prewarmSessionRef.current
    if (!session) {
      return
    }

    session.cancelled = true
    if (options?.restoreCamera !== false) {
      restorePrewarmCamera(session)
    } else {
      session.restored = true
    }
    prewarmSessionRef.current = null
    markMapStartup('prewarm cancelled')
  }, [restorePrewarmCamera])

  const prewarmBounds = useCallback(async (targets: DayPrewarmTarget[]) => {
    const map = mapRef.current
    if (!map || !loadedRef.current || targets.length === 0) {
      markMapStartup('prewarm skipped', {
        hasMap: Boolean(map),
        loaded: loadedRef.current,
        targets: targets.length,
      })
      return
    }

    cancelPrewarm()
    const camera = map.getCamera()
    const session: PrewarmSession = {
      cancelled: false,
      restoreCamera: {
        center: camera.center as LngLat,
        zoom: camera.zoom,
        bearing: camera.bearing,
        pitch: camera.pitch,
      },
      restored: false,
    }
    prewarmSessionRef.current = session

    markMapStartup('prewarm queue created', { count: targets.length })
    try {
      for (const target of targets) {
        if (session.cancelled || prewarmSessionRef.current !== session) {
          break
        }

        markMapStartup('prewarm day started', {
          dayId: target.dayId,
          points: target.coordinatesCount,
          title: target.title,
        })
        map.fitBounds(target.bounds as unknown as LngLatBounds, {
          duration: 0,
          maxZoom: 14,
          padding: 72,
        })
        const result = await map.waitForIdle()
        markMapStartup(result === 'idle' ? 'prewarm day idle' : 'prewarm day timeout', {
          dayId: target.dayId,
        })
      }
    } finally {
      if (prewarmSessionRef.current === session) {
        restorePrewarmCamera(session)
        prewarmSessionRef.current = null
      }
    }
  }, [cancelPrewarm, restorePrewarmCamera])

  const getSelectedLngLat = useCallback(() => {
    const selectedId = selectedItemIdRef.current
    if (!selectedId) {
      return null
    }
    const selectedItem = validItemsRef.current.find((item) => item.id === selectedId)
    return selectedItem ? getItemLngLat(selectedItem) : null
  }, [])

  const recenter = useCallback((options?: DayMapRecenterOptions): DayMapRecenterResult => {
    const plan = buildDayMapViewportPlan({
      itineraryCoordinates: validItemsRef.current.map((item) => getItemLngLat(item)),
      userLocation: userLocationRef.current,
    })
    const map = mapRef.current
    if (map && loadedRef.current) {
      const padding = options?.padding ?? getResponsiveDayMapPadding(
        markerFocusPaddingRef.current,
        markerLabel,
        containerRef.current?.clientWidth,
      )
      const selectedLngLat = options?.focusSelected ? getSelectedLngLat() : null
      if (selectedLngLat) {
        applyCenteredViewport(map, selectedLngLat, Math.max(map.getCamera().zoom, MARKER_FOCUS_COMFORT_ZOOM), padding)
      } else {
        applyViewportPlan(map, plan, padding)
      }
    }
    markMapStartup('manual recenter completed', {
      includedUserLocation: plan.includedUserLocation,
      usedItineraryPoints: plan.usedItineraryPoints,
    })
    return {
      excludedUserLocationForDistance: plan.excludedUserLocationForDistance,
      includedUserLocation: plan.includedUserLocation,
      usedItineraryPoints: plan.usedItineraryPoints,
    }
  }, [getSelectedLngLat, markerLabel])

  useImperativeHandle(ref, () => ({
    cancelPrewarm,
    isReady: () => Boolean(mapRef.current && loadedRef.current),
    prewarmBounds,
    recenter,
  }), [cancelPrewarm, prewarmBounds, recenter])

  const syncUserLocationMarker = useCallback(() => {
    const map = mapRef.current
    if (!map || !loadedRef.current) {
      return
    }

    clearUserLocationMarker()
    const nextUserLocation = userLocationRef.current
    if (!nextUserLocation || !isValidLngLat(nextUserLocation)) {
      return
    }

    const element = document.createElement('div')
    element.className = userLocationMarkerClassName()
    element.setAttribute('aria-label', '当前位置')
    element.setAttribute('data-testid', 'map-user-location-marker')

    const pulse = document.createElement('span')
    pulse.className = 'absolute size-9 rounded-full bg-sky-400/25'
    const dot = document.createElement('span')
    dot.className = 'relative flex size-4 rounded-full border-2 border-white bg-sky-500 shadow-[0_0_0_5px_rgba(14,165,233,0.20)]'
    const heading = document.createElement('span')
    heading.className = 'day-map-user-heading'
    const headingRoot = createRoot(heading)
    headingRoot.render(<Navigation aria-hidden="true" />)
    element.append(pulse, dot, heading)

    const handle = map.addMarker(nextUserLocation as unknown as MapLngLat, element)
    userLocationMarkerRef.current = { element, handle, headingRoot }
  }, [clearUserLocationMarker])

  const syncMarkersAndRoute = useCallback(() => {
    const map = mapRef.current
    if (!map || !loadedRef.current) {
      return
    }

    const mapItems = validItemsRef.current
    clearMarkers()
    clearRouteDirectionMarkers()

    const routePresentation = buildRouteLinePresentation(
      mapItems,
      routeLineStringsRef.current,
      routeLineKindRef.current,
      connectUserLocationToFirst ? userLocationRef.current : null,
      originRouteLineStringRef.current,
    )
    map.setRouteLine(
      (routePresentation.road.length > 0
        ? routePresentation.road
        : routePresentation.sequence) as unknown as MapLngLat[][],
      routePresentation.road.length > 0 ? 'road' : 'sequence',
    )
    map.setRouteConnectorLine(routePresentation.connector as unknown as MapLngLat[][])

    const directionLines = routePresentation.road
    directionLines.forEach((lineString) => {
      const direction = getRouteDirectionMarker(lineString)
      if (!direction) return

      const element = document.createElement('span')
      element.className = 'day-map-route-direction'
      element.setAttribute('aria-hidden', 'true')
      element.setAttribute('data-testid', 'day-map-route-direction')

      const root = createRoot(element)
      root.render(
        <Navigation
          aria-hidden="true"
          className="day-map-route-direction-symbol"
          style={{ transform: `rotate(${direction.bearing.toFixed(1)}deg)` }}
        />,
      )

      const handle = map.addMarker(direction.coordinate as unknown as MapLngLat, element)
      routeDirectionMarkersRef.current.push({ handle, root })
    })

    mapItems.forEach((item, index) => {
      const lngLat = getItemLngLat(item)
      if (!lngLat) {
        return
      }

      const element = document.createElement('button')
      element.type = 'button'
      const isDetailed = markerLabel === 'details'
      element.className = markerRootClassName(isDetailed)
      element.style.zIndex = '40'
      element.setAttribute(
        'aria-label',
        `选择 ${item.title}${item.startTime ? `，${item.startTime}` : ''}`,
      )
      element.setAttribute('data-testid', 'day-map-marker')

      const content = document.createElement('span')
      const { label, isEmoji } = getMarkerDisplayLabel(item, index, markerLabel)
      content.className = markerContentClassName(
        item.id === selectedItemIdRef.current,
        isEmoji,
        isDetailed,
      )
      const iconRoots = isDetailed
        ? appendDetailedMarkerContent(content, item, index, label, mapItems)
        : []
      if (!isDetailed) {
        content.textContent = label
      }
      element.append(content)

      element.addEventListener('click', () => {
        const nextItem = validItemsRef.current.find((candidate) => candidate.id === item.id)
        if (nextItem) {
          onSelectItemRef.current(nextItem)
        }
      })

      const handle = map.addMarker(lngLat as unknown as MapLngLat, element)
      markersRef.current.push({
        itemId: item.id,
        handle,
        element,
        content,
        isDetailed,
        isEmoji,
        iconRoots,
      })
    })

    updateMarkerSelection()
    markMapStartup('markers rendered', { count: mapItems.length })
  }, [clearMarkers, clearRouteDirectionMarkers, connectUserLocationToFirst, markerLabel, updateMarkerSelection])

  const fitViewportIfNeeded = useCallback(() => {
    const map = mapRef.current
    if (!map) return

    const nextCoordinateKey = coordinateKeyRef.current
    const mapItems = validItemsRef.current
    if (!nextCoordinateKey || fitCoordinateKeyRef.current === nextCoordinateKey) {
      return
    }

    fitCoordinateKeyRef.current = nextCoordinateKey
    const plan = buildDayMapViewportPlan({
      itineraryCoordinates: mapItems.map((item) => getItemLngLat(item)),
    })
    applyViewportPlan(
      map,
      plan,
      getResponsiveDayMapPadding(
        viewportPaddingRef.current,
        markerLabel,
        containerRef.current?.clientWidth,
      ),
    )
    markMapStartup('first fitBounds completed', { points: mapItems.length })
  }, [markerLabel])

  const focusSelectedItem = useCallback((source: 'marker' | 'list' | null | undefined) => {
    if (!source) {
      return
    }

    const selectedId = selectedItemIdRef.current
    if (!selectedId) {
      return
    }

    const selectedItem = validItemsRef.current.find((item) => item.id === selectedId)
    const selectedLngLat = selectedItem ? getItemLngLat(selectedItem) : null
    const map = mapRef.current
    if (!map || !loadedRef.current || !selectedLngLat) {
      return
    }

    const currentZoom = map.getCamera().zoom
    const markerRecord = markersRef.current.find((marker) => marker.itemId === selectedId)
    const container = containerRef.current

    if (markerRecord && container) {
      const responsivePadding = getResponsiveDayMapPadding(
        markerFocusPaddingRef.current,
        markerLabel,
        container.clientWidth,
      )
      const correction = getMarkerFocusCorrection({
        currentZoom,
        markerRect: domRectToScreenRect(markerRecord.element.getBoundingClientRect()),
        padding: responsivePadding,
        viewportRect: domRectToScreenRect(container.getBoundingClientRect()),
      })

      if (!correction.shouldMove) {
        return
      }

      applyCenteredViewport(map, selectedLngLat, correction.nextZoom, responsivePadding)
      markMapStartup('selected marker camera corrected', {
        reason: correction.reason,
        source: source ?? 'unknown',
      })
      return
    }

    if (source !== 'marker') {
      applyCenteredViewport(
        map,
        selectedLngLat,
        Math.max(currentZoom, MARKER_FOCUS_COMFORT_ZOOM),
        getResponsiveDayMapPadding(
          markerFocusPaddingRef.current,
          markerLabel,
          containerRef.current?.clientWidth,
        ),
      )
    }
  }, [markerLabel])

  useEffect(() => {
    markMapStartup('DayMap component mounted', { itemCount: initialItemCountRef.current })
  }, [])

  useEffect(() => {
    onSelectItemRef.current = onSelectItem
  }, [onSelectItem])

  useEffect(() => {
    onBaseLoadingChangeRef.current = onBaseLoadingChange
  }, [onBaseLoadingChange])

  useEffect(() => {
    onMapErrorRef.current = onMapError
  }, [onMapError])

  useEffect(() => {
    onMapReadyRef.current = onMapReady
  }, [onMapReady])

  useEffect(() => {
    selectedItemIdRef.current = selectedItemId
  }, [selectedItemId])

  useEffect(() => {
    viewportPaddingRef.current = normalizedViewportPadding
  }, [normalizedViewportPadding])

  useEffect(() => {
    markerFocusPaddingRef.current = normalizedMarkerFocusPadding
  }, [normalizedMarkerFocusPadding])

  useEffect(() => {
    validItemsRef.current = validItems
    coordinateKeyRef.current = coordinateKey
    routeLineStringsRef.current = routeLineStrings
    routeLineKindRef.current = routeLineKind
    originRouteLineStringRef.current = originRouteLineString
    userLocationRef.current = userLocation ?? null
  }, [coordinateKey, originRouteLineString, routeLineKind, routeLineStrings, userLocation, validItems])

  useEffect(() => {
    onBaseLoadingChangeRef.current?.(showBaseLoading)
  }, [showBaseLoading])

  useEffect(() => {
    if (!hasMapTargets) {
      cleanupMap()
      return
    }

    if (mapRef.current && loadedRef.current) {
      syncMarkersAndRoute()
      syncUserLocationMarker()
      fitViewportIfNeeded()
    }
  }, [cleanupMap, coordinateKey, fitViewportIfNeeded, hasMapTargets, routeLineKey, syncMarkersAndRoute, syncUserLocationMarker, userLocationKey])

  useEffect(() => {
    if (!containerRef.current || !hasMapTargets || mapRef.current) {
      return
    }

    let disposed = false

    function createMap(adapter: MapEngineAdapter, styleUrl: string, isFallback: boolean) {
      if (!containerRef.current || disposed) {
        return
      }

      cleanupMap()
      loadedRef.current = false
      setIsMapReady(false)

      const firstLngLat = getItemLngLat(validItemsRef.current[0])
      const initialUserLocation = userLocationRef.current
      const initialCenter = firstLngLat ?? initialUserLocation ?? [139.7671, 35.6812]
      const map = adapter.createMap(containerRef.current, {
        center: initialCenter as MapLngLat,
        zoom: firstLngLat ? 12 : initialUserLocation ? 14 : 10,
        style: styleUrl,
      })

      mapRef.current = map
      containerRef.current.dataset.mapEngine = adapter.type
      markMapStartup('map created', { engine: adapter.type, isFallback, styleUrl })

      map.once('idle', () => {
        markMapStartup('map idle event')
      })

      map.on('zoom', updateMarkerZoomScale)

      map.once('load', () => {
        if (disposed) {
          return
        }
        loadedRef.current = true
        setIsMapReady(true)
        setMapError(null)
        markMapStartup('map load event')
        syncMarkersAndRoute()
        syncUserLocationMarker()
        fitViewportIfNeeded()
        onMapReadyRef.current?.()
      })

      map.on('error', () => {
        if (disposed || loadedRef.current) {
          return
        }

        if (adapter.type === 'maplibre' && !isFallback && !fallbackTriedRef.current) {
          fallbackTriedRef.current = true
          createMap(adapter, FALLBACK_MAP_STYLE, true)
          return
        }

        setMapError(MAP_ERROR_MESSAGE)
        setIsMapReady(false)
        onMapErrorRef.current?.(MAP_ERROR_MESSAGE)
      })
    }

    fallbackTriedRef.current = false
    setMapError(null)
    void loadDayMapAdapter(mapEngine)
      .then(async ({ adapter, styleUrl }) => {
        if (disposed) return

        try {
          createMap(adapter, styleUrl ?? mapStyleUrl, false)
        } catch (caught) {
          if (adapter.type !== 'google') throw caught
          const maplibreAdapter = await loadMapLibreAdapter()
          if (!disposed) createMap(maplibreAdapter, mapStyleUrl, false)
        }
      })
      .catch(() => {
        if (disposed) {
          return
        }
        setMapError(MAP_ERROR_MESSAGE)
        setIsMapReady(false)
        onMapErrorRef.current?.(MAP_ERROR_MESSAGE)
      })

    return () => {
      disposed = true
      cleanupMap()
    }
  }, [cleanupMap, fitViewportIfNeeded, hasMapTargets, mapEngine, mapStyleUrl, syncMarkersAndRoute, syncUserLocationMarker, updateMarkerZoomScale])

  useEffect(() => {
    selectedItemIdRef.current = selectedItemId
    updateMarkerSelection()

    if (!selectedItemId) {
      return
    }

    if (markerFocusFrameRef.current !== null) {
      window.cancelAnimationFrame(markerFocusFrameRef.current)
    }

    markerFocusFrameRef.current = window.requestAnimationFrame(() => {
      markerFocusFrameRef.current = null
      focusSelectedItem(selectedItemSource)
    })

    return () => {
      if (markerFocusFrameRef.current !== null) {
        window.cancelAnimationFrame(markerFocusFrameRef.current)
        markerFocusFrameRef.current = null
      }
    }
  }, [focusSelectedItem, normalizedMarkerFocusPadding, selectedItemId, selectedItemSource, updateMarkerSelection])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !hasMapTargets) {
      return
    }

    const resizeObserver = new ResizeObserver(() => {
      scheduleMapResize()
    })
    resizeObserver.observe(container)
    window.addEventListener('resize', scheduleMapResize)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', scheduleMapResize)
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current)
        resizeFrameRef.current = null
      }
      if (resizeFitTimeoutRef.current !== null) {
        window.clearTimeout(resizeFitTimeoutRef.current)
        resizeFitTimeoutRef.current = null
      }
    }
  }, [hasMapTargets, scheduleMapResize])

  useEffect(() => {
    if (!mapRef.current || !loadedRef.current || resizeSignal === undefined) {
      return
    }

    markMapStartup('resize signal received')
    scheduleMapResize()
    const timeout = window.setTimeout(scheduleMapResize, 240)

    return () => window.clearTimeout(timeout)
  }, [resizeSignal, scheduleMapResize])

  if (!hasMapTargets) {
    return (
      <div className={surface === 'fullscreen'
        ? `${heightClassName} bg-map-bg p-4`
        : `${heightClassName} rounded-2xl border border-white/80 bg-white/80 p-4 shadow-[0_8px_22px_rgba(47,65,88,0.05)]`}
      >
        <div className="flex h-full items-center justify-center">
          <EmptyState
            body="已有行程，但暂无可显示在地图上的坐标。"
            icon={<MapPin className="size-6" />}
            title="没有可显示的坐标"
          />
        </div>
      </div>
    )
  }

  return (
    <div
      className={
        surface === 'fullscreen'
          ? `relative ${heightClassName} overflow-hidden bg-slate-100`
          : `relative ${heightClassName} overflow-hidden rounded-2xl border border-white/80 bg-slate-100 shadow-[0_8px_22px_rgba(47,65,88,0.08)] transition-[height,min-height] duration-300`
      }
      data-route-source={routeLineStrings?.some((lineString) => lineString.length >= 2) ? routeLineKind : 'sequence'}
      data-origin-route-source={originRouteLineString && originRouteLineString.length >= 2 ? 'road' : 'connector'}
    >
      <div className="h-full w-full" ref={containerRef} />
      {showBaseLoading ? (
        <div
          className="pointer-events-none absolute left-3 right-3 top-3 z-10 rounded-2xl bg-white/88 px-4 py-3 text-sm font-medium text-slate-600 shadow-[0_12px_32px_rgba(47,65,88,0.10)] ring-1 ring-white/80 backdrop-blur"
        >
          正在加载地图
        </div>
      ) : null}
      {mapError ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/88 p-5 text-center backdrop-blur">
          <div>
            <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:text-amber-300">
              <AlertTriangle className="size-6" />
            </div>
            <h3 className="text-base font-bold text-slate-950">地图底图无法加载</h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">{mapError}</p>
          </div>
        </div>
      ) : null}
    </div>
  )
})

function markerRootClassName(isDetailed: boolean) {
  return [
    isDetailed ? 'day-map-marker-root-detailed' : '',
    'flex',
    'size-11',
    'items-center',
    'justify-center',
    'pointer-events-auto',
  ].join(' ')
}

function markerContentClassName(isSelected: boolean, isEmoji = false, isDetailed = false) {
  if (isDetailed) {
    return [
      'day-map-marker-content-detailed',
      isSelected ? 'is-selected' : '',
    ].filter(Boolean).join(' ')
  }

  return [
    'flex',
    'size-9',
    'items-center',
    'justify-center',
    'rounded-full',
    'border-[3px]',
    isEmoji ? 'text-base' : 'text-sm',
    'font-bold',
    'transition-[transform,box-shadow,background-color]',
    'duration-200',
    'will-change-transform',
    'shadow-[0_6px_16px_rgba(8,100,93,0.22)]',
    isSelected
      ? 'border-white bg-primary text-white ring-2 ring-primary/20'
      : 'border-white bg-primary text-white',
  ].join(' ')
}

function appendDetailedMarkerContent(
  content: HTMLSpanElement,
  item: ItineraryItem,
  index: number,
  label: string,
  allItems: ItineraryItem[],
): Root[] {
  const iconRoots: Root[] = []
  const dot = document.createElement('span')
  dot.className = 'day-map-marker-dot'
  dot.textContent = label

  const details = document.createElement('span')
  details.className = [
    'day-map-marker-details',
    getDetailedMarkerPosition(allItems, index),
  ].join(' ')
  details.setAttribute('data-testid', 'day-map-marker-details')

  const title = document.createElement('strong')
  title.textContent = item.title
  details.append(title)

  const locationName = item.locationName?.trim()
  if (locationName && locationName.toLocaleLowerCase() !== item.title.trim().toLocaleLowerCase()) {
    const secondary = document.createElement('span')
    secondary.className = 'day-map-marker-secondary'
    secondary.textContent = locationName
    details.append(secondary)
  }

  if (item.ticketIds.length > 0) {
    const ticket = document.createElement('span')
    ticket.className = 'day-map-marker-ticket'
    const icon = document.createElement('span')
    icon.className = 'day-map-marker-ticket-icon'
    const iconRoot = createRoot(icon)
    iconRoot.render(<Ticket aria-hidden="true" />)
    iconRoots.push(iconRoot)
    ticket.append(icon, document.createTextNode(item.startTime ? `已购票 · ${item.startTime}` : '已购票'))
    details.append(ticket)
  } else if (item.startTime) {
    const time = document.createElement('time')
    time.className = 'day-map-marker-time'
    time.textContent = item.startTime
    details.append(time)
  }

  content.append(dot, details)
  return iconRoots
}

function deferRootUnmount(root: Root) {
  window.queueMicrotask(() => root.unmount())
}

function getDetailedMarkerPosition(items: ItineraryItem[], index: number) {
  if (index === 0) return 'day-map-marker-details-center'

  const current = getItemLngLat(items[index])
  const neighbor = getItemLngLat(items[index + 1] ?? items[index - 1])
  if (!current || !neighbor) {
    return index % 2 === 1 ? 'day-map-marker-details-right' : 'day-map-marker-details-left'
  }

  const averageLatitudeRadians = ((current[1] + neighbor[1]) / 2) * Math.PI / 180
  const horizontalSpan = Math.abs(neighbor[0] - current[0]) * Math.cos(averageLatitudeRadians)
  const verticalSpan = Math.abs(neighbor[1] - current[1])
  const followsHorizontalCorridor = horizontalSpan > verticalSpan * 1.35

  if (index === items.length - 1) {
    return followsHorizontalCorridor
      ? 'day-map-marker-details-end'
      : 'day-map-marker-details-center'
  }
  return followsHorizontalCorridor
    ? 'day-map-marker-details-top'
    : 'day-map-marker-details-right'
}

function userLocationMarkerClassName() {
  return [
    'pointer-events-none',
    'relative',
    'flex',
    'size-11',
    'items-center',
    'justify-center',
  ].join(' ')
}

function getMarkerDisplayLabel(
  item: ItineraryItem,
  index: number,
  markerLabel: NonNullable<DayMapProps['markerLabel']>,
): { label: string; isEmoji: boolean } {
  if (markerLabel === 'sequence' || markerLabel === 'details') {
    return { label: String(index + 1), isEmoji: false }
  }
  const emoji = getMarkerEmoji(item)
  return emoji ? { label: emoji, isEmoji: true } : { label: String(index + 1), isEmoji: false }
}

function getMarkerScaleForZoom(zoom: number) {
  if (zoom <= 9) {
    return 0.86
  }
  if (zoom >= 15) {
    return 1.08
  }
  return 0.86 + ((zoom - 9) / 6) * 0.22
}

function getResponsiveDayMapPadding(
  padding: EdgeInsets,
  markerLabel: NonNullable<DayMapProps['markerLabel']>,
  containerWidth?: number,
): EdgeInsets {
  if (markerLabel !== 'details' || !containerWidth || containerWidth > 360) {
    return padding
  }

  return {
    top: Math.min(padding.top, 56),
    right: Math.min(padding.right, 56),
    bottom: Math.min(padding.bottom, 56),
    left: Math.min(padding.left, 56),
  }
}

function buildRouteLinePresentation(
  items: ItineraryItem[],
  routeLineStrings?: LngLat[][],
  routeLineKind: RouteLineKind = 'sequence',
  routeOrigin?: LngLat | null,
  originRouteLineString?: LngLat[],
): { connector: LngLat[][]; road: LngLat[][]; sequence: LngLat[][] } {
  const normalized = normalizeLineStrings(routeLineStrings)
  const normalizedOriginRoute = normalizeLineStrings(
    originRouteLineString ? [originRouteLineString] : undefined,
  )
  const firstItemCoordinate = getItemLngLat(items[0])
  const normalizedOrigin = routeOrigin && isValidLngLat(routeOrigin) ? routeOrigin : null
  const originSegment = normalizedOrigin
    && firstItemCoordinate
    && getDistanceMeters(normalizedOrigin, firstItemCoordinate) <= USER_LOCATION_DISTANCE_THRESHOLD_METERS
    ? [[normalizedOrigin, firstItemCoordinate] satisfies LngLat[]]
    : []
  if (normalized.length > 0 || normalizedOriginRoute.length > 0) {
    const itemSegments = normalized.length > 0
      ? []
      : items.slice(1).flatMap((item, index) => {
          const from = getItemLngLat(items[index])
          const to = getItemLngLat(item)
          return from && to ? [[from, to] satisfies LngLat[]] : []
        })
    return {
      connector: normalizeLineStrings([
        ...(normalizedOriginRoute.length > 0 ? [] : originSegment),
        ...(routeLineKind === 'road' ? [] : normalized),
        ...itemSegments,
      ]),
      road: [
        ...normalizedOriginRoute,
        ...(routeLineKind === 'road' ? normalized : []),
      ],
      sequence: [],
    }
  }

  const itemSegments = items.slice(1).flatMap((item, index) => {
    const from = getItemLngLat(items[index])
    const to = getItemLngLat(item)
    return from && to ? [[from, to]] : []
  })

  if (originSegment.length === 0 && itemSegments.length === 0) {
    return { connector: [], road: [], sequence: [] }
  }

  return {
    connector: [],
    road: [],
    sequence: normalizeLineStrings([...originSegment, ...itemSegments]),
  }
}

function getRouteDirectionMarker(lineString: LngLat[]) {
  if (lineString.length < 2) return null

  const segmentIndex = Math.min(
    lineString.length - 2,
    Math.max(0, Math.floor((lineString.length - 1) * 0.55)),
  )
  const from = lineString[segmentIndex]
  const to = lineString[segmentIndex + 1]
  const averageLatitudeRadians = ((from[1] + to[1]) / 2) * Math.PI / 180
  const east = (to[0] - from[0]) * Math.cos(averageLatitudeRadians)
  const north = to[1] - from[1]

  return {
    bearing: Math.atan2(east, north) * 180 / Math.PI,
    coordinate: [
      (from[0] + to[0]) / 2,
      (from[1] + to[1]) / 2,
    ] satisfies LngLat,
  }
}

function applyViewportPlan(
  map: MapInstance,
  plan: ReturnType<typeof buildDayMapViewportPlan>,
  padding: EdgeInsets,
) {
  if (plan.bounds) {
    map.fitBounds(plan.bounds as unknown as LngLatBounds, {
      duration: 700,
      maxZoom: 14,
      padding,
    })
    return
  }

  if (plan.center && plan.zoom) {
    applyCenteredViewport(map, plan.center, plan.zoom, padding)
  }
}

function applyCenteredViewport(
  map: MapInstance,
  center: LngLat,
  zoom: number,
  padding: EdgeInsets,
) {
  map.fitBounds(buildCenteredBounds(center), {
    duration: 600,
    maxZoom: zoom,
    padding,
  })
}

function buildCenteredBounds(center: LngLat): LngLatBounds {
  const [lng, lat] = center
  const padding = 0.0015

  return [
    [lng - padding, lat - padding],
    [lng + padding, lat + padding],
  ]
}

function domRectToScreenRect(rect: DOMRect): ScreenRect {
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  }
}

function normalizeLineStrings(routeLineStrings?: LngLat[][]) {
  if (!routeLineStrings) {
    return []
  }

  return routeLineStrings
    .map((lineString) => lineString.filter(isValidLngLat))
    .filter((lineString) => lineString.length >= 2)
}

function buildRouteLineKey(routeLineStrings?: LngLat[][]) {
  return normalizeLineStrings(routeLineStrings)
    .map((lineString) => lineString.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';'))
    .join('|')
}
