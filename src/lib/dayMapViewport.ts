import type { EdgeInsets, LngLatBounds, MapPadding } from './mapEngine'
import type { LngLat } from './routing'

export const USER_LOCATION_DISTANCE_THRESHOLD_METERS = 40_000
export const DEFAULT_DAY_MAP_PADDING: EdgeInsets = {
  top: 72,
  right: 72,
  bottom: 72,
  left: 72,
}
export const MARKER_FOCUS_COMFORT_ZOOM = 13.25
export const MARKER_FOCUS_LOW_ZOOM_THRESHOLD = 9.5

const EARTH_RADIUS_METERS = 6_371_000
const MIN_MULTI_POINT_SPAN_DEGREES = 0.003
const MIN_SAFE_RECT_SIZE = 96

export type DayMapRecenterResult = {
  usedItineraryPoints: boolean
  includedUserLocation: boolean
  excludedUserLocationForDistance: boolean
}

export type DayMapViewportPlan = DayMapRecenterResult & {
  bounds: LngLatBounds | null
  center: LngLat | null
  zoom: number | null
}

export type ScreenRect = {
  top: number
  right: number
  bottom: number
  left: number
  width: number
  height: number
}

export type MarkerFocusCorrection = {
  shouldMove: boolean
  reason: 'already-visible' | 'outside-safe-area' | 'zoom-too-low' | 'outside-safe-area-and-zoom-too-low'
  safeRect: ScreenRect
  nextZoom: number
}

export function buildDayMapViewportPlan({
  itineraryCoordinates,
  userLocation,
  distanceThresholdMeters = USER_LOCATION_DISTANCE_THRESHOLD_METERS,
}: {
  itineraryCoordinates: Array<LngLat | null | undefined>
  userLocation?: LngLat | null
  distanceThresholdMeters?: number
}): DayMapViewportPlan {
  const validItineraryCoordinates = itineraryCoordinates
    .map(normalizeLngLat)
    .filter((coordinate): coordinate is LngLat => coordinate !== null)
  const validUserLocation = normalizeLngLat(userLocation)

  if (validItineraryCoordinates.length === 0) {
    return {
      bounds: null,
      center: validUserLocation,
      excludedUserLocationForDistance: false,
      includedUserLocation: Boolean(validUserLocation),
      usedItineraryPoints: false,
      zoom: validUserLocation ? 14 : null,
    }
  }

  let includedUserLocation = false
  let excludedUserLocationForDistance = false
  const coordinates = [...validItineraryCoordinates]

  if (validUserLocation) {
    const itineraryCenter = getCoordinateCenter(validItineraryCoordinates)
    const userDistanceMeters = itineraryCenter
      ? getDistanceMeters(itineraryCenter, validUserLocation)
      : Number.POSITIVE_INFINITY

    if (userDistanceMeters <= distanceThresholdMeters) {
      coordinates.push(validUserLocation)
      includedUserLocation = true
    } else {
      excludedUserLocationForDistance = true
    }
  }

  if (coordinates.length === 1) {
    return {
      bounds: null,
      center: coordinates[0],
      excludedUserLocationForDistance,
      includedUserLocation,
      usedItineraryPoints: true,
      zoom: 14,
    }
  }

  return {
    bounds: buildLngLatBounds(coordinates),
    center: null,
    excludedUserLocationForDistance,
    includedUserLocation,
    usedItineraryPoints: true,
    zoom: null,
  }
}

export function normalizeEdgeInsets(
  padding?: MapPadding | Partial<EdgeInsets> | null,
  fallback: MapPadding | Partial<EdgeInsets> = DEFAULT_DAY_MAP_PADDING,
): EdgeInsets {
  const fallbackInsets = typeof fallback === 'number'
    ? {
        top: fallback,
        right: fallback,
        bottom: fallback,
        left: fallback,
      }
    : {
        top: fallback.top ?? DEFAULT_DAY_MAP_PADDING.top,
        right: fallback.right ?? DEFAULT_DAY_MAP_PADDING.right,
        bottom: fallback.bottom ?? DEFAULT_DAY_MAP_PADDING.bottom,
        left: fallback.left ?? DEFAULT_DAY_MAP_PADDING.left,
      }

  if (typeof padding === 'number') {
    return {
      top: padding,
      right: padding,
      bottom: padding,
      left: padding,
    }
  }

  return {
    top: sanitizeInset(padding?.top, fallbackInsets.top),
    right: sanitizeInset(padding?.right, fallbackInsets.right),
    bottom: sanitizeInset(padding?.bottom, fallbackInsets.bottom),
    left: sanitizeInset(padding?.left, fallbackInsets.left),
  }
}

