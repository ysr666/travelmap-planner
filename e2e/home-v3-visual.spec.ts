import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import homeVisualFixture from './fixtures/home-v3-visual.json' with { type: 'json' }
import homePredepartureFixture from './fixtures/home-predeparture-v3-visual.json' with { type: 'json' }
import {
  clearTravelDatabase,
  expectNoHorizontalOverflow,
  forceRouteProxyFixture,
  seedRouteCacheRecords,
  seedTravelRecords,
} from './helpers'

test.use({ locale: 'zh-CN', timezoneId: 'Europe/London' })

const captureGoldens = process.env.CAPTURE_UI_V3_GOLDENS === '1'
const useLiveMapStyle = process.env.UI_V3_LIVE_MAP_STYLE === '1'
const realRouteFixturePath = process.env.UI_V3_REAL_ROUTE_FIXTURE?.trim()
const useRealRouteFixture = Boolean(realRouteFixturePath)
const expectedMapEngine = process.env.VITE_E2E_USE_LIVE_MAP === '1' ? 'google' : 'maplibre'
const goldenOutputDirectory = resolve(
  useRealRouteFixture
    ? 'output/playwright/ui-v3-real-map'
    : useLiveMapStyle
    ? 'output/playwright/ui-v3-live-map'
    : 'output/playwright/ui-v3-golden',
)
const lifecycleGoldenOutputDirectory = resolve('output/playwright/ui-v3-home-lifecycle')
const requiredViewports = [
  { height: 568, name: '320x568', width: 320 },
  { height: 844, name: '390x844', width: 390 },
  { height: 932, name: '430x932', width: 430 },
  { height: 1024, name: '768x1024', width: 768 },
  { height: 900, name: '1440x900', width: 1440 },
]

test('UI V3 Today keeps the pre-departure first viewport compact and action-first', async ({ page }) => {
  const browserErrors: string[] = []
  let providerRequests = 0
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))
  await page.route('**/api/provider-proxy', (route) => {
    providerRequests += 1
    return route.abort()
  })
  await page.clock.setFixedTime(new Date(homePredepartureFixture.fixedNow))
  await clearTravelDatabase(page)
  await seedTravelRecords(page, homePredepartureFixture.records)
  await page.reload({ waitUntil: 'domcontentloaded' })

  await expect(page.getByTestId('today-upcoming')).toBeVisible()
  await expect(page.getByText('还有 8 天')).toBeVisible()
  await expect(page.getByText('1 个地点待补全')).toBeVisible()
  await expect(page.getByTestId('home-smart-repair')).toHaveText('一键补全')
  await expect(page.getByText('CA849 上海至伦敦机票')).toBeVisible()
  await expect(page.getByText('伦敦 Park Plaza Westminster 酒店')).toBeVisible()
  await expect(page.getByText('英国旅行保险保单')).toBeVisible()
  await expect(page.getByTestId('today-map')).toHaveCount(0)

  if (captureGoldens) await mkdir(lifecycleGoldenOutputDirectory, { recursive: true })
  for (const viewport of requiredViewports) {
    await page.setViewportSize({ height: viewport.height, width: viewport.width })
    await page.evaluate(() => window.scrollTo(0, 0))
    await expectNoHorizontalOverflow(page)
    if (captureGoldens) {
      await page.screenshot({
        animations: 'disabled',
        caret: 'hide',
        path: resolve(lifecycleGoldenOutputDirectory, `predeparture-${viewport.name}.png`),
      })
    }
  }

  expect(providerRequests).toBe(0)
  expect(browserErrors).toEqual([])
})

