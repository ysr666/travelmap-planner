import { expect, test, type Locator, type Page } from '@playwright/test'
import { createDemoTripViaUi, expectNoHorizontalOverflow, forceRoutingUnconfigured, mockMapStyle } from './helpers'

test.beforeEach(async ({ page }) => {
  await mockMapStyle(page)
})

test('地图视图 bottom sheet 可以拖拽并保留本地行程列表', async ({ page }) => {
  await createDemoTripViaUi(page)
  await page.getByTestId('view-switch-map').click()

  const sheet = page.getByTestId('map-sheet')
  const handle = page.getByTestId('map-sheet-handle')
  await expect(sheet).toBeVisible()
  await expect(handle).toBeVisible()
  await expect(page.getByRole('heading', { name: '抵达与涩谷' })).toBeVisible()
  if (await page.getByTestId('map-base-loading').isVisible().catch(() => false)) {
    await expect(page.getByTestId('route-chip')).toBeHidden()
  }
  await expect(page.getByTestId('route-chip')).toBeVisible({ timeout: 15000 })
  await expect(page.getByTestId('route-status-pill')).toContainText('直线连接')
  await expect(page.getByTestId('route-chip')).not.toContainText(/生成|更新|清理缓存|步行|驾车|公交/)
  await expect(page.getByTestId('route-controls-section')).toBeHidden()
  await expect(page.getByTestId('route-mode-segment-straight')).toBeHidden()
  await expect(page.getByTestId('route-mode-segment-road')).toBeHidden()
  await expect(page.getByTestId('route-transport-walk')).toBeHidden()
  await expect(page.getByTestId('route-generate-button')).toBeHidden()
  await expect(page.getByTestId('map-collapsed-sheet')).toBeVisible()
  await expect(page.getByTestId('map-collapsed-item-preview')).toHaveCount(0)
  await expect(page.getByTestId('map-sheet-preview-list')).toBeHidden()
  await expect(page.getByText('上拉查看行程')).toBeHidden()
  await expect(page.getByRole('link', { name: /Apple 地图|Apple/ })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Google 地图|Google/ })).toHaveCount(0)
  await expectDaySelectorShadowBreathingRoom(page)

  const routeChipBox = await page.getByTestId('route-chip').boundingBox()
  const viewport = page.viewportSize()
  expect(routeChipBox).not.toBeNull()
  expect(viewport).not.toBeNull()
  if (!routeChipBox || !viewport) {
    throw new Error('路线 chip 或视口没有可用布局盒')
  }
  expect(routeChipBox.x).toBeGreaterThanOrEqual(16)
  expect(routeChipBox.x + routeChipBox.width).toBeLessThanOrEqual(viewport.width - 16)

  const before = await sheet.boundingBox()
  const handleBox = await handle.boundingBox()
  expect(before).not.toBeNull()
  expect(handleBox).not.toBeNull()

  if (!before || !handleBox) {
    throw new Error('地图抽屉或拖拽横条没有可用布局盒')
  }

  const startX = handleBox.x + handleBox.width / 2
  const startY = handleBox.y + handleBox.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX, startY - 110, { steps: 8 })
  await page.mouse.up()

  await expect.poll(async () => {
    return (await sheet.boundingBox())?.height ?? 0
  }).toBeGreaterThan(before.height + 40)
  await expect(page.getByTestId('map-sheet-preview-list')).toBeVisible()
  await expect(page.getByTestId('route-controls-section')).toBeHidden()
  await page.getByTestId('route-more-toggle').click()
  await expect(page.getByTestId('route-controls-section')).toBeVisible()
  await expect(page.getByTestId('route-more-panel')).toBeHidden()
  await expect(page.getByTestId('route-warning-details')).toBeHidden()
  await page.getByTestId('route-more-toggle').click()
  await expect(page.getByTestId('route-controls-section')).toBeHidden()

  const hotelListItem = page.getByRole('button', { name: /Hotel Metropolitan Tokyo 入住/ }).first()
  await expect(hotelListItem).toBeVisible()
  await hotelListItem.click()
  await expect(hotelListItem).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('collapsed sheet stays summary-only and marker card owns item preview', async ({ page }) => {
  await createDemoTripViaUi(page)
  await page.getByTestId('view-switch-map').click()

  await expect(page.getByTestId('map-collapsed-sheet')).toBeVisible()
  await expect(page.getByTestId('map-collapsed-item-preview')).toHaveCount(0)
  await expect(page.getByTestId('map-sheet-preview-list')).toBeHidden()
  await expect(page.getByRole('link', { name: /Apple 地图|Apple/ })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Google 地图|Google/ })).toHaveCount(0)

  await page.getByRole('button', { name: /选择 Hotel Metropolitan Tokyo 入住/ }).click()
  await expect(page.getByTestId('map-marker-card')).toBeVisible()
  await expect(page.getByTestId('map-collapsed-item-preview')).toHaveCount(0)
  await page.getByTestId('map-marker-card-open').click()
  await expect(page).toHaveURL(/#\/item\?/)
  await expect(page).toHaveURL(/view=map/)
  await expect(page.getByRole('heading', { name: /Hotel Metropolitan Tokyo/ })).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('点击地图 marker 显示轻量地点卡片并可进入详情', async ({ page }) => {
  await createDemoTripViaUi(page)
  await page.getByTestId('view-switch-map').click()

  await expect(page.getByTestId('route-chip')).toBeVisible({ timeout: 15000 })
  await expect(page.getByTestId('route-controls-section')).toBeHidden()

  const hotelMarker = page.getByRole('button', { name: /选择 Hotel Metropolitan Tokyo 入住/ })
  const shibuyaSkyMarker = page.getByRole('button', { name: /选择 Shibuya Sky 夜景/ })
  await expect(shibuyaSkyMarker).toBeVisible()
  await shibuyaSkyMarker.click()

  const markerCard = page.getByTestId('map-marker-card')
  await expect(markerCard).toBeVisible()
  await expect(markerCard).toContainText('Shibuya Sky 夜景')
  await expectMarkerAndCardInUsableMapArea(page, shibuyaSkyMarker, markerCard)

  await page.getByTestId('map-recenter-button').click()
  await expect(hotelMarker).toBeVisible()
  await hotelMarker.click()

  await expect(markerCard).toContainText('15:00')
  await expect(markerCard).toContainText('Hotel Metropolitan Tokyo 入住')
  await expect(markerCard).toContainText('Hotel Metropolitan Tokyo')
  await expectMarkerAndCardInUsableMapArea(page, hotelMarker, markerCard)
  await expect(page.getByTestId('map-sheet-preview-list')).toBeHidden()
  await expect(page.getByTestId('route-controls-section')).toBeHidden()

  await page.getByTestId('map-marker-card-close').click()
  await expect(markerCard).toBeHidden()

  await hotelMarker.click()
  await page.getByTestId('map-marker-card-open').click()
  await expect(page).toHaveURL(/#\/item\?/)
  await expect(page).toHaveURL(/view=map/)
  await expect(page.getByRole('heading', { name: /Hotel Metropolitan Tokyo/ })).toBeVisible()

  await page.getByLabel('返回地图').click()
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=map/)
  await expectNoHorizontalOverflow(page)
})

test('地图重定位不会生成路线且保留 marker 卡片和路线控件', async ({ page }) => {
  let routeRequestCount = 0
  await page.route('https://api.openrouteservice.org/**', (route) => {
    routeRequestCount += 1
    return route.abort()
  })

  await createDemoTripViaUi(page)
  await page.getByTestId('view-switch-map').click()
  await expect(page.getByTestId('route-chip')).toBeVisible({ timeout: 15000 })
  await expect(page.getByTestId('map-recenter-button')).toBeVisible()

  await page.getByTestId('map-recenter-button').click()
  expect(routeRequestCount).toBe(0)
  await expect(page.getByTestId('route-controls-section')).toBeHidden()

  await page.getByRole('button', { name: /选择 Hotel Metropolitan Tokyo 入住/ }).click()
  await expect(page.getByTestId('map-marker-card')).toBeVisible()
  await expect(page.getByTestId('map-marker-card')).toContainText('Hotel Metropolitan Tokyo 入住')
  await page.getByTestId('map-recenter-button').click()
  await expectMarkerGroupNearVisibleCenter(page)

  await page.getByTestId('route-chip').click()
  await expect(page.getByTestId('route-controls-section')).toBeVisible()
  await expect(page.getByTestId('map-marker-card')).toBeHidden()
  await page.getByTestId('map-recenter-button').click()
  await expect(page.getByTestId('route-controls-section')).toBeVisible()
  expect(routeRequestCount).toBe(0)
  await expectNoHorizontalOverflow(page)
})

test('使用 mocked geolocation 显示当前位置且远距离时优先回到行程范围', async ({ page, context }) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: 34.6937, longitude: 135.5023 })

  await createDemoTripViaUi(page)
  await page.getByTestId('view-switch-map').click()
  await expect(page.getByTestId('route-chip')).toBeVisible({ timeout: 15000 })

  await page.getByTestId('map-user-location-button').click()
  await expect(page.getByTestId('map-user-location-marker')).toHaveCount(1)
  await expect(page.getByTestId('map-location-notice')).toContainText('当前位置距离行程较远，已优先回到当天行程范围')
  await expectNoTextOverflow(page.getByTestId('map-location-notice'))
  await expectNoHorizontalOverflow(page)
})

