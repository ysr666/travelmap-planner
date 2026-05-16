import { expect, test } from '@playwright/test'
import {
  clearTravelDatabase,
  createDemoTripViaUi,
  expectNoHorizontalOverflow,
  forceSupabaseUnconfigured,
} from './helpers'

test('设置页 Supabase 未配置时显示云端备份提示且不显示登录上传控件', async ({ page }) => {
  await clearTravelDatabase(page)
  await forceSupabaseUnconfigured(page)
  await page.goto('/#/settings', { waitUntil: 'domcontentloaded' })
  const cloudSection = page.getByTestId('cloud-backup-section')
  if (!(await cloudSection.isVisible().catch(() => false))) {
    await page
      .locator('details')
      .filter({ hasText: '云端备份' })
      .first()
      .locator('summary')
      .click()
  }

  await expect(cloudSection).toBeVisible()
  const message = page.getByTestId('supabase-unconfigured-message')
  await expect(message).toContainText('云端备份未配置')
  await expect(message).toContainText('VITE_SUPABASE_URL')
  await expect(message).toContainText('VITE_SUPABASE_ANON_KEY')
  await expect(
    page.getByText('真实上传/恢复前，请确认 Supabase RLS、Storage policy 和 Auth Redirect URL 已配置。'),
  ).toBeVisible()
  await expect(page.getByTestId('auto-cloud-backup-setting')).toContainText('自动云端备份')
  await expect(page.getByTestId('auto-cloud-backup-setting')).toContainText('配置 Supabase 后才能开启。')
  await expect(page.getByTestId('auto-cloud-backup-toggle')).toBeDisabled()
  await expect(page.getByTestId('cloud-login-form')).toHaveCount(0)
  await expect(page.getByTestId('cloud-upload-current-trip')).toHaveCount(0)
  await expect(page.getByTestId('cloud-backup-list')).toHaveCount(0)
  await expect(page.getByTestId('cloud-snapshot-check-prompts')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('设置页通过 section=cloud 可以直接打开云端备份区域', async ({ page }) => {
  await clearTravelDatabase(page)
  await forceSupabaseUnconfigured(page)
  await page.goto('/#/settings?section=cloud', { waitUntil: 'domcontentloaded' })
  const cloudSection = page.getByTestId('cloud-backup-section')
  await expect(cloudSection).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('Day View 不显示云端快照检查提醒', async ({ page }) => {
  await clearTravelDatabase(page)
  await forceSupabaseUnconfigured(page)
  const tripId = await createDemoTripViaUi(page)
  await page.goto(`/#/trip?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })

  await page.getByRole('button', { name: /第一天/ }).click()
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page.getByTestId('cloud-snapshot-check-card')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('本地新建和编辑旅行不受云端快照提醒干扰', async ({ page }) => {
  await clearTravelDatabase(page)
  await forceSupabaseUnconfigured(page)
  await page.goto('/#/home', { waitUntil: 'domcontentloaded' })

  await page.getByRole('button', { name: '新建旅行' }).click()
  await expect(page.getByTestId('trip-form-page')).toBeVisible()

  await page.getByLabel('旅行标题').fill('测试旅行')
  await page.getByLabel('开始日期').fill('2026-06-01')
  await page.getByLabel('结束日期').fill('2026-06-02')
  await page.getByTestId('trip-form-submit').click()
  await expect(page).toHaveURL(/#\/trip\?tripId=/)

  await expect(page.getByTestId('cloud-snapshot-check-card')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('设置页可以保存和清除本机路线服务 key', async ({ page }) => {
  await clearTravelDatabase(page)
  await forceSupabaseUnconfigured(page)
  await page.goto('/#/settings', { waitUntil: 'domcontentloaded' })
  await page.getByText('路线服务配置', { exact: true }).click()

  await expect(page.getByTestId('routing-settings-section')).toBeVisible()
  const input = page.getByTestId('routing-api-key-input')
  await input.fill('local-routing-key')
  await page.getByTestId('routing-api-key-save').click()
  await expect(page.getByText('路线服务 key 已保存到当前浏览器本机。')).toBeVisible()

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByText('路线服务配置', { exact: true }).click()
  await expect(page.getByTestId('routing-settings-section')).toContainText('已使用本机 key')
  await page.getByTestId('routing-api-key-clear').click()
  await expect(page.getByText('已清除本机路线服务 key')).toBeVisible()
  await expectNoHorizontalOverflow(page)
})
