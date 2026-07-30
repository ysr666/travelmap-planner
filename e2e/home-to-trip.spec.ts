import { expect, test } from '@playwright/test'
import { clearTravelDatabase, expectNoHorizontalOverflow, getFirstTripDayAndItemIds } from './helpers'

test('首页可以手动创建示例旅行并进入旅行工作台', async ({ page }) => {
  await clearTravelDatabase(page)

  const banner = page.getByRole('banner')
  await expect(banner.getByRole('heading', { name: '今日' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '还没有旅行' })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.getByRole('button', { name: '创建示例旅行' }).click()
  await expect(page.getByRole('button', { name: '当前旅行：东京春日旅行' })).toBeVisible()
  await expect(page.locator('.maplibregl-map')).toHaveCount(1)
  await page.getByRole('button', { name: '行程', exact: true }).click()

  await expect(page).toHaveURL(/#\/trip\?tripId=/)
  await expect(page.getByRole('heading', { name: '行程', exact: true })).toBeVisible()
  const tripId = new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('tripId')
  expect(tripId).toBeTruthy()
  const { dayId } = await getFirstTripDayAndItemIds(page, tripId!)
  await page.goto(`/#/day?tripId=${tripId}&dayId=${dayId}&view=schedule`, { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=schedule/)
  await expect(page.getByTestId('day-selector')).toBeVisible()
  await expect(page.getByTestId('view-switch-schedule')).toBeVisible()
  await expect(page.getByTestId('view-switch-map')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.getByRole('button', { name: '更多操作', exact: true }).click()
  const dayMoreMenu = page.getByTestId('day-more-menu')
  await expect(dayMoreMenu).toBeVisible()
  await expect(dayMoreMenu.getByRole('button', { name: '票据库' })).toBeVisible()
  await dayMoreMenu.getByRole('button', { name: '旅行总览' }).click()
  await expect(page).toHaveURL(/#\/trip\?tripId=/)
  await expect(page.getByRole('heading', { name: '行程', exact: true })).toBeVisible()
  await expectNoHorizontalOverflow(page)
})
