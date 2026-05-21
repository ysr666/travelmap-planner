import { expect, test } from '@playwright/test'
import {
  clearTravelDatabase,
  createDemoTripViaUi,
  expectNoHorizontalOverflow,
  mockMapStyle,
} from './helpers'

test('设置页可以切换外观模式并在刷新后保留', async ({ page }) => {
  await clearTravelDatabase(page)
  await page.goto('/#/settings', { waitUntil: 'domcontentloaded' })

  const html = page.locator('html')
  await expect(page.getByTestId('appearance-settings').getByRole('heading', { name: '外观' }).first()).toBeVisible()
  await expect(page.getByTestId('appearance-mode-system')).toHaveAttribute('aria-pressed', 'true')
  await expectNoHorizontalOverflow(page)

  await page.getByTestId('appearance-mode-dark').click()
  await expect(html).toHaveClass(/dark/)
  await expect(page.getByTestId('appearance-mode-dark')).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => window.localStorage.getItem('tripmap:appearance'))).toBe('dark')

  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(html).toHaveClass(/dark/)
  await expect(page.getByTestId('appearance-mode-dark')).toHaveAttribute('aria-pressed', 'true')

  await page.goto('/#/home', { waitUntil: 'domcontentloaded' })
  await expect(html).toHaveClass(/dark/)
  await expect(page.getByText('还没有旅行')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await mockMapStyle(page)
  const tripId = await createDemoTripViaUi(page)
  await expect(html).toHaveClass(/dark/)
  await page.goto(`/#/trip?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('trip-map-overview')).toBeVisible()
  await expect(page.getByTestId('trip-map-overview')).toContainText('行程地图预览')
  await expect(html).toHaveClass(/dark/)
  await expectNoHorizontalOverflow(page)

  await page.goto('/#/settings', { waitUntil: 'domcontentloaded' })
  await page.getByTestId('appearance-mode-light').click()
  await expect.poll(async () => (await html.getAttribute('class')) ?? '').not.toContain('dark')
  await expect(page.getByTestId('appearance-mode-light')).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => window.localStorage.getItem('tripmap:appearance'))).toBe('light')

  await page.getByTestId('appearance-mode-system').click()
  await expect(page.getByTestId('appearance-mode-system')).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => window.localStorage.getItem('tripmap:appearance'))).toBe('system')
  await expectNoHorizontalOverflow(page)
})
