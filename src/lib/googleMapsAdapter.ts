/// <reference types="google.maps" />
import type { MapEventType, MapInstance, MapInitOptions, FitBoundsOptions, CameraState, MarkerHandle, LngLat, LngLatBounds } from './mapEngine'

const IDLE_TIMEOUT_MS = 15000

class GoogleMapInstance implements MapInstance {
  private map: google.maps.Map
  private markers: google.maps.marker.AdvancedMarkerElement[] = []
  private polyline: google.maps.Polyline | null = null
  private disposed = false
  private listeners = new Map<() => void, google.maps.MapsEventListener>()
  private wrappers = new Map<() => void, (...args: unknown[]) => void>()

  constructor(map: google.maps.Map) {
    this.map = map
  }

  remove() {
    this.disposed = true
    for (const marker of this.markers) {
      marker.map = null
    }
    this.markers = []
    if (this.polyline) {
      this.polyline.setMap(null)
      this.polyline = null
    }
    for (const listener of this.listeners.values()) {
      listener.remove()
    }
    this.listeners.clear()
    this.wrappers.clear()
  }

  resize() {
    if (this.disposed) return
    google.maps.event.trigger(this.map, 'resize')
  }

  flyTo(center: LngLat, zoom: number, duration?: number) {
    if (this.disposed) return
    if (duration && duration > 0) {
      this.map.panTo({ lng: center[0], lat: center[1] })
      const currentZoom = this.map.getZoom() ?? 0
      if (Math.abs(zoom - currentZoom) > 1) {
        this.map.setZoom(zoom)
      }
    } else {
      this.map.setCenter({ lng: center[0], lat: center[1] })
      this.map.setZoom(zoom)
    }
  }

  fitBounds(bounds: LngLatBounds, options?: FitBoundsOptions) {
    if (this.disposed) return
    const gBounds = new google.maps.LatLngBounds(
      { lng: bounds[0][0], lat: bounds[0][1] },
      { lng: bounds[1][0], lat: bounds[1][1] },
    )
    this.map.fitBounds(gBounds, options?.padding)
    if (options?.maxZoom != null) {
      const listener = google.maps.event.addListenerOnce(this.map, 'idle', () => {
        if (this.disposed) return
        if ((this.map.getZoom() ?? 0) > options.maxZoom!) {
          this.map.setZoom(options.maxZoom!)
        }
      })
      setTimeout(() => listener.remove(), 5000)
    }
  }

  easeTo(center: LngLat, zoom: number, duration?: number) {
    void duration
    if (this.disposed) return
    this.map.panTo({ lng: center[0], lat: center[1] })
    const currentZoom = this.map.getZoom() ?? 0
    if (Math.abs(zoom - currentZoom) > 0.1) {
      this.map.setZoom(zoom)
    }
  }

  jumpTo(camera: Partial<CameraState>) {
    if (this.disposed) return
    const options: google.maps.MapOptions = {}
    if (camera.center) options.center = { lng: camera.center[0], lat: camera.center[1] }
    if (camera.zoom != null) options.zoom = camera.zoom
    this.map.setOptions(options)
  }

  getCamera(): CameraState {
    const center = this.map.getCenter()
    return {
      center: center ? [center.lng(), center.lat()] : [0, 0],
      zoom: this.map.getZoom() ?? 0,
      bearing: 0,
      pitch: 0,
    }
  }

  addMarker(lngLat: LngLat, element: HTMLElement): MarkerHandle {
    const marker = new google.maps.marker.AdvancedMarkerElement({
      position: { lng: lngLat[0], lat: lngLat[1] },
      content: element,
      map: this.map,
    })
    this.markers.push(marker)
    return {
      setLngLat(nextLngLat) {
        marker.position = { lng: nextLngLat[0], lat: nextLngLat[1] }
      },
      remove() {
        marker.map = null
      },
    }
  }

  setRouteLine(lineStrings: LngLat[][]) {
    if (this.disposed) return

    const path = lineStrings.flatMap((line) =>
      line.map(([lng, lat]) => new google.maps.LatLng(lat, lng)),
    )

    if (this.polyline) {
      this.polyline.setPath(path)
      this.polyline.setMap(path.length > 0 ? this.map : null)
    } else if (path.length > 0) {
      this.polyline = new google.maps.Polyline({
        path,
        strokeColor: '#1677ff',
        strokeWeight: 4,
        strokeOpacity: 0.86,
        map: this.map,
      })
    }
  }

  setRouteVisibility(visible: boolean) {
    if (this.disposed || !this.polyline) return
    this.polyline.setMap(visible ? this.map : null)
  }

  on(event: MapEventType, handler: () => void) {
    if (this.disposed) return
    const gEvent = toGoogleEvent(event)
    if (!gEvent) return
    const wrapper = () => handler()
    this.wrappers.set(handler, wrapper)
    this.listeners.set(handler, google.maps.event.addListener(this.map, gEvent, wrapper))
  }

  off(event: MapEventType, handler: () => void) {
    void event
    const listener = this.listeners.get(handler)
    if (listener) {
      listener.remove()
      this.listeners.delete(handler)
      this.wrappers.delete(handler)
    }
  }

  once(event: MapEventType, handler: () => void) {
    if (this.disposed) return
    const gEvent = toGoogleEvent(event)
    if (!gEvent) return
    const wrapper = () => handler()
    this.wrappers.set(handler, wrapper)
    this.listeners.set(handler, google.maps.event.addListenerOnce(this.map, gEvent, wrapper))
  }

  waitForIdle(): Promise<'idle' | 'timeout'> {
    if (this.disposed) return Promise.resolve('timeout')

    return new Promise((resolve) => {
      let settled = false
      const timeoutId = setTimeout(() => finish('timeout'), IDLE_TIMEOUT_MS)
      const listener = google.maps.event.addListenerOnce(this.map, 'idle', () => finish('idle'))

      const finish = (result: 'idle' | 'timeout') => {
        if (settled) return
        settled = true
        clearTimeout(timeoutId)
        listener.remove()
        resolve(this.disposed ? 'timeout' : result)
      }
    })
  }
}

function toGoogleEvent(event: MapEventType): string | null {
  const mapping: Record<string, string> = {
    load: 'tilesloaded',
    idle: 'idle',
    error: 'error',
    moveend: 'dragend',
    resize: 'resize',
  }
  return mapping[event] ?? null
}

export class GoogleMapsEngineAdapter {
  readonly type = 'google' as const

  createMap(container: HTMLElement, options: MapInitOptions): MapInstance {
    const interactive = options.interactive ?? true
    const map = new google.maps.Map(container, {
      center: { lng: options.center[0], lat: options.center[1] },
      zoom: options.zoom,
      clickableIcons: interactive,
      disableDoubleClickZoom: !interactive,
      draggable: interactive,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      keyboardShortcuts: interactive,
      zoomControl: interactive,
      gestureHandling: interactive ? 'greedy' : 'none',
    })

    return new GoogleMapInstance(map)
  }
}
