import { expect, test } from '@playwright/test'
import { clearTravelDatabase, clickTripCard, expectNoHorizontalOverflow } from './helpers'

test('首页可以手动创建示例旅行并进入旅行工作台', async ({ page }) => {
  await clearTravelDatabase(page)

  await expect(page.getByRole('banner').getByRole('heading', { name: '旅图' })).toBeVisible()
  await expect(page.getByText(/旅图 v\d+\.\d+\.\d+(?:\.\d+)? · 本地优先/)).toBeVisible()
  await expect(page.getByText('还没有旅行')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.getByRole('button', { name: '创建示例旅行' }).click()
  const tripCard = page.getByTestId('trip-card').first()
  await expect(tripCard).toBeVisible()
  await expect(tripCard).toContainText('东京春日旅行')
  await expect(tripCard).toContainText('日本东京')
  await expect(tripCard).toContainText('4/12 - 4/17')
  await expect(tripCard).toContainText('2 天')
  await expect(tripCard).toContainText('5 个行程点')
  await clickTripCard(tripCard)

  await expect(page).toHaveURL(/#\/trip\?tripId=/)
  await page.getByTestId('view-switch-schedule').click()
  await expect(page).toHaveURL(/view=schedule/)
  await expect(page.getByTestId('day-selector')).toBeVisible()
  await expect(page.getByTestId('view-switch-schedule')).toBeVisible()
  await expect(page.getByTestId('view-switch-map')).toBeVisible()
  await expectNoHorizontalOverflow(page)
})
