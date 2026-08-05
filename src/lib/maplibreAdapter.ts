import maplibregl, { type StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { MapEventType, MapInstance, MapInitOptions, FitBoundsOptions, CameraState, MarkerHandle, LngLat, LngLatBounds, RouteLineKind } from './mapEngine'

const IDLE_TIMEOUT_MS = 15000
type RouteWidthExpression = ['interpolate', ['linear'], ['zoom'], number, number, number, number, number, number]

class MapLibreMapInstance implements MapInstance {
  private map: maplibregl.Map
  private markers: maplibregl.Marker[] = []
  private routeSourceId = 'route-source'
  private routeCasingLayerId = 'route-casing'
  private routeLayerId = 'route-line'
  private routeConnectorSourceId = 'route-connector-source'
  private routeConnectorCasingLayerId = 'route-connector-casing'
  private routeConnectorLayerId = 'route-connector-line'
  private routeVisible = true
  private disposed = false
  private listeners = new Map<() => void, (event?: unknown) => void>()
  private pendingRouteLine: { kind: RouteLineKind; lineStrings: LngLat[][] } | null = null
  private pendingRouteLineListenerAttached = false

  constructor(map: maplibregl.Map) {
    this.map = map
  }

  remove() {
    this.disposed = true
    for (const marker of this.markers) {
      marker.remove()
    }
    this.markers = []
    this.map.remove()
  }

  resize() {
    if (this.disposed) return
    this.map.resize()
  }

  flyTo(center: LngLat, zoom: number, duration = 600) {
    if (this.disposed) return
    this.map.flyTo({ center, zoom, duration })
  }

  fitBounds(bounds: LngLatBounds, options?: FitBoundsOptions) {
    if (this.disposed) return
    const sw = new maplibregl.LngLat(bounds[0][0], bounds[0][1])
    const ne = new maplibregl.LngLat(bounds[1][0], bounds[1][1])
    const lngLatBounds = new maplibregl.LngLatBounds(sw, ne)
    this.map.fitBounds(lngLatBounds, {
      padding: options?.padding ?? 72,
      maxZoom: options?.maxZoom ?? 14,
      duration: options?.duration ?? 700,
    })
  }

  easeTo(center: LngLat, zoom: number, duration = 450) {
    if (this.disposed) return
    this.map.easeTo({ center, zoom, duration })
  }

  jumpTo(camera: Partial<CameraState>) {
    if (this.disposed) return
    this.map.jumpTo({
      center: camera.center,
      zoom: camera.zoom,
      bearing: camera.bearing,
      pitch: camera.pitch,
    })
  }

  getCamera(): CameraState {
    const center = this.map.getCenter()
    return {
      center: [center.lng, center.lat],
      zoom: this.map.getZoom(),
      bearing: this.map.getBearing(),
      pitch: this.map.getPitch(),
    }
  }

  addMarker(lngLat: LngLat, element: HTMLElement): MarkerHandle {
    const marker = new maplibregl.Marker({ anchor: 'center', element })
      .setLngLat(lngLat)
      .addTo(this.map)
    this.markers.push(marker)
    return {
      setLngLat(nextLngLat) {
        marker.setLngLat(nextLngLat)
      },
      remove() {
        marker.remove()
      },
    }
  }

  setRouteLine(lineStrings: LngLat[][], kind: RouteLineKind = 'road') {
    if (this.disposed) return

    try {
      this.applyRouteLine(lineStrings, kind)
      this.pendingRouteLine = null
    } catch (caught) {
      if (!isMapLibreStyleLoadingError(caught)) {
        throw caught
      }
      this.queueRouteLine(lineStrings, kind)
    }
  }

  private queueRouteLine(lineStrings: LngLat[][], kind: RouteLineKind) {
    this.pendingRouteLine = { kind, lineStrings }
    if (this.pendingRouteLineListenerAttached) {
      return
    }

    this.pendingRouteLineListenerAttached = true
    this.map.once('load', () => {
      this.pendingRouteLineListenerAttached = false
      const pending = this.pendingRouteLine
      this.pendingRouteLine = null
      if (pending && !this.disposed) {
        this.setRouteLine(pending.lineStrings, pending.kind)
      }
    })
  }

  private applyRouteLine(lineStrings: LngLat[][], kind: RouteLineKind) {
    const feature = {
      type: 'Feature' as const,
      geometry: { type: 'MultiLineString' as const, coordinates: lineStrings },
      properties: {},
    }
    const hasLine = lineStrings.length > 0

    if (!this.map.getSource(this.routeSourceId)) {
      this.map.addSource(this.routeSourceId, { type: 'geojson', data: feature })
      this.map.addLayer({
        id: this.routeCasingLayerId,
        type: 'line',
        source: this.routeSourceId,
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
          visibility: hasLine && this.routeVisible ? 'visible' : 'none',
        },
        paint: {
          'line-color': '#ffffff',
          'line-opacity': routeCasingOpacity(kind),
          'line-width': routeCasingWidth(kind),
        },
      })
      this.map.addLayer({
        id: this.routeLayerId,
        type: 'line',
        source: this.routeSourceId,
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
          visibility: hasLine && this.routeVisible ? 'visible' : 'none',
        },
        paint: {
          'line-color': '#0e7c73',
          'line-dasharray': routeDashArray(kind),
          'line-opacity': routeLineOpacity(kind),
          'line-width': routeLineWidth(kind),
        },
      })
    } else {
      const source = this.map.getSource(this.routeSourceId) as maplibregl.GeoJSONSource
      source.setData(feature)
      this.map.setPaintProperty(this.routeCasingLayerId, 'line-opacity', routeCasingOpacity(kind))
      this.map.setPaintProperty(this.routeCasingLayerId, 'line-width', routeCasingWidth(kind))
      this.map.setPaintProperty(this.routeLayerId, 'line-dasharray', routeDashArray(kind))
      this.map.setPaintProperty(this.routeLayerId, 'line-opacity', routeLineOpacity(kind))
      this.map.setPaintProperty(this.routeLayerId, 'line-width', routeLineWidth(kind))
      this.map.setLayoutProperty(
        this.routeCasingLayerId,
        'visibility',
        hasLine && this.routeVisible ? 'visible' : 'none',
      )
      this.map.setLayoutProperty(
        this.routeLayerId,
        'visibility',
        hasLine && this.routeVisible ? 'visible' : 'none',
      )
    }
  }

  setRouteConnectorLine(lineStrings: LngLat[][]) {
    if (this.disposed) return

    const feature = {
      type: 'Feature' as const,
      geometry: { type: 'MultiLineString' as const, coordinates: lineStrings },
      properties: {},
    }
    const hasLine = lineStrings.length > 0

    if (!this.map.getSource(this.routeConnectorSourceId)) {
      this.map.addSource(this.routeConnectorSourceId, { type: 'geojson', data: feature })
      this.map.addLayer({
        id: this.routeConnectorCasingLayerId,
        type: 'line',
        source: this.routeConnectorSourceId,
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
          visibility: hasLine && this.routeVisible ? 'visible' : 'none',
        },
        paint: {
          'line-color': '#ffffff',
          'line-opacity': routeCasingOpacity('sequence'),
          'line-width': routeCasingWidth('sequence'),
        },
      })
      this.map.addLayer({
        id: this.routeConnectorLayerId,
        type: 'line',
        source: this.routeConnectorSourceId,
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
          visibility: hasLine && this.routeVisible ? 'visible' : 'none',
        },
        paint: {
          'line-color': '#0e7c73',
          'line-dasharray': routeDashArray('sequence'),
          'line-opacity': routeLineOpacity('sequence'),
          'line-width': routeLineWidth('sequence'),
        },
      })
      return
    }

    const source = this.map.getSource(this.routeConnectorSourceId) as maplibregl.GeoJSONSource
    source.setData(feature)
    const visibility = hasLine && this.routeVisible ? 'visible' : 'none'
    this.map.setLayoutProperty(this.routeConnectorCasingLayerId, 'visibility', visibility)
    this.map.setLayoutProperty(this.routeConnectorLayerId, 'visibility', visibility)
  }

  setRouteVisibility(visible: boolean) {
    this.routeVisible = visible
    if (this.disposed) return
    if (this.map.getLayer(this.routeCasingLayerId)) {
      this.map.setLayoutProperty(this.routeCasingLayerId, 'visibility', visible ? 'visible' : 'none')
    }
    if (this.map.getLayer(this.routeLayerId)) {
      this.map.setLayoutProperty(this.routeLayerId, 'visibility', visible ? 'visible' : 'none')
    }
    if (this.map.getLayer(this.routeConnectorCasingLayerId)) {
      this.map.setLayoutProperty(this.routeConnectorCasingLayerId, 'visibility', visible ? 'visible' : 'none')
    }
    if (this.map.getLayer(this.routeConnectorLayerId)) {
      this.map.setLayoutProperty(this.routeConnectorLayerId, 'visibility', visible ? 'visible' : 'none')
    }
  }

  waitForIdle(): Promise<'idle' | 'timeout'> {
    if (this.disposed) return Promise.resolve('timeout')

    return new Promise((resolve) => {
      let settled = false
      const timeoutId = setTimeout(() => finish('timeout'), IDLE_TIMEOUT_MS)
      const handleIdle = () => finish('idle')

      const finish = (result: 'idle' | 'timeout') => {
        if (settled) return
        settled = true
        clearTimeout(timeoutId)
        this.map.off('idle', handleIdle)
        resolve(this.disposed ? 'timeout' : result)
      }

      this.map.once('idle', handleIdle)
    })
  }

  on(event: MapEventType, handler: () => void) {
    if (this.disposed) return
    const wrapper = () => handler()
    this.listeners.set(handler, wrapper)
    this.map.on(event as string, wrapper)
  }

  off(event: MapEventType, handler: () => void) {
    const wrapper = this.listeners.get(handler)
    if (wrapper) {
      this.listeners.delete(handler)
      this.map.off(event as string, wrapper)
    }
  }

  once(event: MapEventType, handler: () => void) {
    if (this.disposed) return
    this.map.once(event as string, () => handler())
  }
}

