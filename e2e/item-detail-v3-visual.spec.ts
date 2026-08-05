import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import placeVisualFixture from './fixtures/home-v3-visual.json' with { type: 'json' }
import {
  clearTravelDatabase,
  expectNoHorizontalOverflow,
  seedTravelRecords,
} from './helpers'

test.use({ colorScheme: 'light', locale: 'zh-CN', timezoneId: 'Europe/London' })

const captureGoldens = process.env.CAPTURE_UI_V3_GOLDENS === '1'
const goldenOutputDirectory = resolve('output/playwright/ui-v3-place-detail')
const requiredViewports = [
  { height: 568, name: '320x568', width: 320 },
  { height: 844, name: '390x844', width: 390 },
  { height: 884, name: '390x884-reference', width: 390 },
  { height: 932, name: '430x932', width: 430 },
  { height: 1024, name: '768x1024', width: 768 },
  { height: 900, name: '1440x900', width: 1440 },
]

test('UI V3 地点详情首屏聚焦真实地点、导航和票据', async ({ page }) => {
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

  await page.clock.setFixedTime(new Date(placeVisualFixture.fixedNow))
  await clearTravelDatabase(page)
  await page.evaluate(() => window.localStorage.setItem('tripmap:appearance', 'light'))
  await seedTravelRecords(page, {
    ...placeVisualFixture.records,
    itineraryItems: placeVisualFixture.records.itineraryItems.map((item) => (
      item.id === 'item_home_v3_castle'
        ? { ...item, address: 'Castlehill, Edinburgh EH1 2NG, United Kingdom' }
        : item
    )),
  })
  await page.goto(
    '/#/item?tripId=trip_home_v3&dayId=day_home_v3_07&itemId=item_home_v3_castle&view=map',
    { waitUntil: 'domcontentloaded' },
  )

  await expect(page.getByRole('heading', { exact: true, name: '爱丁堡城堡' })).toBeVisible()
  await expect(page.getByText('Castlehill, Edinburgh EH1 2NG, United Kingdom', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { exact: true, name: '开始导航' })).toBeVisible()
  await expect(page.getByRole('button', { exact: true, name: '打开票据' })).toBeVisible()
  await expect(page.getByRole('button', { exact: true, name: 'AI 助手' })).toBeVisible()
  await expect(page.getByRole('button', { exact: true, name: '更多' })).toBeVisible()
  await expect(page.getByTestId('item-detail-more')).not.toHaveAttribute('open', '')
  await expect(page.getByTestId('item-place-lookup-panel')).toHaveCount(0)

  await page.getByRole('button', { exact: true, name: '更多' }).click()
  const menu = page.getByTestId('item-header-more-menu')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('button', { exact: true, name: '编辑行程点' })).toBeVisible()
  await expect(menu.getByRole('link', { exact: true, name: 'Google 地图' })).toBeVisible()
  await menu.getByRole('button', { exact: true, name: '关闭地点操作' }).click()

  if (captureGoldens) await mkdir(goldenOutputDirectory, { recursive: true })

  for (const viewport of requiredViewports) {
    await page.setViewportSize({ height: viewport.height, width: viewport.width })
    await page.getByTestId('item-detail-page').evaluate((element) => {
      const scroll = element.querySelector<HTMLElement>('.item-detail-scroll')
      scroll?.scrollTo(0, 0)
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    })
    await expectNoHorizontalOverflow(page)
    await expectItemDetailLayout(page)

    if (captureGoldens) {
      await page.screenshot({
        animations: 'disabled',
        caret: 'hide',
        path: resolve(goldenOutputDirectory, `place-${viewport.name}.png`),
      })
    }
  }

  expect(providerRequests).toBe(0)
  expect(browserErrors).toEqual([])
})

async function expectItemDetailLayout(page: Page) {
  const layout = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>('.item-detail-header')
    const intro = document.querySelector<HTMLElement>('.item-detail-intro')
    const content = document.querySelector<HTMLElement>('.item-detail-content')
    const navigate = document.querySelector<HTMLElement>('[data-testid="item-detail-core"] a')
    const ticket = document.querySelector<HTMLElement>('.item-detail-ticket-callout')
    const headerButtons = Array.from(document.querySelectorAll<HTMLElement>('.item-detail-header-icon'))
    if (!header || !intro || !content || !navigate || !ticket || headerButtons.length !== 3) return null

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
      content: rect(content),
      header: rect(header),
      headerButtons: headerButtons.map(rect),
      intro: rect(intro),
      navigate: rect(navigate),
      ticket: rect(ticket),
      viewportWidth: innerWidth,
    }
  })

  expect(layout).not.toBeNull()
  if (!layout) return
  expect(layout.header.left).toBeGreaterThanOrEqual(-1)
  expect(layout.header.right).toBeLessThanOrEqual(layout.viewportWidth + 1)
  expect(layout.intro.top).toBeGreaterThanOrEqual(layout.header.bottom - 1)
  expect(layout.navigate.height).toBeGreaterThanOrEqual(56)
  expect(layout.ticket.left).toBeGreaterThanOrEqual(layout.content.left)
  expect(layout.ticket.right).toBeLessThanOrEqual(layout.content.right)
  for (const button of layout.headerButtons) {
    expect(button.width).toBeGreaterThanOrEqual(44)
    expect(button.height).toBeGreaterThanOrEqual(44)
  }
}
