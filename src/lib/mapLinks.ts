import type { ItineraryItem, TransportMode } from '../types'

type Coordinates = {
  lat: number
  lng: number
}

const coordinatePattern = '(-?\\d+(?:\\.\\d+)?)\\s*,\\s*(-?\\d+(?:\\.\\d+)?)'
const explicitCoordinatePatterns = [
  new RegExp(`[?&](?:ll|query|q)=${coordinatePattern}`, 'i'),
  new RegExp(`@${coordinatePattern}`, 'i'),
  new RegExp(`!3d(-?\\d+(?:\\.\\d+)?)!4d(-?\\d+(?:\\.\\d+)?)`, 'i'),
]

export function parseCoordinatesFromMapLink(text: string): Coordinates | null {
  const trimmed = text.trim()
  if (!trimmed) {
    return null
  }

  const decoded = safeDecode(trimmed)

  for (const pattern of explicitCoordinatePatterns) {
    const match = decoded.match(pattern)
    if (!match) {
      continue
    }

    const coordinates = normalizeCoordinates(match[1], match[2])
    if (coordinates) {
      return coordinates
    }
  }

  return normalizeCoordinatesFromWholeText(decoded)
}

export function buildAppleMapsUrl(item: ItineraryItem) {
  const label = item.locationName || item.address || item.title
  if (hasValidCoordinates(item)) {
    return `https://maps.apple.com/?ll=${item.lat},${item.lng}&q=${encodeURIComponent(label)}`
  }

  return `https://maps.apple.com/?q=${encodeURIComponent(label)}`
}

export function buildGoogleMapsUrl(item: ItineraryItem) {
  if (hasValidCoordinates(item)) {
    return `https://www.google.com/maps/search/?api=1&query=${item.lat},${item.lng}`
  }

  const query = item.locationName || item.address || item.title
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

export function buildAppleMapsDirectionsUrl(
  fromItem: ItineraryItem,
  toItem: ItineraryItem,
  mode?: TransportMode,
) {
  const origin = getDirectionsPoint(fromItem)
  const destination = getDirectionsPoint(toItem)
  if (!origin || !destination) {
    return null
  }

  const params = [`saddr=${origin}`, `daddr=${destination}`]
  const appleMode = mapAppleDirectionsMode(mode)
  if (appleMode) {
    params.push(`dirflg=${appleMode}`)
  }

  return `https://maps.apple.com/?${params.join('&')}`
}

export function buildGoogleMapsDirectionsUrl(
  fromItem: ItineraryItem,
  toItem: ItineraryItem,
  mode?: TransportMode,
) {
  const origin = getDirectionsPoint(fromItem)
  const destination = getDirectionsPoint(toItem)
  if (!origin || !destination) {
    return null
  }

  const params = ['api=1', `origin=${origin}`, `destination=${destination}`]
  const googleMode = mapGoogleDirectionsMode(mode)
  if (googleMode) {
    params.push(`travelmode=${googleMode}`)
  }

  return `https://www.google.com/maps/dir/?${params.join('&')}`
}

export function hasValidCoordinates(item: ItineraryItem) {
  return (
    typeof item.lat === 'number' &&
    typeof item.lng === 'number' &&
    Number.isFinite(item.lat) &&
    Number.isFinite(item.lng) &&
    item.lat >= -90 &&
    item.lat <= 90 &&
    item.lng >= -180 &&
    item.lng <= 180
  )
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function normalizeCoordinates(latValue: string, lngValue: string): Coordinates | null {
  const lat = Number(latValue)
  const lng = Number(lngValue)

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null
  }

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null
  }

  return { lat, lng }
}

function normalizeCoordinatesFromWholeText(text: string) {
  const exactMatch = text.match(new RegExp(`^\\s*${coordinatePattern}\\s*$`, 'i'))
  if (!exactMatch) {
    return null
  }

  return normalizeCoordinates(exactMatch[1], exactMatch[2])
}

function getDirectionsPoint(item: ItineraryItem) {
  if (hasValidCoordinates(item)) {
    return `${item.lat},${item.lng}`
  }

  const textPoint = item.address?.trim() || item.locationName?.trim()
  return textPoint ? encodeURIComponent(textPoint) : null
}

function mapAppleDirectionsMode(mode?: TransportMode) {
  if (mode === 'walk') {
    return 'w'
  }

  if (mode === 'transit' || mode === 'bus' || mode === 'train') {
    return 'r'
  }

  if (mode === 'car') {
    return 'd'
  }

  return null
}

function mapGoogleDirectionsMode(mode?: TransportMode) {
  if (mode === 'walk') {
    return 'walking'
  }

  if (mode === 'transit' || mode === 'bus' || mode === 'train') {
    return 'transit'
  }

  if (mode === 'car') {
    return 'driving'
  }

  return null
}
