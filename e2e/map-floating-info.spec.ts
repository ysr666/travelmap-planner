import { expect, test, type Locator, type Page } from '@playwright/test'
import { createDemoTripViaUi, expectNoHorizontalOverflow, mockMapStyle } from './helpers'

test.beforeEach(async ({ page }) => {
  await mockMapStyle(page)
})

test('地图视图只保留浮动信息栏，不渲染底部抽屉', async ({ page }) => {
  await createDemoTripViaUi(page)
  await page.getByTestId('view-switch-map').click()

  await expect(page).toHaveURL(/view=map/)
  await expect(page.getByTestId('map-sheet')).toHaveCount(0)
  await expect(page.getByTestId('map-sheet-handle')).toHaveCount(0)
  await expect(page.getByTestId('route-chip')).toHaveCount(0)
  await expect(page.getByTestId('route-controls-section')).toHaveCount(0)
  await expect(page.getByTestId('view-switch-map')).toBeVisible()
  await expect(page.getByTestId('view-switch-schedule')).toBeVisible()
  await expect(page.getByTestId('day-selector')).toBeVisible()
  await expectDaySelectorShadowBreathingRoom(page)

  const markerCard = page.getByTestId('map-marker-card')
  await expect(markerCard).toBeVisible({ timeout: 15000 })
  await expect(markerCard).toContainText('Hotel Metropolitan Tokyo 入住')
  await expect(markerCard).toContainText('15:00')
  await expect(page.getByRole('link', { name: /Apple 地图|Apple/ })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Google 地图|Google/ })).toHaveCount(0)

  await page.getByTestId('view-switch-schedule').click()
  await expect(page).toHaveURL(/view=schedule/)
  await expect(page.getByRole('heading', { name: '当天日程' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('点击地图 marker 更新浮动信息栏并可进入详情', async ({ page }) => {
  await createDemoTripViaUi(page)
  await page.getByTestId('view-switch-map').click()

  const hotelMarker = page.getByRole('button', { name: /选择 Hotel Metropolitan Tokyo 入住/ })
  const shibuyaSkyMarker = page.getByRole('button', { name: /选择 Shibuya Sky 夜景/ })
  const markerCard = page.getByTestId('map-marker-card')

  await expect(markerCard).toBeVisible({ timeout: 15000 })
  await expect(markerCard.getByTestId('map-marker-card-open')).toContainText('详情')
  const stationButtons = markerCard.getByTestId('map-marker-card-station')
  await expect(stationButtons).toHaveCount(3)
  await expect(stationButtons.nth(0)).toHaveAttribute('aria-current', 'true')
  await stationButtons.nth(2).click()
  await expect(markerCard).toContainText('Shibuya Sky 夜景')
  await expect(stationButtons.nth(2)).toHaveAttribute('aria-current', 'true')
  await expectMarkerAndCardInUsableMapArea(page, shibuyaSkyMarker, markerCard)

  await expect(shibuyaSkyMarker).toBeVisible()
  await shibuyaSkyMarker.click()
  await expect(markerCard).toContainText('Shibuya Sky 夜景')
  await expectMarkerAndCardInUsableMapArea(page, shibuyaSkyMarker, markerCard)

  await page.getByTestId('map-recenter-button').click()
  await expect(hotelMarker).toBeVisible()
  await hotelMarker.click()
  await expect(markerCard).toContainText('Hotel Metropolitan Tokyo 入住')
  await expectMarkerAndCardInUsableMapArea(page, hotelMarker, markerCard)

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

test('地图重定位不会生成路线且保留浮动信息栏', async ({ page }) => {
  let routeRequestCount = 0
  await page.route('https://api.openrouteservice.org/**', (route) => {
    routeRequestCount += 1
    return route.abort()
  })

  await createDemoTripViaUi(page)
  await page.getByTestId('view-switch-map').click()
  await expect(page.getByTestId('map-recenter-button')).toBeVisible({ timeout: 15000 })
  await expect(page.getByTestId('map-marker-card')).toBeVisible()

  await page.getByTestId('map-recenter-button').click()
  expect(routeRequestCount).toBe(0)
  await expect(page.getByTestId('map-marker-card')).toContainText('Hotel Metropolitan Tokyo 入住')
  await expectMarkerGroupNearVisibleCenter(page)
  await expectNoHorizontalOverflow(page)
})

test('地图日期条真实点击可以在 Day 1 和 Day 2 间切换', async ({ page }) => {
  await createDemoTripViaUi(page)
  await page.getByTestId('view-switch-map').click()
  await expect(page.getByTestId('map-marker-card')).toBeVisible({ timeout: 15000 })

  await page.getByTestId('day-selector').getByRole('button', { name: /Day 2/ }).click()
  await expect(page.getByRole('heading', { name: '第 2 天 · 4月13日' })).toBeVisible()

  const day1Box = await page.getByTestId('day-selector').getByRole('button', { name: /Day 1/ }).boundingBox()
  expect(day1Box).not.toBeNull()
  if (!day1Box) {
    throw new Error('Day 1 日期按钮没有可用布局盒')
  }

  await page.mouse.click(day1Box.x + day1Box.width / 2, day1Box.y + day1Box.height / 2)
  await expect(page.getByRole('heading', { name: '第 1 天 · 4月12日' })).toBeVisible()
  await expect(page.getByTestId('map-sheet')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('使用 mocked geolocation 显示当前位置且远距离时优先回到行程范围', async ({ page, context }) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: 34.6937, longitude: 135.5023 })

  await createDemoTripViaUi(page)
  await page.getByTestId('view-switch-map').click()
  await expect(page.getByTestId('map-user-location-button')).toBeVisible({ timeout: 15000 })

  await page.getByTestId('map-user-location-button').click()
  await expect(page.getByTestId('map-user-location-marker')).toHaveCount(1)
  await expect(page.getByTestId('map-location-notice')).toContainText('当前位置距离行程较远')
  await expectNoTextOverflow(page.getByTestId('map-location-notice'))
  await expectNoHorizontalOverflow(page)
})

test('使用 mocked geolocation 成功路径显示当前位置', async ({ page, context }) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: 35.6897, longitude: 139.702 })

  await createDemoTripViaUi(page)
  await page.getByTestId('view-switch-map').click()
  await expect(page.getByTestId('map-user-location-button')).toBeVisible({ timeout: 15000 })

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
  await expect(page.getByTestId('map-user-location-button')).toBeVisible({ timeout: 15000 })

  await page.getByTestId('map-user-location-button').click()
  await expect(page.getByTestId('map-location-notice')).toContainText('请在地址栏允许位置后重试')
  await expectLocationNoticeAlignedWithButton(page)
  await expectNoTextOverflow(page.getByTestId('map-location-notice'))
  await expect(page.getByTestId('map-user-location-marker')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

async function expectMarkerAndCardInUsableMapArea(page: Page, marker: Locator, markerCard: Locator) {
  await expect(marker).toBeVisible()
  await expect(markerCard).toBeVisible()

  await expect.poll(async () => {
    const viewport = page.viewportSize()
    const markerBox = await marker.boundingBox()
    const cardBox = await markerCard.boundingBox()
    if (!viewport || !markerBox || !cardBox) {
      return false
    }

    const tolerance = 12
    return (
      markerBox.x >= -tolerance &&
      markerBox.x + markerBox.width <= viewport.width + tolerance &&
      markerBox.y >= -tolerance &&
      markerBox.y + markerBox.height <= cardBox.y + tolerance &&
      cardBox.x >= 8 &&
      cardBox.x + cardBox.width <= viewport.width - 8 &&
      cardBox.y >= 48 &&
      cardBox.y + cardBox.height <= viewport.height - 48
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
    const switchBox = await page.getByTestId('view-switch-map').boundingBox()
    const selectorBox = await page.getByTestId('day-selector').boundingBox()
    const locationButtonBox = await page.getByTestId('map-user-location-button').boundingBox()
    if (!viewport || markerBoxes.length === 0 || !cardBox || !switchBox || !selectorBox || !locationButtonBox) {
      return Number.POSITIVE_INFINITY
    }

    const safeTop = Math.max(
      switchBox.y + switchBox.height,
      selectorBox.y + selectorBox.height,
      locationButtonBox.y + locationButtonBox.height,
    ) + 12
    const safeBottom = cardBox.y - 12
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
  }).toBeLessThanOrEqual(140)
}

async function getVisibleMarkerBoxes(page: Page) {
  const boxes = []
  for (const marker of await page.getByTestId('day-map-marker').all()) {
    const box = await marker.boundingBox()
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

  expect(noticeBox.x + noticeBox.width).toBeLessThanOrEqual(locationButtonBox.x - 6)
  expect(Math.abs((noticeBox.y + noticeBox.height / 2) - (locationButtonBox.y + locationButtonBox.height / 2))).toBeLessThanOrEqual(48)
}