test('UI V3 Today matches the active three-stop visual fixture at every required viewport', async ({
  context,
  page,
}) => {
  const routeLineStrings = await loadRealRouteLineStrings()
  const browserErrors: string[] = []
  let originRouteRequests = 0
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))
  await page.clock.setFixedTime(new Date(homeVisualFixture.fixedNow))
  if (!useLiveMapStyle) await mockHomeVisualMapStyle(page)
  await clearTravelDatabase(page)
  await seedTravelRecords(page, homeVisualFixture.records)
  await seedRouteCacheRecords(page, [buildHomeVisualRouteCacheEntry(routeLineStrings)])
  await forceRouteProxyFixture(page)
  await page.route('**/api/provider-proxy', async (route) => {
    const body = route.request().postDataJSON()
    if (body.operation !== 'route_preview') {
      await route.fallback()
      return
    }

    originRouteRequests += 1
    expect(body.provider).toBe('openrouteservice')
    expect(body.coordinates).toEqual([
      [homeVisualFixture.geolocation.longitude, homeVisualFixture.geolocation.latitude],
      [
        homeVisualFixture.records.itineraryItems[0].lng,
        homeVisualFixture.records.itineraryItems[0].lat,
      ],
    ])
    expect(body.segments).toHaveLength(1)
    expect(JSON.stringify(body)).not.toContain('ticketIds')
    expect(JSON.stringify(body)).not.toContain('OPENROUTESERVICE_API_KEY')
    expect(JSON.stringify(body)).not.toContain('当前位置')
    expect(JSON.stringify(body)).not.toContain('城堡门票')
    expect(JSON.stringify(body)).not.toContain('Castlehill')
    const segment = body.segments[0]
    await route.fulfill({
      body: JSON.stringify({
        ok: true,
        operation: 'route_preview',
        provider: 'openrouteservice',
        route: {
          lineStrings: [homeVisualFixture.originRouteLineString],
          segments: [{
            coordinates: homeVisualFixture.originRouteLineString,
            distanceMeters: 1100,
            durationSeconds: 960,
            fromItemId: segment.fromItemId,
            kind: 'road',
            segmentIndex: segment.segmentIndex,
            toItemId: segment.toItemId,
          }],
          status: 'road',
          warnings: [],
        },
      }),
      contentType: 'application/json',
    })
  })
  await context.grantPermissions(['geolocation'], { origin: new URL(page.url()).origin })
  await context.setGeolocation(homeVisualFixture.geolocation)
  await page.reload({ waitUntil: 'domcontentloaded' })

  await expect(page.getByRole('button', { name: '当前旅行：英国12天家庭旅行' })).toBeVisible()
  await expect(page.getByRole('button', { name: '搜索' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'AI 助手' })).toBeVisible()
  await expect(page.getByTestId('today-departure-countdown')).toContainText('12:40')
  await expect(page.getByText('步行 · 16 分钟 (约 1.1 公里)')).toBeVisible()
  await expect(page.getByText('城堡门票')).toBeVisible()
  await expect(page.getByTestId('today-map-place-sheet').getByText('11:00 入场', { exact: true })).toBeVisible()
  await expect(page.getByText('已就绪', { exact: true })).toBeVisible()
  await expect(page.getByText('打开门票')).toBeVisible()
  await expect(page.getByRole('link', { name: '开始导航' })).toHaveCount(1)
  await expect(page.getByTestId('day-map-marker')).toHaveCount(3)
  await expect(page.getByTestId('day-map-marker-details')).toHaveCount(3)
  await expect(page.getByTestId('day-map-route-direction')).toHaveCount(2)
  await expect(page.locator(`[data-map-engine="${expectedMapEngine}"]`)).toBeVisible()
  await expect(page.locator('[data-route-source="road"]')).toBeVisible()
  await expect(page.locator('.today-map-control')).toHaveCount(1)

  await page.getByRole('button', { exact: true, name: '选择 皇家英里大道，13:30' }).click()
  await expect(page.getByRole('heading', { exact: true, name: '皇家英里大道' })).toBeVisible()
  await page.getByRole('button', { exact: true, name: '回到今日路线' }).click()
  await expect(page.getByRole('heading', { exact: true, name: '爱丁堡城堡' })).toBeVisible()
  await expect(page.getByRole('button', { exact: true, name: '显示当前位置' })).toBeVisible()

  if (!useRealRouteFixture) {
    await page.getByRole('button', { name: '显示当前位置' }).click()
    await expect(page.getByTestId('map-user-location-marker')).toBeVisible()
    await expect.poll(() => originRouteRequests).toBe(1)
    await expect(page.locator('[data-origin-route-source="road"]')).toBeVisible()
    await expect(page.getByTestId('day-map-route-direction')).toHaveCount(3)
    await expect(page.getByRole('button', { exact: true, name: '回到今日路线' })).toHaveCount(0)
  }

  if (captureGoldens) await mkdir(goldenOutputDirectory, { recursive: true })

  const captureViewports = useRealRouteFixture
    ? requiredViewports.filter((viewport) => viewport.name === '390x844')
    : requiredViewports
  for (const viewport of captureViewports) {
    await page.setViewportSize({ height: viewport.height, width: viewport.width })
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(980)
    await expectNoHorizontalOverflow(page)
    await expectMapAndSheetGeometry(page)

    if (captureGoldens) {
      await page.screenshot({
        animations: 'disabled',
        caret: 'hide',
        path: resolve(goldenOutputDirectory, `today-${viewport.name}.png`),
      })
    }
  }

  expect(browserErrors).toEqual([])
})

