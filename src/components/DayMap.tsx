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
  onSelectItem: (item: ItineraryItem) => void
  onMapError?: (message: string) => void
}

type MarkerRecord = {
  itemId: string
  marker: Marker
  element: HTMLButtonElement
}

const ROUTE_SOURCE_ID = 'day-route-source'
const ROUTE_LAYER_ID = 'day-route-line'
const MAP_ERROR_MESSAGE = '地图底图暂时无法加载，但本地行程仍可查看。'

export function DayMap({
  items,
  selectedItemId,
  heightClassName = 'h-[52dvh] min-h-[360px]',
  surface = 'card',
  onSelectItem,
  onMapError,
}: DayMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markersRef = useRef<MarkerRecord[]>([])
  const loadedRef = useRef(false)
  const fallbackTriedRef = useRef(false)
  const onSelectItemRef = useRef(onSelectItem)
  const selectedItemIdRef = useRef(selectedItemId)
  const validItems = useMemo(
    () => sortItineraryItems(items).filter(hasValidCoordinates),
    [items],
  )
  const validItemsRef = useRef(validItems)
  const [mapError, setMapError] = useState<string | null>(null)

  const coordinateKey = validItems
    .map((item) => `${item.id}:${item.lat}:${item.lng}`)
    .join('|')

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
  }, [clearMarkers])

  const updateMarkerSelection = useCallback(() => {
    markersRef.current.forEach(({ itemId, element }) => {
      element.className = markerClassName(itemId === selectedItemId)
    })
  }, [selectedItemId])

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
      const element = document.createElement('button')
      element.type = 'button'
      element.className = markerClassName(item.id === selectedItemIdRef.current)
      element.textContent = String(index + 1)
      element.setAttribute('aria-label', `选择 ${item.title}`)
      element.addEventListener('click', () => onSelectItemRef.current(item))

      const marker = new maplibregl.Marker({
        anchor: 'center',
        element,
      })
        .setLngLat([item.lng as number, item.lat as number])
        .addTo(map)

      markersRef.current.push({ itemId: item.id, marker, element })
    })

    updateViewport(map, mapItems)
  }, [clearMarkers, syncRouteLine])

  useEffect(() => {
    onSelectItemRef.current = onSelectItem
  }, [onSelectItem])

  useEffect(() => {
    selectedItemIdRef.current = selectedItemId
  }, [selectedItemId])

  useEffect(() => {
    validItemsRef.current = validItems
    if (validItems.length === 0) {
      cleanupMap()
      return
    }

    if (mapRef.current && loadedRef.current) {
      syncMarkersAndRoute()
    }
  }, [cleanupMap, coordinateKey, syncMarkersAndRoute, validItems])

  useEffect(() => {
    if (!containerRef.current || validItems.length === 0 || mapRef.current) {
      return
    }

    let disposed = false

    function createMap(styleUrl: string, isFallback: boolean) {
      if (!containerRef.current || disposed) {
        return
      }

      cleanupMap()
      loadedRef.current = false

      const firstItem = validItemsRef.current[0]
      const map = new maplibregl.Map({
        attributionControl: false,
        center: firstItem ? [firstItem.lng as number, firstItem.lat as number] : [139.7671, 35.6812],
        container: containerRef.current,
        cooperativeGestures: true,
        style: styleUrl,
        zoom: firstItem ? 12 : 10,
      })

      map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left')
      mapRef.current = map

      map.once('load', () => {
        if (disposed) {
          return
        }
        loadedRef.current = true
        setMapError(null)
        syncMarkersAndRoute()
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
        onMapError?.(MAP_ERROR_MESSAGE)
      })
    }

    fallbackTriedRef.current = false
    setMapError(null)
    createMap(DEFAULT_MAP_STYLE, false)

    return () => {
      disposed = true
      cleanupMap()
    }
  }, [cleanupMap, onMapError, syncMarkersAndRoute, validItems.length])

  useEffect(() => {
    updateMarkerSelection()

    const selectedItem = validItems.find((item) => item.id === selectedItemId)
    const map = mapRef.current
    if (map && loadedRef.current && selectedItem) {
      map.easeTo({
        center: [selectedItem.lng as number, selectedItem.lat as number],
        duration: 450,
        zoom: Math.max(map.getZoom(), 13.5),
      })
    }
  }, [selectedItemId, updateMarkerSelection, validItems])

  if (validItems.length === 0) {
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

function markerClassName(isSelected: boolean) {
  return [
    'flex',
    'size-11',
    'z-10',
    'items-center',
    'justify-center',
    'pointer-events-auto',
    'rounded-full',
    'border-4',
    'text-base',
    'font-bold',
    'shadow-[0_12px_28px_rgba(22,119,255,0.28)]',
    'transition',
    'active:scale-95',
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
      coordinates: items.length > 1 ? items.map((item) => [item.lng as number, item.lat as number]) : [],
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
    map.flyTo({
      center: [item.lng as number, item.lat as number],
      duration: 600,
      zoom: 14,
    })
    return
  }

  const bounds = new maplibregl.LngLatBounds()
  items.forEach((item) => bounds.extend([item.lng as number, item.lat as number]))
  map.fitBounds(bounds, {
    duration: 700,
    maxZoom: 14,
    padding: 72,
  })
}
