import { expect, test } from '@playwright/test'
import {
  clearTravelDatabase,
  createDemoTripViaUi,
  expectNoHorizontalOverflow,
  getFirstTripDayAndItemIds,
  mockMapStyle,
} from './helpers'

test('设置页可以切换外观模式并在刷新后保留', async ({ page }) => {
  await clearTravelDatabase(page)
  await page.goto('/#/settings/app', { waitUntil: 'domcontentloaded' })

  const html = page.locator('html')
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
  await expect(page.getByRole('heading', { name: '还没有旅行' })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await mockMapStyle(page)
  const tripId = await createDemoTripViaUi(page)
  const { dayId } = await getFirstTripDayAndItemIds(page, tripId)
  await expect(html).toHaveClass(/dark/)
  await page.goto(`/#/day?tripId=${tripId}&dayId=${dayId}&view=map`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: /选择 Hotel Metropolitan Tokyo 入住/ }).click()
  await expect(page.getByTestId('map-marker-card')).toBeVisible({ timeout: 15_000 })
  await expect(html).toHaveClass(/dark/)
  await expectNoHorizontalOverflow(page)

  await page.goto('/#/settings/app', { waitUntil: 'domcontentloaded' })
  await page.getByTestId('appearance-mode-light').click()
  await expect.poll(async () => (await html.getAttribute('class')) ?? '').not.toContain('dark')
  await expect(page.getByTestId('appearance-mode-light')).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => window.localStorage.getItem('tripmap:appearance'))).toBe('light')

  await page.getByTestId('appearance-mode-system').click()
  await expect(page.getByTestId('appearance-mode-system')).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => window.localStorage.getItem('tripmap:appearance'))).toBe('system')
  await expectNoHorizontalOverflow(page)
})

test('设置页展示 PWA 生命周期状态和网络能力边界', async ({ page }) => {
  await clearTravelDatabase(page)
  await page.goto('/#/settings/app', { waitUntil: 'domcontentloaded' })

  await expect(page.locator('main')).toContainText(/应用更新：(等待注册|已启用|应用外壳可离线打开|有新版本可更新|更新检查失败|当前浏览器不支持应用更新控制)/)
  await expect(page.locator('main')).toContainText(/当前版本：v\d+\.\d+\.\d+/)
  await expect(page.locator('main')).toContainText(/当前在线|当前离线/)
  await expectNoHorizontalOverflow(page)
})
