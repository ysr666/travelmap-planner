import { chromium, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const baseURL = 'http://127.0.0.1:4173'
const screenshotDir = path.resolve('output/playwright/route-provider-real-qa')
const summaryPath = path.join(screenshotDir, 'route-real-qa-ors-summary.json')
const envPath = path.resolve('.env.local')

function readEnvValue(name) {
  if (!fs.existsSync(envPath)) return ''
  const prefix = `${name}=`
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((entry) => entry.startsWith(prefix))
  return line ? line.slice(prefix.length).trim() : ''
}

const orsKey = readEnvValue('VITE_OPENROUTESERVICE_API_KEY')
const summary = {
  providerConfig: {
    googleConfigured: Boolean(readEnvValue('VITE_GOOGLE_MAPS_API_KEY')),
    orsConfigured: Boolean(orsKey),
  },
  requestEvents: [],
  counts: { googleRoutes: 0, orsRoutes: 0 },
  checks: {},
  screenshots: {},
  cacheSnapshots: {},
  sortOrders: {},
}
let phase = 'startup'

function countProviderRequest(request) {
  const url = request.url()
  if (url.includes('routes.googleapis.com/directions/v2:computeRoutes')) {
    summary.counts.googleRoutes += 1
    summary.requestEvents.push({ phase, provider: 'google', method: request.method() })
  }
  if (url.includes('api.openrouteservice.org/v2/directions')) {
    summary.counts.orsRoutes += 1
    summary.requestEvents.push({ phase, provider: 'openrouteservice', method: request.method() })
  }
  if (summary.counts.googleRoutes > 0 || summary.counts.orsRoutes > 2) {
    throw new Error(`unexpected provider count: google=${summary.counts.googleRoutes}, ors=${summary.counts.orsRoutes}`)
  }
}

async function screenshot(page, name) {
  const file = path.join(screenshotDir, name)
  await page.screenshot({ path: file, fullPage: true })
  summary.screenshots[name] = file
}

async function clearDatabases(page) {
  await page.goto(`${baseURL}/favicon.svg`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(async () => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    async function deleteDb(name) {
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error ?? new Error(`delete ${name} failed`))
        request.onblocked = () => reject(new Error(`delete ${name} blocked`))
      })
    }
    await deleteDb('TravelConsoleDB')
    await deleteDb('TripMapRouteCacheDB')
  })
}

async function seedTrip(page) {
  const now = Date.now()
  const tripId = 'qa-real-provider-ors-trip'
  const dayId = 'qa-real-provider-ors-day'
  await page.goto(`${baseURL}/#/home`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(async ({ now, tripId, dayId }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('TravelConsoleDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('open TravelConsoleDB failed'))
    })
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['trips', 'days', 'itineraryItems', 'ticketMetas', 'ticketBlobs'], 'readwrite')
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => reject(tx.error ?? new Error('seed failed'))
      tx.objectStore('trips').put({
        createdAt: now,
        destination: '日本东京',
        endDate: '2026-04-12',
        id: tripId,
        startDate: '2026-04-12',
        title: 'ORS 真实路线 QA 小旅行',
        updatedAt: now,
      })
      tx.objectStore('days').put({
        date: '2026-04-12',
        id: dayId,
        sortOrder: 1,
        title: 'ORS 真实路线 QA',
        tripId,
      })
      const items = [
        { id: 'ors-item-tokyo-station', title: '东京站', locationName: 'Tokyo Station', lat: 35.681236, lng: 139.767125, sortOrder: 1 },
        { id: 'ors-item-hibiya', title: '日比谷公园', locationName: 'Hibiya Park', lat: 35.6745, lng: 139.7550, sortOrder: 2, previousTransportMode: 'car' },
      ]
      for (const item of items) {
        tx.objectStore('itineraryItems').put({
          address: item.locationName,
          createdAt: now,
          dayId,
          ticketIds: [],
          tripId,
          updatedAt: now,
          ...item,
        })
      }
    })
  }, { now, tripId, dayId })
  return { tripId, dayId }
}

