import maplibregl, { type StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { MapEventType, MapInstance, MapInitOptions, FitBoundsOptions, CameraState, MarkerHandle, LngLat, LngLatBounds } from './mapEngine'

const IDLE_TIMEOUT_MS = 15000

class MapLibreMapInstance implements MapInstance {
  private map: maplibregl.Map
  private markers: maplibregl.Marker[] = []
  private routeSourceId = 'route-source'
  private routeLayerId = 'route-line'
  private routeVisible = true
  private disposed = false
  private listeners = new Map<() => void, (event?: unknown) => void>()

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

  setRouteLine(lineStrings: LngLat[][]) {
    if (this.disposed) return

    const feature = {
      type: 'Feature' as const,
      geometry: { type: 'MultiLineString' as const, coordinates: lineStrings },
      properties: {},
    }
    const hasLine = lineStrings.length > 0

    if (!this.map.getSource(this.routeSourceId)) {
      this.map.addSource(this.routeSourceId, { type: 'geojson', data: feature })
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
          'line-color': '#1677ff',
          'line-opacity': 0.86,
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 12, 4, 16, 6],
        },
      })
    } else {
      const source = this.map.getSource(this.routeSourceId) as maplibregl.GeoJSONSource
      source.setData(feature)
      this.map.setLayoutProperty(
        this.routeLayerId,
        'visibility',
        hasLine && this.routeVisible ? 'visible' : 'none',
      )
    }
  }

  setRouteVisibility(visible: boolean) {
    this.routeVisible = visible
    if (this.disposed) return
    if (this.map.getLayer(this.routeLayerId)) {
      this.map.setLayoutProperty(this.routeLayerId, 'visibility', visible ? 'visible' : 'none')
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
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left')

    return new MapLibreMapInstance(map)
  }
}
