import type { Page } from '@playwright/test'
import productFidelityFixture from './fixtures/product-fidelity-v1.json' with { type: 'json' }
import {
  clearTravelDatabase,
  seedTravelObjectRuntimeContext,
  seedTravelRecords,
} from './helpers'

export { productFidelityFixture }
export const productFidelityRecords = productFidelityFixture.records
export const productFidelityTrip = productFidelityRecords.trips[0]

export async function seedProductFidelity(page: Page, fixedNow: string) {
  await page.clock.setFixedTime(new Date(fixedNow))
  await seedProductFidelityData(page)
}

export async function seedProductFidelityData(page: Page) {
  await clearTravelDatabase(page)
  await seedTravelRecords(page, {
    days: productFidelityRecords.days,
    itineraryItems: productFidelityRecords.itineraryItems,
    ticketMetas: productFidelityRecords.ticketMetas,
    transportBookings: productFidelityRecords.transportBookings,
    transportSegments: productFidelityRecords.transportSegments,
    trips: productFidelityRecords.trips,
  })
  await seedTravelObjectRuntimeContext(page, {
    insurancePolicies: productFidelityRecords.insurancePolicies,
    lodgingReservations: productFidelityRecords.lodgingReservations,
    mediaAssets: productFidelityRecords.mediaAssets,
    realtimeFacts: productFidelityRecords.realtimeFacts,
    tripId: productFidelityTrip.id,
  })
}

export function trackUnexpectedProviderRequests(page: Page) {
  const state = { count: 0 }
  void page.route('**/api/provider-proxy', (route) => {
    state.count += 1
    return route.abort()
  })
  return state
}

export function buildProductFidelityRouteCacheEntry() {
  const day = productFidelityRecords.days.find((candidate) => candidate.id === 'day_uk_07')!
  const items = productFidelityRecords.itineraryItems
    .filter((item) => item.dayId === day.id)
    .sort((left, right) => left.sortOrder - right.sortOrder)
  const coordinateKey = items.map((item) => [
    item.id,
    item.lat,
    item.lng,
    item.sortOrder,
    item.startTime ?? '',
  ].join(':')).join('|')
  const modeKey = items.slice(1).map((item, index) => [
    items[index].id,
    item.id,
    item.previousTransportMode ?? item.transportMode ?? 'unknown',
    'foot-walking',
  ].join(':')).join('|')
  const signature = [
    'route-cache',
    1,
    'day-map',
    'openrouteservice',
    productFidelityTrip.id,
    day.id,
    coordinateKey,
    modeKey,
  ].join('::')
  const now = '2026-08-18T09:31:00.000Z'
  return {
    coordinateKey,
    createdAt: now,
    dayId: day.id,
    distanceMeters: 2250,
    durationSeconds: 1800,
    id: signature,
    lastUsedAt: now,
    lineStrings: productFidelityFixture.routeScenario.lineStrings,
    modeKey,
    provider: 'openrouteservice',
    routingVersion: 1,
    scope: 'day-map',
    signature,
    sizeBytes: 1024,
    status: 'road',
    tripId: productFidelityTrip.id,
    updatedAt: now,
    warnings: [],
  }
}