test('UI V3 Today fetches and caches provider road geometry when the exact route is missing', async ({
  page,
}) => {
  let routePreviewRequests = 0
  await page.clock.setFixedTime(new Date(homeVisualFixture.fixedNow))
  if (!useLiveMapStyle) await mockHomeVisualMapStyle(page)
  await clearTravelDatabase(page)
  await page.route('**/api/provider-proxy', async (route) => {
    const body = route.request().postDataJSON()
    if (body.operation !== 'route_preview') {
      await route.fallback()
      return
    }

    routePreviewRequests += 1
    expect(body.provider).toBe('openrouteservice')
    expect(body.coordinates).toHaveLength(3)
    expect(body.segments).toHaveLength(2)
    expect(JSON.stringify(body)).not.toContain('ticketIds')
    expect(JSON.stringify(body)).not.toContain('OPENROUTESERVICE_API_KEY')
    const segments = body.segments.map((segment: Record<string, unknown>, index: number) => ({
      coordinates: homeVisualFixture.routeLineStrings[index],
      distanceMeters: index === 0 ? 950 : 1400,
      durationSeconds: index === 0 ? 780 : 1320,
      fromItemId: segment.fromItemId,
      segmentIndex: segment.segmentIndex,
      toItemId: segment.toItemId,
    }))
    await route.fulfill({
      body: JSON.stringify({
        ok: true,
        operation: 'route_preview',
        provider: 'openrouteservice',
        route: {
          lineStrings: segments.map((segment: { coordinates: unknown }) => segment.coordinates),
          segments,
          status: 'road',
          warnings: [],
        },
      }),
      contentType: 'application/json',
    })
  })
  await seedTravelRecords(page, homeVisualFixture.records)
  await forceRouteProxyFixture(page)
  await page.reload({ waitUntil: 'domcontentloaded' })

  await expect.poll(() => routePreviewRequests).toBe(1)
  await expect(page.locator('[data-route-source="road"]')).toBeVisible()
  await expect(page.getByTestId('day-map-route-direction')).toHaveCount(2)
  await page.waitForTimeout(500)
  expect(routePreviewRequests).toBe(1)
})

test('UI V3 Today keeps an unavailable route visibly distinct from provider road geometry', async ({
  page,
}) => {
  let routePreviewRequests = 0
  await page.clock.setFixedTime(new Date(homeVisualFixture.fixedNow))
  if (!useLiveMapStyle) await mockHomeVisualMapStyle(page)
  await clearTravelDatabase(page)
  await page.route('**/api/provider-proxy', async (route) => {
    const body = route.request().postDataJSON()
    if (body.operation !== 'route_preview') {
      await route.fallback()
      return
    }

    routePreviewRequests += 1
    await route.fulfill({
      body: JSON.stringify({
        error: { code: 'provider_unavailable', message: '路线服务暂不可用。' },
        ok: false,
        operation: 'route_preview',
      }),
      contentType: 'application/json',
      status: 503,
    })
  })
  await seedTravelRecords(page, homeVisualFixture.records)
  await forceRouteProxyFixture(page)
  await page.reload({ waitUntil: 'domcontentloaded' })

  await expect.poll(() => routePreviewRequests).toBe(1)
  await expect(page.locator('[data-route-source="sequence"]')).toBeVisible()
  await expect(page.getByTestId('day-map-route-direction')).toHaveCount(0)
  await page.waitForTimeout(500)
  expect(routePreviewRequests).toBe(1)
})

