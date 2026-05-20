import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { AlertTriangle, MapPin } from 'lucide-react'
import { DEFAULT_MAP_STYLE, FALLBACK_MAP_STYLE } from '../lib/mapConfig'
import { MapLibreAdapter } from '../lib/maplibreAdapter'
import type { EdgeInsets, MapInstance, LngLat as MapLngLat, LngLatBounds } from '../lib/mapEngine'
import { markMapStartup } from '../lib/mapStartupMetrics'
import {
  DEFAULT_DAY_MAP_PADDING,
  MARKER_FOCUS_COMFORT_ZOOM,
  buildDayMapViewportPlan,
  getMarkerFocusCorrection,
  isValidLngLat,
  normalizeEdgeInsets,
  type DayMapRecenterResult,
  type ScreenRect,
} from '../lib/dayMapViewport'
import { sortItineraryItems } from '../lib/itinerary'
import { getItemLngLat, type LngLat } from '../lib/routing'
import type { DayPrewarmTarget } from '../lib/mapPrewarm'
import type { ItineraryItem } from '../types'
import { EmptyState } from './ui/EmptyState'

type DayMapProps = {
  items: ItineraryItem[]
  selectedItemId?: string | null
  selectedItemSource?: 'marker' | 'list' | null
  heightClassName?: string
  surface?: 'card' | 'fullscreen'
  resizeSignal?: number
  viewportPadding?: EdgeInsets
  markerFocusPadding?: EdgeInsets
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
}

