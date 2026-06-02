import { expect, test, type Page } from '@playwright/test'
import {
  clearTravelDatabase,
  createDemoTripViaUi,
  expectNoHorizontalOverflow,
  forceRouteProxyFixture,
  forceSupabaseUnconfigured,
  getHashParam,
  mockGoogleMapsUnavailable,
  mockMapStyle,
  seedTravelRecords,
  setRouteProxyConfig,
} from './helpers'

test('旅行工作台可以在日程和地图视图之间切换', async ({ page }) => {
  await mockMapStyle(page)
  const tripId = await createDemoTripViaUi(page)
  expect(tripId).toBeTruthy()

  await expect(page.getByRole('heading', { name: '当天日程' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Hotel Metropolitan Tokyo 入住/ })).toBeVisible()
  const dayBrief = page.getByTestId('day-local-brief-card')
  await expect(dayBrief).toBeVisible()
  await expect(dayBrief).toContainText('当日简报')
  await expect(dayBrief).toContainText('本地检查')
  await expect(dayBrief).toContainText('准备提醒')
  await expect(dayBrief).toContainText(/根据已填写内容|基于当前本地行程信息/)
  await expect(dayBrief).toContainText('开放时间')
  await expect(dayBrief.getByRole('button')).toHaveCount(0)
  await expect(page).toHaveURL(/#\/day\?/)
  await expectNoHorizontalOverflow(page)

  await page.getByTestId('view-switch-map').click()
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=map/)
  await expect(page.getByTestId('map-sheet')).toHaveCount(0)
  await expect(page.getByTestId('map-marker-card')).toBeVisible({ timeout: 15000 })
  await expect(page.getByTestId('view-switch-schedule')).toBeVisible()
  await expect(dayBrief).toBeHidden()
  await expectNoHorizontalOverflow(page)

  await page.getByTestId('view-switch-schedule').click()
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=schedule/)
  await expect(page.getByRole('heading', { name: '当天日程' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Hotel Metropolitan Tokyo 入住/ })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.getByTestId('view-switch-map').click()
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=map/)
  await expect(page.getByTestId('map-sheet')).toHaveCount(0)
  await expect(page.getByTestId('map-marker-card')).toBeVisible({ timeout: 15000 })
  await expectNoHorizontalOverflow(page)

  await page.getByTestId('day-selector').getByRole('button', { name: /Day 2/ }).click()
  await expect(page).toHaveURL(/view=map/)
  await expect(page.getByTestId('map-sheet')).toHaveCount(0)
  await expect(page.getByTestId('map-marker-card')).toBeVisible({ timeout: 15000 })
  await expectNoHorizontalOverflow(page)

  const currentTripId = getHashParam(page.url(), 'tripId')
  const currentDayId = getHashParam(page.url(), 'dayId')
  expect(currentTripId).toBe(tripId)
  expect(currentDayId).toBeTruthy()

  await page.getByRole('button', { name: '总览' }).click()
  await expect(page).toHaveURL(/#\/trip\?/)
  await expect(page.getByRole('heading', { name: '每日行程' })).toBeVisible()
  await expect(page.getByRole('button', { name: /抵达与涩谷/ })).toContainText('3 个行程点')
  await expect(page.getByRole('button', { name: /浅草与东京站/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /2026年4月12日/ })).toBeVisible()
  const mapOverview = page.getByTestId('trip-map-overview')
  const localCheck = page.getByTestId('local-trip-check-card')
  await expect(localCheck).toBeVisible()
  await expect(localCheck).toContainText('行程体检')
  await expect(localCheck).toContainText('本地检查')
  await expect(localCheck).toContainText('准备提醒')
  await expect(localCheck).toContainText('行程点')
  await expect(localCheck).toContainText('票据')
  await expect(localCheck).toContainText('开放时间')
  await expect(localCheck.getByRole('button')).toHaveCount(0)
  expect(await localCheck.getByTestId('local-trip-check-finding').count()).toBeLessThanOrEqual(3)
  await expectNoHorizontalOverflow(page)

  await expect(mapOverview).toBeVisible()
  await expect(mapOverview).toContainText('行程地图预览')
  await expect(mapOverview).toContainText('5 个有坐标地点')
  await expect(mapOverview.getByTestId('trip-map-preview-map')).toHaveAttribute('data-interactive', 'false')
  await expectTripPreviewRenderedInPlot(page, 5)
  await expect(mapOverview.getByTestId('trip-map-preview-overlay')).toHaveCount(0)
  await expect(mapOverview.getByTestId('trip-map-overview-marker')).toHaveCount(5)
  await expect(mapOverview.getByTestId('trip-map-overview-note')).toContainText(
    '路线仅供预览，不会自动改行程顺序。',
  )
  const noteIsOutsidePlot = await mapOverview.evaluate((overview) => {
    const plot = overview.querySelector('[data-testid="trip-map-overview-plot"]')
    const note = overview.querySelector('[data-testid="trip-map-overview-note"]')
    return Boolean(plot && note && !plot.contains(note))
  })
  expect(noteIsOutsidePlot).toBe(true)
  await expectNoHorizontalOverflow(page)
  await mapOverview.getByRole('button', { name: '查看地图' }).click()
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=map/)
  await expect(page.getByTestId('map-sheet')).toHaveCount(0)
  await expect(page.getByTestId('map-marker-card')).toBeVisible({ timeout: 15000 })

  await page.getByRole('button', { name: '总览' }).click()
  await expect(page).toHaveURL(/#\/trip\?/)

  await page.getByRole('button', { name: '更多' }).click()
  const moreMenu = page.getByTestId('trip-more-menu')
  await expect(moreMenu).toBeVisible()
  await expect(moreMenu.getByRole('button', { name: '设置' })).toBeVisible()
  await expect(moreMenu).not.toContainText('设置与存储说明')
  await expect(moreMenu).not.toContainText(/Google Maps 配置|路线服务配置|路线服务|设备存储/)
  await moreMenu.getByRole('button', { name: '更多' }).click()
  await expectNoHorizontalOverflow(page)

  await page.goto(`/#/trip?tripId=${tripId}&dayId=${currentDayId}&view=map`, { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=map/)

  await page.getByRole('button', { name: '总览' }).click()
  await expect(page).toHaveURL(/#\/trip\?/)
  await page.getByRole('button', { name: '票据库' }).click()
  await expect(page).toHaveURL(/#\/tickets\?/)
  await expect(page.getByRole('heading', { name: '票据和订单' })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await forceSupabaseUnconfigured(page)
  await page.goto(`/#/settings?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: '设置' })).toBeVisible()
  await page.locator('summary').filter({ hasText: '关于' }).click()
  await expect(page.locator('main').getByText(/当前版本：v\d+\.\d+\.\d+(?:\.\d+)?/)).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('Trip Home 路线准备在坐标不足时保持安静不可用', async ({ page }) => {
  await clearTravelDatabase(page)
  const now = Date.now()
  await seedTravelRecords(page, {
    trips: [{
      createdAt: now,
      destination: '日本东京',
      endDate: '2026-04-12',
      id: 'trip-no-route-coords',
      startDate: '2026-04-12',
      title: '坐标待补充旅行',
      updatedAt: now,
    }],
    days: [{
      date: '2026-04-12',
      id: 'day-no-route-coords',
      sortOrder: 1,
      title: '坐标待补充',
      tripId: 'trip-no-route-coords',
    }],
    itineraryItems: [{
      createdAt: now,
      dayId: 'day-no-route-coords',
      id: 'item-no-route-coords',
      sortOrder: 1,
      ticketIds: [],
      title: '还没有坐标的地点',
      tripId: 'trip-no-route-coords',
      updatedAt: now,
    }],
  })

  await page.goto('/#/trip?tripId=trip-no-route-coords&dayId=day-no-route-coords', { waitUntil: 'domcontentloaded' })
  const panel = page.getByTestId('route-preparation-panel')

  await expect(panel).toBeVisible()
  await expect(panel.getByTestId('route-preparation-summary')).toContainText('补充至少两个有坐标')
  await expect(panel.getByRole('button', { name: '生成路线预览' })).toBeDisabled()
  await expectNoHorizontalOverflow(page)
})

test('Trip Home 地图预览缓存路线并通过 proxy 应用路线顺序建议', async ({ page }) => {
  await mockMapStyle(page)
  let routePreviewRequests = 0
  let routeOrderRequests = 0
  let directGoogleRouteRequests = 0
  let directOrsRequests = 0
  await page.route('**/api/provider-proxy', async (route) => {
    const body = route.request().postDataJSON()
    if (body.operation === 'route_preview') {
      routePreviewRequests += 1
      const coords = body.coordinates ?? [[139.1, 35.1], [139.2, 35.2]]
      const segments = (body.segments ?? []).map((seg: Record<string, unknown>, i: number) => ({
        coordinates: [coords[seg.fromCoordinateIndex as number] ?? coords[0], coords[seg.toCoordinateIndex as number] ?? coords[1]],
        distanceMeters: 1200,
        durationSeconds: 600,
        fromItemId: seg.fromItemId,
        segmentIndex: seg.segmentIndex ?? i,
        toItemId: seg.toItemId,
      }))
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          operation: 'route_preview',
          provider: 'openrouteservice',
          route: {
            lineStrings: segments.map((s: { coordinates: unknown }) => s.coordinates),
            segments,
            status: 'road',
            warnings: [],
          },
        }),
        contentType: 'application/json',
      })
      return
    }
    if (body.operation === 'route_order_suggestion') {
      routeOrderRequests += 1
      expect(body.provider).toBe('auto')
      expect(body.quotaSessionId).toBeTruthy()
      expect(JSON.stringify(body)).not.toContain('GOOGLE_ROUTES_API_KEY')
      expect(JSON.stringify(body)).not.toContain('OPENROUTESERVICE_API_KEY')
      expect(JSON.stringify(body)).not.toContain('ticketIds')
      expect(JSON.stringify(body)).not.toContain('notes')
      const requestItems = body.items as Array<{ coordinate?: unknown; id: string }>
      const coordinateItems = requestItems.filter((item) => item.coordinate)
      const suggestedItemIds = [
        coordinateItems[0]?.id,
        ...coordinateItems.slice(1, -1).reverse().map((item) => item.id),
        coordinateItems[coordinateItems.length - 1]?.id,
      ].filter(Boolean)
      await route.fulfill({
        body: JSON.stringify({
          distanceMeters: 1800,
          durationSeconds: 900,
          ok: true,
          operation: 'route_order_suggestion',
          provider: 'mock',
          retrievedAt: '2026-01-01T00:00:00.000Z',
          suggestedItemIds,
          summary: '模拟路线顺序建议',
          unchangedItemIds: requestItems.filter((item) => !item.coordinate).map((item) => item.id),
          warnings: [],
        }),
        contentType: 'application/json',
      })
      return
    }
    await route.fulfill({
      body: JSON.stringify({ code: 'unsupported', message: 'unexpected operation', ok: false }),
      contentType: 'application/json',
      status: 501,
    })
  })
  await page.route('https://routes.googleapis.com/directions/v2:computeRoutes', async (route) => {
    directGoogleRouteRequests += 1
    await route.fulfill({
      body: JSON.stringify({
        routes: [
          {
            distanceMeters: 3200,
            duration: '840s',
            optimizedIntermediateWaypointIndex: [1, 0],
            polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' },
          },
        ],
      }),
      contentType: 'application/json',
    })
  })
  await page.route('https://api.openrouteservice.org/**', (route) => {
    directOrsRequests += 1
    return route.abort()
  })
  const tripId = await createDemoTripViaUi(page)
  const dayId = getHashParam(page.url(), 'dayId')
  expect(dayId).toBeTruthy()

  await page.evaluate(({ currentDayId, currentTripId }) => {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('TravelConsoleDB')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction(['itineraryItems'], 'readwrite')
        tx.objectStore('itineraryItems').add({
          createdAt: Date.now(),
          dayId: currentDayId,
          id: 'item_extra_optimization',
          lat: 35.6812,
          lng: 139.7671,
          previousTransportMode: 'car',
          sortOrder: 4,
          ticketIds: [],
          title: '东京站补充点',
          tripId: currentTripId,
          updatedAt: Date.now(),
        })
        tx.onerror = () => reject(tx.error)
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
      }
    })
  }, { currentDayId: dayId, currentTripId: tripId })

  await page.goto(`/#/trip?tripId=${tripId}&dayId=${dayId}`, { waitUntil: 'domcontentloaded' })
  await setRouteProxyConfig(page)
  const mapOverview = page.getByTestId('trip-map-overview')
  await expect(mapOverview).toContainText('行程地图预览')
  await expect(mapOverview.getByTestId('trip-map-preview-map')).toHaveAttribute('data-interactive', 'false')
  await expectTripPreviewRenderedInPlot(page, 6)
  await expect(mapOverview.getByTestId('trip-map-preview-overlay')).toHaveCount(0)
  await expect(mapOverview.getByTestId('trip-map-overview-marker')).toHaveCount(6)
  await expect(mapOverview.getByTestId('trip-map-overview-note')).toContainText('尚未生成路线预览')
  await expect(page.getByTestId('route-preparation-panel')).toContainText('路线准备')
  await expect(page.getByTestId('route-preparation-summary')).toContainText('可为 2 天生成路线预览')
  expect(await readRouteCacheEntryCount(page)).toBe(0)
  await expect(mapOverview.getByText(/加载地图预览/)).toHaveCount(0)
  expect(routeOrderRequests).toBe(0)

  await page.getByTestId('route-preparation-panel').getByRole('button', { name: '生成路线预览' }).click()
  const routeDialog = page.getByTestId('route-generation-confirm-dialog')
  await expect(routeDialog).toContainText('将调用路线服务')
  await expect(routeDialog).toContainText('不会自动调整')
  await expect(routeDialog).toContainText('不会生成公交')
  expect(await readRouteCacheEntryCount(page)).toBe(0)

  await routeDialog.getByRole('button', { name: '确认生成' }).click()
  await expect(page.getByTestId('route-preparation-result')).toContainText('已生成 1 天路线预览')
  await expect(mapOverview.getByTestId('trip-map-overview-note')).toContainText('已缓存的 ORS 路线几何')
  expect(routePreviewRequests).toBeGreaterThan(0)

  await page.reload({ waitUntil: 'domcontentloaded' })
  const reloadedMapOverview = page.getByTestId('trip-map-overview')
  await expect(reloadedMapOverview.getByTestId('trip-map-overview-note')).toContainText('已缓存的 ORS 路线几何')
  await expect(reloadedMapOverview.getByText(/加载地图预览/)).toHaveCount(0)

  await page.evaluate(() => {
    window.localStorage.setItem('tripmap:google-maps-api-key', 'fake-google-key')
    window.dispatchEvent(new Event('tripmap:google-maps-config-changed'))
  })
  const originalOrder = await readDayItemOrder(page, dayId as string)
  const cacheCountBeforeSuggestion = await readRouteCacheEntryCount(page)
  const routeOrderPanel = page.getByTestId('trip-map-route-order-panel')
  await expect(routeOrderPanel).toBeVisible()
  expect(routeOrderRequests).toBe(0)
  await routeOrderPanel.getByRole('button', { name: '查看建议（仅建议）' }).click()
  await expect(routeOrderPanel.getByTestId('trip-map-route-order-suggestion')).toContainText('建议顺序')
  expect(routeOrderRequests).toBe(1)
  expect(await readDayItemOrder(page, dayId as string)).toEqual(originalOrder)

  await routeOrderPanel.getByRole('button', { name: '应用建议' }).click()
  const orderDialog = page.getByTestId('trip-map-route-order-confirm-dialog')
  await expect(orderDialog).toContainText('只会更新')
  await expect(orderDialog).toContainText('不会生成路线')
  await expect(orderDialog).toContainText('不会写入云端')
  await expect(orderDialog).toContainText('不会创建票据')
  await orderDialog.getByRole('button', { name: '暂不应用' }).click()
  expect(await readDayItemOrder(page, dayId as string)).toEqual(originalOrder)

  await routeOrderPanel.getByRole('button', { name: '应用建议' }).click()
  await page.getByTestId('trip-map-route-order-confirm-dialog').getByRole('button', { name: '确认应用' }).click()
  const expectedOrder = [
    originalOrder[0],
    ...originalOrder.slice(1, -1).reverse(),
    originalOrder[originalOrder.length - 1],
  ]
  await expect.poll(() => readDayItemOrder(page, dayId as string)).toEqual(expectedOrder)
  expect(await readRouteCacheEntryCount(page)).toBe(cacheCountBeforeSuggestion)
  expect(directGoogleRouteRequests).toBe(0)
  expect(directOrsRequests).toBe(0)
  await expectNoHorizontalOverflow(page)
})

test('Trip Home 路线生成可在确认后使用 mock provider proxy', async ({ page }) => {
  await mockMapStyle(page)
  let proxyCalls = 0
  await page.route('**/api/provider-proxy', async (route) => {
    proxyCalls += 1
    const body = route.request().postDataJSON() as {
      coordinates: number[][]
      operation: string
      provider: string
      quotaSessionId?: string
      segments: Array<{
        fromCoordinateIndex: number
        fromItemId?: string
        segmentIndex: number
        toCoordinateIndex: number
        toItemId?: string
      }>
    }
    expect(body.operation).toBe('route_preview')
    expect(body.provider).toBe('openrouteservice')
    expect(body.quotaSessionId).toBeTruthy()
    expect(JSON.stringify(body)).not.toContain('OPENROUTESERVICE_API_KEY')
    expect(JSON.stringify(body)).not.toContain('GOOGLE_ROUTES_API_KEY')
    await route.fulfill({
      body: JSON.stringify({
        ok: true,
        operation: 'route_preview',
        provider: 'openrouteservice',
        route: {
          lineStrings: body.segments.map((segment) => [
            body.coordinates[segment.fromCoordinateIndex],
            body.coordinates[segment.toCoordinateIndex],
          ]),
          segments: body.segments.map((segment) => ({
            coordinates: [
              body.coordinates[segment.fromCoordinateIndex],
              body.coordinates[segment.toCoordinateIndex],
            ],
            distanceMeters: 1200,
            durationSeconds: 600,
            fromItemId: segment.fromItemId,
            kind: 'road',
            segmentIndex: segment.segmentIndex,
            toItemId: segment.toItemId,
          })),
          status: 'road',
          warnings: [],
        },
      }),
      contentType: 'application/json',
    })
  })

  const tripId = await createDemoTripViaUi(page)
  const dayId = getHashParam(page.url(), 'dayId')
  expect(dayId).toBeTruthy()
  await forceRouteProxyFixture(page)
  await page.goto(`/#/trip?tripId=${tripId}&dayId=${dayId}`, { waitUntil: 'domcontentloaded' })

  await expect(page.getByTestId('route-preparation-summary')).toContainText('可为')
  expect(proxyCalls).toBe(0)
  await page.getByTestId('route-preparation-panel').getByRole('button', { name: '生成路线预览' }).click()
  const routeDialog = page.getByTestId('route-generation-confirm-dialog')
  await expect(routeDialog).toContainText('将调用路线服务')
  expect(proxyCalls).toBe(0)
  await routeDialog.getByRole('button', { name: '确认生成' }).click()

  await expect(page.getByTestId('route-preparation-result')).toContainText('已生成')
  expect(proxyCalls).toBeGreaterThan(0)
  await expectNoHorizontalOverflow(page)
})

test('Trip Home 地图预览在 MapLibre 样式失败时仍显示轻量预览', async ({ page }) => {
  await mockGoogleMapsUnavailable(page)
  await page.route('https://*.basemaps.cartocdn.com/**', (route) => route.abort())
  await page.route('https://tiles.openfreemap.org/styles/**', (route) => route.abort())
  const tripId = await createDemoTripViaUi(page)
  const dayId = getHashParam(page.url(), 'dayId')
  expect(dayId).toBeTruthy()

  await page.goto(`/#/trip?tripId=${tripId}&dayId=${dayId}`, { waitUntil: 'domcontentloaded' })
  const mapOverview = page.getByTestId('trip-map-overview')

  await expect(mapOverview).toContainText('行程地图预览')
  await expect(mapOverview.getByTestId('trip-map-preview-map')).toHaveAttribute('data-interactive', 'false')
  await expectTripPreviewRenderedInPlot(page, 5, { requireMarkers: true })
  await expect(mapOverview.getByTestId('trip-map-preview-overlay')).toHaveCount(0)
  await expect(mapOverview.getByTestId('trip-map-overview-marker')).toHaveCount(5)
  await expect(mapOverview.getByText('地图底图暂时无法加载')).toBeVisible()
  await expect(mapOverview.getByText(/加载地图预览/)).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('Trip Home Google 地图预览不依赖 AdvancedMarker', async ({ page }) => {
  await mockGoogleMapsScript(page)
  let googleRouteCalls = 0
  await page.route('https://routes.googleapis.com/directions/v2:computeRoutes', async (route) => {
    googleRouteCalls += 1
    await route.fulfill({
      body: JSON.stringify({
        routes: [
          {
            distanceMeters: 1200,
            duration: '600s',
            polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' },
          },
        ],
      }),
      contentType: 'application/json',
    })
  })
  const tripId = await createDemoTripViaUi(page)
  const dayId = getHashParam(page.url(), 'dayId')
  expect(dayId).toBeTruthy()

  await page.evaluate(() => {
    window.localStorage.setItem('tripmap:google-maps-api-key', 'fake-google-key')
  })
  await page.goto(`/#/trip?tripId=${tripId}&dayId=${dayId}`, { waitUntil: 'domcontentloaded' })
  const mapOverview = page.getByTestId('trip-map-overview')

  await expect(mapOverview.getByTestId('trip-map-preview-map')).toHaveAttribute('data-interactive', 'false')
  await expect(mapOverview.getByTestId('trip-map-preview-overlay')).toHaveCount(0)
  await expect(mapOverview.getByTestId('trip-map-overview-marker')).toHaveCount(5)
  await expect(mapOverview.getByTestId('trip-map-google-route-line')).toHaveCount(1)
  await expect(mapOverview.getByTestId('trip-map-overview-note')).toContainText('尚未生成路线预览')
  await expect(mapOverview.locator('.maplibregl-map')).toHaveCount(0)
  expect(googleRouteCalls).toBe(0)
  await expectNoHorizontalOverflow(page)
})

test('Trip Home AI 修改建议需要两次确认且只在最终确认后写入', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockMapStyle(page)
  await clearTravelDatabase(page)
  await setRouteProxyConfig(page)
  let editRequests = 0
  let travelSearchRequests = 0
  let routePreviewRequests = 0
  let cloudRequests = 0
  let deepSeekRequests = 0

  await page.route('**/api/provider-proxy', async (route) => {
    const body = route.request().postDataJSON()
    if (body.operation === 'ai_trip_edit_plan') {
      editRequests += 1
      expect(body.searchResults).toBeUndefined()
      expect(JSON.stringify(body)).not.toContain('ticket_1')
      expect(JSON.stringify(body)).not.toContain('ticketMetas')
      expect(JSON.stringify(body)).not.toContain('ticketBlobs')
      expect(JSON.stringify(body)).not.toContain('routeCache')
      expect(JSON.stringify(body)).not.toContain('cloudToken')
      expect(JSON.stringify(body)).not.toContain('lat')
      expect(JSON.stringify(body)).not.toContain('lng')
      expect(JSON.stringify(body)).not.toContain('默认不发送的备注')
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          operation: 'ai_trip_edit_plan',
          patchPlan: {
            operations: [
              { itemId: 'item_ai_edit_1', reason: '把标题改得更明确。', title: '西湖深度散步', type: 'update_item_title' },
            ],
            summary: '把西湖安排改得更明确。',
          },
          source: 'mock',
        }),
        contentType: 'application/json',
      })
      return
    }
    if (body.operation === 'travel_search') {
      travelSearchRequests += 1
    }
    if (body.operation === 'route_preview') {
      routePreviewRequests += 1
    }
    await route.fulfill({
      body: JSON.stringify({ code: 'unsupported', message: 'unexpected operation', ok: false }),
      contentType: 'application/json',
      status: 501,
    })
  })
  await page.route('https://api.deepseek.com/**', (route) => {
    deepSeekRequests += 1
    return route.abort()
  })
  await page.route('**/*.supabase.co/**', (route) => {
    cloudRequests += 1
    return route.abort()
  })
  await page.evaluate(() => {
    window.localStorage.setItem('tripmap:e2e:supabase-unconfigured', '1')
  })

  const now = Date.now()
  await seedTravelRecords(page, {
    trips: [{
      createdAt: now,
      destination: '杭州',
      endDate: '2026-07-11',
      id: 'trip-ai-edit',
      notes: '旅行备注也不应默认发送',
      startDate: '2026-07-10',
      title: '杭州 AI 修改测试',
      updatedAt: now,
    }],
    days: [
      { date: '2026-07-10', id: 'day_ai_edit_1', sortOrder: 1, title: '第一天', tripId: 'trip-ai-edit' },
      { date: '2026-07-11', id: 'day_ai_edit_2', sortOrder: 2, title: '第二天', tripId: 'trip-ai-edit' },
    ],
    itineraryItems: [
      {
        createdAt: now,
        dayId: 'day_ai_edit_1',
        id: 'item_ai_edit_1',
        lat: 30.244,
        lng: 120.155,
        notes: '默认不发送的备注',
        sortOrder: 1,
        ticketIds: [],
        title: '西湖',
        tripId: 'trip-ai-edit',
        updatedAt: now,
      },
      {
        createdAt: now,
        dayId: 'day_ai_edit_1',
        id: 'item_ai_edit_2',
        sortOrder: 2,
        ticketIds: ['ticket_1'],
        title: '演出票项目',
        tripId: 'trip-ai-edit',
        updatedAt: now,
      },
    ],
    ticketMetas: [{
      createdAt: now,
      fileName: 'ticket.pdf',
      fileType: 'pdf',
      id: 'ticket_1',
      itemId: 'item_ai_edit_2',
      mimeType: 'application/pdf',
      size: 1,
      tripId: 'trip-ai-edit',
      updatedAt: now,
    }],
  })

  await page.goto('/#/trip?tripId=trip-ai-edit&dayId=day_ai_edit_1', { waitUntil: 'domcontentloaded' })
  const panel = page.getByTestId('ai-trip-edit-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('AI 修改建议')
  await expect(panel).toContainText('当前仍不会自动查询网页')
  await expect(panel.getByRole('button', { name: '生成修改方案' })).toBeDisabled()
  await expectNoHorizontalOverflow(page)

  const beforeCounts = await readAiEditBoundaryCounts(page)
  await panel.getByTestId('ai-trip-edit-command').fill('第二天太满了，帮我放松一点')
  await panel.getByRole('button', { name: '生成修改方案' }).click()
  const sendDialog = page.getByTestId('ai-trip-edit-send-confirm-dialog')
  await expect(sendDialog).toContainText('不会直接修改旅行')
  expect(editRequests).toBe(0)
  await sendDialog.getByRole('button', { name: '暂不发送' }).click()
  expect(editRequests).toBe(0)
  expect(await readItemTitle(page, 'item_ai_edit_1')).toBe('西湖')

  await panel.getByRole('button', { name: '生成修改方案' }).click()
  await page.getByTestId('ai-trip-edit-send-confirm-dialog').getByRole('button', { name: '确认发送' }).click()
  await expect(panel.getByTestId('ai-trip-edit-preview')).toContainText('西湖深度散步')
  expect(editRequests).toBe(1)
  expect(travelSearchRequests).toBe(0)
  expect(await readItemTitle(page, 'item_ai_edit_1')).toBe('西湖')
  expect(await readAiEditBoundaryCounts(page)).toEqual(beforeCounts)

  await writeItemTitle(page, 'item_ai_edit_1', '西湖手动调整')
  await panel.getByRole('button', { name: '应用修改' }).click()
  await page.getByTestId('ai-trip-edit-apply-confirm-dialog').getByRole('button', { name: '确认应用' }).click()
  await expect(panel.getByTestId('ai-trip-edit-error')).toContainText('本地行程已变化，请重新生成 AI 修改方案。')
  expect(await readItemTitle(page, 'item_ai_edit_1')).toBe('西湖手动调整')

  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(panel).toBeVisible()
  await panel.getByTestId('ai-trip-edit-command').fill('第二天太满了，帮我放松一点')
  await panel.getByRole('button', { name: '生成修改方案' }).click()
  await page.getByTestId('ai-trip-edit-send-confirm-dialog').getByRole('button', { name: '确认发送' }).click()
  await expect(panel.getByTestId('ai-trip-edit-preview')).toContainText('西湖深度散步')
  expect(editRequests).toBe(2)

  await panel.getByRole('button', { name: '应用修改' }).click()
  const applyDialog = page.getByTestId('ai-trip-edit-apply-confirm-dialog')
  await expect(applyDialog).toContainText('不会生成路线')
  await expect(applyDialog).toContainText('不会联网搜索或查询网页')
  await applyDialog.getByRole('button', { name: '确认应用' }).click()
  await expect.poll(() => readItemTitle(page, 'item_ai_edit_1')).toBe('西湖深度散步')
  const afterCounts = await readAiEditBoundaryCounts(page)
  expect(afterCounts.trips).toBe(beforeCounts.trips)
  expect(afterCounts.days).toBe(beforeCounts.days)
  expect(afterCounts.itineraryItems).toBe(beforeCounts.itineraryItems)
  expect(afterCounts.ticketMetas).toBe(beforeCounts.ticketMetas)
  expect(afterCounts.ticketBlobs).toBe(beforeCounts.ticketBlobs)
  expect(afterCounts.routeCaches).toBe(beforeCounts.routeCaches)
  expect(travelSearchRequests).toBe(0)
  expect(routePreviewRequests).toBe(0)
  expect(cloudRequests).toBe(0)
  expect(deepSeekRequests).toBe(0)
  await expectNoHorizontalOverflow(page)
})

test('Trip Home 智能整理此行程先确认再生成可勾选 diff 并批量应用', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockMapStyle(page)
  await clearTravelDatabase(page)
  await setRouteProxyConfig(page)
  let placeLookupRequests = 0
  let routeOrderRequests = 0
  let travelSearchRequests = 0
  let cloudRequests = 0
  let deepSeekRequests = 0

  await page.route('**/api/provider-proxy', async (route) => {
    const body = route.request().postDataJSON()
    if (body.operation === 'place_lookup') {
      placeLookupRequests += 1
      expect(body.maxResults).toBe(3)
      expect(JSON.stringify(body)).not.toContain('ticket_')
      expect(JSON.stringify(body)).not.toContain('ticketBlobs')
      expect(JSON.stringify(body)).not.toContain('routeCache')
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          operation: 'place_lookup',
          retrievedAt: '2026-06-02T01:02:03.000Z',
          source: 'mock',
          results: [
            {
              displayName: '西湖相似地点',
              formattedAddress: '杭州西湖相似地点',
              location: { lat: 30.2, lng: 120.1 },
              placeId: 'place-weak',
              provider: 'google_places',
              retrievedAt: '2026-06-02T01:02:03.000Z',
            },
            {
              displayName: '西湖风景名胜区',
              formattedAddress: '杭州西湖风景名胜区',
              googleMapsUri: 'https://maps.google.com/west-lake',
              location: { lat: 30.25, lng: 120.14 },
              placeId: 'place-west-lake',
              provider: 'google_places',
              retrievedAt: '2026-06-02T01:02:03.000Z',
            },
          ],
        }),
        contentType: 'application/json',
      })
      return
    }
    if (body.operation === 'route_order_suggestion') {
      routeOrderRequests += 1
      expect(body.items.find((item: { id: string }) => item.id === 'smart_item_1')?.coordinate).toMatchObject({ lat: 30.25, lng: 120.14 })
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          operation: 'route_order_suggestion',
          provider: 'mock',
          requestId: body.requestId,
          retrievedAt: '2026-06-02T01:02:03.000Z',
          suggestedItemIds: ['smart_item_2', 'smart_item_1'],
          summary: '已生成模拟路线顺序建议。',
          unchangedItemIds: [],
          warnings: [],
        }),
        contentType: 'application/json',
      })
      return
    }
    if (body.operation === 'travel_search') {
      travelSearchRequests += 1
      expect(JSON.stringify(body)).not.toContain('ticket_')
      expect(JSON.stringify(body)).not.toContain('ticketBlobs')
      expect(JSON.stringify(body)).not.toContain('routeCache')
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          operation: 'travel_search',
          query: body.query,
          retrievedAt: '2026-06-02T01:02:03.000Z',
          source: 'mock',
          results: [
            {
              confidence: 'low',
              displayUrl: 'unknown.example/smart-trip',
              domain: 'unknown.example',
              retrievedAt: '2026-06-02T01:02:03.000Z',
              snippet: '低质量搬运摘要。',
              sourceType: 'unknown',
              title: '智能整理搬运来源',
              url: 'https://unknown.example/smart-trip',
            },
            {
              confidence: 'high',
              displayUrl: 'travel.example/smart-trip',
              domain: 'travel.example',
              retrievedAt: '2026-06-02T01:02:03.000Z',
              snippet: '模拟来源摘要：开放时间和票价请以官方信息为准。',
              sourceType: 'official',
              title: '智能整理模拟来源',
              url: 'https://travel.example/smart-trip',
            },
          ],
        }),
        contentType: 'application/json',
      })
      return
    }
    if (body.operation === 'route_preview') {
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          operation: 'route_preview',
          provider: 'openrouteservice',
          route: {
            lineStrings: [],
            segments: [],
            status: 'failed',
            warnings: ['route preview ignored in smart workspace test'],
          },
        }),
        contentType: 'application/json',
      })
      return
    }
    await route.fulfill({
      body: JSON.stringify({ code: 'unsupported', message: 'unexpected operation', ok: false }),
      contentType: 'application/json',
      status: 501,
    })
  })
  await page.route('https://api.deepseek.com/**', (route) => {
    deepSeekRequests += 1
    return route.abort()
  })
  await page.route('**/*.supabase.co/**', (route) => {
    cloudRequests += 1
    return route.abort()
  })

  const now = Date.now()
  await seedTravelRecords(page, {
    trips: [{
      createdAt: now,
      destination: '杭州',
      endDate: '2026-07-10',
      id: 'trip-smart-workspace',
      notes: '原旅行备注',
      startDate: '2026-07-10',
      title: '杭州智能整理测试',
      updatedAt: now,
    }],
    days: [
      { date: '2026-07-10', id: 'smart_day_1', sortOrder: 1, title: '第一天', tripId: 'trip-smart-workspace' },
    ],
    itineraryItems: [
      {
        createdAt: now,
        dayId: 'smart_day_1',
        id: 'smart_item_1',
        sortOrder: 1,
        ticketIds: [],
        title: '西湖',
        tripId: 'trip-smart-workspace',
        updatedAt: now,
      },
      {
        createdAt: now,
        dayId: 'smart_day_1',
        id: 'smart_item_2',
        lat: 30.24,
        lng: 120.16,
        sortOrder: 2,
        ticketIds: [],
        title: '灵隐寺',
        tripId: 'trip-smart-workspace',
        updatedAt: now,
      },
    ],
  })

  await page.goto('/#/trip?tripId=trip-smart-workspace&dayId=smart_day_1', { waitUntil: 'domcontentloaded' })
  const panel = page.getByTestId('smart-trip-workspace-panel')
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: '智能整理此行程' }).click()
  const sendDialog = page.getByTestId('smart-trip-workspace-send-confirm-dialog')
  await expect(sendDialog).toContainText('预计最多')
  await expect(sendDialog).toContainText('不会直接写入旅行')
  expect(placeLookupRequests).toBe(0)
  expect(routeOrderRequests).toBe(0)
  expect(travelSearchRequests).toBe(0)
  await sendDialog.getByRole('button', { name: '暂不整理' }).click()
  expect(placeLookupRequests).toBe(0)
  expect(routeOrderRequests).toBe(0)
  expect(travelSearchRequests).toBe(0)

  await panel.getByRole('button', { name: '智能整理此行程' }).click()
  await page.getByTestId('smart-trip-workspace-send-confirm-dialog').getByRole('button', { name: '确认整理' }).click()
  await expect(panel.getByTestId('smart-trip-workspace-preview')).toContainText('地点校准：西湖')
  await expect(panel.getByTestId('smart-trip-workspace-preview')).toContainText('路线顺序：第一天')
  await expect(panel.getByTestId('smart-trip-workspace-preview')).toContainText('景点提示：西湖')
  await expect(panel.getByTestId('smart-trip-workspace-preview')).toContainText('每日提示')
  await expect(panel.getByTestId('smart-trip-workspace-preview')).toContainText('官网')
  await expect(panel.getByTestId('smart-trip-workspace-preview')).toContainText('来源时间：2026-06-02')
  await expect(panel.getByTestId('smart-trip-workspace-preview')).toContainText('可信度：高')
  await expect(panel.getByTestId('smart-trip-workspace-preview')).toContainText('建议理由')
  await expect(panel.getByTestId('smart-trip-workspace-category-controls')).toContainText('地点校准')
  await expect(panel.getByTestId('smart-trip-workspace-category-controls')).toContainText('景点提示')
  await panel.getByTestId('smart-trip-workspace-category-clear-place_calibration').click()
  await expect(panel.getByTestId('smart-trip-workspace-category-controls')).toContainText(/地点校准\s*0\/1/)
  await panel.getByTestId('smart-trip-workspace-category-select-place_calibration').click()
  await expect(panel.getByTestId('smart-trip-workspace-category-controls')).toContainText(/地点校准\s*1\/1/)
  expect(placeLookupRequests).toBe(1)
  expect(routeOrderRequests).toBe(1)
  expect(travelSearchRequests).toBe(2)
  expect(await readDayItemOrder(page, 'smart_day_1')).toEqual(['smart_item_1', 'smart_item_2'])

  await panel.getByRole('button', { name: '批量应用' }).click()
  const applyDialog = page.getByTestId('smart-trip-workspace-apply-confirm-dialog')
  await expect(applyDialog).toContainText('不会创建票据')
  await expect(applyDialog).toContainText('不会上传云端')
  await expect(applyDialog).toContainText('不会清除路线缓存')
  await applyDialog.getByRole('button', { name: '确认应用' }).click()
  await expect.poll(() => readDayItemOrder(page, 'smart_day_1')).toEqual(['smart_item_2', 'smart_item_1'])
  const smartItem = await readItineraryItem(page, 'smart_item_1')
  expect(smartItem.locationName).toBe('西湖风景名胜区')
  expect(smartItem.notes).toContain('模拟来源摘要')
  expect(await readTripNotes(page, 'trip-smart-workspace')).toContain('智能整理每日提示')
  expect(cloudRequests).toBe(0)
  expect(deepSeekRequests).toBe(0)
  await expectNoHorizontalOverflow(page)
})

