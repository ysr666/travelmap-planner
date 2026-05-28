import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Loader2, Map as MapIcon, MapPinned, Sparkles } from 'lucide-react'
import { updateItineraryItem } from '../../db'
import { EMPTY_MAP_STYLE, FALLBACK_MAP_STYLE, TRIP_PREVIEW_MAP_STYLE } from '../../lib/mapConfig'
import { GoogleMapsEngineAdapter } from '../../lib/googleMapsAdapter'
import {
  getGoogleMapsApiKey,
  GOOGLE_MAPS_CONFIG_CHANGED_EVENT_EXPORT,
  waitForGoogleMaps,
} from '../../lib/googleMaps'
import type { LngLat, MapEngineAdapter, MapInstance, MarkerHandle } from '../../lib/mapEngine'
import { loadMapLibreAdapter } from '../../lib/maplibreAdapterLoader'
import {
  fetchProviderProxyRouteOrderSuggestion,
  getProviderProxyConfig,
  ProviderProxyClientError,
} from '../../lib/providerProxyClient'
import type { ProviderProxyRouteOrderSuggestionSuccessResponse } from '../../lib/ai/providerProxyContract'
import {
  buildRouteOrderSuggestionRequestItems,
  buildRouteOrderSuggestionSortPatches,
  getRouteOrderSuggestionCandidateDay,
} from '../../lib/routeOrderSuggestion'
import { getRoutingConfig } from '../../lib/routing'
import { ROUTE_CACHE_CHANGED_EVENT } from '../../lib/routeCache'
import {
  buildTripMapPreviewData,
  fetchTripPreviewRoute,
  selectTripPreviewRoutingConfig,
  type TripMapPreviewData,
  type TripMapPreviewEngine,
  type TripMapPreviewRecord,
  type TripPreviewRouteResult,
} from '../../lib/tripMapPreview'
import type { Day, ItineraryItem } from '../../types'
import { Card } from '../ui/Card'
import { ConfirmDialog } from '../ui/ConfirmDialog'

type TripMapPreviewProps = {
  days: Day[]
  itemsByDay: Record<string, ItineraryItem[]>
  onItemsReordered?: () => Promise<void> | void
  onOpenMap: (day: Day) => void
  routeDataReady?: boolean
  selectedDay: Day | null
  tripId: string
}

type RouteOrderSuggestionState =
  | { status: 'idle' }
  | { day: Day; status: 'loading' }
  | { day: Day; result: ProviderProxyRouteOrderSuggestionSuccessResponse; status: 'ready' }
  | { message: string; status: 'applied' }
  | { message: string; status: 'error' }

const googleMapsAdapter = new GoogleMapsEngineAdapter()
const NATIVE_MARKER_OVERLAP_THRESHOLD_METERS = 18
const NATIVE_MARKER_OVERLAP_OFFSET_PX = 11

