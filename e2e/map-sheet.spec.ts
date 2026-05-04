import { expect, test } from '@playwright/test'
import { createDemoTripViaUi, expectNoHorizontalOverflow } from './helpers'

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
