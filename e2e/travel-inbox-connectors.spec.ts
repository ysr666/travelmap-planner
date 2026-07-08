import { expect, test } from '@playwright/test'
import { clearTravelDatabase, createDemoTripViaUi, expectNoHorizontalOverflow, forceSupabaseUnconfigured } from './helpers'

test('账号旅行收件箱在连接器后端未配置时保留本地能力', async ({ page }) => {
  await clearTravelDatabase(page)
  await forceSupabaseUnconfigured(page)
  await page.goto('/#/inbox', { waitUntil: 'domcontentloaded' })

  await expect(page.getByTestId('travel-inbox-page')).toBeVisible()
  await expect(page.getByRole('heading', { name: '旅行收件箱' })).toBeVisible()
  await expect(page.getByText('邮箱同步暂不可用')).toBeVisible()
  await expect(page.getByRole('button', { name: '收件箱' })).toHaveClass(/text-on-primary-fixed/)
  await expect(page.getByRole('button', { name: '连接 Gmail' })).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('Trip Home 用轻量入口保留材料输入并可进入账号总收件箱', async ({ page }) => {
  await createDemoTripViaUi(page)
  await page.getByTestId('day-back-to-trip').click()

  await expect(page.getByTestId('travel-inbox-panel')).toHaveCount(0)
  await expect(page.getByTestId('trip-action-travel-inbox')).toBeVisible()
  await page.getByTestId('trip-action-account-inbox').click()
  await expect(page).toHaveURL(/#\/inbox/)
  await expect(page.getByTestId('travel-inbox-page')).toBeVisible()
})
