import { describe, expect, it } from 'vitest'
import {
  USER_LOCATION_DISTANCE_THRESHOLD_METERS,
  buildDayMapViewportPlan,
  getDistanceMeters,
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

  it('uses the documented 40 km threshold boundary', () => {
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
      userLocation: [140.45, 35.89],
    }).excludedUserLocationForDistance).toBe(true)
  })
})