test('使用 mocked geolocation 成功路径显示当前位置', async ({ page, context }) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: 35.6897, longitude: 139.702 })

  await createDemoTripViaUi(page)
  await page.getByTestId('view-switch-map').click()
  await expect(page.getByTestId('route-chip')).toBeVisible({ timeout: 15000 })

  await page.getByTestId('map-user-location-button').click()
  await expect(page.getByTestId('map-user-location-marker')).toBeVisible()
  await expect(page.getByTestId('map-location-notice')).toBeHidden()
  await expectNoHorizontalOverflow(page)
})

test('当前位置权限被拒绝时显示轻量 fallback', async ({ page, context }) => {
  await context.clearPermissions()
  await page.addInitScript(() => {
    Object.defineProperty(window.navigator, 'geolocation', {
      configurable: true,
      value: {
        clearWatch: () => undefined,
        getCurrentPosition: (
          _success: PositionCallback,
          error?: PositionErrorCallback | null,
        ) => {
          error?.({
            code: 1,
            message: 'denied',
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          } as GeolocationPositionError)
        },
        watchPosition: () => 1,
      },
    })
  })

  await createDemoTripViaUi(page)
  await page.getByTestId('view-switch-map').click()
  await expect(page.getByTestId('route-chip')).toBeVisible({ timeout: 15000 })

  await page.getByTestId('map-user-location-button').click()
  await expect(page.getByTestId('map-location-notice')).toContainText('请在地址栏允许位置后重试')
  await expectLocationNoticeAlignedWithButton(page)
  await expectNoTextOverflow(page.getByTestId('map-location-notice'))
  await expect(page.getByTestId('map-user-location-marker')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('地图路线服务未配置时保留直线连接提示', async ({ page }) => {
  await createDemoTripViaUi(page)
  await forceRoutingUnconfigured(page)
  await page.getByTestId('view-switch-map').click()

  await expect(page.getByTestId('route-chip')).toBeVisible({ timeout: 15000 })
  await expect(page.getByTestId('route-status-pill')).toContainText('直线连接')
  await expect(page.getByTestId('route-chip')).not.toContainText(/生成|更新|清理缓存|步行|驾车|公交/)
  await expect(page.getByTestId('route-controls-section')).toBeHidden()
  await expect(page.getByTestId('route-transport-walk')).toBeHidden()
  await page.getByTestId('route-chip').click()
  await expect(page.getByTestId('route-controls-section')).toBeVisible()
  await page.getByTestId('route-mode-segment-road').click()
  await expect(page.getByTestId('route-status-pill')).toContainText('无法生成路线')
  await expect(page.getByTestId('route-generate-button')).toBeDisabled()
  await expect(page.getByTestId('route-more-panel')).toBeHidden()
  await page.getByTestId('route-details-toggle').click()
  await expect(page.getByTestId('route-more-panel')).toContainText('未配置 ORS')
  await expectNoHorizontalOverflow(page)
})

test('配置本机路线 key 后可以用 mock provider 生成道路路线', async ({ page }) => {
  await page.route('https://api.openrouteservice.org/**', async (route) => {
    const request = route.request()
    expect(request.method()).toBe('POST')
    expect(request.headers().authorization).toBe('fake-routing-key')
    const body = request.postDataJSON() as { coordinates: number[][] }
    expect(body.coordinates[0]).toHaveLength(2)
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: body.coordinates,
            },
            properties: {
              summary: {
                distance: 1200,
                duration: 600,
              },
            },
          },
        ],
      }),
    })
  })

  await createDemoTripViaUi(page)
  await page.evaluate(() => {
    window.localStorage.setItem('tripmap:routing:provider', 'openrouteservice')
    window.localStorage.setItem('tripmap:routing:openrouteservice-api-key', 'fake-routing-key')
  })
  await page.getByTestId('view-switch-map').click()
  await page.getByTestId('route-chip').click()
  await expect(page.getByTestId('route-controls-section')).toBeVisible()
  await page.getByTestId('route-mode-segment-road').click()
  await page.getByTestId('route-generate-button').click()

  await expect(page.getByTestId('route-status-pill')).toContainText(/道路路线|部分失败|本地缓存/)
  await expectNoHorizontalOverflow(page)
})

