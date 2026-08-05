import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import formVisualFixture from './fixtures/home-v3-visual.json' with { type: 'json' }
import {
  clearTravelDatabase,
  expectNoHorizontalOverflow,
  seedTravelRecords,
} from './helpers'

test.use({ colorScheme: 'light', locale: 'zh-CN', timezoneId: 'Europe/London' })

const captureGoldens = process.env.CAPTURE_UI_V3_GOLDENS === '1'
const goldenOutputDirectory = resolve('output/playwright/ui-v3-forms')
const requiredViewports = [
  { height: 568, name: '320x568', width: 320 },
  { height: 844, name: '390x844', width: 390 },
  { height: 932, name: '430x932', width: 430 },
  { height: 1024, name: '768x1024', width: 768 },
  { height: 900, name: '1440x900', width: 1440 },
]

test('UI V3 旅行与行程点表单默认只展开基本信息和地点', async ({ page }) => {
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

  await page.clock.setFixedTime(new Date(formVisualFixture.fixedNow))
  await clearTravelDatabase(page)
  await seedTravelRecords(page, formVisualFixture.records)
  if (captureGoldens) await mkdir(goldenOutputDirectory, { recursive: true })

  const trip = formVisualFixture.records.trips[0]
  const item = formVisualFixture.records.itineraryItems[0]
  const day = formVisualFixture.records.days.find((candidate) => candidate.id === item.dayId)
  expect(day).toBeTruthy()

  const forms = [
    {
      heading: '编辑旅行',
      name: 'trip-edit',
      path: `/#/trip/edit?tripId=${trip.id}`,
      root: 'trip-form-page',
    },
    {
      heading: '编辑行程点',
      name: 'item-edit',
      path: `/#/item/edit?tripId=${trip.id}&dayId=${day!.id}&itemId=${item.id}`,
      root: 'item-form-page',
    },
  ]

  for (const form of forms) {
    await page.goto(form.path, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId(form.root)).toBeVisible()
    await expect(page.getByRole('heading', { exact: true, name: form.heading })).toBeVisible()
    await expect(page.getByText('基本信息', { exact: true })).toBeVisible()
    const more = page.locator('details').filter({ has: page.getByText('更多设置', { exact: true }) })
    await expect(more).not.toHaveAttribute('open', '')
    if (form.name === 'item-edit') {
      await expect(page.getByText('地点', { exact: true })).toBeVisible()
      await expect(more.getByText('从上一站到此处', { exact: true })).toBeHidden()
    } else {
      await expect(more.getByText('默认时区', { exact: true })).toBeHidden()
    }

    for (const viewport of requiredViewports) {
      await page.setViewportSize({ height: viewport.height, width: viewport.width })
      await page.evaluate(() => {
        const main = document.querySelector<HTMLElement>('main')
        main?.scrollTo(0, 0)
      })
      await expectNoHorizontalOverflow(page)
      await expectFormBounds(page, form.root)
      if (captureGoldens) {
        await page.screenshot({
          animations: 'disabled',
          caret: 'hide',
          path: resolve(goldenOutputDirectory, `${form.name}-${viewport.name}.png`),
        })
      }
    }
  }

  await page.setViewportSize({ height: 480, width: 390 })
  await page.goto(forms[1].path, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('地址').focus()
  await expect(page.getByRole('button', { exact: true, name: '保存修改' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  if (captureGoldens) {
    await page.screenshot({
      animations: 'disabled',
      caret: 'hide',
      path: resolve(goldenOutputDirectory, 'item-edit-keyboard-390x480.png'),
    })
  }

  expect(providerRequests).toBe(0)
  expect(browserErrors).toEqual([])
})

async function expectFormBounds(page: Page, testId: string) {
  const bounds = await page.evaluate((rootTestId) => {
    const root = document.querySelector<HTMLElement>(`[data-testid="${rootTestId}"]`)
    const headerContent = root?.querySelector<HTMLElement>('header > div')
    const mainContent = root?.querySelector<HTMLElement>('main > div')
    const footerContent = root?.querySelector<HTMLElement>('footer > div')
    if (!root || !headerContent || !mainContent || !footerContent) return null
    const rect = (element: HTMLElement) => {
      const value = element.getBoundingClientRect()
      return { left: value.left, right: value.right, width: value.width }
    }
    return {
      footer: rect(footerContent),
      header: rect(headerContent),
      main: rect(mainContent),
      viewportWidth: innerWidth,
    }
  }, testId)
  expect(bounds).not.toBeNull()
  if (!bounds) return
  for (const area of [bounds.header, bounds.main, bounds.footer]) {
    expect(area.left).toBeGreaterThanOrEqual(-1)
    expect(area.right).toBeLessThanOrEqual(bounds.viewportWidth + 1)
    if (bounds.viewportWidth >= 1024) expect(area.width).toBeLessThanOrEqual(770)
  }
}
