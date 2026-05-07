import { expect, test } from '@playwright/test'
import { createDemoTripViaUi, expectNoHorizontalOverflow, forceRoutingUnconfigured } from './helpers'

test('地图视图 bottom sheet 可以拖拽并保留本地行程列表', async ({ page }) => {
  await createDemoTripViaUi(page)
  await page.getByTestId('view-switch-map').click()

  const sheet = page.getByTestId('map-sheet')
  const handle = page.getByTestId('map-sheet-handle')
  await expect(sheet).toBeVisible()
  await expect(handle).toBeVisible()
  await expect(page.getByRole('heading', { name: '抵达与涩谷' })).toBeVisible()

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
  await page.mouse.move(startX, startY - 260, { steps: 8 })
  await page.mouse.up()

  await expect.poll(async () => {
    return (await sheet.boundingBox())?.height ?? 0
  }).toBeGreaterThan(before.height + 40)

  const hotelListItem = page.getByRole('button', { name: /Hotel Metropolitan Tokyo 入住/ }).first()
  await expect(hotelListItem).toBeVisible()
  await hotelListItem.click()
  await expect(hotelListItem).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('地图路线服务未配置时保留直线连接提示', async ({ page }) => {
  await createDemoTripViaUi(page)
  await forceRoutingUnconfigured(page)
  await page.getByTestId('view-switch-map').click()

  await expect(page.getByTestId('route-status-pill')).toContainText('直线连接')
  await expect(page.getByTestId('route-generate-button')).toBeDisabled()
  await expect(page.getByText('配置路线服务后可手动生成道路路线。')).toBeVisible()
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
  await page.getByTestId('route-generate-button').click()

  await expect(page.getByTestId('route-status-pill')).toContainText(/道路路线|部分路线失败/)
  await expectNoHorizontalOverflow(page)
})