async function expectMapAndSheetGeometry(page: Page) {
  const geometry = await page.evaluate(() => {
    const map = document.querySelector<HTMLElement>('.today-map-stage')
    const sheet = document.querySelector<HTMLElement>('.today-trip-sheet')
    const markerDetails = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="day-map-marker-details"]'),
    )
    const selectedDot = document.querySelector<HTMLElement>(
      '.day-map-marker-content-detailed.is-selected .day-map-marker-dot',
    )
    if (!map || !sheet || !selectedDot || markerDetails.length !== 3) return null

    const mapRect = map.getBoundingClientRect()
    const sheetRect = sheet.getBoundingClientRect()
    const rootStyle = getComputedStyle(document.documentElement)
    return {
      expectedSelectedColor: rootStyle.getPropertyValue('--color-primary').trim(),
      mapBottom: mapRect.bottom,
      mapLeft: mapRect.left,
      mapRight: mapRect.right,
      mapTop: mapRect.top,
      markerRects: markerDetails.flatMap((marker) => {
        const rect = marker.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
          ? [{
              bottom: rect.bottom,
              left: rect.left,
              right: rect.right,
              text: marker.textContent ?? '',
              top: rect.top,
            }]
          : []
      }),
      selectedColor: getComputedStyle(selectedDot).backgroundColor,
      sheetBottom: sheetRect.bottom,
      sheetLeft: sheetRect.left,
      sheetTop: sheetRect.top,
    }
  })

  expect(geometry).not.toBeNull()
  if (!geometry) return

  const sheetIsBesideMap = geometry.sheetLeft >= geometry.mapRight - 1
  if (!sheetIsBesideMap) {
    const mapBeforeSheet = geometry.mapBottom <= geometry.sheetTop + 1
    const sheetBeforeMap = geometry.sheetBottom <= geometry.mapTop + 1
    expect(mapBeforeSheet || sheetBeforeMap).toBe(true)
  }
  for (const marker of geometry.markerRects) {
    expect(marker.left, marker.text).toBeGreaterThanOrEqual(geometry.mapLeft - 2)
    expect(marker.right, marker.text).toBeLessThanOrEqual(geometry.mapRight + 2)
    expect(marker.top, marker.text).toBeGreaterThanOrEqual(geometry.mapTop - 2)
    expect(marker.bottom, marker.text).toBeLessThanOrEqual(geometry.mapBottom + 2)
  }
  for (let index = 0; index < geometry.markerRects.length; index += 1) {
    for (let nextIndex = index + 1; nextIndex < geometry.markerRects.length; nextIndex += 1) {
      const first = geometry.markerRects[index]
      const second = geometry.markerRects[nextIndex]
      const overlapWidth = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left))
      const overlapHeight = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top))
      expect(overlapWidth * overlapHeight, `${first.text} / ${second.text}`).toBeLessThanOrEqual(2)
    }
  }

  expect(normalizeCssColor(geometry.selectedColor)).toBe(normalizeCssColor(geometry.expectedSelectedColor))
}

function normalizeCssColor(color: string) {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color)
  if (!match) return color.replaceAll(' ', '')
  return `rgb(${Number.parseInt(match[1], 16)},${Number.parseInt(match[2], 16)},${Number.parseInt(match[3], 16)})`
}