export class MapLibreAdapter {
  readonly type = 'maplibre' as const

  createMap(container: HTMLElement, options: MapInitOptions): MapInstance {
    const interactive = options.interactive ?? true
    const map = new maplibregl.Map({
      attributionControl: false,
      center: options.center,
      container,
      dragRotate: false,
      interactive,
      pitchWithRotate: false,
      style: (options.style ?? 'https://tiles.openfreemap.org/styles/positron') as string | StyleSpecification,
      touchPitch: false,
      zoom: options.zoom,
    })

    if (interactive) {
      map.dragPan.enable()
      map.touchZoomRotate.enable()
      map.touchZoomRotate.disableRotation()
      map.dragRotate.disable()
    }
    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      options.attributionPosition ?? 'bottom-left',
    )
    const collapseAttribution = () => {
      const attribution = container.querySelector<HTMLElement>('.maplibregl-ctrl-attrib')
      attribution?.classList.remove('maplibregl-compact-show')
      attribution?.setAttribute('open', '')
    }
    collapseAttribution()
    map.once('load', collapseAttribution)

    return new MapLibreMapInstance(map)
  }
}

function routeCasingWidth(kind: RouteLineKind) {
  return kind === 'road'
    ? ['interpolate', ['linear'], ['zoom'], 8, 4, 12, 5.5, 16, 7] satisfies RouteWidthExpression
    : ['interpolate', ['linear'], ['zoom'], 8, 3.5, 12, 4.5, 16, 5.5] satisfies RouteWidthExpression
}

function routeLineWidth(kind: RouteLineKind) {
  return kind === 'road'
    ? ['interpolate', ['linear'], ['zoom'], 8, 2, 12, 3, 16, 4] satisfies RouteWidthExpression
    : ['interpolate', ['linear'], ['zoom'], 8, 1.8, 12, 2.5, 16, 3.2] satisfies RouteWidthExpression
}

function routeDashArray(kind: RouteLineKind): [number, number] {
  return kind === 'road' ? [1, 0.01] : [0.7, 1.35]
}

function routeCasingOpacity(kind: RouteLineKind) {
  return kind === 'road' ? 0.9 : 0.42
}

function routeLineOpacity(kind: RouteLineKind) {
  return kind === 'road' ? 0.98 : 0.52
}

function isMapLibreStyleLoadingError(caught: unknown) {
  return caught instanceof Error && /style.*(not.*done|load)/i.test(caught.message)
}
