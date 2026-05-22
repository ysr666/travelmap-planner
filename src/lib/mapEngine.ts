export type LngLat = [number, number]

export type LngLatBounds = [LngLat, LngLat]

export type EdgeInsets = {
  top: number
  right: number
  bottom: number
  left: number
}

export type MapPadding = number | EdgeInsets

export type CameraState = {
  center: LngLat
  zoom: number
  bearing: number
  pitch: number
}

export type FitBoundsOptions = {
  padding?: MapPadding
  maxZoom?: number
  duration?: number
}

export type MapInitOptions = {
  center: LngLat
  interactive?: boolean
  zoom: number
  style?: string | Record<string, unknown>
}

export type MapEventType = 'load' | 'idle' | 'error' | 'moveend' | 'resize' | 'zoom'

export type MarkerHandle = {
  setLngLat(lngLat: LngLat): void
  remove(): void
}

export interface MapInstance {
  remove(): void
  resize(): void
  flyTo(center: LngLat, zoom: number, duration?: number): void
  fitBounds(bounds: LngLatBounds, options?: FitBoundsOptions): void
  easeTo(center: LngLat, zoom: number, duration?: number): void
  jumpTo(camera: Partial<CameraState>): void
  getCamera(): CameraState
  addMarker(lngLat: LngLat, element: HTMLElement): MarkerHandle
  setRouteLine(lineStrings: LngLat[][]): void
  setRouteVisibility(visible: boolean): void
  waitForIdle(): Promise<'idle' | 'timeout'>
  on(event: MapEventType, handler: () => void): void
  off(event: MapEventType, handler: () => void): void
  once(event: MapEventType, handler: () => void): void
}

export type MapEngineType = 'google' | 'maplibre'

export interface MapEngineAdapter {
  type: MapEngineType
  createMap(container: HTMLElement, options: MapInitOptions): MapInstance
}
