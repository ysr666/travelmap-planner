import { expect, test } from '@playwright/test'
import { createDemoTripViaUi, expectNoHorizontalOverflow } from './helpers'

test('本机搜索可筛选行程点并进入准确详情', async ({ page }) => {
  const tripId = await createDemoTripViaUi(page)

  await page.getByRole('button', { name: '搜索', exact: true }).click()
  await expect(page).toHaveURL(/#\/search/)
  await expect(page.getByRole('heading', { name: '搜索' })).toBeVisible()
  await expect(page.getByTestId('search-filter-trip')).toContainText('1')
  await expect(page.getByTestId('search-filter-item')).toContainText('5')

  await page.getByRole('searchbox', { name: '搜索关键词' }).fill('Shibuya Sky')
  const itemGroup = page.getByTestId('search-group-item')
  await expect(itemGroup).toBeVisible()
  await expect(itemGroup.getByRole('button', { name: '打开Shibuya Sky 夜景' })).toBeVisible()
  await expect(page.getByTestId('search-group-trip')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)

  await itemGroup.getByRole('button', { name: '打开Shibuya Sky 夜景' }).click()
  await expect(page).toHaveURL(new RegExp(`#\/item\?[^#]*tripId=${tripId}`))
  await expect(page.getByRole('heading', { name: 'Shibuya Sky 夜景' })).toBeVisible()
})
