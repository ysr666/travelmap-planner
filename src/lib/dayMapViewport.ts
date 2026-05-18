import type { LngLatBounds } from './mapEngine'
import type { LngLat } from './routing'

export const USER_LOCATION_DISTANCE_THRESHOLD_METERS = 40_000

const EARTH_RADIUS_METERS = 6_371_000
const MIN_MULTI_POINT_SPAN_DEGREES = 0.003

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
