import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:5175/'
const outDir = '/Users/ysradmin/Documents/New project/output/playwright/design-system-visual-pass'

await mkdir(outDir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })

const notes = []

async function noOverflow(label) {
  const result = await page.evaluate(() => {
    const root = document.documentElement
    const body = document.body
    return {
      rootClient: root.clientWidth,
      rootScroll: root.scrollWidth,
      bodyClient: body.clientWidth,
      bodyScroll: body.scrollWidth,
    }
  })
  const overflow = Math.max(result.rootScroll - result.rootClient, result.bodyScroll - result.bodyClient)
  if (overflow > 1) {
    throw new Error(`${label} horizontal overflow: ${JSON.stringify(result)}`)
  }
  notes.push(`${label}: no horizontal overflow`)
}

async function shot(label) {
  await page.screenshot({ path: `${outDir}/${label}.png`, fullPage: true })
  notes.push(`${label}: screenshot saved`)
}

function paramsFromHash() {
  const url = new URL(page.url())
  const query = url.hash.split('?')[1] ?? ''
  return new URLSearchParams(query)
}

await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
await page.goto(`${baseUrl}favicon.svg`, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => {
  function deleteDatabase(name) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error ?? new Error(`delete ${name} failed`))
      request.onblocked = () => reject(new Error(`delete ${name} blocked`))
    })
  }
  return Promise.all([
    deleteDatabase('TravelConsoleDB'),
    deleteDatabase('TripMapRouteCacheDB'),
  ]).then(() => undefined)
})
await page.goto(`${baseUrl}#/home`, { waitUntil: 'domcontentloaded' })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.getByRole('button', { name: '创建示例旅行' }).click()
await page.getByTestId('trip-card').first().waitFor({ state: 'visible' })
await page.getByTestId('trip-card').first().getByRole('button').filter({ hasText: '东京春日旅行' }).first().click()
await page.waitForURL(/#\/trip\?tripId=/, { timeout: 15000 })
await page.getByText('第一天', { exact: true }).click()
await page.waitForURL(/#\/day\?/, { timeout: 15000 })
const createdParams = paramsFromHash()
const tripId = createdParams.get('tripId')
const dayId = createdParams.get('dayId')
if (!tripId || !dayId) throw new Error('Missing tripId/dayId after creating demo trip')

await page.goto(`${baseUrl}#/home`, { waitUntil: 'domcontentloaded' })
await page.getByText('东京春日旅行').waitFor({ state: 'visible' })
await noOverflow('home')
await shot('390-home-light')

await page.goto(`${baseUrl}#/trip?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })
await page.getByText('每日行程').waitFor({ state: 'visible' })
await page.getByTestId('local-trip-check-card').waitFor({ state: 'visible' })
await noOverflow('trip-home')
await shot('390-trip-home-light')

await page.goto(`${baseUrl}#/day?tripId=${tripId}&dayId=${dayId}&view=schedule`, { waitUntil: 'domcontentloaded' })
await page.getByText('当天日程').waitFor({ state: 'visible' })
await page.getByTestId('day-local-brief-card').waitFor({ state: 'visible' })
await noOverflow('day-schedule')
await shot('390-day-schedule-light')

await page.goto(`${baseUrl}#/day?tripId=${tripId}&dayId=${dayId}&view=map`, { waitUntil: 'domcontentloaded' })
await page.getByTestId('map-sheet').waitFor({ state: 'visible' })
await page.getByTestId('map-recenter-button').waitFor({ state: 'visible' })
await page.getByRole('button', { name: /选择 Hotel Metropolitan Tokyo 入住/ }).click()
await page.getByTestId('map-marker-card').waitFor({ state: 'visible' })
await noOverflow('day-map')
await shot('390-day-map-marker-light')

await page.getByTestId('map-marker-card-open').click()
await page.waitForURL(/#\/item\?/)
await page.getByRole('heading', { name: /Hotel Metropolitan Tokyo/ }).waitFor({ state: 'visible' })
await noOverflow('item-detail')
await shot('390-item-detail-light')

await page.goto(`${baseUrl}#/tickets?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })
await page.getByText('票据和订单').waitFor({ state: 'visible' })
await page.getByRole('button', { name: /添加外部链接/ }).click()
await page.getByLabel('显示名称').fill('酒店订单链接')
await page.getByLabel('外部链接').fill('https://example.com/hotel-order')
await page.getByRole('button', { name: '保存票据' }).click()
await page.getByTestId('ticket-card').first().waitFor({ state: 'visible' })
await noOverflow('ticket-library')
await shot('390-ticket-library-light')
await page.getByTestId('ticket-card').first().getByRole('button', { name: /查看/ }).last().click()
await page.getByTestId('ticket-preview').waitFor({ state: 'visible' })
await noOverflow('ticket-preview')
await shot('390-ticket-preview-light')
await page.getByTestId('ticket-preview-close').click()

await page.goto(`${baseUrl}#/settings`, { waitUntil: 'domcontentloaded' })
await page.getByText('外观').first().waitFor({ state: 'visible' })
await noOverflow('settings-light')
await shot('390-settings-light')
await page.getByTestId('appearance-mode-dark').click()
await page.waitForFunction(() => document.documentElement.classList.contains('dark'))
await noOverflow('settings-dark')
await shot('390-settings-dark')

await page.goto(`${baseUrl}#/trip/new`, { waitUntil: 'domcontentloaded' })
await page.getByRole('heading', { name: '新建旅行' }).waitFor({ state: 'visible' })
await noOverflow('trip-form-dark')
await shot('390-trip-form-dark')

await page.goto(`${baseUrl}#/item/new?tripId=${tripId}&dayId=${dayId}&view=schedule`, { waitUntil: 'domcontentloaded' })
await page.getByRole('heading', { name: '新增行程点' }).waitFor({ state: 'visible' })
await noOverflow('item-form-dark')
await shot('390-item-form-dark')

console.log(notes.join('\n'))
await browser.close()
