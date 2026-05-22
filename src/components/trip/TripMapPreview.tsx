import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Loader2, Map as MapIcon, MapPinned, Sparkles, X } from 'lucide-react'
import { updateItineraryItem } from '../../db'
import { EMPTY_MAP_STYLE, FALLBACK_MAP_STYLE, TRIP_PREVIEW_MAP_STYLE } from '../../lib/mapConfig'
import { GoogleMapsEngineAdapter } from '../../lib/googleMapsAdapter'
import {
  getGoogleMapsApiKey,
  GOOGLE_MAPS_CONFIG_CHANGED_EVENT_EXPORT,
  waitForGoogleMaps,
} from '../../lib/googleMaps'
import type { LngLat, MapInstance, MarkerHandle } from '../../lib/mapEngine'
import { MapLibreAdapter } from '../../lib/maplibreAdapter'
import {
  fetchGoogleRouteOptimization,
  getRoutingConfig,
  type GoogleRouteOptimizationResult,
} from '../../lib/routing'
import { ROUTE_CACHE_CHANGED_EVENT } from '../../lib/routeCache'
import {
  buildTripMapPreviewData,
  fetchTripPreviewRoute,
  getTripPreviewOptimizationDay,
  selectTripPreviewRoutingConfig,
  type TripMapPreviewData,
  type TripMapPreviewEngine,
  type TripMapPreviewRecord,
  type TripPreviewRouteResult,
} from '../../lib/tripMapPreview'
import type { Day, ItineraryItem } from '../../types'
import { Card } from '../ui/Card'

type TripMapPreviewProps = {
  days: Day[]
  itemsByDay: Record<string, ItineraryItem[]>
  onItemsReordered?: () => Promise<void> | void
  onOpenMap: (day: Day) => void
  routeDataReady?: boolean
  selectedDay: Day | null
  tripId: string
}

type OptimizationState =
  | { status: 'idle' }
  | { status: 'loading'; day: Day }
  | { status: 'ready'; day: Day; result: GoogleRouteOptimizationResult }
  | { status: 'applied'; message: string }
  | { status: 'error'; message: string }

