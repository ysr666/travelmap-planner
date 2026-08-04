import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import {
  clearTravelDatabase,
  expectNoHorizontalOverflow,
  forceSupabaseUnconfigured,
  seedTravelRecords,
} from './helpers'

test.use({ colorScheme: 'light', locale: 'zh-CN', timezoneId: 'Europe/London' })

const captureGoldens = process.env.CAPTURE_UI_V3_GOLDENS === '1'
const goldenOutputDirectory = resolve('output/playwright/ui-v3-inbox')
const requiredViewports = [
  { height: 568, name: '320x568', width: 320 },
  { height: 844, name: '390x844', width: 390 },
  { height: 932, name: '430x932', width: 430 },
  { height: 1024, name: '768x1024', width: 768 },
  { height: 900, name: '1440x900', width: 1440 },
]

test('UI V3 收件箱空状态与待整理列表保持单入口和紧凑层级', async ({ page }) => {
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
  await forceSupabaseUnconfigured(page)
  await page.goto('/#/inbox', { waitUntil: 'domcontentloaded' })

  await expect(page.getByRole('heading', { exact: true, name: '导入旅行材料' })).toBeVisible()
  await expect(page.getByRole('button', { exact: true, name: '导入材料' })).toHaveCount(1)
  await expect(page.getByRole('button', { name: '来源与导入 0' })).toBeVisible()
  await expect(page.getByRole('dialog', { name: '来源与导入' })).toHaveCount(0)

  if (captureGoldens) await mkdir(goldenOutputDirectory, { recursive: true })

  for (const viewport of requiredViewports) {
    await page.setViewportSize({ height: viewport.height, width: viewport.width })
    await page.evaluate(() => window.scrollTo(0, 0))
    await expectNoHorizontalOverflow(page)
    await expectInboxBounds(page)
    if (captureGoldens) {
      await page.screenshot({
        animations: 'disabled',
        caret: 'hide',
        path: resolve(goldenOutputDirectory, `inbox-empty-${viewport.name}.png`),
      })
    }
  }

  await seedInboxList(page)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { exact: true, name: '待整理' })).toBeVisible()
  await expect(page.getByTestId('travel-inbox-source')).toHaveCount(3)
  await expect(page.getByText('爱丁堡城堡门票与预约确认单-家庭套票.pdf', { exact: true })).toBeVisible()
  await expect(page.getByRole('dialog', { name: '来源与导入' })).toHaveCount(0)

  for (const viewport of requiredViewports) {
    await page.setViewportSize({ height: viewport.height, width: viewport.width })
    await page.evaluate(() => window.scrollTo(0, 0))
    await expectNoHorizontalOverflow(page)
    await expectInboxBounds(page)
    if (captureGoldens) {
      await page.screenshot({
        animations: 'disabled',
        caret: 'hide',
        path: resolve(goldenOutputDirectory, `inbox-list-${viewport.name}.png`),
      })
    }
  }

  await page.setViewportSize({ height: 844, width: 390 })
  await page.getByRole('button', { name: '来源与导入 0' }).click()
  const sheet = page.getByRole('dialog', { name: '来源与导入' })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('button', { exact: true, name: '导入文件' })).toBeVisible()
  await expect(sheet.getByText('邮箱连接暂不可用。')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
  if (captureGoldens) {
    await page.screenshot({
      animations: 'disabled',
      caret: 'hide',
      path: resolve(goldenOutputDirectory, 'inbox-source-sheet-390x844.png'),
    })
  }

  expect(providerRequests).toBe(0)
  expect(browserErrors).toEqual([])
})

async function seedInboxList(page: Page) {
  const now = Date.now()
  await seedTravelRecords(page, {
    trips: [{
      createdAt: now,
      destination: '英国',
      endDate: '2026-07-21',
      id: 'trip-inbox-v3',
      startDate: '2026-07-10',
      title: '英国12天家庭旅行',
      updatedAt: now,
    }],
  })
  await page.evaluate(async ({ timestamp }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('TravelConsoleDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction('travelInboxAccountSources', 'readwrite')
    const store = transaction.objectStore('travelInboxAccountSources')
    const common = {
      connectorKind: 'local_folder',
      mimeType: 'application/pdf',
      size: 2048,
      sourceKind: 'pdf',
      targetTripId: 'trip-inbox-v3',
      warnings: [],
    }
    store.put({
      ...common,
      createdAt: timestamp,
      fileName: '爱丁堡城堡门票与预约确认单-家庭套票.pdf',
      id: 'inbox-v3-castle',
      label: '爱丁堡城堡门票与预约确认单-家庭套票.pdf',
      receivedAt: timestamp,
      status: 'needs_assignment',
      updatedAt: timestamp,
    })
    store.put({
      ...common,
      createdAt: timestamp - 1,
      fileName: '伦敦至爱丁堡火车票.pdf',
      id: 'inbox-v3-train',
      label: '伦敦至爱丁堡火车票.pdf',
      receivedAt: timestamp - 1,
      status: 'preview_ready',
      updatedAt: timestamp - 1,
    })
    store.put({
      ...common,
      createdAt: timestamp - 2,
      error: '文件需要重新选择。',
      fileName: '酒店确认单.pdf',
      id: 'inbox-v3-hotel',
      label: '酒店确认单.pdf',
      receivedAt: timestamp - 2,
      status: 'error',
      updatedAt: timestamp - 2,
    })
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    database.close()
  }, { timestamp: now })
}

async function expectInboxBounds(page: Page) {
  const bounds = await page.evaluate(() => {
    const pageElement = document.querySelector<HTMLElement>('[data-testid="travel-inbox-page"]')
    if (!pageElement) return null
    const rect = pageElement.getBoundingClientRect()
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="travel-inbox-source"]'))
      .map((row) => row.getBoundingClientRect())
    return {
      left: rect.left,
      right: rect.right,
      rows: rows.map((row) => ({ height: row.height, left: row.left, right: row.right })),
      viewportWidth: innerWidth,
    }
  })
  expect(bounds).not.toBeNull()
  if (!bounds) return
  expect(bounds.left).toBeGreaterThanOrEqual(-1)
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth + 1)
  for (const row of bounds.rows) {
    expect(row.left).toBeGreaterThanOrEqual(bounds.left - 1)
    expect(row.right).toBeLessThanOrEqual(bounds.right + 1)
    expect(row.height).toBeLessThan(150)
  }
}
