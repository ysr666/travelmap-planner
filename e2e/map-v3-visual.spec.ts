import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import {
  createDemoTripViaUi,
  expectNoHorizontalOverflow,
  mockMapStyle,
} from './helpers'

test.use({ colorScheme: 'light', locale: 'zh-CN' })

const captureGoldens = process.env.CAPTURE_UI_V3_GOLDENS === '1'
const goldenOutputDirectory = resolve('output/playwright/ui-v3-map')
const requiredViewports = [
  { height: 568, name: '320x568', width: 320 },
  { height: 844, name: '390x844', width: 390 },
  { height: 932, name: '430x932', width: 430 },
  { height: 1024, name: '768x1024', width: 768 },
  { height: 900, name: '1440x900', width: 1440 },
]

test('UI V3 地图保持全屏画布和单一地点 Sheet', async ({ page }) => {
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
  await mockMapStyle(page)
  await createDemoTripViaUi(page)
  await page.getByTestId('view-switch-map').click()
  await page.getByRole('button', { name: /选择 Hotel Metropolitan Tokyo 入住/ }).click()

  await expect(page.getByTestId('map-marker-card')).toBeVisible()
  await expect(page.getByTestId('map-marker-card-navigate')).toHaveAttribute('href', /google\.com\/maps/)
  await expect(page.getByTestId('map-marker-card-open')).toBeVisible()
  await expect(page.locator('[data-route-source="sequence"]')).toBeVisible()
  await expect(page.getByTestId('day-map-route-direction')).toHaveCount(0)
  await expect(page.getByTestId('view-switch-map')).toHaveCount(0)
  await expect(page.getByTestId('view-switch-schedule')).toBeVisible()

  if (captureGoldens) await mkdir(goldenOutputDirectory, { recursive: true })

  for (const viewport of requiredViewports) {
    await page.setViewportSize({ height: viewport.height, width: viewport.width })
    await page.waitForTimeout(180)
    await expectNoHorizontalOverflow(page)
    await expectMapLayout(page)

    if (captureGoldens) {
      await page.screenshot({
        animations: 'disabled',
        caret: 'hide',
        path: resolve(goldenOutputDirectory, `map-${viewport.name}.png`),
      })
    }
  }

  expect(providerRequests).toBe(0)
  expect(browserErrors).toEqual([])
})

async function expectMapLayout(page: Page) {
  const layout = await page.evaluate(() => {
    const map = document.querySelector<HTMLElement>('[data-route-source]')
    const canvas = map?.querySelector<HTMLCanvasElement>('canvas')
    const sheet = document.querySelector<HTMLElement>('.day-map-place-sheet-panel')
    const scheduleControl = document.querySelector<HTMLElement>('[data-testid="view-switch-schedule"]')
    const primaryAction = document.querySelector<HTMLElement>('[data-testid="map-marker-card-navigate"]')
    if (!map || !canvas || !sheet || !scheduleControl || !primaryAction) return null

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
      canvas: rect(canvas),
      map: rect(map),
      primaryAction: rect(primaryAction),
      scheduleControl: rect(scheduleControl),
      sheet: rect(sheet),
      viewportHeight: innerHeight,
      viewportWidth: innerWidth,
    }
  })

  expect(layout).not.toBeNull()
  if (!layout) return
  expect(layout.canvas.width).toBeGreaterThan(0)
  expect(layout.canvas.height).toBeGreaterThan(0)
  expect(layout.map.left).toBeGreaterThanOrEqual(-1)
  expect(layout.map.right).toBeLessThanOrEqual(layout.viewportWidth + 1)
  expect(layout.primaryAction.height).toBeGreaterThanOrEqual(48)
  expect(layout.scheduleControl.width).toBeGreaterThanOrEqual(44)
  expect(layout.scheduleControl.height).toBeGreaterThanOrEqual(44)
  expect(layout.sheet.left).toBeGreaterThanOrEqual(-1)
  expect(layout.sheet.right).toBeLessThanOrEqual(layout.viewportWidth + 1)
  expect(layout.sheet.bottom).toBeLessThanOrEqual(layout.viewportHeight + 1)
}