test('道路路线生成后可从本地缓存恢复并可清理', async ({ page }) => {
  let routeRequestCount = 0
  await page.route('https://api.openrouteservice.org/**', async (route) => {
    routeRequestCount += 1
    const body = route.request().postDataJSON() as { coordinates: number[][] }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: body.coordinates,
            },
            properties: {
              summary: {
                distance: 1200,
                duration: 600,
              },
            },
          },
        ],
      }),
    })
  })

  await createDemoTripViaUi(page)
  await page.evaluate(() => {
    window.localStorage.setItem('tripmap:routing:provider', 'openrouteservice')
    window.localStorage.setItem('tripmap:routing:openrouteservice-api-key', 'fake-routing-key')
  })
  await page.getByTestId('view-switch-map').click()
  await page.getByTestId('route-chip').click()
  await expect(page.getByTestId('route-controls-section')).toBeVisible()
  await page.getByTestId('route-mode-segment-road').click()
  await page.getByTestId('route-generate-button').click()
  await expect(page.getByTestId('route-status-pill')).toContainText(/道路路线|部分失败|本地缓存/)

  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('map-sheet')).toBeVisible()
  await expect(page.getByTestId('route-controls-section')).toBeHidden()
  await expect(page.getByTestId('route-chip')).toContainText('本地缓存')
  await expect(page.getByTestId('route-chip')).not.toContainText(/生成|更新|清理缓存|步行|驾车|公交/)
  await expect(page.getByTestId('route-generate-button')).toBeHidden()

  const requestsAfterCacheLoad = routeRequestCount
  await page.evaluate(() => {
    window.localStorage.setItem('tripmap:routing:provider', 'none')
    window.localStorage.removeItem('tripmap:routing:openrouteservice-api-key')
    window.dispatchEvent(new Event('tripmap:routing-config-changed'))
  })
  await expect(page.getByTestId('route-chip')).toContainText('本地缓存')
  await page.getByTestId('route-chip').click()
  await expect(page.getByTestId('route-controls-section')).toBeVisible()
  await expect(page.getByTestId('route-generate-button')).toBeDisabled()
  await expect(page.getByTestId('route-more-panel')).toBeHidden()
  await page.getByTestId('route-details-toggle').click()
  await expect(page.getByTestId('route-more-panel')).toContainText('未配置 ORS')
  expect(routeRequestCount).toBe(requestsAfterCacheLoad)

  await page.getByRole('button', { name: '清理缓存' }).click()
  await expect(page.getByTestId('route-status-pill')).toContainText('直线连接')
  await expectNoHorizontalOverflow(page)
})