export function buildSafeScreenRect(
  viewportRect: ScreenRect,
  padding?: MapPadding | Partial<EdgeInsets> | null,
): ScreenRect {
  const insets = normalizeEdgeInsets(padding)
  let left = viewportRect.left + insets.left
  let right = viewportRect.right - insets.right
  let top = viewportRect.top + insets.top
  let bottom = viewportRect.bottom - insets.bottom

  if (right - left < MIN_SAFE_RECT_SIZE) {
    const centerX = viewportRect.left + viewportRect.width / 2
    left = centerX - MIN_SAFE_RECT_SIZE / 2
    right = centerX + MIN_SAFE_RECT_SIZE / 2
  }

  if (bottom - top < MIN_SAFE_RECT_SIZE) {
    const centerY = viewportRect.top + viewportRect.height / 2
    top = centerY - MIN_SAFE_RECT_SIZE / 2
    bottom = centerY + MIN_SAFE_RECT_SIZE / 2
  }

  return {
    top,
    right,
    bottom,
    left,
    width: right - left,
    height: bottom - top,
  }
}

export function getMarkerFocusCorrection({
  viewportRect,
  markerRect,
  padding,
  currentZoom,
  comfortMargin = 10,
  lowZoomThreshold = MARKER_FOCUS_LOW_ZOOM_THRESHOLD,
  comfortZoom = MARKER_FOCUS_COMFORT_ZOOM,
}: {
  viewportRect: ScreenRect
  markerRect: ScreenRect
  padding?: MapPadding | Partial<EdgeInsets> | null
  currentZoom: number
  comfortMargin?: number
  lowZoomThreshold?: number
  comfortZoom?: number
}): MarkerFocusCorrection {
  const safeRect = buildSafeScreenRect(viewportRect, padding)
  const outsideSafeArea = (
    markerRect.left < safeRect.left + comfortMargin ||
    markerRect.right > safeRect.right - comfortMargin ||
    markerRect.top < safeRect.top + comfortMargin ||
    markerRect.bottom > safeRect.bottom - comfortMargin
  )
  const zoomTooLow = currentZoom < lowZoomThreshold
  const reason = outsideSafeArea && zoomTooLow
    ? 'outside-safe-area-and-zoom-too-low'
    : outsideSafeArea
      ? 'outside-safe-area'
      : zoomTooLow
        ? 'zoom-too-low'
        : 'already-visible'

  return {
    nextZoom: zoomTooLow ? Math.max(currentZoom, comfortZoom) : currentZoom,
    reason,
    safeRect,
    shouldMove: outsideSafeArea || zoomTooLow,
  }
}

export function normalizeLngLat(coordinate?: LngLat | null): LngLat | null {
  if (!coordinate) {
    return null
  }

  const [lng, lat] = coordinate
  if (!isValidLngLat([lng, lat])) {
    return null
  }

  return [lng, lat]
}

export function isValidLngLat(coordinate: LngLat) {
  const [lng, lat] = coordinate
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lng >= -180 &&
    lng <= 180 &&
    lat >= -90 &&
    lat <= 90
  )
}

export function getDistanceMeters(from: LngLat, to: LngLat) {
  const fromLat = toRadians(from[1])
  const toLat = toRadians(to[1])
  const deltaLat = toRadians(to[1] - from[1])
  const deltaLng = toRadians(to[0] - from[0])

  const halfChord = (
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLng / 2) ** 2
  )
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(halfChord), Math.sqrt(1 - halfChord))
}

function getCoordinateCenter(coordinates: LngLat[]): LngLat | null {
  if (coordinates.length === 0) {
    return null
  }

  const [lngSum, latSum] = coordinates.reduce(
    ([lngTotal, latTotal], [lng, lat]) => [lngTotal + lng, latTotal + lat],
    [0, 0],
  )
  return [lngSum / coordinates.length, latSum / coordinates.length]
}

function buildLngLatBounds(coordinates: LngLat[]): LngLatBounds {
  let minLng = coordinates[0][0]
  let minLat = coordinates[0][1]
  let maxLng = coordinates[0][0]
  let maxLat = coordinates[0][1]

  coordinates.forEach(([lng, lat]) => {
    minLng = Math.min(minLng, lng)
    minLat = Math.min(minLat, lat)
    maxLng = Math.max(maxLng, lng)
    maxLat = Math.max(maxLat, lat)
  })

  const lngPadding = getTinyBoundsPadding(minLng, maxLng)
  const latPadding = getTinyBoundsPadding(minLat, maxLat)

  return [
    [minLng - lngPadding, minLat - latPadding],
    [maxLng + lngPadding, maxLat + latPadding],
  ]
}

function getTinyBoundsPadding(min: number, max: number) {
  const span = max - min
  if (span >= MIN_MULTI_POINT_SPAN_DEGREES) {
    return 0
  }

  return (MIN_MULTI_POINT_SPAN_DEGREES - span) / 2
}

function toRadians(degrees: number) {
  return degrees * (Math.PI / 180)
}

function sanitizeInset(value: number | undefined, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  return Math.max(0, value)
}
