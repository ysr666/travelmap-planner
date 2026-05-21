import { expect, test } from '@playwright/test'
import {
  createDemoTripViaUi,
  expectNoHorizontalOverflow,
  forceSupabaseUnconfigured,
  getHashParam,
  mockMapStyle,
} from './helpers'

test('旅行工作台可以在日程和地图视图之间切换', async ({ page }) => {
  await mockMapStyle(page)
  const tripId = await createDemoTripViaUi(page)
  expect(tripId).toBeTruthy()

  await expect(page.getByText('当天日程')).toBeVisible()
  await expect(page.getByText('Hotel Metropolitan Tokyo 入住')).toBeVisible()
  const dayBrief = page.getByTestId('day-local-brief-card')
  await expect(dayBrief).toBeVisible()
  await expect(dayBrief).toContainText('当日简报')
  await expect(dayBrief).toContainText('本地检查')
  await expect(dayBrief).toContainText('准备提醒')
  await expect(dayBrief).toContainText(/根据已填写内容|基于当前本地行程信息/)
  await expect(dayBrief).toContainText('后续可接入天气、开放时间和路线信息')
  await expect(dayBrief.getByRole('button')).toHaveCount(0)
  await expect(page).toHaveURL(/#\/day\?/)
  await expectNoHorizontalOverflow(page)

  await page.getByTestId('view-switch-map').click()
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=map/)
  await expect(page.getByTestId('map-sheet')).toBeVisible()
  await expect(page.getByRole('heading', { name: '抵达与涩谷' })).toBeVisible()
  await expect(dayBrief).toBeHidden()
  await expectNoHorizontalOverflow(page)

  await page.getByTestId('view-switch-schedule').click()
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=schedule/)
  await expect(page.getByText('当天日程')).toBeVisible()
  await expect(page.getByText('Hotel Metropolitan Tokyo 入住')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.getByTestId('view-switch-map').click()
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=map/)
  await expect(page.getByTestId('map-sheet')).toBeVisible()
  await expect(page.getByRole('heading', { name: '抵达与涩谷' })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.getByTestId('day-selector').getByRole('button', { name: /Day 2/ }).click()
  await expect(page).toHaveURL(/view=map/)
  await expect(page.getByTestId('map-sheet')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  const currentTripId = getHashParam(page.url(), 'tripId')
  const currentDayId = getHashParam(page.url(), 'dayId')
  expect(currentTripId).toBe(tripId)
  expect(currentDayId).toBeTruthy()

  await page.getByRole('button', { name: '总览' }).click()
  await expect(page).toHaveURL(/#\/trip\?/)
  await expect(page.getByText('每日行程')).toBeVisible()
  await expect(page.getByText('第一天')).toBeVisible()
  await expect(page.getByText('第二天')).toBeVisible()
  await expect(page.getByText('抵达与涩谷')).toBeVisible()
  await expect(page.getByText('浅草与东京站')).toBeVisible()
  await expect(page.getByText('2026年4月12日')).toBeVisible()
  await expect(page.getByText('3 个行程点')).toBeVisible()
  const mapOverview = page.getByTestId('trip-map-overview')
  const localCheck = page.getByTestId('local-trip-check-card')
  await expect(localCheck).toBeVisible()
  await expect(localCheck).toContainText('行程体检')
  await expect(localCheck).toContainText('本地检查')
  await expect(localCheck).toContainText('准备提醒')
  await expect(localCheck).toContainText('行程点')
  await expect(localCheck).toContainText('票据')
  await expect(localCheck).toContainText('后续可接入天气、开放时间和路线信息')
  await expect(localCheck.getByRole('button')).toHaveCount(0)
  expect(await localCheck.getByTestId('local-trip-check-finding').count()).toBeLessThanOrEqual(3)
  await expectNoHorizontalOverflow(page)

  await expect(mapOverview).toBeVisible()
  await expect(mapOverview).toContainText('行程地图预览')
  await expect(mapOverview).toContainText('5 个有坐标地点')
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
  await expect(page.getByTestId('map-sheet')).toBeVisible()

  await page.getByRole('button', { name: '总览' }).click()
  await expect(page).toHaveURL(/#\/trip\?/)

  await page.getByRole('button', { name: '更多' }).click()
  const moreMenu = page.getByTestId('trip-more-menu')
  await expect(moreMenu).toBeVisible()
  await expect(moreMenu.getByRole('button', { name: '设置' })).toBeVisible()
  await expect(moreMenu.getByText('设置与存储说明')).toHaveCount(0)
  await expect(moreMenu.getByText(/Google Maps 配置|路线服务配置|设备存储/)).toHaveCount(0)
  await moreMenu.getByRole('button', { name: '更多' }).click()
  await expectNoHorizontalOverflow(page)

  await page.goto(`/#/trip?tripId=${tripId}&dayId=${currentDayId}&view=map`, { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=map/)

  await page.getByRole('button', { name: '总览' }).click()
  await expect(page).toHaveURL(/#\/trip\?/)
  await page.getByRole('button', { name: '票据库' }).click()
  await expect(page).toHaveURL(/#\/tickets\?/)
  await expect(page.getByText('票据库')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await forceSupabaseUnconfigured(page)
  await page.goto(`/#/settings?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('PWA 和离线使用')).toBeVisible()
  await page.getByText('关于', { exact: true }).click()
  await expect(page.getByText(/当前版本：v\d+\.\d+\.\d+(?:\.\d+)?/)).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('Trip Home 地图预览缓存路线且路线顺序建议需要确认', async ({ page }) => {
  await mockMapStyle(page)
  let orsCalls = 0
  await page.route('https://api.openrouteservice.org/**', async (route) => {
    orsCalls += 1
    await route.fulfill({
      body: JSON.stringify({
        features: [
          {
            geometry: {
              coordinates: [[139.1, 35.1], [139.2, 35.2]],
              type: 'LineString',
            },
            properties: { summary: { distance: 1000, duration: 600 } },
            type: 'Feature',
          },
        ],
        type: 'FeatureCollection',
      }),
      contentType: 'application/json',
    })
  })
  await page.route('https://routes.googleapis.com/directions/v2:computeRoutes', async (route) => {
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
  const tripId = await createDemoTripViaUi(page)
  const dayId = getHashParam(page.url(), 'dayId')
  expect(dayId).toBeTruthy()

  await page.evaluate(({ currentDayId, currentTripId }) => {
    window.localStorage.setItem('tripmap:routing:provider', 'openrouteservice')
    window.localStorage.setItem('tripmap:routing:openrouteservice-api-key', 'fake-routing-key')
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
  const mapOverview = page.getByTestId('trip-map-overview')
  await expect(mapOverview).toContainText('行程地图预览')
  await expect(mapOverview.getByTestId('trip-map-overview-marker')).toHaveCount(6)
  await expect(mapOverview.getByTestId('trip-map-overview-note')).toContainText('ORS 路线几何')
  expect(orsCalls).toBeGreaterThan(0)
  await page.waitForLoadState('networkidle')

  const callsAfterFirstLoad = orsCalls
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('trip-map-overview').getByTestId('trip-map-overview-note')).toContainText('已缓存的 ORS 路线几何')
  await page.waitForLoadState('networkidle')
  expect(orsCalls).toBe(callsAfterFirstLoad)

  await page.evaluate(() => {
    window.localStorage.setItem('tripmap:google-maps-api-key', 'fake-google-key')
    window.dispatchEvent(new Event('tripmap:google-maps-config-changed'))
  })
  await expect(page.getByTestId('trip-map-optimization-panel')).toBeVisible()
  await page.getByTestId('trip-map-optimization-check').click()
  await expect(page.getByTestId('trip-map-optimization-suggestion')).toContainText('东京站补充点')

  const originalOrder = await readDayItemOrder(page, dayId as string)
  await page.getByTestId('trip-map-optimization-apply').click()
  await expect(page.getByTestId('trip-map-optimization-confirm')).toBeVisible()
  await page.getByTestId('trip-map-optimization-cancel').click()
  expect(await readDayItemOrder(page, dayId as string)).toEqual(originalOrder)

  await page.getByTestId('trip-map-optimization-apply').click()
  await page.getByTestId('trip-map-optimization-confirm-apply').click()
  await expect.poll(() => readDayItemOrder(page, dayId as string)).not.toEqual(originalOrder)
  await expectNoHorizontalOverflow(page)
})

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
