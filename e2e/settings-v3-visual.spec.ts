import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import {
  clearTravelDatabase,
  expectNoHorizontalOverflow,
  forceSupabaseFixture,
} from './helpers'

test.use({ colorScheme: 'light', locale: 'zh-CN', timezoneId: 'Europe/London' })

const captureGoldens = process.env.CAPTURE_UI_V3_GOLDENS === '1'
const goldenOutputDirectory = resolve('output/playwright/ui-v3-settings')
const requiredViewports = [
  { height: 568, name: '320x568', width: 320 },
  { height: 844, name: '390x844', width: 390 },
  { height: 932, name: '430x932', width: 430 },
  { height: 1024, name: '768x1024', width: 768 },
  { height: 900, name: '1440x900', width: 1440 },
]
const settingsRoutes = [
  { heading: '我的', name: 'index', path: '/#/settings' },
  { heading: '账户与同步', name: 'account', path: '/#/settings/account' },
  { heading: '旅行偏好', name: 'preferences', path: '/#/settings/preferences' },
  { heading: '应用与通知', name: 'app', path: '/#/settings/app' },
  { heading: '数据与高级', name: 'advanced', path: '/#/settings/advanced' },
]

test('UI V3 设置保持四组一级菜单和默认收起的二级技术项', async ({ page }) => {
  const browserErrors: string[] = []
  let providerRequests = 0
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))
  await page.route('**/api/provider-proxy', (route) => {
    providerRequests += 1
    void route.abort()
  })

  await clearTravelDatabase(page)
  await forceSupabaseFixture(page, { backups: [], user: null })
  if (captureGoldens) await mkdir(goldenOutputDirectory, { recursive: true })

  for (const route of settingsRoutes) {
    await page.goto(route.path, { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { exact: true, name: route.heading })).toHaveCount(1)
    await expectNoHorizontalOverflow(page)

    if (route.name === 'index') {
      for (const label of ['账户与同步', '旅行偏好', '应用与通知', '数据与高级']) {
        await expect(page.getByRole('button', { name: new RegExp(label) })).toBeVisible()
      }
    }
    if (route.name === 'account') {
      await expect(page.getByRole('heading', { exact: true, name: '登录旅图' })).toBeVisible()
      await expect(page.getByLabel('Supabase 登录邮箱')).toBeVisible()
      await expect(page.getByLabel('Supabase 登录验证码')).toHaveCount(0)
      await expect(page.getByText(/Auth session missing|Supabase/i)).toHaveCount(0)
    }
    if (route.name === 'preferences') {
      await expect(page.getByText('旅行节奏', { exact: true })).toBeVisible()
      await expect(page.getByText(/本地检查|隐私/)).toHaveCount(0)
    }
    if (route.name === 'advanced') {
      await expect(page.getByText('AI 与隐私', { exact: true })).toBeVisible()
      await expect(page.getByText('行程基础信息', { exact: true })).toBeHidden()
      await expect(page.getByText('路线服务', { exact: true })).toBeHidden()
    }

    for (const viewport of requiredViewports) {
      await page.setViewportSize({ height: viewport.height, width: viewport.width })
      await page.evaluate(() => window.scrollTo(0, 0))
      await expectNoHorizontalOverflow(page)
      await expectSettingsBounds(page)
      if (captureGoldens) {
        await page.screenshot({
          animations: 'disabled',
          caret: 'hide',
          path: resolve(goldenOutputDirectory, `settings-${route.name}-${viewport.name}.png`),
        })
      }
    }
  }

  expect(providerRequests).toBe(0)
  expect(browserErrors).toEqual([])
})

async function expectSettingsBounds(page: Page) {
  const bounds = await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>('main')
    const content = main?.firstElementChild as HTMLElement | null
    if (!main || !content) return null
    const mainRect = main.getBoundingClientRect()
    const contentRect = content.getBoundingClientRect()
    return {
      contentLeft: contentRect.left,
      contentRight: contentRect.right,
      mainLeft: mainRect.left,
      mainRight: mainRect.right,
      viewportWidth: innerWidth,
    }
  })
  expect(bounds).not.toBeNull()
  if (!bounds) return
  expect(bounds.mainLeft).toBeGreaterThanOrEqual(-1)
  expect(bounds.mainRight).toBeLessThanOrEqual(bounds.viewportWidth + 1)
  expect(bounds.contentLeft).toBeGreaterThanOrEqual(bounds.mainLeft - 1)
  expect(bounds.contentRight).toBeLessThanOrEqual(bounds.mainRight + 1)
}
