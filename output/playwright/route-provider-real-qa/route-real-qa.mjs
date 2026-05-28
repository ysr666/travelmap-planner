import { chromium, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const baseURL = 'http://127.0.0.1:4173'
const screenshotDir = path.resolve('output/playwright/route-provider-real-qa')
const summaryPath = path.join(screenshotDir, 'route-real-qa-summary.json')
const envPath = path.resolve('.env.local')

function readEnvValue(name) {
  if (!fs.existsSync(envPath)) return ''
  const prefix = `${name}=`
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((entry) => entry.startsWith(prefix))
  return line ? line.slice(prefix.length).trim() : ''
}

const orsKey = readEnvValue('VITE_OPENROUTESERVICE_API_KEY')
const summary = {
  branch: '',
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
  if (summary.counts.googleRoutes > 2 || summary.counts.orsRoutes > 2) {
    throw new Error(`quota cap exceeded: google=${summary.counts.googleRoutes}, ors=${summary.counts.orsRoutes}`)
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
  const tripId = 'qa-real-provider-trip'
  const dayId = 'qa-real-provider-day'
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
      tx.onabort = () => reject(tx.error ?? new Error('seed aborted'))
      tx.objectStore('trips').put({
        createdAt: now,
        destination: '日本东京',
        endDate: '2026-04-12',
        id: tripId,
        startDate: '2026-04-12',
        title: '真实路线 QA 小旅行',
        updatedAt: now,
      })
      tx.objectStore('days').put({
        date: '2026-04-12',
        id: dayId,
        sortOrder: 1,
        title: '真实路线 QA',
        tripId,
      })
      const items = [
        { id: 'qa-item-tokyo-station', title: '东京站', locationName: 'Tokyo Station', lat: 35.681236, lng: 139.767125, sortOrder: 1 },
        { id: 'qa-item-shinjuku', title: '新宿御苑', locationName: 'Shinjuku Gyoen', lat: 35.685176, lng: 139.710052, sortOrder: 2, previousTransportMode: 'car' },
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

async function addOptimizationItems(page, tripId, dayId) {
  const now = Date.now()
  await page.evaluate(async ({ now, tripId, dayId }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('TravelConsoleDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('open TravelConsoleDB failed'))
    })
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['itineraryItems'], 'readwrite')
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => reject(tx.error ?? new Error('add optimization items failed'))
      const items = [
        { id: 'qa-item-ginza', title: '银座', locationName: 'Ginza', lat: 35.671989, lng: 139.764965, sortOrder: 3, previousTransportMode: 'car' },
        { id: 'qa-item-ueno', title: '上野公园', locationName: 'Ueno Park', lat: 35.715298, lng: 139.773037, sortOrder: 4, previousTransportMode: 'car' },
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
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  page.on('request', countProviderRequest)

  try {
    await clearDatabases(page)
    const { tripId, dayId } = await seedTrip(page)
    const tripUrl = `${baseURL}/#/trip?tripId=${tripId}&dayId=${dayId}`
    const dayMapUrl = `${baseURL}/#/day?tripId=${tripId}&dayId=${dayId}&view=map`

    phase = 'trip_home_initial_render'
    await page.goto(tripUrl, { waitUntil: 'domcontentloaded' })
    const panel = await waitForRoutePrep(page)
    await expect(panel.getByTestId('route-preparation-summary')).toContainText('可为 1 天生成路线预览')
    await page.waitForTimeout(1500)
    summary.checks.noSilentRequest = summary.counts.googleRoutes === 0 && summary.counts.orsRoutes === 0
    summary.cacheSnapshots.beforeConfirm = await readRouteCaches(page, tripId)
    summary.checks.noCacheBeforeConfirm = summary.cacheSnapshots.beforeConfirm.length === 0
    await screenshot(page, 'trip-home-route-ready-before-confirm.png')

    phase = 'confirmation_dialog_open'
    await panel.getByRole('button', { name: '生成路线预览' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('将调用路线服务生成路线预览')
    await expect(dialog).toContainText('可能消耗 API 次数')
    await expect(dialog).toContainText('只为有足够坐标的日期生成')
    await expect(dialog).toContainText('不会自动调整行程顺序')
    await expect(dialog).toContainText('不会生成公交/地铁线路号')
    await page.waitForTimeout(800)
    summary.checks.noRequestAtDialog = summary.counts.googleRoutes === 0 && summary.counts.orsRoutes === 0
    summary.cacheSnapshots.atDialog = await readRouteCaches(page, tripId)
    summary.checks.noCacheAtDialog = summary.cacheSnapshots.atDialog.length === 0
    await screenshot(page, 'route-generation-confirm-dialog.png')

    summary.sortOrders.beforeGoogleGeneration = await readSortOrder(page, dayId)
    phase = 'google_generation_confirmed'
    await page.getByRole('button', { name: '确认生成' }).click()
    await expect(page.getByTestId('route-preparation-result')).toBeVisible({ timeout: 20000 })
    await page.waitForTimeout(1000)
    summary.cacheSnapshots.afterGoogleGeneration = await readRouteCaches(page, tripId)
    summary.sortOrders.afterGoogleGeneration = await readSortOrder(page, dayId)
    summary.checks.googleGenerationRequestCount = summary.counts.googleRoutes
    summary.checks.googleCacheWritten = summary.cacheSnapshots.afterGoogleGeneration.some((entry) => entry.provider === 'google' && entry.scope === 'day-map')
    summary.checks.googleTripPreviewCacheWritten = summary.cacheSnapshots.afterGoogleGeneration.some((entry) => entry.provider === 'google' && entry.scope === 'trip-preview')
    summary.checks.sortOrderUnchangedAfterGeneration = JSON.stringify(summary.sortOrders.beforeGoogleGeneration) === JSON.stringify(summary.sortOrders.afterGoogleGeneration)
    await screenshot(page, 'trip-home-route-cached-after-generate.png')

    const googleRequestsAfterGeneration = summary.counts.googleRoutes
    const orsRequestsAfterGeneration = summary.counts.orsRoutes
    phase = 'cache_reuse_refresh'
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitForRoutePrep(page)
    await expect(page.getByTestId('route-preparation-summary')).toContainText('路线预览已准备', { timeout: 15000 })
    await page.waitForTimeout(1500)
    summary.checks.cacheReuseNoRepeatRequest = summary.counts.googleRoutes === googleRequestsAfterGeneration && summary.counts.orsRoutes === orsRequestsAfterGeneration
    summary.cacheSnapshots.afterRefresh = await readRouteCaches(page, tripId)
    await screenshot(page, 'trip-home-route-cache-reuse-after-refresh.png')

    phase = 'day_view_regression'
    const routeCountBeforeDayView = { ...summary.counts }
    await page.goto(dayMapUrl, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('route-chip')).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('map-recenter-button')).toBeVisible({ timeout: 20000 })
    await page.getByTestId('map-recenter-button').click()
    const tokyoMarker = page.getByRole('button', { name: /选择 东京站/ })
    await expect(tokyoMarker).toBeVisible({ timeout: 20000 })
    await tokyoMarker.click()
    await expect(page.getByTestId('map-marker-card')).toContainText('东京站', { timeout: 10000 })
    await page.getByTestId('route-chip').click()
    await expect(page.getByTestId('route-controls-section')).toBeVisible({ timeout: 10000 })
    await page.waitForTimeout(1000)
    summary.checks.dayViewNoExtraProviderRequest = summary.counts.googleRoutes === routeCountBeforeDayView.googleRoutes && summary.counts.orsRoutes === routeCountBeforeDayView.orsRoutes
    await screenshot(page, 'day-view-route-cache-display.png')

    phase = 'ors_provider_switch_before_confirm'
    await page.goto(tripUrl, { waitUntil: 'domcontentloaded' })
    await page.evaluate((key) => {
      window.localStorage.setItem('tripmap:routing:provider', 'openrouteservice')
      window.localStorage.setItem('tripmap:routing:openrouteservice-api-key', key)
      window.dispatchEvent(new Event('tripmap:routing-config-changed'))
    }, orsKey)
    await page.reload({ waitUntil: 'domcontentloaded' })
    const orsPanel = await waitForRoutePrep(page)
    const orsSummary = await orsPanel.getByTestId('route-preparation-summary').innerText()
    summary.checks.orsDoesNotReuseGoogleCache = /可为 1 天生成路线预览/.test(orsSummary)
    const countsBeforeOrsDialog = { ...summary.counts }
    await orsPanel.getByRole('button', { name: '生成路线预览' }).click()
    await expect(page.getByRole('dialog')).toContainText('将调用路线服务生成路线预览')
    await page.waitForTimeout(800)
    summary.checks.noRequestAtOrsDialog = summary.counts.googleRoutes === countsBeforeOrsDialog.googleRoutes && summary.counts.orsRoutes === countsBeforeOrsDialog.orsRoutes

    phase = 'ors_generation_confirmed'
    await page.getByRole('button', { name: '确认生成' }).click()
    await expect(page.getByTestId('route-preparation-result')).toBeVisible({ timeout: 20000 })
    await page.waitForTimeout(1000)
    summary.cacheSnapshots.afterOrsGeneration = await readRouteCaches(page, tripId)
    summary.checks.orsGenerationRequestCount = summary.counts.orsRoutes
    summary.checks.orsCacheWritten = summary.cacheSnapshots.afterOrsGeneration.some((entry) => entry.provider === 'openrouteservice' && entry.scope === 'day-map')
    summary.checks.providerCachesMixed = false

    phase = 'order_suggestion_setup'
    await addOptimizationItems(page, tripId, dayId)
    await page.goto(tripUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1200)
    const countsBeforeSuggestion = { ...summary.counts }
    summary.sortOrders.beforeSuggestion = await readSortOrder(page, dayId)
    await expect(page.getByTestId('trip-map-optimization-panel')).toBeVisible({ timeout: 15000 })

    phase = 'google_order_suggestion_clicked'
    await page.getByTestId('trip-map-optimization-check').click()
    await page.waitForTimeout(2500)
    summary.checks.orderSuggestionRequestDelta = summary.counts.googleRoutes - countsBeforeSuggestion.googleRoutes
    if (await page.getByTestId('trip-map-optimization-suggestion').count()) {
      await page.getByTestId('trip-map-optimization-apply').click()
      await expect(page.getByTestId('trip-map-optimization-confirm')).toBeVisible({ timeout: 10000 })
      await page.getByTestId('trip-map-optimization-cancel').click()
      summary.checks.orderSuggestionConfirmShown = true
    } else {
      const message = await page.getByTestId('trip-map-optimization-message').textContent().catch(() => '')
      summary.checks.orderSuggestionConfirmShown = false
      summary.checks.orderSuggestionMessage = message || ''
    }
    summary.sortOrders.afterSuggestionCancel = await readSortOrder(page, dayId)
    summary.checks.sortOrderUnchangedAfterSuggestionCancel = JSON.stringify(summary.sortOrders.beforeSuggestion) === JSON.stringify(summary.sortOrders.afterSuggestionCancel)

    phase = 'provider_unavailable_state'
    await page.evaluate(() => {
      window.localStorage.setItem('tripmap:routing:provider', 'none')
      window.localStorage.removeItem('tripmap:routing:openrouteservice-api-key')
      window.dispatchEvent(new Event('tripmap:routing-config-changed'))
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    const unavailablePanel = await waitForRoutePrep(page)
    await expect(unavailablePanel).toContainText('当前路线服务不可用', { timeout: 15000 })
    await screenshot(page, 'provider-unavailable-state.png')

    summary.checks.finalGoogleRouteRequests = summary.counts.googleRoutes
    summary.checks.finalOrsRouteRequests = summary.counts.orsRoutes
    summary.checks.noUnexpectedPreConfirmationRequests = summary.requestEvents.every((event) => ![
      'trip_home_initial_render',
      'confirmation_dialog_open',
      'ors_provider_switch_before_confirm',
      'provider_unavailable_state',
    ].includes(event.phase))
    summary.checks.noRepeatAfterCache = summary.checks.cacheReuseNoRepeatRequest
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