test('Trip Home AI 修改建议搜索意图先确认并显示来源', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockMapStyle(page)
  await clearTravelDatabase(page)
  await setRouteProxyConfig(page)
  let editRequests = 0
  let travelSearchRequests = 0
  let routePreviewRequests = 0
  let cloudRequests = 0
  let deepSeekRequests = 0

  await page.route('**/api/provider-proxy', async (route) => {
    const body = route.request().postDataJSON()
    if (body.operation === 'travel_search') {
      travelSearchRequests += 1
      expect(editRequests).toBe(0)
      expect(body.searchType).toBe('opening_hours')
      expect(JSON.stringify(body)).not.toContain('ticket_1')
      expect(JSON.stringify(body)).not.toContain('ticketBlobs')
      expect(JSON.stringify(body)).not.toContain('routeCache')
      expect(JSON.stringify(body)).not.toContain('lat')
      expect(JSON.stringify(body)).not.toContain('lng')
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          operation: 'travel_search',
          query: body.query,
          retrievedAt: '2026-01-01T00:00:00.000Z',
          source: 'mock',
          results: [
            {
              confidence: 'medium',
              displayUrl: 'travel.example/search/west-lake-hours',
              domain: 'travel.example',
              retrievedAt: '2026-01-01T00:00:00.000Z',
              snippet: '模拟搜索片段：西湖开放时间。此结果仅用于测试。',
              sourceType: 'official',
              title: '西湖开放时间模拟来源',
              url: 'https://travel.example/search/west-lake-hours',
            },
          ],
          warnings: ['当前为模拟搜索结果，不代表实时网页信息。'],
        }),
        contentType: 'application/json',
      })
      return
    }
    if (body.operation === 'ai_trip_edit_plan') {
      editRequests += 1
      expect(travelSearchRequests).toBe(1)
      expect(body.searchResults.results[0]).toMatchObject({
        domain: 'travel.example',
        retrievedAt: '2026-01-01T00:00:00.000Z',
        title: '西湖开放时间模拟来源',
      })
      expect(JSON.stringify(body)).not.toContain('rawProviderBody')
      expect(JSON.stringify(body)).not.toContain('ticket_1')
      expect(JSON.stringify(body)).not.toContain('routeCache')
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          operation: 'ai_trip_edit_plan',
          patchPlan: {
            operations: [
              { itemId: 'item_ai_edit_1', reason: '参考搜索来源后，让标题更明确。', title: '西湖开放时间确认后散步', type: 'update_item_title' },
            ],
            summary: '根据搜索来源调整西湖安排标题。',
          },
          source: 'mock',
        }),
        contentType: 'application/json',
      })
      return
    }
    if (body.operation === 'route_preview') routePreviewRequests += 1
    await route.fulfill({
      body: JSON.stringify({ code: 'unsupported', message: 'unexpected operation', ok: false }),
      contentType: 'application/json',
      status: 501,
    })
  })
  await page.route('https://api.deepseek.com/**', (route) => {
    deepSeekRequests += 1
    return route.abort()
  })
  await page.route('**/*.supabase.co/**', (route) => {
    cloudRequests += 1
    return route.abort()
  })
  await page.evaluate(() => {
    window.localStorage.setItem('tripmap:e2e:supabase-unconfigured', '1')
  })
  await seedAiEditSearchTrip(page)

  await page.goto('/#/trip?tripId=trip-ai-edit-search&dayId=day_ai_edit_search_1', { waitUntil: 'domcontentloaded' })
  const panel = page.getByTestId('ai-trip-edit-panel')
  await expect(panel).toBeVisible()
  await panel.getByTestId('ai-trip-edit-command').fill('查一下西湖今天开门吗，然后把标题改清楚')
  await expect(panel.getByTestId('ai-trip-edit-search-intent-note')).toContainText('此请求可能需要联网搜索')
  await panel.getByRole('button', { name: '生成修改方案' }).click()
  const sendDialog = page.getByTestId('ai-trip-edit-send-confirm-dialog')
  await expect(sendDialog).toContainText('会先通过旅图服务查询一次')
  expect(travelSearchRequests).toBe(0)
  expect(editRequests).toBe(0)
  await sendDialog.getByRole('button', { name: '暂不发送' }).click()
  expect(travelSearchRequests).toBe(0)
  expect(editRequests).toBe(0)

  await panel.getByRole('button', { name: '生成修改方案' }).click()
  await page.getByTestId('ai-trip-edit-send-confirm-dialog').getByRole('button', { name: '确认发送' }).click()
  await expect(panel.getByTestId('ai-trip-edit-preview')).toContainText('西湖开放时间确认后散步')
  await expect(panel.getByTestId('ai-trip-edit-search-sources')).toContainText('搜索来源')
  await expect(panel.getByTestId('ai-trip-edit-search-sources')).toContainText('西湖开放时间模拟来源')
  await expect(panel.getByTestId('ai-trip-edit-search-sources')).toContainText('travel.example')
  await expect(panel.getByTestId('ai-trip-edit-search-sources')).toContainText('2026-01-01T00:00:00.000Z')
  expect(travelSearchRequests).toBe(1)
  expect(editRequests).toBe(1)
  expect(await readItemTitle(page, 'item_ai_edit_1')).toBe('西湖')

  await panel.getByRole('button', { name: '应用修改' }).click()
  await page.getByTestId('ai-trip-edit-apply-confirm-dialog').getByRole('button', { name: '暂不应用' }).click()
  expect(await readItemTitle(page, 'item_ai_edit_1')).toBe('西湖')
  expect(routePreviewRequests).toBe(0)
  expect(cloudRequests).toBe(0)
  expect(deepSeekRequests).toBe(0)
  await expectNoHorizontalOverflow(page)
})