test('公交段生成道路路线时显示近似提示', async ({ page }) => {
  let sawDrivingCarRequest = false
  let routeRequestCount = 0
  await page.route('https://api.openrouteservice.org/**', async (route) => {
    routeRequestCount += 1
    const request = route.request()
    const body = request.postDataJSON() as { coordinates: number[][] }
    if (request.url().includes('/driving-car/')) {
      sawDrivingCarRequest = true
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: body.coordinates,
            },
            properties: {
              summary: {
                distance: 1200,
                duration: 600,
              },
            },
          },
        ],
      }),
    })
  })

  await createDemoTripViaUi(page)
  await page.evaluate(() => {
    window.localStorage.setItem('tripmap:routing:provider', 'openrouteservice')
    window.localStorage.setItem('tripmap:routing:openrouteservice-api-key', 'fake-routing-key')
  })
  await page.getByTestId('view-switch-map').click()
  await page.getByTestId('route-chip').click()
  await expect(page.getByTestId('route-controls-section')).toBeVisible()
  await page.getByTestId('route-mode-segment-road').click()
  await page.getByTestId('route-transport-bus').click()
  await expect(page.getByTestId('route-status-pill')).toContainText('公交近似')
  await expect(page.getByTestId('route-more-panel')).toBeHidden()
  await expect(page.getByTestId('route-warning-details')).toBeHidden()
  await page.getByTestId('route-details-toggle').click()
  await expect(page.getByTestId('route-more-panel')).toContainText('公交为道路近似')
  await expect(page.getByTestId('route-warning-details')).toContainText('公交为道路近似')
  expect(routeRequestCount).toBe(0)
  await page.getByTestId('route-generate-button').click()

  await expect.poll(() => routeRequestCount).toBeGreaterThan(0)
  await expect(page.getByTestId('route-status-pill')).toContainText('公交近似')
  expect(sawDrivingCarRequest).toBe(true)
  await expectNoHorizontalOverflow(page)
})

