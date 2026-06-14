import { expect, test } from '@playwright/test'
import { clearTravelDatabase, createDemoTripViaUi, expectNoHorizontalOverflow, forceSupabaseUnconfigured } from './helpers'

test('账号旅行收件箱在连接器后端未配置时保留本地能力', async ({ page }) => {
  await clearTravelDatabase(page)
  await forceSupabaseUnconfigured(page)
  await page.goto('/#/inbox', { waitUntil: 'domcontentloaded' })

  await expect(page.getByTestId('travel-inbox-page')).toBeVisible()
  await expect(page.getByRole('heading', { name: '旅行收件箱' })).toBeVisible()
  await expect(page.getByText('连接器后端未配置')).toBeVisible()
  await expect(page.getByRole('button', { name: '收件箱' })).toHaveClass(/text-primary/)
  await expect(page.getByRole('button', { name: '连接 Gmail' })).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('Trip Home 保留手动收件箱并可进入账号总收件箱', async ({ page }) => {
  await createDemoTripViaUi(page)
  await page.getByTestId('day-back-to-trip').click()

  await expect(page.getByTestId('travel-inbox-panel')).toBeVisible()
  await page.getByRole('button', { name: '查看账号旅行收件箱' }).click()
  await expect(page).toHaveURL(/#\/inbox/)
  await expect(page.getByTestId('travel-inbox-page')).toBeVisible()
})