test('Trip Home AI 修改建议搜索不可用时只显示未接入警告', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockMapStyle(page)
  await clearTravelDatabase(page)
  await setRouteProxyConfig(page)
  let editRequests = 0
  let travelSearchRequests = 0

  await page.route('**/api/provider-proxy', async (route) => {
    const body = route.request().postDataJSON()
    if (body.operation === 'travel_search') {
      travelSearchRequests += 1
      await route.fulfill({
        body: JSON.stringify({
          code: 'provider_unavailable',
          message: '搜索服务暂不可用。',
          ok: false,
          operation: 'travel_search',
        }),
        contentType: 'application/json',
        status: 503,
      })
      return
    }
    if (body.operation === 'ai_trip_edit_plan') {
      editRequests += 1
      expect(body.searchResults).toBeUndefined()
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          operation: 'ai_trip_edit_plan',
          patchPlan: {
            operations: [
              { itemId: 'item_ai_edit_1', reason: '未查询实时网页，仅按本地上下文调整标题。', title: '西湖本地散步', type: 'update_item_title' },
            ],
            summary: '按本地上下文生成修改建议。',
            warnings: ['联网搜索暂未接入，未查询实时信息。'],
          },
          source: 'mock',
          warnings: ['联网搜索暂未接入，未查询实时信息。'],
        }),
        contentType: 'application/json',
      })
      return
    }
    await route.fulfill({
      body: JSON.stringify({ code: 'unsupported', message: 'unexpected operation', ok: false }),
      contentType: 'application/json',
      status: 501,
    })
  })
  await seedAiEditSearchTrip(page)

  await page.goto('/#/trip?tripId=trip-ai-edit-search&dayId=day_ai_edit_search_1', { waitUntil: 'domcontentloaded' })
  const panel = page.getByTestId('ai-trip-edit-panel')
  await panel.getByTestId('ai-trip-edit-command').fill('查询西湖最新开放时间，并把标题改清楚')
  await panel.getByRole('button', { name: '生成修改方案' }).click()
  await page.getByTestId('ai-trip-edit-send-confirm-dialog').getByRole('button', { name: '确认发送' }).click()
  await expect(panel.getByTestId('ai-trip-edit-preview')).toContainText('西湖本地散步')
  await expect(panel.getByTestId('ai-trip-edit-warnings')).toContainText('联网搜索暂未接入，未查询实时信息。')
  await expect(panel.getByTestId('ai-trip-edit-search-sources')).toHaveCount(0)
  expect(travelSearchRequests).toBe(1)
  expect(editRequests).toBe(1)
  await expectNoHorizontalOverflow(page)
})

