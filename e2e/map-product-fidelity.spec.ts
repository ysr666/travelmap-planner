import { expect, test, type Page } from '@playwright/test'
import productFidelityFixture from './fixtures/product-fidelity-v1.json' with { type: 'json' }
import {
  clearTravelDatabase,
  expectNoHorizontalOverflow,
  mockMapStyle,
  seedRouteCacheRecords,
  seedTravelRecords,
  setRouteProxyConfig,
} from './helpers'

test.use({ colorScheme: 'light', locale: 'zh-CN', timezoneId: 'Europe/London' })

const trip = productFidelityFixture.records.trips[0]
const day = productFidelityFixture.records.days.find((candidate) => candidate.id === productFidelityFixture.routeScenario.dayId)!
const dayItems = productFidelityFixture.records.itineraryItems
  .filter((item) => item.dayId === day.id)
  .sort((first, second) => first.sortOrder - second.sortOrder)
const roadLineStrings = productFidelityFixture.routeScenario.lineStrings

test.beforeEach(async ({ page }) => {
  await mockMapStyle(page)
})

test('产品地图使用道路几何、活动路段、当前位置和单一地点 Sheet', async ({ page, context }) => {
  let providerRequests = 0
  await page.route('**/api/provider-proxy', (route) => {
    providerRequests += 1
    void route.abort()
  })
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({
    latitude: productFidelityFixture.routeScenario.userLocation[1],
    longitude: productFidelityFixture.routeScenario.userLocation[0],
  })
  await seedProductMap(page)
  await seedRouteCacheRecords(page, [buildRoadCacheEntry()])

  await page.goto(`/#/day?tripId=${trip.id}&dayId=${day.id}&view=map`, { waitUntil: 'domcontentloaded' })

  const map = page.locator('[data-route-source]')
  await expect(map).toHaveAttribute('data-route-source', 'road')
  await expect(map).toHaveAttribute('data-active-route-kind', 'walk')
  await expect(page.getByTestId('map-route-status')).toHaveAttribute('data-route-state', 'road')
  await expect(page.getByTestId('map-route-status-label')).toHaveText('道路路线')
  await expect(page.getByTestId('day-map-marker')).toHaveCount(3)
  await expect(page.getByTestId('day-map-route-direction')).toHaveCount(2)
  await expectMapCanvasNonBlank(page)

  await page.getByRole('button', { name: /选择 爱丁堡城堡/ }).click()
  const sheet = page.getByTestId('map-marker-card')
  await expect(sheet).toBeVisible()
  await expect(sheet).toContainText('8月18日 · 第 1/3 站')
  await expect(sheet).toContainText('步行 16 分钟')
  await expect(sheet).toContainText('1 张票据')
  await expect(sheet.getByTestId('map-marker-card-navigate')).toHaveAttribute('href', /google\.com\/maps/)
  await expect(sheet.getByTestId('map-marker-card-tickets')).toBeVisible()
  await expectMapOverlaysDoNotOverlap(page)

  await page.getByTestId('map-user-location-button').click()
  await expect(page.getByTestId('map-user-location-marker')).toBeVisible()
  await expect(page.getByTestId('map-location-notice')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
  if (process.env.CAPTURE_PRODUCT_FIDELITY_MAP === '1') {
    await page.screenshot({
      animations: 'disabled',
      path: 'output/playwright/product-fidelity-map/map-390x844.png',
    })
  }
  expect(providerRequests).toBe(0)

  await sheet.getByTestId('map-marker-card-tickets').click()
  await expect(page).toHaveURL(/#\/documents\?.*ticketId=ticket_edinburgh_castle/)
  await expect(page.getByTestId('ticket-preview')).toBeVisible()
})

test('路线只在用户点击后重算，失败保留估算并可再次成功', async ({ page }) => {
  let routeRequests = 0
  await page.route('**/api/provider-proxy', async (route) => {
    const body = route.request().postDataJSON() as {
      coordinates?: Array<[number, number]>
      operation?: string
      segments?: Array<{
        fromCoordinateIndex: number
        fromItemId: string
        segmentIndex: number
        toCoordinateIndex: number
        toItemId: string
      }>
    }
    if (body.operation !== 'route_preview') {
      await route.abort()
      return
    }
    routeRequests += 1
    if (routeRequests === 1) {
      await route.fulfill({
        body: JSON.stringify({
          error: { code: 'provider_error', message: 'fixture route unavailable' },
          ok: false,
          operation: 'route_preview',
        }),
        contentType: 'application/json',
        status: 503,
      })
      return
    }

    const coordinates = body.coordinates ?? []
    const segments = (body.segments ?? []).map((segment) => {
      const from = coordinates[segment.fromCoordinateIndex]
      const to = coordinates[segment.toCoordinateIndex]
      const midpoint: [number, number] = [
        (from[0] + to[0]) / 2 + 0.0007,
        (from[1] + to[1]) / 2 + 0.0004,
      ]
      return {
        coordinates: [from, midpoint, to],
        distanceMeters: 1100,
        durationSeconds: 780,
        fromItemId: segment.fromItemId,
        segmentIndex: segment.segmentIndex,
        toItemId: segment.toItemId,
      }
    })
    await route.fulfill({
      body: JSON.stringify({
        ok: true,
        operation: 'route_preview',
        provider: 'openrouteservice',
        route: {
          lineStrings: segments.map((segment) => segment.coordinates),
          segments,
          status: 'road',
          warnings: [],
        },
      }),
      contentType: 'application/json',
    })
  })
  await seedProductMap(page)
  await setRouteProxyConfig(page)
  await page.goto(`/#/day?tripId=${trip.id}&dayId=${day.id}&view=map`, { waitUntil: 'domcontentloaded' })

  const routeStatus = page.getByTestId('map-route-status')
  await expect(routeStatus).toHaveAttribute('data-route-state', 'estimate')
  await expect(page.locator('[data-route-source]')).toHaveAttribute('data-route-source', 'sequence')
  expect(routeRequests).toBe(0)

  await routeStatus.click()
  await expect(page.getByTestId('map-route-status-label')).toHaveText('道路路线暂不可用')
  await expect(page.locator('[data-route-source]')).toHaveAttribute('data-route-source', 'sequence')
  await expect(page.getByTestId('map-location-notice')).toContainText('已保留当前显示')
  expect(routeRequests).toBe(1)

  await routeStatus.click()
  await expect(page.getByTestId('map-route-status-label')).toHaveText('道路路线')
  await expect(page.locator('[data-route-source]')).toHaveAttribute('data-route-source', 'road')
  await expect(page.locator('[data-active-route-kind="walk"]')).toBeVisible()
  expect(routeRequests).toBe(2)
  await expectNoHorizontalOverflow(page)
})

async function seedProductMap(page: Page) {
  await clearTravelDatabase(page)
  await seedTravelRecords(page, {
    days: productFidelityFixture.records.days,
    itineraryItems: productFidelityFixture.records.itineraryItems,
    ticketMetas: productFidelityFixture.records.ticketMetas,
    trips: productFidelityFixture.records.trips,
  })
}

function buildRoadCacheEntry() {
  const coordinateKey = dayItems.map((item) => [
    item.id,
    item.lat,
    item.lng,
    item.sortOrder,
    item.startTime ?? '',
  ].join(':')).join('|')
  const modeKey = dayItems.slice(1).map((item, index) => [
    dayItems[index].id,
    item.id,
    item.previousTransportMode ?? item.transportMode ?? 'unknown',
    item.previousTransportMode === 'walk' ? 'foot-walking' : 'driving-car',
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
    lineStrings: roadLineStrings,
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

async function expectMapCanvasNonBlank(page: Page) {
  const canvas = page.locator('[data-route-source] canvas').first()
  await expect(canvas).toBeVisible()
  const screenshot = await canvas.screenshot({ animations: 'disabled' })
  const stats = await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (value) => value.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const sample = document.createElement('canvas')
    sample.width = bitmap.width
    sample.height = bitmap.height
    const context = sample.getContext('2d')
    if (!context) return { colors: 0, painted: 0 }
    context.drawImage(bitmap, 0, 0)
    const pixels = context.getImageData(0, 0, sample.width, sample.height).data
    const colors = new Set<string>()
    let painted = 0
    for (let index = 0; index < pixels.length; index += 16) {
      const alpha = pixels[index + 3]
      if (alpha === 0) continue
      painted += 1
      colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]},${alpha}`)
      if (colors.size > 24) break
    }
    bitmap.close()
    return { colors: colors.size, painted }
  }, screenshot.toString('base64'))

  expect(stats.painted).toBeGreaterThan(20)
  expect(stats.colors).toBeGreaterThan(1)
}

async function expectMapOverlaysDoNotOverlap(page: Page) {
  const boxes = await page.evaluate(() => {
    const box = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector)
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return { bottom: rect.bottom, left: rect.left, right: rect.right, top: rect.top }
    }
    return {
      daySelector: box('[data-testid="day-selector"]'),
      locationControl: box('[data-testid="map-user-location-button"]'),
      routeStatus: box('[data-testid="map-route-status"]'),
      sheet: box('[data-testid="map-marker-card"]'),
    }
  })

  expect(boxes.daySelector).not.toBeNull()
  expect(boxes.locationControl).not.toBeNull()
  expect(boxes.routeStatus).not.toBeNull()
  expect(boxes.sheet).not.toBeNull()
  if (!boxes.daySelector || !boxes.locationControl || !boxes.routeStatus || !boxes.sheet) return
  expect(boxes.routeStatus.top).toBeGreaterThanOrEqual(boxes.daySelector.bottom - 1)
  expect(boxes.routeStatus.right).toBeLessThanOrEqual(boxes.locationControl.left - 4)
  expect(boxes.routeStatus.bottom).toBeLessThanOrEqual(boxes.sheet.top - 8)
  expect(boxes.locationControl.bottom).toBeLessThanOrEqual(boxes.sheet.top - 8)
}
