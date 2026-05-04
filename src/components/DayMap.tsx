import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap, type Marker } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Feature, LineString } from 'geojson'
import { AlertTriangle, MapPin } from 'lucide-react'
import { DEFAULT_MAP_STYLE, FALLBACK_MAP_STYLE } from '../lib/mapConfig'
import { hasValidCoordinates } from '../lib/mapLinks'
import { sortItineraryItems } from '../lib/itinerary'
import type { ItineraryItem } from '../types'
import { EmptyState } from './ui/EmptyState'

type DayMapProps = {
  items: ItineraryItem[]
  selectedItemId?: string | null
  heightClassName?: string
  surface?: 'card' | 'fullscreen'
  resizeSignal?: number
  onSelectItem: (item: ItineraryItem) => void
  onMapError?: (message: string) => void
}

type MarkerRecord = {
  itemId: string
  marker: Marker
  element: HTMLButtonElement
  content: HTMLSpanElement
}

const ROUTE_SOURCE_ID = 'day-route-source'
const ROUTE_LAYER_ID = 'day-route-line'
const MAP_ERROR_MESSAGE = '地图底图暂时无法加载，但本地行程仍可查看。'

export function DayMap({
  items,
  selectedItemId,
  heightClassName = 'h-[52dvh] min-h-[360px]',
  surface = 'card',
  resizeSignal,
  onSelectItem,
  onMapError,
}: DayMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markersRef = useRef<MarkerRecord[]>([])
  const loadedRef = useRef(false)
  const fallbackTriedRef = useRef(false)
  const fitCoordinateKeyRef = useRef<string | null>(null)
  const onSelectItemRef = useRef(onSelectItem)
  const onMapErrorRef = useRef(onMapError)
  const selectedItemIdRef = useRef(selectedItemId)
  const coordinateKeyRef = useRef('')
  const resizeFrameRef = useRef<number | null>(null)
  const validItems = useMemo(
    () => sortItineraryItems(items).filter(hasValidCoordinates),
    [items],
  )
  const validItemsRef = useRef(validItems)
  const [mapError, setMapError] = useState<string | null>(null)

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
  const hasMappableItems = validItems.length > 0

  const clearMarkers = useCallback(() => {
    markersRef.current.forEach(({ marker }) => marker.remove())
    markersRef.current = []
  }, [])

  const cleanupMap = useCallback(() => {
    clearMarkers()
    if (mapRef.current) {
      mapRef.current.remove()
      mapRef.current = null
    }
    loadedRef.current = false
    fitCoordinateKeyRef.current = null
  }, [clearMarkers])

  const updateMarkerSelection = useCallback(() => {
    const selectedId = selectedItemIdRef.current
    markersRef.current.forEach(({ itemId, content }) => {
      content.className = markerContentClassName(itemId === selectedId)
    })
  }, [])

  const scheduleMapResize = useCallback(() => {
    if (resizeFrameRef.current !== null) {
      return
    }

    resizeFrameRef.current = window.requestAnimationFrame(() => {
      resizeFrameRef.current = null
      mapRef.current?.resize()
    })
  }, [])

  const syncRouteLine = useCallback((map: MapLibreMap, mapItems: ItineraryItem[]) => {
    const lineData = buildLineFeature(mapItems)
    const hasLine = mapItems.length > 1

    if (!map.getSource(ROUTE_SOURCE_ID)) {
      map.addSource(ROUTE_SOURCE_ID, {
        type: 'geojson',
        data: lineData,
      })
    } else {
      const source = map.getSource(ROUTE_SOURCE_ID) as GeoJSONSource
      source.setData(lineData)
    }

    if (!map.getLayer(ROUTE_LAYER_ID)) {
      map.addLayer({
        id: ROUTE_LAYER_ID,
        type: 'line',
        source: ROUTE_SOURCE_ID,
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
          visibility: hasLine ? 'visible' : 'none',
        },
        paint: {
          'line-color': '#1677ff',
          'line-width': 4,
          'line-opacity': 0.86,
        },
      })
    } else {
      map.setLayoutProperty(ROUTE_LAYER_ID, 'visibility', hasLine ? 'visible' : 'none')
    }
  }, [])

  const syncMarkersAndRoute = useCallback(() => {
    const map = mapRef.current
    if (!map || !loadedRef.current) {
      return
    }

    const mapItems = validItemsRef.current
    clearMarkers()
    syncRouteLine(map, mapItems)

    mapItems.forEach((item, index) => {
      const lngLat = getItemLngLat(item)
      if (!lngLat) {
        return
      }

      const element = document.createElement('button')
      element.type = 'button'
      element.className = markerRootClassName()
      element.setAttribute('aria-label', `选择 ${item.title}`)

      const content = document.createElement('span')
      content.className = markerContentClassName(item.id === selectedItemIdRef.current)
      content.textContent = String(index + 1)
      element.append(content)

      element.addEventListener('click', () => {
        const nextItem = validItemsRef.current.find((candidate) => candidate.id === item.id)
        if (nextItem) {
          onSelectItemRef.current(nextItem)
        }
      })

      const marker = new maplibregl.Marker({
        anchor: 'center',
        element,
      })
        .setLngLat(lngLat)
        .addTo(map)

      markersRef.current.push({ itemId: item.id, marker, element, content })
    })

    updateMarkerSelection()
  }, [clearMarkers, syncRouteLine, updateMarkerSelection])

  const fitViewportIfNeeded = useCallback((map: MapLibreMap) => {
    const nextCoordinateKey = coordinateKeyRef.current
    const mapItems = validItemsRef.current
    if (!nextCoordinateKey || fitCoordinateKeyRef.current === nextCoordinateKey) {
      return
    }

    fitCoordinateKeyRef.current = nextCoordinateKey
    updateViewport(map, mapItems)
  }, [])

  useEffect(() => {
    onSelectItemRef.current = onSelectItem
  }, [onSelectItem])

  useEffect(() => {
    onMapErrorRef.current = onMapError
  }, [onMapError])

  useEffect(() => {
    selectedItemIdRef.current = selectedItemId
  }, [selectedItemId])

  useEffect(() => {
    validItemsRef.current = validItems
    coordinateKeyRef.current = coordinateKey
  }, [coordinateKey, validItems])

  useEffect(() => {
    if (!hasMappableItems) {
      cleanupMap()
      return
    }

    if (mapRef.current && loadedRef.current) {
      syncMarkersAndRoute()
      fitViewportIfNeeded(mapRef.current)
    }
  }, [cleanupMap, coordinateKey, fitViewportIfNeeded, hasMappableItems, syncMarkersAndRoute])

  useEffect(() => {
    if (!containerRef.current || !hasMappableItems || mapRef.current) {
      return
    }

    let disposed = false

    function createMap(styleUrl: string, isFallback: boolean) {
      if (!containerRef.current || disposed) {
        return
      }

      cleanupMap()
      loadedRef.current = false

      const firstLngLat = getItemLngLat(validItemsRef.current[0])
      const map = new maplibregl.Map({
        attributionControl: false,
        center: firstLngLat ?? [139.7671, 35.6812],
        container: containerRef.current,
        dragRotate: false,
        pitchWithRotate: false,
        style: styleUrl,
        touchPitch: false,
        zoom: firstLngLat ? 12 : 10,
      })

      map.dragPan.enable()
      map.touchZoomRotate.enable()
      map.touchZoomRotate.disableRotation()
      map.dragRotate.disable()
      map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left')
      mapRef.current = map

      map.once('load', () => {
        if (disposed) {
          return
        }
        loadedRef.current = true
        setMapError(null)
        syncMarkersAndRoute()
        fitViewportIfNeeded(map)
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
  }, [cleanupMap, fitViewportIfNeeded, hasMappableItems, syncMarkersAndRoute])

  useEffect(() => {
    selectedItemIdRef.current = selectedItemId
    updateMarkerSelection()

    const selectedItem = validItemsRef.current.find((item) => item.id === selectedItemId)
    const selectedLngLat = selectedItem ? getItemLngLat(selectedItem) : null
    const map = mapRef.current
    if (map && loadedRef.current && selectedLngLat) {
      map.easeTo({
        center: selectedLngLat,
        duration: 450,
        zoom: Math.max(map.getZoom(), 13.5),
      })
    }
  }, [selectedItemId, updateMarkerSelection])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !hasMappableItems) {
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
  }, [hasMappableItems, scheduleMapResize])

  useEffect(() => {
    if (!mapRef.current || !loadedRef.current || resizeSignal === undefined) {
      return
    }

    scheduleMapResize()
    const timeout = window.setTimeout(scheduleMapResize, 240)

    return () => window.clearTimeout(timeout)
  }, [resizeSignal, scheduleMapResize])

  if (!hasMappableItems) {
    return (
      <div className={surface === 'fullscreen'
        ? `${heightClassName} bg-[#eaf2f9] p-4`
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
}

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
    'shadow-[0_12px_28px_rgba(22,119,255,0.28)]',
    isSelected
      ? 'border-white bg-emerald-500 text-white ring-4 ring-emerald-200'
      : 'border-white bg-[#1677ff] text-white',
  ].join(' ')
}

function buildLineFeature(items: ItineraryItem[]): Feature<LineString> {
  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: items.length > 1 ? items.flatMap((item) => {
        const lngLat = getItemLngLat(item)
        return lngLat ? [lngLat] : []
      }) : [],
    },
    properties: {},
  }
}

function updateViewport(map: MapLibreMap, items: ItineraryItem[]) {
  if (items.length === 0) {
    return
  }

  if (items.length === 1) {
    const item = items[0]
    const lngLat = getItemLngLat(item)
    if (!lngLat) {
      return
    }
    map.flyTo({
      center: lngLat,
      duration: 600,
      zoom: 14,
    })
    return
  }

  const bounds = new maplibregl.LngLatBounds()
  items.forEach((item) => {
    const lngLat = getItemLngLat(item)
    if (lngLat) {
      bounds.extend(lngLat)
    }
  })
  map.fitBounds(bounds, {
    duration: 700,
    maxZoom: 14,
    padding: 72,
  })
}

function getItemLngLat(item?: ItineraryItem): [number, number] | null {
  if (!item) {
    return null
  }

  if (
    typeof item.lat !== 'number' ||
    typeof item.lng !== 'number' ||
    !Number.isFinite(item.lat) ||
    !Number.isFinite(item.lng) ||
    item.lat < -90 ||
    item.lat > 90 ||
    item.lng < -180 ||
    item.lng > 180
  ) {
    return null
  }

  return [item.lng, item.lat]
}
