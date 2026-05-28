import { chromium, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const baseURL = 'http://127.0.0.1:4173'
const outDir = path.resolve('output/playwright/route-provider-real-qa')
const outPath = path.join(outDir, 'google-debug-app-chrome-summary.json')
const envText = fs.readFileSync('.env.local', 'utf8')
const googleKey = envText.split(/\r?\n/).find((line) => line.startsWith('VITE_GOOGLE_MAPS_API_KEY='))?.split('=')[1]?.trim() || ''
if (!googleKey) throw new Error('Google key missing')

const summary = {
  counts: { googleRoutes: 0, orsRoutes: 0 },
  networkResponses: [],
  console: [],
  pageErrors: [],
  fetchEvents: [],
  ui: {},
  cacheEntries: [],
  sortOrder: {},
}
let phase = 'startup'
function sanitize(value) {
  if (typeof value !== 'string') return value
  return value.replaceAll(googleKey, '[masked-google-key]')
}
async function clearDatabases(page) {
  await page.goto(`${baseURL}/favicon.svg`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(async () => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    for (const name of ['TravelConsoleDB', 'TripMapRouteCacheDB']) {
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error ?? new Error(`delete ${name} failed`))
        request.onblocked = () => reject(new Error(`delete ${name} blocked`))
      })
    }
  })
}
async function seedTrip(page) {
  const now = Date.now()
  const tripId = 'qa-google-debug-trip'
  const dayId = 'qa-google-debug-day'
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
      tx.objectStore('trips').put({ createdAt: now, destination: '日本东京', endDate: '2026-04-12', id: tripId, startDate: '2026-04-12', title: 'Google Debug QA', updatedAt: now })
      tx.objectStore('days').put({ date: '2026-04-12', id: dayId, sortOrder: 1, title: 'Google Debug QA', tripId })
      for (const item of [
        { id: 'google-debug-a', title: '东京站', locationName: 'Tokyo Station', lat: 35.681236, lng: 139.767125, sortOrder: 1 },
        { id: 'google-debug-b', title: '新宿御苑', locationName: 'Shinjuku Gyoen', lat: 35.685176, lng: 139.710052, sortOrder: 2, previousTransportMode: 'car' },
      ]) {
        tx.objectStore('itineraryItems').put({ address: item.locationName, createdAt: now, dayId, ticketIds: [], tripId, updatedAt: now, ...item })
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
            provider: entry.provider,
            scope: entry.scope ?? 'day-map',
            status: entry.status ?? null,
            lineStringCount: entry.lineStrings?.length ?? 0,
            firstLineLength: entry.lineStrings?.[0]?.length ?? 0,
            warnings: entry.warnings ?? [],
            distanceMeters: entry.distanceMeters,
            durationSeconds: entry.durationSeconds,
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
        const order = request.result.filter((item) => item.dayId === targetDayId).sort((a,b) => a.sortOrder - b.sortOrder).map((item) => `${item.id}:${item.sortOrder}`)
        db.close()
        resolve(order)
      }
      request.onerror = () => reject(request.error ?? new Error('read sort order failed'))
    })
  }, dayId)
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-quic'] })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await context.addInitScript(() => {
    window.__qaFetchEvents = []
    window.__qaErrors = []
    window.addEventListener('error', (event) => window.__qaErrors.push({ type: 'error', message: event.message }))
    window.addEventListener('unhandledrejection', (event) => window.__qaErrors.push({ type: 'unhandledrejection', message: String(event.reason?.message ?? event.reason) }))
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (...args) => {
      const requestInfo = args[0]
      const url = typeof requestInfo === 'string' ? requestInfo : requestInfo?.url ?? ''
      const isGoogleRoute = String(url).includes('routes.googleapis.com/directions/v2:computeRoutes')
      if (!isGoogleRoute) return originalFetch(...args)
      const startedAt = Date.now()
      try {
        const response = await originalFetch(...args)
        let text = ''
        try { text = await response.clone().text() } catch (error) { text = `body read failed: ${error?.message ?? error}` }
        let parsed = null
        try { parsed = text ? JSON.parse(text) : null } catch {}
        const route = parsed?.routes?.[0]
        window.__qaFetchEvents.push({
          type: 'response',
          status: response.status,
          ok: response.ok,
          elapsedMs: Date.now() - startedAt,
          bodySummary: parsed ? {
            errorStatus: parsed.error?.status,
            errorMessage: parsed.error?.message,
            routeCount: Array.isArray(parsed.routes) ? parsed.routes.length : null,
            hasPolyline: Boolean(route?.polyline?.encodedPolyline),
            polylineLength: route?.polyline?.encodedPolyline?.length ?? 0,
            distanceMeters: route?.distanceMeters,
            duration: route?.duration,
          } : { rawPrefix: text.slice(0, 180) },
        })
        return response
      } catch (error) {
        window.__qaFetchEvents.push({ type: 'fetch-error', name: error?.name, message: error?.message ?? String(error), elapsedMs: Date.now() - startedAt })
        throw error
      }
    }
  })
  const page = await context.newPage()
  page.on('request', (request) => {
    const url = request.url()
    if (url.includes('routes.googleapis.com/directions/v2:computeRoutes')) summary.counts.googleRoutes += 1
    if (url.includes('api.openrouteservice.org/v2/directions')) summary.counts.orsRoutes += 1
  })
  page.on('response', async (response) => {
    const url = response.url()
    if (!url.includes('routes.googleapis.com/directions/v2:computeRoutes')) return
    const headers = response.headers()
    summary.networkResponses.push({ phase, status: response.status(), ok: response.ok(), contentType: headers['content-type'] ?? null })
  })
  page.on('console', (msg) => summary.console.push({ type: msg.type(), text: sanitize(msg.text()).slice(0, 500) }))
  page.on('pageerror', (error) => summary.pageErrors.push(sanitize(error.message)))
  try {
    await clearDatabases(page)
    const { tripId, dayId } = await seedTrip(page)
    await page.goto(`${baseURL}/#/home`, { waitUntil: 'domcontentloaded' })
    await page.evaluate((key) => {
      window.localStorage.setItem('tripmap:google-maps-api-key', key)
      window.localStorage.removeItem('tripmap:routing:provider')
      window.localStorage.removeItem('tripmap:routing:openrouteservice-api-key')
      window.dispatchEvent(new Event('tripmap:google-maps-config-changed'))
      window.dispatchEvent(new Event('tripmap:routing-config-changed'))
    }, googleKey)
    phase = 'trip_home_render'
    await page.goto(`${baseURL}/#/trip?tripId=${tripId}&dayId=${dayId}`, { waitUntil: 'domcontentloaded' })
    const panel = page.getByTestId('route-preparation-panel')
    await expect(panel).toBeVisible({ timeout: 15000 })
    await expect(panel.getByTestId('route-preparation-summary')).toContainText('可为 1 天生成路线预览', { timeout: 15000 })
    summary.ui.beforeSummary = await panel.getByTestId('route-preparation-summary').innerText()
    await page.waitForTimeout(1200)
    summary.ui.preConfirmCounts = { ...summary.counts }
    phase = 'dialog_open'
    await panel.getByRole('button', { name: '生成路线预览' }).click()
    await expect(page.getByRole('dialog')).toContainText('将调用路线服务生成路线预览', { timeout: 10000 })
    await page.waitForTimeout(500)
    summary.ui.dialogCounts = { ...summary.counts }
    summary.sortOrder.before = await readSortOrder(page, dayId)
    phase = 'confirm_generation'
    await page.getByRole('button', { name: '确认生成' }).click()
    await expect(page.getByTestId('route-preparation-result')).toBeVisible({ timeout: 25000 })
    await page.waitForTimeout(1500)
    summary.ui.resultText = await page.getByTestId('route-preparation-result').innerText().catch(() => '')
    summary.ui.errorText = await page.getByTestId('route-preparation-error').innerText().catch(() => '')
    summary.ui.afterSummary = await page.getByTestId('route-preparation-summary').innerText().catch(() => '')
    summary.cacheEntries = await readRouteCaches(page, tripId)
    summary.sortOrder.after = await readSortOrder(page, dayId)
    summary.fetchEvents = await page.evaluate(() => window.__qaFetchEvents ?? [])
    summary.browserErrors = await page.evaluate(() => window.__qaErrors ?? [])
    await page.screenshot({ path: path.join(outDir, 'google-debug-app-chrome-after-confirm.png'), fullPage: true })
  } finally {
    await fs.promises.writeFile(outPath, JSON.stringify(summary, null, 2))
    await browser.close().catch(() => {})
  }
}

main().then(() => {
  console.log(`summary=${outPath}`)
  console.log(`googleRoutes=${summary.counts.googleRoutes}`)
  console.log(`orsRoutes=${summary.counts.orsRoutes}`)
}).catch(async (error) => {
  summary.error = sanitize(error.message ?? String(error))
  await fs.promises.writeFile(outPath, JSON.stringify(summary, null, 2))
  console.error(`debug failed: ${summary.error}`)
  console.error(`summary=${outPath}`)
  process.exit(1)
})