export function TripMapPreview({
  days,
  itemsByDay,
  onItemsReordered,
  onOpenMap,
  routeDataReady = true,
  selectedDay,
  tripId,
}: TripMapPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapInstance | null>(null)
  const markerHandlesRef = useRef<MarkerHandle[]>([])
  const [engine, setEngine] = useState<TripMapPreviewEngine | null>(null)
  const [isMapReady, setIsMapReady] = useState(false)
  const [isMapBaseSlow, setIsMapBaseSlow] = useState(false)
  const [mapInstanceVersion, setMapInstanceVersion] = useState(0)
  const [mapNotice, setMapNotice] = useState<string | null>(null)
  const [routeResult, setRouteResult] = useState<TripPreviewRouteResult | null>(null)
  const [routeLoading, setRouteLoading] = useState(false)
  const [configVersion, setConfigVersion] = useState(0)
  const [routeOrderSuggestionState, setRouteOrderSuggestionState] = useState<RouteOrderSuggestionState>({ status: 'idle' })
  const [routeOrderConfirmOpen, setRouteOrderConfirmOpen] = useState(false)
  const activeRouteRequestKeyRef = useRef<string | null>(null)
  const completedRouteRequestKeyRef = useRef<string | null>(null)
  const data = useMemo(
    () => buildTripMapPreviewData({ days, itemsByDay, selectedDay }),
    [days, itemsByDay, selectedDay],
  )
  const hasPoints = data.records.length > 0
  const googleMapsKey = getGoogleMapsApiKey()
  const routeOrderSuggestionDay = useMemo(
    () => getRouteOrderSuggestionCandidateDay({ days, itemsByDay, selectedDay }),
    [days, itemsByDay, selectedDay],
  )
  const dataKey = useMemo(() => buildPreviewDataKey(data), [data])
  const previewRouteLoading = routeLoading || (hasPoints && !routeDataReady)
  const routeKey = useMemo(
    () => routeResult?.lineStrings.map((line) => line.map((point) => point.join(',')).join('|')).join('::') ?? '',
    [routeResult],
  )

  const clearMapMarkers = useCallback(() => {
    markerHandlesRef.current.forEach((marker) => marker.remove())
    markerHandlesRef.current = []
  }, [])

  const cleanupMap = useCallback(() => {
    clearMapMarkers()
    mapRef.current?.remove()
    mapRef.current = null
  }, [clearMapMarkers])

  useEffect(() => {
    function refreshConfig() {
      setConfigVersion((version) => version + 1)
    }

    window.addEventListener(GOOGLE_MAPS_CONFIG_CHANGED_EVENT_EXPORT, refreshConfig)
    window.addEventListener(ROUTE_CACHE_CHANGED_EVENT, refreshConfig)
    window.addEventListener('storage', refreshConfig)
    window.addEventListener('tripmap:routing-config-changed', refreshConfig)
    return () => {
      window.removeEventListener(GOOGLE_MAPS_CONFIG_CHANGED_EVENT_EXPORT, refreshConfig)
      window.removeEventListener(ROUTE_CACHE_CHANGED_EVENT, refreshConfig)
      window.removeEventListener('storage', refreshConfig)
      window.removeEventListener('tripmap:routing-config-changed', refreshConfig)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    cleanupMap()
    queueMicrotask(() => {
      if (!cancelled) {
        setIsMapReady(false)
        setIsMapBaseSlow(false)
      }
    })
    queueMicrotask(() => {
      if (!cancelled) {
        setRouteResult(null)
        setMapNotice(null)
      }
    })
    if (!hasPoints) {
      queueMicrotask(() => {
        if (!cancelled) {
          setEngine(null)
        }
      })
      return () => {
        cancelled = true
      }
    }

    if (!googleMapsKey) {
      queueMicrotask(() => {
        if (!cancelled) {
          setEngine('maplibre')
        }
      })
      return () => {
        cancelled = true
      }
    }

    queueMicrotask(() => {
      if (!cancelled) {
        setEngine(null)
      }
    })
    void waitForGoogleMaps().then((loaded) => {
      if (!cancelled) {
        setEngine(loaded ? 'google' : 'maplibre')
        if (!loaded) {
          setMapNotice('Google 地图暂时不可用，已切换到基础地图预览。')
        }
      }
    })

    return () => {
      cancelled = true
    }
  }, [cleanupMap, googleMapsKey, hasPoints])

  useEffect(() => {
    if (!containerRef.current || !engine || !hasPoints || mapRef.current) {
      return
    }

    let disposed = false
    let readinessTimeout: number | null = null

    function clearReadinessTimeout() {
      if (readinessTimeout !== null) {
        window.clearTimeout(readinessTimeout)
        readinessTimeout = null
      }
    }

    function markMapReady(notice?: string) {
      if (disposed) return
      clearReadinessTimeout()
      setIsMapBaseSlow(false)
      setIsMapReady(true)
      setMapNotice((current) => {
        if (notice) return notice
        return current === '地图底图加载较慢，地点和路线预览仍可查看。' ? null : current
      })
    }

    function createMap(
      style: string | Record<string, unknown>,
      fallbackLevel: 0 | 1 | 2 = 0,
      maplibreAdapter?: MapEngineAdapter,
    ) {
      if (!containerRef.current || disposed || !engine) {
        return
      }

      cleanupMap()
      clearReadinessTimeout()
      const first = data.records[0]?.coordinate ?? [139.7671, 35.6812]
      let map: MapInstance
      if (engine === 'google') {
        map = googleMapsAdapter.createMap(containerRef.current, { center: first, interactive: false, zoom: 11 })
      } else {
        if (!maplibreAdapter) {
          return
        }
        map = maplibreAdapter.createMap(containerRef.current, {
          attributionPosition: 'bottom-right',
          center: first,
          interactive: false,
          zoom: 11,
          style,
        })
      }
      mapRef.current = map
      setMapInstanceVersion((version) => version + 1)
      map.resize()
      fitPreviewBounds(map, data.records)
      readinessTimeout = window.setTimeout(() => {
        if (!disposed) {
          setIsMapBaseSlow(true)
        }
      }, 2000)

      map.once('load', () => {
        markMapReady()
      })
      map.once('idle', () => {
        markMapReady()
      })
      map.on('error', () => {
        if (disposed || engine === 'google') {
          clearReadinessTimeout()
          setIsMapBaseSlow(true)
          setMapNotice('地图底图暂时无法加载，但行程地点仍可查看。')
          return
        }
        if (fallbackLevel === 0) {
          createMap(FALLBACK_MAP_STYLE, 1, maplibreAdapter)
          return
        }
        if (fallbackLevel === 1) {
          setMapNotice('地图底图暂时无法加载，已切换为轻量预览。')
          createMap(EMPTY_MAP_STYLE, 2, maplibreAdapter)
          return
        }
        clearReadinessTimeout()
        setIsMapBaseSlow(true)
        setMapNotice('地图底图暂时无法加载，但行程地点仍可查看。')
      })
    }

    if (engine === 'google') {
      createMap(TRIP_PREVIEW_MAP_STYLE)
    } else {
      void loadMapLibreAdapter()
        .then((maplibreAdapter) => {
          if (!disposed) {
            createMap(TRIP_PREVIEW_MAP_STYLE, 0, maplibreAdapter)
          }
        })
        .catch(() => {
          if (disposed) {
            return
          }
          clearReadinessTimeout()
          setIsMapBaseSlow(true)
          setIsMapReady(false)
          setMapNotice('地图底图暂时无法加载，但行程地点仍可查看。')
        })
    }

    return () => {
      disposed = true
      clearReadinessTimeout()
      cleanupMap()
    }
  }, [cleanupMap, data.records, engine, hasPoints])

  useEffect(() => {
    if (routeDataReady) {
      return
    }

    queueMicrotask(() => {
      setRouteResult(null)
      setRouteLoading(false)
    })
  }, [routeDataReady])

  useEffect(() => {
    if (!engine || !hasPoints || !routeDataReady) {
      return
    }

    const controller = new AbortController()
    const selectedConfig = selectTripPreviewRoutingConfig(engine, getRoutingConfig())
    const requestKey = [
      engine,
      selectedConfig.provider,
      selectedConfig.source,
      selectedConfig.apiKey ? 'ors-key' : 'no-ors-key',
      selectedConfig.googleMapsKey ? 'google-key' : 'no-google-key',
      tripId,
      dataKey,
      configVersion,
    ].join('|')
    if (
      activeRouteRequestKeyRef.current === requestKey ||
      completedRouteRequestKeyRef.current === requestKey
    ) {
      return
    }

    activeRouteRequestKeyRef.current = requestKey
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setRouteResult(null)
        setRouteLoading(true)
      }
    })
    void fetchTripPreviewRoute({
      config: selectedConfig,
      days,
      itemsByDay,
      tripId,
    }).then((result) => {
      if (!controller.signal.aborted) {
        completedRouteRequestKeyRef.current = requestKey
        setRouteResult(result)
      }
    }).catch((caught) => {
      if (!controller.signal.aborted) {
        completedRouteRequestKeyRef.current = null
        setRouteResult(null)
        setMapNotice(caught instanceof Error ? caught.message : '地图预览路线生成失败。')
      }
    }).finally(() => {
      if (activeRouteRequestKeyRef.current === requestKey) {
        activeRouteRequestKeyRef.current = null
      }
      if (!controller.signal.aborted) {
        setRouteLoading(false)
      }
    })

    return () => controller.abort()
  }, [configVersion, dataKey, days, engine, hasPoints, itemsByDay, routeDataReady, tripId])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !hasPoints) {
      return
    }

    map.resize()
    map.setRouteLine(routeResult?.lineStrings ?? [])
    fitPreviewBounds(map, data.records, routeResult?.lineStrings ?? [])
  }, [data.records, dataKey, hasPoints, mapInstanceVersion, routeKey, routeResult])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !hasPoints) {
      clearMapMarkers()
      return
    }

    clearMapMarkers()
    markerHandlesRef.current = buildNativePreviewMarkers(data.records).map((marker) =>
      map.addMarker(marker.coordinate, createPreviewMarkerElement(marker)),
    )
    return clearMapMarkers
  }, [clearMapMarkers, data.records, dataKey, engine, hasPoints, mapInstanceVersion])

  const handleCheckRouteOrderSuggestion = useCallback(async () => {
    const day = routeOrderSuggestionDay
    const proxyConfig = getProviderProxyConfig()
    if (!day || !proxyConfig.proxyUrl) {
      setRouteOrderSuggestionState({ message: '路线顺序建议服务暂不可用。', status: 'error' })
      return
    }

    const dayItems = itemsByDay[day.id] ?? []
    setRouteOrderSuggestionState({ day, status: 'loading' })
    setRouteOrderConfirmOpen(false)
    try {
      const result = await fetchProviderProxyRouteOrderSuggestion({
        dayId: day.id,
        items: buildRouteOrderSuggestionRequestItems(dayItems),
        operation: 'route_order_suggestion',
        provider: 'auto',
        requestId: createRouteOrderSuggestionRequestId(),
        tripId,
      }, proxyConfig.proxyUrl)
      setRouteOrderSuggestionState({ day, result, status: 'ready' })
    } catch (caught) {
      const message = caught instanceof ProviderProxyClientError || caught instanceof Error
        ? caught.message
        : '路线顺序建议生成失败。'
      setRouteOrderSuggestionState({ message, status: 'error' })
    }
  }, [itemsByDay, routeOrderSuggestionDay, tripId])

  const handleConfirmRouteOrderSuggestion = useCallback(async () => {
    if (routeOrderSuggestionState.status !== 'ready') {
      return
    }

    const { day, result } = routeOrderSuggestionState
    const dayItems = itemsByDay[day.id] ?? []
    const patches = buildRouteOrderSuggestionSortPatches(dayItems, result.suggestedItemIds)
    await Promise.all(patches.map((patch) => updateItineraryItem(patch.id, { sortOrder: patch.sortOrder })))
    setRouteOrderConfirmOpen(false)
    setRouteOrderSuggestionState({
      message: patches.length > 0
        ? `已按建议更新 ${day.title} 的行程顺序。`
        : `${day.title} 当前顺序已经接近建议。`,
      status: 'applied',
    })
    await onItemsReordered?.()
  }, [itemsByDay, onItemsReordered, routeOrderSuggestionState])

  return (
    <>
    <Card className="overflow-hidden" data-testid="trip-map-overview" padding="none" variant="grouped">
      <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-100">行程地图预览</h3>
          <p className="mt-0.5 truncate text-xs tm-muted">
            {hasPoints ? `${data.coordinateCount} 个有坐标地点 · ${data.dayCount} 天` : '还没有可显示的坐标'}
          </p>
        </div>
        <button
          className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-full bg-white/70 px-3 text-xs font-semibold text-slate-700 ring-1 ring-slate-200/80 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-900/55 dark:text-slate-200 dark:ring-slate-700/80 tm-focus"
          disabled={!data.targetDay}
          onClick={() => {
            if (data.targetDay) {
              onOpenMap(data.targetDay)
            }
          }}
          type="button"
        >
          <MapIcon className="size-3.5" />
          查看地图
        </button>
      </div>
      <div className="space-y-2 px-4 pb-4">
        <div
          className="relative h-40 overflow-hidden rounded-2xl bg-slate-50/70 ring-1 ring-slate-100/80 dark:bg-slate-900/35 dark:ring-slate-700/60"
          data-testid="trip-map-overview-plot"
        >
          {hasPoints ? (
            <>
              <div
                className="absolute inset-0"
                data-interactive="false"
              >
                <div
                  className="size-full"
                  data-interactive="false"
                  data-testid="trip-map-preview-map"
                  ref={containerRef}
                />
              </div>
              {(!engine || (!isMapReady && !isMapBaseSlow) || previewRouteLoading) ? (
                <div className="pointer-events-none absolute inset-x-3 top-3 flex items-center gap-2 rounded-full bg-white/90 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm ring-1 ring-slate-100 dark:bg-slate-950/80 dark:text-slate-300 dark:ring-slate-700">
                  <Loader2 className="size-3.5 animate-spin" />
                  {engine ? '加载地图预览...' : '准备地图预览...'}
                </div>
              ) : null}
            </>
          ) : (
            <div className="absolute inset-0 flex items-center gap-3 px-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-white/80 text-slate-400 ring-1 ring-slate-100 dark:bg-slate-900/75 dark:ring-slate-700">
                <MapPinned className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">还没有可显示的坐标</p>
                <p className="mt-1 text-xs leading-5 tm-muted">
                  给行程点补充坐标后，这里会显示地图预览。
                </p>
              </div>
            </div>
          )}
        </div>
        {hasPoints ? (
          <div className="space-y-2">
            <p data-testid="trip-map-overview-note" className="text-[11px] leading-5 tm-muted">
              {describeRoutePreview(routeResult, previewRouteLoading)}路线仅供预览，不会自动改行程顺序。
            </p>
            {mapNotice ? (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                {mapNotice}
              </p>
            ) : null}
            {routeOrderSuggestionDay ? (
              <RouteOrderSuggestionPanel
                day={routeOrderSuggestionDay}
                items={itemsByDay[routeOrderSuggestionDay.id] ?? []}
                onApply={() => setRouteOrderConfirmOpen(true)}
                onCheck={() => void handleCheckRouteOrderSuggestion()}
                state={routeOrderSuggestionState}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
    <ConfirmDialog
      body={routeOrderSuggestionState.status === 'ready'
        ? `只会更新 ${routeOrderSuggestionState.day.title} 内行程点的排序。\n不会生成路线，不会写入云端，不会创建票据。`
        : ''}
      cancelLabel="暂不应用"
      confirmLabel="确认应用"
      icon={<Sparkles className="size-5" />}
      onCancel={() => setRouteOrderConfirmOpen(false)}
      onConfirm={() => void handleConfirmRouteOrderSuggestion()}
      open={routeOrderConfirmOpen && routeOrderSuggestionState.status === 'ready'}
      testId="trip-map-route-order-confirm-dialog"
      title="应用路线顺序建议？"
    />
    </>
  )
}

function RouteOrderSuggestionPanel({
  day,
  items,
  onApply,
  onCheck,
  state,
}: {
  day: Day
  items: ItineraryItem[]
  onApply: () => void
  onCheck: () => void
  state: RouteOrderSuggestionState
}) {
  const titleById = new Map(items.map((item) => [item.id, item.title]))
  return (
    <div
      className="space-y-2 rounded-2xl bg-slate-50/80 p-3 ring-1 ring-slate-100/80 dark:bg-slate-900/45 dark:ring-slate-700/70"
      data-testid="trip-map-route-order-panel"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">路线顺序建议</p>
          <p className="mt-0.5 truncate text-[11px] tm-muted">{day.title} · 仅提供排序建议</p>
        </div>
        <button
          className="inline-flex min-h-8 shrink-0 items-center justify-center gap-1.5 rounded-full bg-white px-2.5 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200 active:scale-[0.98] disabled:opacity-60 dark:bg-slate-950/60 dark:text-slate-200 dark:ring-slate-700 tm-focus"
          data-testid="trip-map-route-order-check"
          disabled={state.status === 'loading'}
          onClick={onCheck}
          type="button"
        >
          {state.status === 'loading' ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          查看建议（仅建议）
        </button>
      </div>
      {state.status === 'ready' ? (
        <div className="space-y-2" data-testid="trip-map-route-order-suggestion">
          <p className="text-[11px] leading-5 tm-muted">
            建议顺序：{state.result.suggestedItemIds.map((itemId) => titleById.get(itemId) ?? itemId).join(' → ')}
          </p>
          <p className="text-[11px] leading-5 tm-muted">
            {state.result.summary} {formatDistance(state.result.distanceMeters)} · {formatDuration(state.result.durationSeconds)}
          </p>
          {state.result.warnings.length > 0 ? (
            <p className="text-[11px] leading-5 text-amber-700 dark:text-amber-300">
              {state.result.warnings.join(' ')}
            </p>
          ) : null}
          <button
            className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-full bg-sky-600 px-3 text-[11px] font-semibold text-white active:scale-[0.98] dark:bg-sky-500 tm-focus"
            data-testid="trip-map-route-order-apply"
            onClick={onApply}
            type="button"
          >
            <Check className="size-3.5" />
            应用建议
          </button>
        </div>
      ) : null}
      {state.status === 'error' || state.status === 'applied' ? (
        <p className="text-[11px] leading-5 tm-muted" data-testid="trip-map-route-order-message">{state.message}</p>
      ) : null}
    </div>
  )
}

type NativePreviewMarker = {
  coordinate: LngLat
  index: number
  offset: { x: number; y: number }
  record: TripMapPreviewRecord
}

function buildNativePreviewMarkers(records: TripMapPreviewRecord[]): NativePreviewMarker[] {
  return separateNearbyRecordMarkers(records.map((record, index) => ({
    coordinate: record.coordinate,
    index,
    offset: { x: 0, y: 0 },
    record,
  })))
}

function createPreviewMarkerElement(marker: NativePreviewMarker) {
  const outer = document.createElement('div')
  outer.className = 'pointer-events-none relative size-0'

  const inner = document.createElement('div')
  inner.className = [
    'absolute flex size-7 items-center justify-center rounded-full border-[3px] border-white',
    'bg-sky-600 text-[13px] font-bold leading-none text-white shadow-[0_4px_12px_rgba(2,6,23,0.35)]',
    'dark:border-slate-950 dark:bg-sky-300 dark:text-slate-950',
  ].join(' ')
  inner.dataset.testid = 'trip-map-overview-marker'
  inner.setAttribute('aria-label', `${marker.index + 1}. ${marker.record.item.title}`)
  inner.style.transform = `translate(calc(-50% + ${marker.offset.x}px), calc(-50% + ${marker.offset.y}px))`
  inner.textContent = String(marker.index + 1)

  outer.appendChild(inner)
  return outer
}

function separateNearbyRecordMarkers(markers: NativePreviewMarker[]) {
  const groups: NativePreviewMarker[][] = []
  markers.forEach((marker) => {
    const group = groups.find((candidate) =>
      candidate.some((member) => getCoordinateDistanceMeters(member.coordinate, marker.coordinate) < NATIVE_MARKER_OVERLAP_THRESHOLD_METERS),
    )
    if (group) {
      group.push(marker)
    } else {
      groups.push([marker])
    }
  })

  return groups.flatMap((group) => {
    if (group.length === 1) {
      return group
    }

    return group.map((marker, groupIndex) => {
      const angle = (Math.PI * 2 * groupIndex) / group.length - Math.PI / 2
      return {
        ...marker,
        offset: {
          x: Math.cos(angle) * NATIVE_MARKER_OVERLAP_OFFSET_PX,
          y: Math.sin(angle) * NATIVE_MARKER_OVERLAP_OFFSET_PX,
        },
      }
    })
  }).sort((first, second) => first.index - second.index)
}

function getCoordinateDistanceMeters(first: LngLat, second: LngLat) {
  const latScale = 111_320
  const lngScale = 111_320 * Math.cos(((first[1] + second[1]) / 2) * Math.PI / 180)
  return Math.hypot((first[0] - second[0]) * lngScale, (first[1] - second[1]) * latScale)
}

function fitPreviewBounds(map: MapInstance, records: TripMapPreviewRecord[], lineStrings: LngLat[][] = []) {
  const coordinates = [...records.map((record) => record.coordinate), ...lineStrings.flat()]
  if (coordinates.length === 0) {
    return
  }

  const lngs = coordinates.map((coordinate) => coordinate[0])
  const lats = coordinates.map((coordinate) => coordinate[1])
  let minLng = Math.min(...lngs)
  let maxLng = Math.max(...lngs)
  let minLat = Math.min(...lats)
  let maxLat = Math.max(...lats)

  if (Math.abs(maxLng - minLng) < 0.0001) {
    minLng -= 0.01
    maxLng += 0.01
  }
  if (Math.abs(maxLat - minLat) < 0.0001) {
    minLat -= 0.01
    maxLat += 0.01
  }

  map.fitBounds([[minLng, minLat], [maxLng, maxLat]], {
    duration: 0,
    maxZoom: 13,
    padding: { bottom: 56, left: 28, right: 28, top: 28 },
  })
}

function describeRoutePreview(result: TripPreviewRouteResult | null, loading: boolean) {
  if (loading) {
    return '正在准备路线预览；'
  }
  if (!result) {
    return '地图底图用于查看空间关系；'
  }
  if (result.provider === 'google') {
    return result.source === 'cache' ? '使用已缓存的 Google 路线几何，按每天行程顺序预览；' : '使用 Google 路线几何，按每天行程顺序预览；'
  }
  if (result.provider === 'openrouteservice') {
    return result.source === 'cache' ? '使用已缓存的 ORS 路线几何，按每天行程顺序预览；' : '使用 ORS 路线几何，按每天行程顺序预览；'
  }
  if (result.warnings[0]?.includes('尚未生成路线预览')) {
    return '尚未生成路线预览，直线仅按每天行程顺序连接；'
  }
  return '路线服务未配置，直线仅按每天行程顺序连接；'
}

function buildPreviewDataKey(data: TripMapPreviewData) {
  return data.records
    .map((record) => [record.day.id, record.item.id, record.coordinate.join(','), record.item.sortOrder].join(':'))
    .join('|')
}

function formatDistance(value?: number) {
  if (!value || !Number.isFinite(value)) {
    return '距离待确认'
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)} km`
  }
  return `${Math.round(value)} m`
}

function formatDuration(value?: number) {
  if (!value || !Number.isFinite(value)) {
    return '时长待确认'
  }
  if (value >= 3600) {
    const hours = Math.floor(value / 3600)
    const minutes = Math.round((value % 3600) / 60)
    return minutes > 0 ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`
  }
  return `${Math.max(1, Math.round(value / 60))} 分钟`
}

function createRouteOrderSuggestionRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `route_order_${crypto.randomUUID()}`
  }
  return `route_order_${Date.now().toString(36)}`
}