async function seedAiEditSearchTrip(page: Page) {
  const now = Date.now()
  await seedTravelRecords(page, {
    trips: [{
      createdAt: now,
      destination: '杭州',
      endDate: '2026-07-11',
      id: 'trip-ai-edit-search',
      notes: '搜索测试备注不应发送',
      startDate: '2026-07-10',
      title: '杭州搜索测试',
      updatedAt: now,
    }],
    days: [
      { date: '2026-07-10', id: 'day_ai_edit_search_1', sortOrder: 1, title: '第一天', tripId: 'trip-ai-edit-search' },
    ],
    itineraryItems: [
      {
        address: '杭州市西湖区',
        createdAt: now,
        dayId: 'day_ai_edit_search_1',
        id: 'item_ai_edit_1',
        lat: 30.244,
        lng: 120.155,
        locationName: '西湖风景名胜区',
        notes: '默认不发送的备注',
        sortOrder: 1,
        ticketIds: ['ticket_1'],
        title: '西湖',
        tripId: 'trip-ai-edit-search',
        updatedAt: now,
      },
    ],
    ticketMetas: [{
      createdAt: now,
      fileName: 'ticket.pdf',
      fileType: 'pdf',
      id: 'ticket_1',
      itemId: 'item_ai_edit_1',
      mimeType: 'application/pdf',
      size: 1,
      tripId: 'trip-ai-edit-search',
      updatedAt: now,
    }],
  })
}

