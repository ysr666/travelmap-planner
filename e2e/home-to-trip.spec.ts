import { expect, test } from '@playwright/test'
import { clearTravelDatabase, clickTripCard, expectNoHorizontalOverflow } from './helpers'

test('首页可以手动创建示例旅行并进入旅行工作台', async ({ page }) => {
  await clearTravelDatabase(page)

  const banner = page.getByRole('banner')
  await expect(banner.getByRole('heading', { name: '旅图' })).toBeVisible()
  await expect(page.locator('main').getByText(/旅图 v\d+\.\d+\.\d+(?:\.\d+)? · 本地优先/)).toBeVisible()
  await expect(page.getByRole('heading', { name: '还没有旅行' })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.getByRole('button', { name: '创建示例旅行' }).click()
  const tripCard = page.getByTestId('trip-card').filter({ hasText: '东京春日旅行' })
  await expect(tripCard).toBeVisible()
  await expect(tripCard).toContainText('东京春日旅行')
  await expect(tripCard).toContainText('日本东京')
  await expect(tripCard).toContainText('4月12日 - 4月17日')
  await expect(tripCard).toContainText('2 天')
  await expect(tripCard).toContainText('5 个行程点')
  await clickTripCard(tripCard)

  await expect(page).toHaveURL(/#\/trip\?tripId=/)
  await expect(page.getByRole('heading', { name: '每日行程' })).toBeVisible()
  await page.getByRole('button', { name: /抵达与涩谷/ }).click()
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=schedule/)
  await expect(page.getByTestId('day-selector')).toBeVisible()
  await expect(page.getByTestId('view-switch-schedule')).toBeVisible()
  await expect(page.getByTestId('view-switch-map')).toBeVisible()
  await expectNoHorizontalOverflow(page)
})