type UserLocationMarkerRecord = {
  handle: { setLngLat(lngLat: MapLngLat): void; remove(): void }
  element: HTMLDivElement
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

const MAP_ERROR_MESSAGE = '地图底图暂时无法加载，但本地行程仍可查看。'

const maplibreAdapter = new MapLibreAdapter()

export const DayMap = forwardRef<DayMapHandle, DayMapProps>(function DayMap({
  items,
  selectedItemId,
  selectedItemSource,
  heightClassName = 'h-[52dvh] min-h-[360px]',
  surface = 'card',
  resizeSignal,
  viewportPadding,
  markerFocusPadding,
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
  const userLocationRef = useRef<LngLat | null>(userLocation ?? null)
  const viewportPaddingRef = useRef<EdgeInsets>(DEFAULT_DAY_MAP_PADDING)
  const markerFocusPaddingRef = useRef<EdgeInsets>(DEFAULT_DAY_MAP_PADDING)
  const resizeFrameRef = useRef<number | null>(null)
  const markerFocusFrameRef = useRef<number | null>(null)
  const prewarmSessionRef = useRef<PrewarmSession | null>(null)
  const initialItemCountRef = useRef(items.length)
  const validItems = useMemo(
    () => sortItineraryItems(items).filter((item) => getItemLngLat(item) !== null),
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
  const routeLineKey = useMemo(() => buildRouteLineKey(routeLineStrings), [routeLineStrings])
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
  userLocationRef.current = userLocation ?? null
  selectedItemIdRef.current = selectedItemId
  viewportPaddingRef.current = normalizedViewportPadding
  markerFocusPaddingRef.current = normalizedMarkerFocusPadding

  const clearMarkers = useCallback(() => {
    markersRef.current.forEach(({ handle }) => handle.remove())
    markersRef.current = []
  }, [])

  const clearUserLocationMarker = useCallback(() => {
    userLocationMarkerRef.current?.handle.remove()
    userLocationMarkerRef.current = null
  }, [])

  const cleanupMap = useCallback(() => {
    const session = prewarmSessionRef.current
    if (session) {
      session.cancelled = true
      prewarmSessionRef.current = null
    }
    clearMarkers()
    clearUserLocationMarker()
    if (markerFocusFrameRef.current !== null) {
      window.cancelAnimationFrame(markerFocusFrameRef.current)
      markerFocusFrameRef.current = null
    }
    if (mapRef.current) {
      mapRef.current.remove()
      mapRef.current = null
    }
    loadedRef.current = false
    fitCoordinateKeyRef.current = null
  }, [clearMarkers, clearUserLocationMarker])

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
    markersRef.current.forEach(({ itemId, element, content }) => {
      const isSelected = itemId === selectedId
      content.className = markerContentClassName(isSelected)
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
      mapRef.current?.resize()
    })
  }, [])

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
      const padding = options?.padding ?? markerFocusPaddingRef.current
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
  }, [getSelectedLngLat])

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
    element.append(pulse, dot)

    const handle = map.addMarker(nextUserLocation as unknown as MapLngLat, element)
    userLocationMarkerRef.current = { element, handle }
  }, [clearUserLocationMarker])

  const syncMarkersAndRoute = useCallback(() => {
    const map = mapRef.current
    if (!map || !loadedRef.current) {
      return
    }

    const mapItems = validItemsRef.current
    clearMarkers()

    const lineStrings = buildLineStrings(mapItems, routeLineStringsRef.current)
    map.setRouteLine(lineStrings as unknown as MapLngLat[][])

    mapItems.forEach((item, index) => {
      const lngLat = getItemLngLat(item)
      if (!lngLat) {
        return
      }

      const element = document.createElement('button')
      element.type = 'button'
      element.className = markerRootClassName()
      element.style.zIndex = '40'
      element.setAttribute('aria-label', `选择 ${item.title}`)
      element.setAttribute('data-testid', 'day-map-marker')

      const content = document.createElement('span')
      content.className = markerContentClassName(item.id === selectedItemIdRef.current)
      content.textContent = getMarkerDisplayLabel(item, index)
      element.append(content)

      element.addEventListener('click', () => {
        const nextItem = validItemsRef.current.find((candidate) => candidate.id === item.id)
        if (nextItem) {
          onSelectItemRef.current(nextItem)
        }
      })

      const handle = map.addMarker(lngLat as unknown as MapLngLat, element)
      markersRef.current.push({ itemId: item.id, handle, element, content })
    })

    updateMarkerSelection()
    markMapStartup('markers rendered', { count: mapItems.length })
  }, [clearMarkers, updateMarkerSelection])

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
    applyViewportPlan(map, plan, viewportPaddingRef.current)
    markMapStartup('first fitBounds completed', { points: mapItems.length })
  }, [])

  const focusSelectedItem = useCallback((source: 'marker' | 'list' | null | undefined) => {
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
      const correction = getMarkerFocusCorrection({
        currentZoom,
        markerRect: domRectToScreenRect(markerRecord.element.getBoundingClientRect()),
        padding: markerFocusPaddingRef.current,
        viewportRect: domRectToScreenRect(container.getBoundingClientRect()),
      })

      if (!correction.shouldMove) {
        return
      }

      applyCenteredViewport(map, selectedLngLat, correction.nextZoom, markerFocusPaddingRef.current)
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
        markerFocusPaddingRef.current,
      )
    }
  }, [])

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
    userLocationRef.current = userLocation ?? null
  }, [coordinateKey, routeLineStrings, userLocation, validItems])

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

    function createMap(styleUrl: string, isFallback: boolean) {
      if (!containerRef.current || disposed) {
        return
      }

      cleanupMap()
      loadedRef.current = false
      setIsMapReady(false)

      const firstLngLat = getItemLngLat(validItemsRef.current[0])
      const initialUserLocation = userLocationRef.current
      const initialCenter = firstLngLat ?? initialUserLocation ?? [139.7671, 35.6812]
      const map = maplibreAdapter.createMap(containerRef.current, {
        center: initialCenter as MapLngLat,
        zoom: firstLngLat ? 12 : initialUserLocation ? 14 : 10,
        style: styleUrl,
      })

      mapRef.current = map
      markMapStartup('map created', { isFallback, styleUrl })

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

        if (!isFallback && !fallbackTriedRef.current) {
          fallbackTriedRef.current = true
          createMap(FALLBACK_MAP_STYLE, true)
          return
        }

        setMapError(MAP_ERROR_MESSAGE)
        setIsMapReady(false)
        onMapErrorRef.current?.(MAP_ERROR_MESSAGE)
      })
    }

    fallbackTriedRef.current = false
    setMapError(null)
    createMap(DEFAULT_MAP_STYLE, false)

    return () => {
      disposed = true
      cleanupMap()
    }
  }, [cleanupMap, fitViewportIfNeeded, hasMapTargets, syncMarkersAndRoute, syncUserLocationMarker, updateMarkerZoomScale])

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
    >
      <div className="h-full w-full" ref={containerRef} />
      {showBaseLoading ? (
        <div
          className="pointer-events-none absolute left-3 right-3 top-3 z-10 rounded-2xl bg-white/88 px-4 py-3 text-sm font-medium text-slate-600 shadow-[0_12px_32px_rgba(47,65,88,0.10)] ring-1 ring-white/80 backdrop-blur"
          data-testid="map-base-loading"
        >
          正在加载地图底图，本地行程仍可查看。
        </div>
      ) : null}
      {mapError ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/88 p-5 text-center backdrop-blur">
          <div>
            <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
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

function markerRootClassName() {
  return [
    'flex',
    'size-11',
    'items-center',
    'justify-center',
    'pointer-events-auto',
  ].join(' ')
}

function markerContentClassName(isSelected: boolean) {
  return [
    'flex',
    'size-11',
    'items-center',
    'justify-center',
    'rounded-full',
    'border-4',
    'text-base',
    'font-bold',
    'transition-[transform,box-shadow,background-color]',
    'duration-200',
    'will-change-transform',
    'shadow-[0_12px_28px_rgba(22,119,255,0.28)]',
    isSelected
      ? 'border-white bg-emerald-500 text-white ring-4 ring-emerald-200'
      : 'border-white bg-primary text-white',
  ].join(' ')
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

function getMarkerDisplayLabel(_item: ItineraryItem, index: number) {
  return String(index + 1)
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

function buildLineStrings(items: ItineraryItem[], routeLineStrings?: LngLat[][]): LngLat[][] {
  const normalized = normalizeLineStrings(routeLineStrings)
  if (normalized.length > 0) {
    return normalized
  }

  if (items.length <= 1) {
    return []
  }

  return normalizeLineStrings(
    items.slice(1).flatMap((item, index) => {
      const from = getItemLngLat(items[index])
      const to = getItemLngLat(item)
      return from && to ? [[from, to]] : []
    }),
  )
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
