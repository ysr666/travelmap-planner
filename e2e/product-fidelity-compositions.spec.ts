import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import productFidelityFixture from './fixtures/product-fidelity-v1.json' with { type: 'json' }
import {
  clearTravelDatabase,
  expectNoHorizontalOverflow,
  mockMapStyle,
  seedRouteCacheRecords,
  seedTravelObjectRuntimeContext,
  seedTravelRecords,
} from './helpers'

test.use({ colorScheme: 'light', locale: 'zh-CN', timezoneId: 'Europe/London' })

const captureCompositions = process.env.CAPTURE_PRODUCT_FIDELITY_COMPOSITIONS === '1'
const outputDirectory = resolve('output/playwright/product-fidelity-compositions')
const records = productFidelityFixture.records
const trip = records.trips[0]

test.beforeEach(async ({ page }) => {
  await mockMapStyle(page)
})

test('出发前今日使用航班、住宿、保险和必要天气组成首屏', async ({ page }) => {
  const providerRequests = trackUnexpectedProviderRequests(page)
  await seedProductFidelity(page, productFidelityFixture.scenarios.predeparture.fixedNow)
  await page.goto(productFidelityFixture.scenarios.predeparture.route, { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })

  await expect(page.getByTestId('today-upcoming')).toBeVisible()
  await expect(page.getByText('PVG → LHR', { exact: true })).toBeVisible()
  await expect(page.getByText('CA849', { exact: true })).toBeVisible()
  await expect(page.getByText('Washington Mayfair Hotel', { exact: true })).toBeVisible()
  await expect(page.getByText('安联境外旅行保险', { exact: true })).toBeVisible()
  await expect(page.locator('[data-brand-code="CA"]')).toBeVisible()
  await expect(page.locator('[data-brand-code="ALLIANZ"]')).toBeVisible()
  await expect(page.getByTestId('today-weather-fact')).toBeVisible()
  await expect(page.getByTestId('today-map')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
  await capture(page, 'today-predeparture-390x844.png')
  expect(providerRequests.count).toBe(0)
})

test('旅行中今日以真实地点媒体、票据和单一导航动作构成首屏', async ({ page }) => {
  const providerRequests = trackUnexpectedProviderRequests(page)
  await seedProductFidelity(page, productFidelityFixture.scenarios.activeToday.fixedNow)
  await seedRouteCacheRecords(page, [buildActiveTodayRouteCacheEntry()])
  await page.goto(productFidelityFixture.scenarios.activeToday.route, { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })

  const hero = page.getByTestId('today-active-hero')
  await expect(hero).toBeVisible()
  await expect(hero.getByRole('heading', { exact: true, name: '爱丁堡城堡' })).toBeVisible()
  await expect(hero.locator('[data-media-state="ready"]')).toBeVisible({ timeout: 15_000 })
  await expect(hero.getByText('爱丁堡城堡门票', { exact: true })).toBeVisible()
  await expect(hero.getByRole('link', { exact: true, name: '开始导航' })).toHaveCount(1)
  await expect(page.getByTestId('day-map-marker')).toHaveCount(3)
  await expectNoHorizontalOverflow(page)
  await capture(page, 'today-active-390x844.png')
  expect(providerRequests.count).toBe(0)
})

test('行程页使用带媒体的连续时间线和结构化票据状态', async ({ page }) => {
  const providerRequests = trackUnexpectedProviderRequests(page)
  await seedProductFidelity(page, productFidelityFixture.scenarios.itinerary.fixedNow)
  await page.goto(productFidelityFixture.scenarios.itinerary.route, { waitUntil: 'domcontentloaded' })

  const timeline = page.getByTestId('day-timeline')
  await expect(timeline).toBeVisible()
  await expect(timeline.getByTestId('day-timeline-item')).toHaveCount(4)
  await expect(timeline.locator('[data-media-state="ready"]')).toHaveCount(4, { timeout: 15_000 })
  await expect(timeline.getByText('大英博物馆', { exact: true })).toBeVisible()
  await expect(timeline.getByRole('heading', { exact: true, name: 'Dishoom Covent Garden' })).toBeVisible()
  await expect(timeline.getByText('伦敦塔桥', { exact: true })).toBeVisible()
  await expect(timeline.getByText('乘火车前往爱丁堡', { exact: true })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await capture(page, 'itinerary-390x844.png')
  expect(providerRequests.count).toBe(0)
})

test('资料页使用真实预览、对象元数据和关联状态', async ({ page }) => {
  const providerRequests = trackUnexpectedProviderRequests(page)
  await seedProductFidelity(page, productFidelityFixture.scenarios.documents.fixedNow)
  await page.goto(productFidelityFixture.scenarios.documents.route, { waitUntil: 'domcontentloaded' })

  const gallery = page.getByTestId('ticket-gallery')
  await expect(gallery).toBeVisible()
  await expect(gallery.getByTestId('ticket-card')).toHaveCount(records.ticketMetas.length)
  await expect(gallery.locator('[data-media-state="ready"]')).toHaveCount(4, { timeout: 15_000 })
  await expect(gallery.getByText('门票 · 2026-08-18 · 11:00', { exact: true })).toBeVisible()
  await expect(gallery.getByText('已关联行程', { exact: true }).first()).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await capture(page, 'documents-390x844.png')
  expect(providerRequests.count).toBe(0)
})

test('地点详情复用同一真实媒体、状态和票据直达能力', async ({ page }) => {
  const providerRequests = trackUnexpectedProviderRequests(page)
  await seedProductFidelity(page, productFidelityFixture.scenarios.activeToday.fixedNow)
  await page.goto(`/#/item?tripId=${trip.id}&dayId=day_uk_07&itemId=item_edinburgh_castle&view=schedule`, { waitUntil: 'domcontentloaded' })

  await expect(page.getByTestId('item-detail-page')).toBeVisible()
  await expect(page.locator('.item-detail-media[data-media-state="ready"]')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('heading', { exact: true, name: '爱丁堡城堡' })).toBeVisible()
  await expect(page.getByRole('link', { exact: true, name: '开始导航' })).toHaveCount(1)
  await expect(page.getByRole('button', { exact: true, name: '打开票据' })).toHaveCount(1)
  await expectNoHorizontalOverflow(page)
  await capture(page, 'item-detail-390x844.png')
  expect(providerRequests.count).toBe(0)
})

async function seedProductFidelity(page: Page, fixedNow: string) {
  await page.clock.setFixedTime(new Date(fixedNow))
  await clearTravelDatabase(page)
  await seedTravelRecords(page, {
    days: records.days,
    itineraryItems: records.itineraryItems,
    ticketMetas: records.ticketMetas,
    transportBookings: records.transportBookings,
    transportSegments: records.transportSegments,
    trips: records.trips,
  })
  await seedTravelObjectRuntimeContext(page, {
    insurancePolicies: records.insurancePolicies,
    lodgingReservations: records.lodgingReservations,
    mediaAssets: records.mediaAssets,
    realtimeFacts: records.realtimeFacts,
    tripId: trip.id,
  })
}

function trackUnexpectedProviderRequests(page: Page) {
  const state = { count: 0 }
  void page.route('**/api/provider-proxy', (route) => {
    state.count += 1
    return route.abort()
  })
  return state
}

async function capture(page: Page, fileName: string) {
  if (!captureCompositions) return
  await mkdir(outputDirectory, { recursive: true })
  await page.screenshot({
    animations: 'disabled',
    caret: 'hide',
    path: resolve(outputDirectory, fileName),
  })
}

function buildActiveTodayRouteCacheEntry() {
  const day = records.days.find((candidate) => candidate.id === 'day_uk_07')!
  const items = records.itineraryItems
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
    trip.id,
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
    tripId: trip.id,
    updatedAt: now,
    warnings: [],
  }
}