async function expectMarkerAndCardInUsableMapArea(page: Page, marker: Locator, markerCard: Locator) {
  await expect(marker).toBeVisible()
  await expect(markerCard).toBeVisible()

  await expect.poll(async () => {
    const viewport = page.viewportSize()
    const markerBox = await marker.boundingBox()
    const cardBox = await markerCard.boundingBox()
    const sheetBox = await page.getByTestId('map-sheet').boundingBox()
    if (!viewport || !markerBox || !cardBox || !sheetBox) {
      return false
    }

    const tolerance = 12
    const markerBottomLimit = Math.min(sheetBox.y, cardBox.y) - 4
    return (
      markerBox.x >= -tolerance &&
      markerBox.x + markerBox.width <= viewport.width + tolerance &&
      markerBox.y >= -tolerance &&
      markerBox.y + markerBox.height <= markerBottomLimit + tolerance &&
      cardBox.x >= 8 &&
      cardBox.x + cardBox.width <= viewport.width - 8 &&
      cardBox.y >= 48 &&
      cardBox.y + cardBox.height <= sheetBox.y + tolerance
    )
  }, {
    message: 'selected marker and marker card should fit in the usable map area',
    timeout: 1500,
  }).toBe(true)
}

async function expectDaySelectorShadowBreathingRoom(page: Page) {
  const selectorBox = await page.getByTestId('day-selector').boundingBox()
  const activeDayBox = await page.getByTestId('day-selector').getByRole('button', { name: /Day 1/ }).boundingBox()

  expect(selectorBox).not.toBeNull()
  expect(activeDayBox).not.toBeNull()
  if (!selectorBox || !activeDayBox) {
    throw new Error('日期选择器或当前日期按钮没有可用布局盒')
  }

  expect(activeDayBox.y - selectorBox.y).toBeGreaterThanOrEqual(2)
  expect(selectorBox.y + selectorBox.height - (activeDayBox.y + activeDayBox.height)).toBeGreaterThanOrEqual(2)
}

