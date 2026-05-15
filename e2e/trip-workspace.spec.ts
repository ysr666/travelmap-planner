import { expect, test } from '@playwright/test'
import {
  createDemoTripViaUi,
  expectNoHorizontalOverflow,
  forceSupabaseUnconfigured,
  getHashParam,
} from './helpers'

test('旅行工作台可以在日程和地图视图之间切换', async ({ page }) => {
  const tripId = await createDemoTripViaUi(page)
  expect(tripId).toBeTruthy()

  await expect(page.getByText('当天日程')).toBeVisible()
  await expect(page.getByText('Hotel Metropolitan Tokyo 入住')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.getByTestId('view-switch-map').click()
  await expect(page).toHaveURL(/view=map/)
  await expect(page.getByTestId('map-sheet')).toBeVisible()
  await expect(page.getByRole('heading', { name: '抵达与涩谷' })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.getByTestId('view-switch-schedule').click()
  await expect(page).toHaveURL(/view=schedule/)
  await expect(page.getByText('当天日程')).toBeVisible()
  await expect(page.getByText('Hotel Metropolitan Tokyo 入住')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.getByTestId('view-switch-map').click()
  await expect(page).toHaveURL(/view=map/)
  await expect(page.getByTestId('map-sheet')).toBeVisible()
  await expect(page.getByRole('heading', { name: '抵达与涩谷' })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.getByTestId('day-selector').getByRole('button', { name: /Day 2/ }).click()
  await expect(page).toHaveURL(/view=map/)
  await expect(page.getByTestId('map-sheet')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  const currentTripId = getHashParam(page.url(), 'tripId')
  expect(currentTripId).toBe(tripId)

  await page.goto(`/#/overview?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('每日行程')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.goto(`/#/tickets?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('票据库')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await forceSupabaseUnconfigured(page)
  await page.goto(`/#/settings?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('PWA 和离线使用')).toBeVisible()
  await page.getByText('关于', { exact: true }).click()
  await expect(page.getByText(/当前版本：v\d+\.\d+\.\d+(?:\.\d+)?/)).toBeVisible()
  await expectNoHorizontalOverflow(page)
})