async function readRouteCaches(page, tripId) {
  return await page.evaluate(async (targetTripId) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('TripMapRouteCacheDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('open route cache failed'))
    })
    if (!db.objectStoreNames.contains('routeCaches')) {
      db.close()
      return []
    }
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(['routeCaches'], 'readonly')
      const request = tx.objectStore('routeCaches').getAll()
      request.onsuccess = () => {
        const entries = request.result
          .filter((entry) => entry.tripId === targetTripId)
          .map((entry) => ({
            dayId: entry.dayId,
            distanceMeters: entry.distanceMeters,
            durationSeconds: entry.durationSeconds,
            lineStringCount: entry.lineStrings?.length ?? 0,
            provider: entry.provider,
            scope: entry.scope ?? 'day-map',
            status: entry.status ?? null,
          }))
        db.close()
        resolve(entries)
      }
      request.onerror = () => reject(request.error ?? new Error('read route cache failed'))
    })
  }, tripId)
}

async function readSortOrder(page, dayId) {
  return await page.evaluate(async (targetDayId) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('TravelConsoleDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('open TravelConsoleDB failed'))
    })
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(['itineraryItems'], 'readonly')
      const request = tx.objectStore('itineraryItems').getAll()
      request.onsuccess = () => {
        const order = request.result
          .filter((item) => item.dayId === targetDayId)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((item) => `${item.id}:${item.sortOrder}`)
        db.close()
        resolve(order)
      }
      request.onerror = () => reject(request.error ?? new Error('read sort order failed'))
    })
  }, dayId)
}

async function waitForRoutePrep(page) {
  const panel = page.getByTestId('route-preparation-panel')
  await expect(panel).toBeVisible({ timeout: 15000 })
  await expect(panel.getByTestId('route-preparation-summary')).not.toContainText('正在检查路线缓存', { timeout: 15000 })
  return panel
}

