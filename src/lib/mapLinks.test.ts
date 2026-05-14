import { describe, expect, it } from 'vitest'
import {
  buildAppleMapsDirectionsUrl,
  buildAppleMapsUrl,
  buildGoogleMapsDirectionsUrl,
  buildGoogleMapsUrl,
  hasValidCoordinates,
  parseCoordinatesFromMapLink,
} from './mapLinks'
import type { ItineraryItem } from '../types'

function makeItem(overrides: Partial<ItineraryItem> = {}): ItineraryItem {
  return {
    id: 'item-1',
    tripId: 'trip-1',
    dayId: 'day-1',
    title: 'Test Place',
    sortOrder: 0,
    ticketIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

describe('parseCoordinatesFromMapLink', () => {
  it('parses ll= parameter', () => {
    expect(parseCoordinatesFromMapLink('https://maps.google.com/?ll=35.6585,139.7020')).toEqual({
      lat: 35.6585,
      lng: 139.7020,
    })
  })

  it('parses query= parameter', () => {
    expect(parseCoordinatesFromMapLink('https://maps.google.com/?query=35.6585,139.7020')).toEqual({
      lat: 35.6585,
      lng: 139.7020,
    })
  })

  it('parses @lat,lng format', () => {
    expect(parseCoordinatesFromMapLink('https://www.google.com/maps/@35.6585,139.7020,15z')).toEqual({
      lat: 35.6585,
      lng: 139.7020,
    })
  })

  it('parses !3d!4d format', () => {
    expect(parseCoordinatesFromMapLink('https://www.google.com/maps/place/.../!3d35.6585!4d139.7020')).toEqual({
      lat: 35.6585,
      lng: 139.7020,
    })
  })

  it('parses plain coordinates', () => {
    expect(parseCoordinatesFromMapLink('35.6585, 139.7020')).toEqual({ lat: 35.6585, lng: 139.7020 })
  })

  it('returns null for empty input', () => {
    expect(parseCoordinatesFromMapLink('')).toBeNull()
    expect(parseCoordinatesFromMapLink('   ')).toBeNull()
  })

  it('returns null when no coordinates found', () => {
    expect(parseCoordinatesFromMapLink('https://example.com')).toBeNull()
  })

  it('returns null for out-of-range coordinates', () => {
    expect(parseCoordinatesFromMapLink('999,999')).toBeNull()
  })

  it('handles URI-encoded URLs', () => {
    expect(parseCoordinatesFromMapLink('https://maps.google.com/?ll=35.6585%2C139.7020')).toEqual({
      lat: 35.6585,
      lng: 139.7020,
    })
  })
})

describe('hasValidCoordinates', () => {
  it('returns true for valid coordinates', () => {
    expect(hasValidCoordinates(makeItem({ lat: 35.6585, lng: 139.702 }))).toBe(true)
  })

  it('returns false when lat is missing', () => {
    expect(hasValidCoordinates(makeItem({ lng: 139.702 }))).toBe(false)
  })

  it('returns false when lng is missing', () => {
    expect(hasValidCoordinates(makeItem({ lat: 35.6585 }))).toBe(false)
  })

  it('returns false for out-of-range lat', () => {
    expect(hasValidCoordinates(makeItem({ lat: 91, lng: 0 }))).toBe(false)
  })

  it('returns false for out-of-range lng', () => {
    expect(hasValidCoordinates(makeItem({ lat: 0, lng: 181 }))).toBe(false)
  })

  it('returns false for NaN', () => {
    expect(hasValidCoordinates(makeItem({ lat: NaN, lng: 0 }))).toBe(false)
  })
})

describe('buildAppleMapsUrl', () => {
  it('includes coordinates when available', () => {
    const url = buildAppleMapsUrl(makeItem({ lat: 35.6585, lng: 139.702 }))
    expect(url).toContain('ll=35.6585,139.702')
    expect(url).toContain('maps.apple.com')
  })

  it('uses query when no coordinates', () => {
    const url = buildAppleMapsUrl(makeItem({ locationName: 'Tokyo Tower' }))
    expect(url).toContain('q=Tokyo%20Tower')
    expect(url).not.toContain('ll=')
  })
})

describe('buildGoogleMapsUrl', () => {
  it('includes coordinates when available', () => {
    const url = buildGoogleMapsUrl(makeItem({ lat: 35.6585, lng: 139.702 }))
    expect(url).toContain('query=35.6585,139.702')
  })

  it('uses query text when no coordinates', () => {
    const url = buildGoogleMapsUrl(makeItem({ locationName: 'Senso-ji' }))
    expect(url).toContain('query=Senso-ji')
  })
})

describe('buildAppleMapsDirectionsUrl', () => {
  it('builds directions between two items with coordinates', () => {
    const from = makeItem({ id: 'from', lat: 35.0, lng: 139.0 })
    const to = makeItem({ id: 'to', lat: 36.0, lng: 140.0 })
    const url = buildAppleMapsDirectionsUrl(from, to, 'walk')
    expect(url).toContain('saddr=35,139')
    expect(url).toContain('daddr=36,140')
    expect(url).toContain('dirflg=w')
  })

  it('returns null when from has no location', () => {
    const from = makeItem({ id: 'from' })
    const to = makeItem({ id: 'to', lat: 36.0, lng: 140.0 })
    expect(buildAppleMapsDirectionsUrl(from, to)).toBeNull()
  })
})

describe('buildGoogleMapsDirectionsUrl', () => {
  it('builds directions between two items', () => {
    const from = makeItem({ id: 'from', lat: 35.0, lng: 139.0 })
    const to = makeItem({ id: 'to', lat: 36.0, lng: 140.0 })
    const url = buildGoogleMapsDirectionsUrl(from, to, 'car')
    expect(url).toContain('origin=35,139')
    expect(url).toContain('destination=36,140')
    expect(url).toContain('travelmode=driving')
  })

  it('returns null when to has no location', () => {
    const from = makeItem({ id: 'from', lat: 35.0, lng: 139.0 })
    const to = makeItem({ id: 'to' })
    expect(buildGoogleMapsDirectionsUrl(from, to)).toBeNull()
  })
})
