import { chromium, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
const baseURL = 'http://127.0.0.1:4173'
const screenshotDir = path.resolve('output/playwright/route-provider-real-qa')
const summaryPath = path.join(screenshotDir, 'provider-unavailable-summary.json')
const summary = { counts: { googleRoutes: 0, orsRoutes: 0 }, requestEvents: [], screenshots: {}, checks: {} }
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
  const tripId = 'qa-provider-unavailable-trip'
  const dayId = 'qa-provider-unavailable-day'
  await page.goto(`${baseURL}/#/home`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(async ({ now, tripId, dayId }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('TravelConsoleDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('open failed'))
    })
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['trips', 'days', 'itineraryItems', 'ticketMetas', 'ticketBlobs'], 'readwrite')
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => reject(tx.error ?? new Error('seed failed'))
      tx.objectStore('trips').put({ createdAt: now, destination: '日本东京', endDate: '2026-04-12', id: tripId, startDate: '2026-04-12', title: 'Provider Unavailable QA', updatedAt: now })
      tx.objectStore('days').put({ date: '2026-04-12', id: dayId, sortOrder: 1, title: 'Provider unavailable', tripId })
      for (const item of [
        { id: 'unavailable-item-a', title: '东京站', locationName: 'Tokyo Station', lat: 35.681236, lng: 139.767125, sortOrder: 1 },
        { id: 'unavailable-item-b', title: '日比谷公园', locationName: 'Hibiya Park', lat: 35.6745, lng: 139.7550, sortOrder: 2, previousTransportMode: 'car' },
      ]) tx.objectStore('itineraryItems').put({ address: item.locationName, createdAt: now, dayId, ticketIds: [], tripId, updatedAt: now, ...item })
    })
  }, { now, tripId, dayId })
  return { tripId, dayId }
}
async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  page.on('request', countProviderRequest)
  try {
    await clearDatabases(page)
    const { tripId, dayId } = await seedTrip(page)
    await page.evaluate(() => window.localStorage.setItem('tripmap:routing:provider', 'none'))
    phase = 'provider_unavailable_render'
    await page.goto(`${baseURL}/#/trip?tripId=${tripId}&dayId=${dayId}`, { waitUntil: 'domcontentloaded' })
    const panel = page.getByTestId('route-preparation-panel')
    await expect(panel).toContainText('当前路线服务不可用', { timeout: 15000 })
    await page.waitForTimeout(1000)
    const file = path.join(screenshotDir, 'provider-unavailable-state.png')
    await page.screenshot({ path: file, fullPage: true })
    summary.screenshots['provider-unavailable-state.png'] = file
    summary.checks.providerUnavailableShown = true
    summary.checks.noProviderRequest = summary.counts.googleRoutes === 0 && summary.counts.orsRoutes === 0
  } finally {
    await fs.promises.writeFile(summaryPath, JSON.stringify(summary, null, 2))
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
  process.exit(1)
})