function buildHomeVisualRouteCacheEntry(lineStrings = homeVisualFixture.routeLineStrings) {
  const items = homeVisualFixture.records.itineraryItems
  const coordinateKey = items
    .map((item) => [
      item.id,
      item.lat,
      item.lng,
      item.sortOrder,
      item.startTime ?? '',
    ].join(':'))
    .join('|')
  const modeKey = items.slice(1).map((item, index) => [
    items[index].id,
    item.id,
    item.previousTransportMode,
    'foot-walking',
  ].join(':')).join('|')
  const signature = [
    'route-cache',
    1,
    'day-map',
    'openrouteservice',
    'trip_home_v3',
    'day_home_v3_07',
    coordinateKey,
    modeKey,
  ].join('::')
  const timestamp = homeVisualFixture.fixedNow

  return {
    id: signature,
    tripId: 'trip_home_v3',
    dayId: 'day_home_v3_07',
    scope: 'day-map',
    provider: 'openrouteservice',
    routingVersion: 1,
    signature,
    coordinateKey,
    modeKey,
    lineStrings,
    warnings: [],
    status: 'road',
    sizeBytes: JSON.stringify(lineStrings).length,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastUsedAt: timestamp,
  }
}

async function loadRealRouteLineStrings(): Promise<number[][][]> {
  if (!realRouteFixturePath) return homeVisualFixture.routeLineStrings

  const parsed = JSON.parse(await readFile(realRouteFixturePath, 'utf8')) as {
    lineStrings?: unknown
    source?: unknown
  }
  if (parsed.source !== 'openrouteservice' || !isRouteLineStrings(parsed.lineStrings)) {
    throw new Error('UI_V3_REAL_ROUTE_FIXTURE must contain OpenRouteService lineStrings')
  }
  return parsed.lineStrings
}

function isRouteLineStrings(value: unknown): value is number[][][] {
  return Array.isArray(value)
    && value.length === 2
    && value.every((lineString) => Array.isArray(lineString)
      && lineString.length >= 2
      && lineString.every((coordinate) => Array.isArray(coordinate)
        && coordinate.length === 2
        && coordinate.every((entry) => typeof entry === 'number' && Number.isFinite(entry))))
}

async function mockHomeVisualMapStyle(page: Page) {
  await page.route('https://tiles.openfreemap.org/styles/**', (route) => {
    void route.fulfill({
      body: JSON.stringify(HOME_VISUAL_MAP_STYLE),
      contentType: 'application/json',
    })
  })
}

