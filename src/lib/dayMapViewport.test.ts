import { describe, expect, it } from 'vitest'
import {
  USER_LOCATION_DISTANCE_THRESHOLD_METERS,
  buildSafeScreenRect,
  buildDayMapViewportPlan,
  getDistanceMeters,
  getMarkerFocusCorrection,
  normalizeEdgeInsets,
  normalizeLngLat,
} from './dayMapViewport'
import type { LngLat } from './routing'

describe('day map viewport helpers', () => {
  it('filters invalid coordinates and returns an empty plan when nothing is usable', () => {
    const plan = buildDayMapViewportPlan({
      itineraryCoordinates: [
        [Number.NaN, 35],
        [181, 35],
        [139, 91],
      ] as LngLat[],
    })

    expect(plan).toEqual({
      bounds: null,
      center: null,
      excludedUserLocationForDistance: false,
      includedUserLocation: false,
      usedItineraryPoints: false,
      zoom: null,
    })
    expect(normalizeLngLat([139.7, 35.6])).toEqual([139.7, 35.6])
  })

  it('centers a single itinerary coordinate', () => {
    const plan = buildDayMapViewportPlan({
      itineraryCoordinates: [[139.7006, 35.6896]],
    })

    expect(plan.usedItineraryPoints).toBe(true)
    expect(plan.center).toEqual([139.7006, 35.6896])
    expect(plan.bounds).toBeNull()
    expect(plan.zoom).toBe(14)
  })

  it('pads tiny or identical multi-point bounds', () => {
    const plan = buildDayMapViewportPlan({
      itineraryCoordinates: [
        [139.7006, 35.6896],
        [139.7006, 35.6896],
      ],
    })

    expect(plan.bounds).not.toBeNull()
    const bounds = plan.bounds
    if (!bounds) {
      throw new Error('expected bounds')
    }
    expect(bounds[1][0] - bounds[0][0]).toBeCloseTo(0.003)
    expect(bounds[1][1] - bounds[0][1]).toBeCloseTo(0.003)
  })

  it('uses user location when there are no itinerary coordinates', () => {
    const plan = buildDayMapViewportPlan({
      itineraryCoordinates: [],
      userLocation: [139.76, 35.68],
    })

    expect(plan.usedItineraryPoints).toBe(false)
    expect(plan.includedUserLocation).toBe(true)
    expect(plan.center).toEqual([139.76, 35.68])
  })

  it('includes nearby user location in itinerary bounds', () => {
    const plan = buildDayMapViewportPlan({
      itineraryCoordinates: [
        [139.7006, 35.6896],
        [139.704, 35.692],
      ],
      userLocation: [139.71, 35.69],
    })

    expect(plan.usedItineraryPoints).toBe(true)
    expect(plan.includedUserLocation).toBe(true)
    expect(plan.excludedUserLocationForDistance).toBe(false)
    expect(plan.bounds?.[1][0]).toBeGreaterThanOrEqual(139.71)
  })

  it('excludes user location beyond the distance threshold', () => {
    const plan = buildDayMapViewportPlan({
      itineraryCoordinates: [
        [139.7006, 35.6896],
        [139.704, 35.692],
      ],
      userLocation: [135.5023, 34.6937],
    })

    expect(plan.usedItineraryPoints).toBe(true)
    expect(plan.includedUserLocation).toBe(false)
    expect(plan.excludedUserLocationForDistance).toBe(true)
    expect(plan.bounds?.[0][0]).toBeGreaterThan(139)
  })

  it('uses the documented 80 km threshold boundary', () => {
    const tokyo: LngLat = [139.7671, 35.6812]
    const nearbyTokyo: LngLat = [139.97, 35.79]
    const distance = getDistanceMeters(tokyo, nearbyTokyo)

    expect(distance).toBeLessThan(USER_LOCATION_DISTANCE_THRESHOLD_METERS)
    expect(buildDayMapViewportPlan({
      itineraryCoordinates: [tokyo],
      userLocation: nearbyTokyo,
    }).includedUserLocation).toBe(true)

    expect(buildDayMapViewportPlan({
      itineraryCoordinates: [tokyo],
      userLocation: [140.4749, 36.3414],
    }).excludedUserLocationForDistance).toBe(true)
  })

  it('includes user location within 40 km (inside 80 km threshold)', () => {
    const tokyo: LngLat = [139.7671, 35.6812]
    const hachioji: LngLat = [139.3261, 35.6558]
    const distance = getDistanceMeters(tokyo, hachioji)

    expect(distance).toBeGreaterThan(30_000)
    expect(distance).toBeLessThan(80_000)
    expect(buildDayMapViewportPlan({
      itineraryCoordinates: [tokyo],
      userLocation: hachioji,
    }).includedUserLocation).toBe(true)
  })

  it('includes user location between 40 km and 80 km', () => {
    const tokyo: LngLat = [139.7671, 35.6812]
    const odawara: LngLat = [139.1967, 35.2561]
    const distance = getDistanceMeters(tokyo, odawara)

    expect(distance).toBeGreaterThan(40_000)
    expect(distance).toBeLessThan(80_000)
    expect(buildDayMapViewportPlan({
      itineraryCoordinates: [tokyo],
      userLocation: odawara,
    }).includedUserLocation).toBe(true)
  })

  it('excludes user location beyond 80 km', () => {
    const tokyo: LngLat = [139.7671, 35.6812]
    const mito: LngLat = [140.4749, 36.3414]
    const distance = getDistanceMeters(tokyo, mito)

    expect(distance).toBeGreaterThan(80_000)
    expect(buildDayMapViewportPlan({
      itineraryCoordinates: [tokyo],
      userLocation: mito,
    }).excludedUserLocationForDistance).toBe(true)
  })

  it('keeps a marker inside the safe rect without camera correction', () => {
    const correction = getMarkerFocusCorrection({
      currentZoom: 13,
      markerRect: rect({ left: 180, top: 260, width: 44, height: 44 }),
      padding: { top: 88, right: 72, bottom: 180, left: 24 },
      viewportRect: rect({ left: 0, top: 0, width: 390, height: 640 }),
    })

    expect(correction.shouldMove).toBe(false)
    expect(correction.reason).toBe('already-visible')
  })

  it('recommends correction when a marker is hidden by the bottom inset', () => {
    const correction = getMarkerFocusCorrection({
      currentZoom: 13,
      markerRect: rect({ left: 180, top: 500, width: 44, height: 44 }),
      padding: { top: 72, right: 72, bottom: 180, left: 24 },
      viewportRect: rect({ left: 0, top: 0, width: 390, height: 640 }),
    })

    expect(correction.shouldMove).toBe(true)
    expect(correction.reason).toBe('outside-safe-area')
    expect(correction.safeRect.bottom).toBe(460)
  })

  it('uses mild minimum zoom only when marker context is too far out', () => {
    const correction = getMarkerFocusCorrection({
      currentZoom: 8.5,
      markerRect: rect({ left: 180, top: 260, width: 44, height: 44 }),
      padding: { top: 72, right: 72, bottom: 160, left: 24 },
      viewportRect: rect({ left: 0, top: 0, width: 390, height: 640 }),
    })

    expect(correction.shouldMove).toBe(true)
    expect(correction.reason).toBe('zoom-too-low')
    expect(correction.nextZoom).toBe(13.25)
  })

  it('normalizes missing measured insets with conservative fallbacks', () => {
    expect(normalizeEdgeInsets({ bottom: 188 }, { top: 80, right: 64, bottom: 150, left: 20 })).toEqual({
      top: 80,
      right: 64,
      bottom: 188,
      left: 20,
    })
    expect(normalizeEdgeInsets(48)).toEqual({
      top: 48,
      right: 48,
      bottom: 48,
      left: 48,
    })
  })

  it('keeps a usable safe rect even when overlays consume most of the viewport', () => {
    const safeRect = buildSafeScreenRect(
      rect({ left: 0, top: 0, width: 390, height: 240 }),
      { top: 120, right: 24, bottom: 150, left: 24 },
    )

    expect(safeRect.height).toBeGreaterThanOrEqual(96)
    expect(safeRect.width).toBeGreaterThanOrEqual(96)
  })
})

function rect({
  left,
  top,
  width,
  height,
}: {
  left: number
  top: number
  width: number
  height: number
}) {
  return {
    top,
    right: left + width,
    bottom: top + height,
    left,
    width,
    height,
  }
}