async function readItemTitle(page: import('@playwright/test').Page, itemId: string) {
  return page.evaluate(async (currentItemId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('TravelConsoleDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const tx = db.transaction(['itineraryItems'], 'readonly')
    const title = await new Promise<string | undefined>((resolve, reject) => {
      const request = tx.objectStore('itineraryItems').get(currentItemId)
      request.onsuccess = () => resolve(request.result?.title)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return title
  }, itemId)
}

async function readItineraryItem(page: import('@playwright/test').Page, itemId: string) {
  return page.evaluate(async (currentItemId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('TravelConsoleDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const item = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = db.transaction(['itineraryItems'], 'readonly').objectStore('itineraryItems').get(currentItemId)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return item
  }, itemId)
}

async function readTripNotes(page: import('@playwright/test').Page, tripId: string) {
  return page.evaluate(async (currentTripId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('TravelConsoleDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const notes = await new Promise<string | undefined>((resolve, reject) => {
      const request = db.transaction(['trips'], 'readonly').objectStore('trips').get(currentTripId)
      request.onsuccess = () => resolve(request.result?.notes)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return notes
  }, tripId)
}

async function writeItemTitle(page: import('@playwright/test').Page, itemId: string, title: string) {
  return page.evaluate(async ({ currentItemId, nextTitle }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('TravelConsoleDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['itineraryItems'], 'readwrite')
      const store = tx.objectStore('itineraryItems')
      const getRequest = store.get(currentItemId)
      getRequest.onsuccess = () => {
        store.put({ ...getRequest.result, title: nextTitle })
      }
      getRequest.onerror = () => reject(getRequest.error)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  }, { currentItemId: itemId, nextTitle: title })
}

async function readAiEditBoundaryCounts(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    async function openDb(name: string) {
      return new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    }
    async function countStore(db: IDBDatabase, storeName: string) {
      if (!Array.from(db.objectStoreNames).includes(storeName)) return 0
      const tx = db.transaction([storeName], 'readonly')
      return new Promise<number>((resolve, reject) => {
        const request = tx.objectStore(storeName).count()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    }

    const travelDb = await openDb('TravelConsoleDB')
    const routeDb = await openDb('TripMapRouteCacheDB')
    const counts = {
      days: await countStore(travelDb, 'days'),
      itineraryItems: await countStore(travelDb, 'itineraryItems'),
      routeCaches: await countStore(routeDb, 'routeCaches'),
      ticketBlobs: await countStore(travelDb, 'ticketBlobs'),
      ticketMetas: await countStore(travelDb, 'ticketMetas'),
      trips: await countStore(travelDb, 'trips'),
    }
    travelDb.close()
    routeDb.close()
    return counts
  })
}

async function readDayItemOrder(page: import('@playwright/test').Page, dayId: string) {
  return page.evaluate(async (currentDayId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('TravelConsoleDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const tx = db.transaction(['itineraryItems'], 'readonly')
    const index = tx.objectStore('itineraryItems').index('dayId')
    const items = await new Promise<Array<{ id: string; sortOrder: number; title: string }>>((resolve, reject) => {
      const request = index.getAll(currentDayId)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return items.sort((first, second) => first.sortOrder - second.sortOrder).map((item) => item.id)
  }, dayId)
}

async function readRouteCacheEntryCount(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('TripMapRouteCacheDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    if (!Array.from(db.objectStoreNames).includes('routeCaches')) {
      db.close()
      return 0
    }
    const tx = db.transaction(['routeCaches'], 'readonly')
    const count = await new Promise<number>((resolve, reject) => {
      const request = tx.objectStore('routeCaches').count()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return count
  })
}

async function expectTripPreviewRenderedInPlot(
  page: Page,
  expectedMarkerCount: number,
  options: { requireMarkers?: boolean } = {},
) {
  await expect.poll(async () => {
    return page.evaluate(({ expectedMarkerCount: markerCount, requireMarkers }) => {
      const plot = document.querySelector<HTMLElement>('[data-testid="trip-map-overview-plot"]')
      const map = document.querySelector<HTMLElement>('[data-testid="trip-map-preview-map"]')
      if (!plot || !map) return false

      const plotRect = plot.getBoundingClientRect()
      const mapRect = map.getBoundingClientRect()
      const hasVisiblePlot =
        plotRect.width > 0 &&
        plotRect.height > 0 &&
        mapRect.width > 0 &&
        mapRect.height > 0
      if (!hasVisiblePlot) return false

      const isCenteredInPlot = (rect: DOMRect) => {
        const centerX = rect.left + rect.width / 2
        const centerY = rect.top + rect.height / 2
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          centerX >= plotRect.left &&
          centerX <= plotRect.right &&
          centerY >= plotRect.top &&
          centerY <= plotRect.bottom
        )
      }

      const markers = Array.from(plot.querySelectorAll<HTMLElement>('[data-testid="trip-map-overview-marker"]'))
      const markersAreReady =
        markers.length === markerCount &&
        markers.every((marker) => isCenteredInPlot(marker.getBoundingClientRect()))
      if (markersAreReady) return true
      if (requireMarkers) return false

      const canvas = map.querySelector<HTMLCanvasElement>('canvas')
      return Boolean(canvas && isCenteredInPlot(canvas.getBoundingClientRect()))
    }, { expectedMarkerCount, requireMarkers: options.requireMarkers ?? false })
  }).toBe(true)
}

async function mockGoogleMapsScript(page: Page) {
  await page.route('https://maps.googleapis.com/maps/api/js**', async (route) => {
    await route.fulfill({
      body: `
        (() => {
          const listeners = new WeakMap();
          function getListeners(target, event) {
            let targetListeners = listeners.get(target);
            if (!targetListeners) {
              targetListeners = {};
              listeners.set(target, targetListeners);
            }
            targetListeners[event] ||= [];
            return targetListeners[event];
          }
          class LatLng {
            constructor(lat, lng) {
              this._lat = lat;
              this._lng = lng;
            }
            lat() { return this._lat; }
            lng() { return this._lng; }
          }
          class LatLngBounds {
            constructor(sw, ne) {
              this.sw = sw;
              this.ne = ne;
            }
          }
          class Map {
            constructor(container, options) {
              this.container = container;
              this.center = new LatLng(options.center.lat, options.center.lng);
              this.zoom = options.zoom;
              this.panes = { overlayMouseTarget: container };
              window.setTimeout(() => {
                google.maps.event.trigger(this, 'tilesloaded');
                google.maps.event.trigger(this, 'idle');
              }, 0);
            }
            fitBounds() { google.maps.event.trigger(this, 'idle'); }
            getCenter() { return this.center; }
            getZoom() { return this.zoom; }
            panTo(center) { this.center = new LatLng(center.lat, center.lng); google.maps.event.trigger(this, 'idle'); }
            setCenter(center) { this.center = new LatLng(center.lat, center.lng); }
            setOptions(options) {
              if (options.center) this.setCenter(options.center);
              if (options.zoom != null) this.zoom = options.zoom;
            }
            setZoom(zoom) { this.zoom = zoom; }
          }
          class OverlayView {
            setMap(map) {
              this.map = map;
              if (map) {
                this.onAdd?.();
                this.draw?.();
              } else {
                this.onRemove?.();
              }
            }
            getPanes() { return this.map?.panes; }
            getProjection() {
              return {
                fromLatLngToDivPixel: (position) => ({
                  x: (position.lng() - 139) * 1000 + 160,
                  y: (36 - position.lat()) * 1000 + 80,
                }),
              };
            }
          }
          class Polyline {
            constructor(options) {
              this.path = options.path ?? [];
              this.element = document.createElement('div');
              this.element.dataset.testid = 'trip-map-google-route-line';
              this.element.setAttribute('data-point-count', String(this.path.length));
              this.setMap(options.map ?? null);
            }
            setMap(map) {
              this.map = map;
              this.element.remove();
              if (map && this.path.length > 0) {
                map.container.appendChild(this.element);
              }
            }
            setPath(path) {
              this.path = path;
              this.element.setAttribute('data-point-count', String(this.path.length));
              this.setMap(this.map);
            }
          }
          const event = {
            addListener(target, name, handler) {
              getListeners(target, name).push(handler);
              return { remove() {} };
            },
            addListenerOnce(target, name, handler) {
              const wrapped = () => handler();
              getListeners(target, name).push(wrapped);
              return { remove() {} };
            },
            trigger(target, name) {
              for (const handler of getListeners(target, name)) handler();
            },
          };
          window.google = { maps: { event, LatLng, LatLngBounds, Map, OverlayView, Polyline } };
          window.__googleMapsInitCallback?.();
        })();
      `,
      contentType: 'application/javascript',
    })
  })
}