const HOME_VISUAL_MAP_STYLE = {
  version: 8,
  sources: {
    landuse: {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [
          polygonFeature([
            [-3.178, 55.945], [-3.155, 55.945], [-3.155, 55.966],
            [-3.178, 55.966], [-3.178, 55.945],
          ], 'park'),
          polygonFeature([
            [-3.211, 55.949], [-3.188, 55.949], [-3.188, 55.953],
            [-3.211, 55.953], [-3.211, 55.949],
          ], 'park'),
          polygonFeature([
            [-3.219, 55.937], [-3.191, 55.937], [-3.191, 55.944],
            [-3.219, 55.944], [-3.219, 55.937],
          ], 'park'),
          polygonFeature([
            [-3.169, 55.939], [-3.158, 55.939], [-3.158, 55.959],
            [-3.166, 55.956], [-3.169, 55.939],
          ], 'water'),
        ],
      },
    },
    buildings: {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: buildHomeVisualBlockFeatures(),
      },
    },
    minorStreets: {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: buildHomeVisualMinorStreetFeatures(),
      },
    },
    majorStreets: {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [
          lineFeature([[-3.222, 55.952], [-3.208, 55.9524], [-3.19, 55.953], [-3.16, 55.954]]),
          lineFeature([[-3.218, 55.947], [-3.202, 55.9482], [-3.187, 55.9501], [-3.16, 55.9528]]),
          lineFeature([[-3.211, 55.939], [-3.207, 55.945], [-3.2, 55.951], [-3.194, 55.962]]),
          lineFeature([[-3.189, 55.939], [-3.19, 55.946], [-3.188, 55.953], [-3.184, 55.963]]),
          lineFeature([[-3.173, 55.939], [-3.177, 55.946], [-3.175, 55.953], [-3.166, 55.962]]),
        ],
      },
    },
    railway: {
      type: 'geojson',
      data: lineFeature([[-3.221, 55.946], [-3.205, 55.948], [-3.192, 55.951], [-3.176, 55.949], [-3.158, 55.947]]),
    },
  },
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#f4f7f5' },
    },
    {
      id: 'parks',
      type: 'fill',
      source: 'landuse',
      filter: ['==', ['get', 'kind'], 'park'],
      paint: { 'fill-color': '#deeedb', 'fill-opacity': 0.96 },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'landuse',
      filter: ['==', ['get', 'kind'], 'water'],
      paint: { 'fill-color': '#d8ecf1', 'fill-opacity': 0.96 },
    },
    {
      id: 'buildings',
      type: 'fill',
      source: 'buildings',
      paint: {
        'fill-color': '#e7ece9',
        'fill-outline-color': '#dbe2df',
      },
    },
    {
      id: 'minor-street-casing',
      type: 'line',
      source: 'minorStreets',
      paint: { 'line-color': '#d9e0dd', 'line-width': 4 },
    },
    {
      id: 'minor-streets',
      type: 'line',
      source: 'minorStreets',
      paint: { 'line-color': '#ffffff', 'line-width': 2.2 },
    },
    {
      id: 'major-street-casing',
      type: 'line',
      source: 'majorStreets',
      paint: { 'line-color': '#d3dcd8', 'line-width': 7 },
    },
    {
      id: 'major-streets',
      type: 'line',
      source: 'majorStreets',
      paint: { 'line-color': '#ffffff', 'line-width': 4.2 },
    },
    {
      id: 'railway',
      type: 'line',
      source: 'railway',
      paint: {
        'line-color': '#9fb7b1',
        'line-dasharray': [1.5, 1.5],
        'line-opacity': 0.78,
        'line-width': 2.2,
      },
    },
  ],
} as const

function lineFeature(coordinates: number[][]) {
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'LineString' as const,
      coordinates,
    },
  }
}

function polygonFeature(coordinates: number[][], kind = 'building') {
  return {
    type: 'Feature' as const,
    properties: { kind },
    geometry: {
      type: 'Polygon' as const,
      coordinates: [coordinates],
    },
  }
}

function buildHomeVisualMinorStreetFeatures() {
  const verticals = [-3.228, -3.218, -3.208, -3.198, -3.188, -3.178, -3.168, -3.158, -3.148]
  const horizontals = Array.from({ length: 25 }, (_, index) => 55.89 + index * 0.005)
  return [
    ...verticals.map((longitude, index) => lineFeature([
      [longitude, 55.89],
      [longitude + (index % 2 === 0 ? 0.003 : -0.002), 55.950],
      [longitude + (index % 3 === 0 ? -0.002 : 0.002), 56.01],
    ])),
    ...horizontals.map((latitude, index) => lineFeature([
      [-3.235, latitude],
      [-3.194, latitude + (index % 2 === 0 ? 0.001 : -0.0006)],
      [-3.14, latitude + (index % 3 === 0 ? -0.0008 : 0.0007)],
    ])),
  ]
}

function buildHomeVisualBlockFeatures() {
  const longitudes = [-3.228, -3.218, -3.208, -3.198, -3.188, -3.178, -3.168, -3.158, -3.148]
  const latitudes = Array.from({ length: 11 }, (_, index) => 55.9 + index * 0.01)
  return longitudes.flatMap((longitude, column) => latitudes.map((latitude, row) => {
    const width = 0.006 + (column % 2) * 0.001
    const height = 0.0024 + (row % 2) * 0.0004
    return polygonFeature([
      [longitude, latitude],
      [longitude + width, latitude + 0.0003],
      [longitude + width - 0.0005, latitude + height],
      [longitude - 0.0004, latitude + height - 0.0002],
      [longitude, latitude],
    ])
  }))
}