async function main() {
  if (!orsKey) throw new Error('ORS key unavailable')
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  page.on('request', countProviderRequest)
  try {
    await clearDatabases(page)
    const { tripId, dayId } = await seedTrip(page)
    const tripUrl = `${baseURL}/#/trip?tripId=${tripId}&dayId=${dayId}`
    const dayMapUrl = `${baseURL}/#/day?tripId=${tripId}&dayId=${dayId}&view=map`
    await page.goto(`${baseURL}/#/home`, { waitUntil: 'domcontentloaded' })
    await page.evaluate((key) => {
      window.localStorage.setItem('tripmap:routing:provider', 'openrouteservice')
      window.localStorage.setItem('tripmap:routing:openrouteservice-api-key', key)
    }, orsKey)

    phase = 'ors_trip_home_initial_render'
    await page.goto(tripUrl, { waitUntil: 'domcontentloaded' })
    const panel = await waitForRoutePrep(page)
    await expect(panel.getByTestId('route-preparation-summary')).toContainText('可为 1 天生成路线预览')
    await page.waitForTimeout(1500)
    summary.checks.noSilentRequest = summary.counts.googleRoutes === 0 && summary.counts.orsRoutes === 0
    summary.cacheSnapshots.beforeConfirm = await readRouteCaches(page, tripId)
    summary.checks.noCacheBeforeConfirm = summary.cacheSnapshots.beforeConfirm.length === 0

    phase = 'ors_confirmation_dialog_open'
    await panel.getByRole('button', { name: '生成路线预览' }).click()
    await expect(page.getByRole('dialog')).toContainText('将调用路线服务生成路线预览')
    await expect(page.getByRole('dialog')).toContainText('可能消耗 API 次数')
    await expect(page.getByRole('dialog')).toContainText('不会自动调整行程顺序')
    await expect(page.getByRole('dialog')).toContainText('不会生成公交/地铁线路号')
    await page.waitForTimeout(800)
    summary.checks.noRequestAtDialog = summary.counts.googleRoutes === 0 && summary.counts.orsRoutes === 0
    await screenshot(page, 'route-generation-confirm-dialog.png')

    summary.sortOrders.beforeGeneration = await readSortOrder(page, dayId)
    phase = 'ors_generation_confirmed'
    await page.getByRole('button', { name: '确认生成' }).click()
    await expect(page.getByTestId('route-preparation-result')).toContainText('已生成 1 天路线预览', { timeout: 25000 })
    await page.waitForTimeout(1000)
    summary.cacheSnapshots.afterGeneration = await readRouteCaches(page, tripId)
    summary.sortOrders.afterGeneration = await readSortOrder(page, dayId)
    summary.checks.orsGenerationRequestCount = summary.counts.orsRoutes
    summary.checks.orsCacheWritten = summary.cacheSnapshots.afterGeneration.some((entry) => entry.provider === 'openrouteservice' && entry.scope === 'day-map')
    summary.checks.orsTripPreviewCacheWritten = summary.cacheSnapshots.afterGeneration.some((entry) => entry.provider === 'openrouteservice' && entry.scope === 'trip-preview')
    summary.checks.sortOrderUnchangedAfterGeneration = JSON.stringify(summary.sortOrders.beforeGeneration) === JSON.stringify(summary.sortOrders.afterGeneration)
    await screenshot(page, 'trip-home-route-cached-after-generate.png')

    const countsAfterGeneration = { ...summary.counts }
    phase = 'ors_cache_reuse_refresh'
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitForRoutePrep(page)
    await expect(page.getByTestId('route-preparation-summary')).toContainText('路线预览已准备', { timeout: 15000 })
    await page.waitForTimeout(1500)
    summary.checks.cacheReuseNoRepeatRequest = summary.counts.googleRoutes === countsAfterGeneration.googleRoutes && summary.counts.orsRoutes === countsAfterGeneration.orsRoutes
    await screenshot(page, 'trip-home-route-cache-reuse-after-refresh.png')

    phase = 'ors_day_view_regression'
    const countsBeforeDayView = { ...summary.counts }
    await page.goto(dayMapUrl, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('route-chip')).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('map-recenter-button')).toBeVisible({ timeout: 20000 })
    await page.getByTestId('map-recenter-button').click()
    const marker = page.getByRole('button', { name: /选择 东京站/ })
    await expect(marker).toBeVisible({ timeout: 20000 })
    await marker.click()
    await expect(page.getByTestId('map-marker-card')).toContainText('东京站', { timeout: 10000 })
    await page.getByTestId('route-chip').click()
    await expect(page.getByTestId('route-controls-section')).toBeVisible({ timeout: 10000 })
    await page.waitForTimeout(1000)
    summary.checks.dayViewNoExtraProviderRequest = summary.counts.googleRoutes === countsBeforeDayView.googleRoutes && summary.counts.orsRoutes === countsBeforeDayView.orsRoutes
    await screenshot(page, 'day-view-route-cache-display.png')

    phase = 'provider_separation_google_after_ors'
    await page.goto(tripUrl, { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => {
      window.localStorage.removeItem('tripmap:routing:provider')
      window.localStorage.removeItem('tripmap:routing:openrouteservice-api-key')
      window.dispatchEvent(new Event('tripmap:routing-config-changed'))
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    const googlePanel = await waitForRoutePrep(page)
    const googleSummary = await googlePanel.getByTestId('route-preparation-summary').innerText()
    summary.checks.googleDoesNotReuseOrsCache = /可为 1 天生成路线预览/.test(googleSummary)
    await screenshot(page, 'provider-separation-google-ready-after-ors-cache.png')

    phase = 'provider_unavailable_state'
    await page.evaluate(() => {
      window.localStorage.setItem('tripmap:routing:provider', 'none')
      window.dispatchEvent(new Event('tripmap:routing-config-changed'))
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    const unavailablePanel = await waitForRoutePrep(page)
    await expect(unavailablePanel).toContainText('当前路线服务不可用', { timeout: 15000 })
    await screenshot(page, 'provider-unavailable-state.png')

    summary.checks.noUnexpectedPreConfirmationRequests = summary.requestEvents.every((event) => ![
      'ors_trip_home_initial_render',
      'ors_confirmation_dialog_open',
      'provider_separation_google_after_ors',
      'provider_unavailable_state',
    ].includes(event.phase))
  } finally {
    await fs.promises.writeFile(summaryPath, JSON.stringify(summary, null, 2))
    await page.close().catch(() => {})
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

main().then(() => {
  console.log(`summary=${summaryPath}`)
  console.log(`googleRoutes=${summary.counts.googleRoutes}`)
  console.log(`orsRoutes=${summary.counts.orsRoutes}`)
}).catch(async (error) => {
  summary.error = error instanceof Error ? error.message : String(error)
  await fs.promises.writeFile(summaryPath, JSON.stringify(summary, null, 2))
  console.error(`QA failed: ${summary.error}`)
  console.error(`summary=${summaryPath}`)
  process.exit(1)
})