async function expectMarkerGroupNearVisibleCenter(page: Page) {
  await expect.poll(async () => {
    const viewport = page.viewportSize()
    const markerBoxes = await getVisibleMarkerBoxes(page)
    const cardBox = await page.getByTestId('map-marker-card').boundingBox()
    const sheetBox = await page.getByTestId('map-sheet').boundingBox()
    const routeChipBox = await page.getByTestId('route-chip').boundingBox()
    const locationButtonBox = await page.getByTestId('map-user-location-button').boundingBox()
    if (!viewport || markerBoxes.length === 0 || !cardBox || !sheetBox || !routeChipBox || !locationButtonBox) {
      return Number.POSITIVE_INFINITY
    }

    const safeTop = Math.max(routeChipBox.y + routeChipBox.height, locationButtonBox.y + locationButtonBox.height) + 12
    const safeBottom = Math.min(cardBox.y, sheetBox.y) - 12
    const visibleCenterY = safeTop + Math.max(0, safeBottom - safeTop) / 2
    const visibleCenterX = viewport.width / 2
    const markerGroupCenterY = (
      Math.min(...markerBoxes.map((box) => box.y)) +
      Math.max(...markerBoxes.map((box) => box.y + box.height))
    ) / 2
    const markerGroupCenterX = (
      Math.min(...markerBoxes.map((box) => box.x)) +
      Math.max(...markerBoxes.map((box) => box.x + box.width))
    ) / 2

    return Math.max(
      Math.abs(markerGroupCenterX - visibleCenterX),
      Math.abs(markerGroupCenterY - visibleCenterY),
    )
  }, {
    message: 'recenter should place the itinerary near the visual map center',
    timeout: 1500,
  }).toBeLessThanOrEqual(100)
}

async function getVisibleMarkerBoxes(page: Page) {
  const markers = page.getByTestId('day-map-marker')
  const markerCount = await markers.count()
  const boxes = []
  for (let index = 0; index < markerCount; index += 1) {
    const box = await markers.nth(index).boundingBox()
    if (box) {
      boxes.push(box)
    }
  }
  return boxes
}

async function expectNoTextOverflow(locator: Locator) {
  const overflow = await locator.evaluate((element) => ({
    clientHeight: element.clientHeight,
    clientWidth: element.clientWidth,
    scrollHeight: element.scrollHeight,
    scrollWidth: element.scrollWidth,
  }))

  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1)
  expect(overflow.scrollHeight).toBeLessThanOrEqual(overflow.clientHeight + 1)
}

async function expectLocationNoticeAlignedWithButton(page: Page) {
  const noticeBox = await page.getByTestId('map-location-notice').boundingBox()
  const locationButtonBox = await page.getByTestId('map-user-location-button').boundingBox()

  expect(noticeBox).not.toBeNull()
  expect(locationButtonBox).not.toBeNull()
  if (!noticeBox || !locationButtonBox) {
    throw new Error('定位提示或定位按钮没有可用布局盒')
  }

  expect(Math.abs(noticeBox.y - locationButtonBox.y)).toBeLessThanOrEqual(2)
  expect(Math.abs(noticeBox.height - locationButtonBox.height)).toBeLessThanOrEqual(4)
  expect(noticeBox.x + noticeBox.width).toBeLessThanOrEqual(locationButtonBox.x - 8)
}