const maplibreAdapter = new MapLibreAdapter()
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
  const [optimizationState, setOptimizationState] = useState<OptimizationState>({ status: 'idle' })
  const [confirmOptimization, setConfirmOptimization] = useState(false)
  const activeRouteRequestKeyRef = useRef<string | null>(null)
  const completedRouteRequestKeyRef = useRef<string | null>(null)
  const data = useMemo(
    () => buildTripMapPreviewData({ days, itemsByDay, selectedDay }),
    [days, itemsByDay, selectedDay],
  )
  const hasPoints = data.records.length > 0
  const googleMapsKey = getGoogleMapsApiKey()
  const optimizationDay = useMemo(
    () => getTripPreviewOptimizationDay({ days, itemsByDay, selectedDay }),
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

    function createMap(style: string | Record<string, unknown>, fallbackLevel: 0 | 1 | 2 = 0) {
      if (!containerRef.current || disposed || !engine) {
        return
      }

      cleanupMap()
      clearReadinessTimeout()
      const first = data.records[0]?.coordinate ?? [139.7671, 35.6812]
      const map = engine === 'google'
        ? googleMapsAdapter.createMap(containerRef.current, { center: first, interactive: false, zoom: 11 })
        : maplibreAdapter.createMap(containerRef.current, {
          attributionPosition: 'bottom-right',
          center: first,
          interactive: false,
          zoom: 11,
          style,
        })
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
          createMap(FALLBACK_MAP_STYLE, 1)
          return
        }
        if (fallbackLevel === 1) {
          setMapNotice('地图底图暂时无法加载，已切换为轻量预览。')
          createMap(EMPTY_MAP_STYLE, 2)
          return
        }
        clearReadinessTimeout()
        setIsMapBaseSlow(true)
        setMapNotice('地图底图暂时无法加载，但行程地点仍可查看。')
      })
    }

    createMap(TRIP_PREVIEW_MAP_STYLE)

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

  const handleCheckOptimization = useCallback(async () => {
    const day = optimizationDay
    const apiKey = getGoogleMapsApiKey()
    if (!day || !apiKey) {
      setOptimizationState({ status: 'error', message: '需要配置 Google Maps API key，且当天至少有 4 个带坐标地点。' })
      return
    }

    setOptimizationState({ status: 'loading', day })
    try {
      const result = await fetchGoogleRouteOptimization(itemsByDay[day.id] ?? [], apiKey)
      if (sameItemOrder(result.originalItems, result.suggestedItems)) {
        setOptimizationState({ status: 'applied', message: `${day.title} 当前顺序已经接近推荐。` })
        return
      }
      setOptimizationState({ status: 'ready', day, result })
    } catch (caught) {
      setOptimizationState({
        status: 'error',
        message: caught instanceof Error ? caught.message : '路线顺序建议生成失败。',
      })
    }
  }, [itemsByDay, optimizationDay])

  const handleApplyOptimization = useCallback(async () => {
    if (optimizationState.status !== 'ready') {
      return
    }

    const { day, result } = optimizationState
    await Promise.all(
      result.suggestedItems.map((item, index) =>
        updateItineraryItem(item.id, { sortOrder: index + 1 }),
      ),
    )
    setConfirmOptimization(false)
    setOptimizationState({ status: 'applied', message: `已按建议更新 ${day.title} 的行程顺序。` })
    await onItemsReordered?.()
  }, [onItemsReordered, optimizationState])

  return (
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
            {googleMapsKey && optimizationDay ? (
              <RouteOptimizationPanel
                confirmOpen={confirmOptimization}
                day={optimizationDay}
                onApply={() => setConfirmOptimization(true)}
                onCancelConfirm={() => setConfirmOptimization(false)}
                onCheck={() => void handleCheckOptimization()}
                onConfirm={() => void handleApplyOptimization()}
                state={optimizationState}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  )
}

function RouteOptimizationPanel({
  confirmOpen,
  day,
  onApply,
  onCancelConfirm,
  onCheck,
  onConfirm,
  state,
}: {
  confirmOpen: boolean
  day: Day
  onApply: () => void
  onCancelConfirm: () => void
  onCheck: () => void
  onConfirm: () => void
  state: OptimizationState
}) {
  return (
    <div className="space-y-2 rounded-2xl bg-slate-50/80 p-3 ring-1 ring-slate-100/80 dark:bg-slate-900/45 dark:ring-slate-700/70" data-testid="trip-map-optimization-panel">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">路线顺序建议</p>
          <p className="mt-0.5 truncate text-[11px] tm-muted">{day.title} · Google Routes API</p>
        </div>
        <button
          className="inline-flex min-h-8 shrink-0 items-center justify-center gap-1.5 rounded-full bg-white px-2.5 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200 active:scale-[0.98] disabled:opacity-60 dark:bg-slate-950/60 dark:text-slate-200 dark:ring-slate-700 tm-focus"
          data-testid="trip-map-optimization-check"
          disabled={state.status === 'loading'}
          onClick={onCheck}
          type="button"
        >
          {state.status === 'loading' ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          查看建议
        </button>
      </div>
      {state.status === 'ready' ? (
        <div className="space-y-2" data-testid="trip-map-optimization-suggestion">
          <p className="text-[11px] leading-5 tm-muted">
            建议顺序：{state.result.suggestedItems.map((item) => item.title).join(' → ')}
          </p>
          <p className="text-[11px] leading-5 tm-muted">
            预计 {formatDistance(state.result.distanceMeters)} · {formatDuration(state.result.durationSeconds)}，可能产生 Google Routes API 费用。
          </p>
          <button
            className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-full bg-sky-600 px-3 text-[11px] font-semibold text-white active:scale-[0.98] dark:bg-sky-500 tm-focus"
            data-testid="trip-map-optimization-apply"
            onClick={onApply}
            type="button"
          >
            <Check className="size-3.5" />
            应用建议
          </button>
        </div>
      ) : null}
      {state.status === 'error' || state.status === 'applied' ? (
        <p className="text-[11px] leading-5 tm-muted" data-testid="trip-map-optimization-message">{state.message}</p>
      ) : null}
      {confirmOpen && state.status === 'ready' ? (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/35 p-4 sm:items-center sm:justify-center" data-testid="trip-map-optimization-confirm">
          <div className="w-full max-w-sm rounded-3xl bg-white p-4 shadow-xl dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold text-slate-950 dark:text-slate-100">应用路线顺序建议？</h4>
                <p className="mt-1 text-xs leading-5 tm-muted">
                  只会更新 {state.day.title} 内行程点的排序，不会修改地点、时间、票据或云端保存。
                </p>
              </div>
              <button
                aria-label="关闭"
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300 tm-focus"
                onClick={onCancelConfirm}
                type="button"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                className="min-h-10 rounded-xl bg-slate-100 px-3 text-sm font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200 tm-focus"
                data-testid="trip-map-optimization-cancel"
                onClick={onCancelConfirm}
                type="button"
              >
                取消
              </button>
              <button
                className="min-h-10 rounded-xl bg-sky-600 px-3 text-sm font-semibold text-white dark:bg-sky-500 tm-focus"
                data-testid="trip-map-optimization-confirm-apply"
                onClick={onConfirm}
                type="button"
              >
                确认应用
              </button>
            </div>
          </div>
        </div>
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

function sameItemOrder(first: ItineraryItem[], second: ItineraryItem[]) {
  return first.map((item) => item.id).join('|') === second.map((item) => item.id).join('|')
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
    return '时间待确认'
  }
  const minutes = Math.max(1, Math.round(value / 60))
  if (minutes >= 60) {
    return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
  }
  return `${minutes} 分钟`
}
