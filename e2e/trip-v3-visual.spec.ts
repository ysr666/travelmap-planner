import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import tripVisualFixture from './fixtures/trip-v3-visual.json' with { type: 'json' }
import {
  clearTravelDatabase,
  expectNoHorizontalOverflow,
  seedTravelRecords,
} from './helpers'

test.use({ colorScheme: 'light', locale: 'zh-CN', timezoneId: 'Europe/London' })

const captureGoldens = process.env.CAPTURE_UI_V3_GOLDENS === '1'
const goldenOutputDirectory = resolve('output/playwright/ui-v3-itinerary')
const requiredViewports = [
  { height: 568, name: '320x568', width: 320 },
  { height: 844, name: '390x844', width: 390 },
  { height: 932, name: '430x932', width: 430 },
  { height: 1024, name: '768x1024', width: 768 },
  { height: 900, name: '1440x900', width: 1440 },
]

test('UI V3 行程页保持紧凑日期条和连续时间轴', async ({ page }) => {
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
  await page.clock.setFixedTime(new Date(tripVisualFixture.fixedNow))
  await clearTravelDatabase(page)
  await page.evaluate(() => window.localStorage.setItem('tripmap:appearance', 'light'))
  await seedTravelRecords(page, tripVisualFixture.records)
  await page.goto('/#/trip?tripId=trip_itinerary_v3', { waitUntil: 'domcontentloaded' })

  await expect(page.getByRole('heading', { exact: true, name: '行程' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: '行程内容' })).toBeVisible()
  await expect(page.getByTestId('trip-day-link')).toHaveCount(12)
  await expect(page.getByTestId('trip-day-link').filter({ hasText: '16' })).toHaveAttribute('aria-current', 'page')
  const timeline = page.getByTestId('trip-home-focus-timeline')
  await expect(timeline).toHaveAttribute('aria-label', /伦敦经典路线/)
  await expect(timeline.getByRole('listitem')).toHaveCount(4)
  await expect(timeline.getByText('Great British Museum, Bloomsbury', { exact: true })).toBeVisible()
  await expect(timeline.getByText('步行 10 分钟', { exact: true })).toBeVisible()
  await expect(timeline.getByText('公交 20 分钟', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { exact: true, name: '添加行程点' })).toHaveCount(1)

  const dayThree = page.getByRole('button', { name: /第 3 天.*博物馆与西区/ })
  await dayThree.click()
  await expect(dayThree).toHaveAttribute('aria-current', 'page')
  await expect(page.getByText('这一天还没有行程点', { exact: true })).toBeVisible()
  const dayTwo = page.getByRole('button', { name: /第 2 天.*伦敦经典路线/ })
  await dayTwo.click()
  await expect(timeline.getByRole('listitem')).toHaveCount(4)

  await page.getByRole('button', { exact: true, name: '更多' }).click()
  const moreMenu = page.getByTestId('trip-more-menu')
  await expect(moreMenu).toBeVisible()
  await expect(moreMenu.getByRole('button', { exact: true, name: '编辑旅行' })).toBeVisible()
  await moreMenu.getByRole('button', { exact: true, name: '关闭更多操作菜单' }).click()

  if (captureGoldens) await mkdir(goldenOutputDirectory, { recursive: true })

  for (const viewport of requiredViewports) {
    await page.setViewportSize({ height: viewport.height, width: viewport.width })
    await page.evaluate(() => {
      window.scrollTo(0, 0)
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    })
    await expectNoHorizontalOverflow(page)
    await expectTripLayout(page)

    if (captureGoldens) {
      await page.screenshot({
        animations: 'disabled',
        caret: 'hide',
        path: resolve(goldenOutputDirectory, `trip-${viewport.name}.png`),
      })
    }
  }

  expect(providerRequests).toBe(0)
  expect(browserErrors).toEqual([])
})

async function expectTripLayout(page: Page) {
  const layout = await page.evaluate(() => {
    const dateStrip = document.querySelector<HTMLElement>('.trip-date-strip')
    const timeline = document.querySelector<HTMLElement>('.trip-timeline')
    const tools = document.querySelector<HTMLElement>('.trip-workspace-secondary')
    const navigation = document.querySelector<HTMLElement>('.primary-navigation')
    const selectedDate = document.querySelector<HTMLElement>('.trip-date-option[aria-current="page"]')
    if (!dateStrip || !timeline || !tools || !navigation || !selectedDate) return null

    const rect = (element: HTMLElement) => {
      const bounds = element.getBoundingClientRect()
      return {
        bottom: bounds.bottom,
        height: bounds.height,
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        width: bounds.width,
      }
    }
    return {
      dateStrip: rect(dateStrip),
      navigation: rect(navigation),
      selectedDate: rect(selectedDate),
      timeline: rect(timeline),
      tools: rect(tools),
      viewportWidth: window.innerWidth,
    }
  })

  expect(layout).not.toBeNull()
  if (!layout) return
  expect(layout.selectedDate.width).toBeGreaterThanOrEqual(44)
  expect(layout.selectedDate.height).toBeGreaterThanOrEqual(44)
  expect(layout.timeline.top).toBeGreaterThanOrEqual(layout.dateStrip.bottom - 1)

  if (layout.viewportWidth < 600) {
    expect(layout.dateStrip.left).toBe(0)
    expect(layout.dateStrip.right).toBeLessThanOrEqual(layout.viewportWidth + 1)
    expect(layout.tools.top).toBeGreaterThanOrEqual(layout.navigation.top - 1)
  } else {
    expect(layout.navigation.right).toBeLessThanOrEqual(layout.dateStrip.left + 1)
  }
}
