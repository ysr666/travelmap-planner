/// <reference types="google.maps" />
import type { ActiveRouteLineKind, MapEventType, MapInstance, MapInitOptions, FitBoundsOptions, CameraState, MarkerHandle, LngLat, LngLatBounds, RouteLineKind } from './mapEngine'

const IDLE_TIMEOUT_MS = 15000
const TRIP_MAP_GOOGLE_STYLES: google.maps.MapTypeStyle[] = [
  {
    elementType: 'geometry',
    stylers: [{ color: '#f4f7f5' }],
  },
  {
    elementType: 'labels.text.fill',
    stylers: [{ color: '#5e6b68' }],
  },
  {
    elementType: 'labels.text.stroke',
    stylers: [{ color: '#ffffff' }, { weight: 3 }],
  },
  {
    featureType: 'administrative.locality',
    elementType: 'labels',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'poi',
    elementType: 'labels',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'poi.park',
    elementType: 'geometry',
    stylers: [{ color: '#deeedb' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#ffffff' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#d9e0dd' }],
  },
  {
    featureType: 'transit',
    elementType: 'labels',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#d8ecf1' }],
  },
]

class GoogleMapInstance implements MapInstance {
  private map: google.maps.Map
  private markers: MarkerHandle[] = []
  private polyline: google.maps.Polyline | null = null
  private connectorPolyline: google.maps.Polyline | null = null
  private activePolyline: google.maps.Polyline | null = null
  private disposed = false
  private listeners = new Map<() => void, google.maps.MapsEventListener>()
  private wrappers = new Map<() => void, (...args: unknown[]) => void>()

  constructor(map: google.maps.Map) {
    this.map = map
  }

  remove() {
    this.disposed = true
    for (const marker of this.markers) {
      marker.remove()
    }
    this.markers = []
    if (this.polyline) {
      this.polyline.setMap(null)
      this.polyline = null
    }
    if (this.connectorPolyline) {
      this.connectorPolyline.setMap(null)
      this.connectorPolyline = null
    }
    if (this.activePolyline) {
      this.activePolyline.setMap(null)
      this.activePolyline = null
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
    const marker = createGoogleDomMarker(lngLat, element, this.map)
    this.markers.push(marker)
    return marker
  }

  setRouteLine(lineStrings: LngLat[][], kind: RouteLineKind = 'road') {
    if (this.disposed) return

    const path = lineStrings.flatMap((line) =>
      line.map(([lng, lat]) => new google.maps.LatLng(lat, lng)),
    )

    const routeStyle = getGoogleRouteStyle(kind)
    if (this.polyline) {
      this.polyline.setPath(path)
      this.polyline.setOptions(routeStyle)
      this.polyline.setMap(path.length > 0 ? this.map : null)
    } else if (path.length > 0) {
      this.polyline = new google.maps.Polyline({
        path,
        ...routeStyle,
        map: this.map,
      })
    }
  }

  setRouteVisibility(visible: boolean) {
    if (this.disposed) return
    this.polyline?.setMap(visible ? this.map : null)
    this.connectorPolyline?.setMap(visible ? this.map : null)
    this.activePolyline?.setMap(visible ? this.map : null)
  }

  setRouteConnectorLine(lineStrings: LngLat[][]) {
    if (this.disposed) return

    const path = lineStrings.flatMap((line) =>
      line.map(([lng, lat]) => new google.maps.LatLng(lat, lng)),
    )

    const connectorStyle = getGoogleRouteStyle('sequence')
    if (this.connectorPolyline) {
      this.connectorPolyline.setPath(path)
      this.connectorPolyline.setOptions(connectorStyle)
      this.connectorPolyline.setMap(path.length > 0 ? this.map : null)
    } else if (path.length > 0) {
      this.connectorPolyline = new google.maps.Polyline({
        path,
        ...connectorStyle,
        map: this.map,
      })
    }
  }

  setActiveRouteLine(lineStrings: LngLat[][], kind: ActiveRouteLineKind = 'other') {
    if (this.disposed) return

    const path = lineStrings.flatMap((line) =>
      line.map(([lng, lat]) => new google.maps.LatLng(lat, lng)),
    )
    const style = getGoogleActiveRouteStyle(kind)
    if (this.activePolyline) {
      this.activePolyline.setPath(path)
      this.activePolyline.setOptions(style)
      this.activePolyline.setMap(path.length > 0 ? this.map : null)
    } else if (path.length > 0) {
      this.activePolyline = new google.maps.Polyline({
        path,
        ...style,
        map: this.map,
      })
    }
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

function getGoogleRouteStyle(kind: RouteLineKind): google.maps.PolylineOptions {
  if (kind === 'road') {
    return {
      icons: [],
      strokeColor: '#0f8f83',
      strokeOpacity: 0.94,
      strokeWeight: 3,
    }
  }

  return {
    icons: [{
      icon: {
        path: 'M 0,-1 0,1',
        scale: 2,
        strokeColor: '#0f8f83',
        strokeOpacity: 0.58,
        strokeWeight: 1.5,
      },
      offset: '0',
      repeat: '10px',
    }],
    strokeColor: '#0f8f83',
    strokeOpacity: 0,
    strokeWeight: 2,
  }
}

function getGoogleActiveRouteStyle(kind: ActiveRouteLineKind): google.maps.PolylineOptions {
  const color = kind === 'transit'
    ? '#2563eb'
    : kind === 'other'
      ? '#b45309'
      : kind === 'estimate'
        ? '#64748b'
        : '#0e7c73'
  if (kind === 'walk' || kind === 'estimate') {
    return {
      icons: [{
        icon: {
          path: 'M 0,-1 0,1',
          scale: kind === 'walk' ? 2.5 : 2,
          strokeColor: color,
          strokeOpacity: kind === 'estimate' ? 0.68 : 1,
          strokeWeight: kind === 'walk' ? 2.5 : 2,
        },
        offset: '0',
        repeat: kind === 'walk' ? '8px' : '10px',
      }],
      strokeColor: color,
      strokeOpacity: 0,
      strokeWeight: 5,
      zIndex: 4,
    }
  }

  return {
    icons: [],
    strokeColor: color,
    strokeOpacity: 1,
    strokeWeight: 6,
    zIndex: 4,
  }
}

function createGoogleDomMarker(lngLat: LngLat, element: HTMLElement, map: google.maps.Map): MarkerHandle {
  class GoogleDomMarker extends google.maps.OverlayView implements MarkerHandle {
    private position: google.maps.LatLng
    private element: HTMLElement

    constructor(initialLngLat: LngLat, markerElement: HTMLElement) {
      super()
      this.position = new google.maps.LatLng(initialLngLat[1], initialLngLat[0])
      this.element = markerElement
      this.element.style.position = 'absolute'
      this.element.style.transform = 'translate(-50%, -50%)'
      this.element.style.willChange = 'transform'
      this.setMap(map)
    }

    onAdd() {
      this.getPanes()?.overlayMouseTarget.appendChild(this.element)
    }

    draw() {
      const projection = this.getProjection()
      if (!projection) return
      const point = projection.fromLatLngToDivPixel(this.position)
      if (!point) return
      this.element.style.left = `${point.x}px`
      this.element.style.top = `${point.y}px`
    }

    onRemove() {
      this.element.remove()
    }

    setLngLat(nextLngLat: LngLat) {
      this.position = new google.maps.LatLng(nextLngLat[1], nextLngLat[0])
      this.draw()
    }

    remove() {
      this.setMap(null)
    }
  }

  return new GoogleDomMarker(lngLat, element)
}

function toGoogleEvent(event: MapEventType): string | null {
  const mapping: Record<string, string> = {
    load: 'tilesloaded',
    idle: 'idle',
    error: 'error',
    moveend: 'dragend',
    resize: 'resize',
    zoom: 'zoom_changed',
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
      clickableIcons: false,
      disableDefaultUI: true,
      disableDoubleClickZoom: !interactive,
      draggable: interactive,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      keyboardShortcuts: false,
      zoomControl: false,
      gestureHandling: interactive ? 'greedy' : 'none',
      styles: TRIP_MAP_GOOGLE_STYLES,
    })

    return new GoogleMapInstance(map)
  }
}
