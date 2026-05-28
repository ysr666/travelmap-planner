import { chromium, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
const baseURL = 'http://127.0.0.1:4173'
const screenshotDir = path.resolve('output/playwright/route-provider-real-qa')
const envPath = path.resolve('.env.local')
const summaryPath = path.join(screenshotDir, 'route-panel-shots-summary.json')
function readEnvValue(name) {
  if (!fs.existsSync(envPath)) return ''
  const prefix = `${name}=`
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((entry) => entry.startsWith(prefix))
  return line ? line.slice(prefix.length).trim() : ''
}
const orsKey = readEnvValue('VITE_OPENROUTESERVICE_API_KEY')
const summary = { counts: { googleRoutes: 0, orsRoutes: 0 }, screenshots: {}, checks: {} }
function countProviderRequest(request) {
  const url = request.url()
  if (url.includes('routes.googleapis.com/directions/v2:computeRoutes')) summary.counts.googleRoutes += 1
  if (url.includes('api.openrouteservice.org/v2/directions')) summary.counts.orsRoutes += 1
}
async function resetAndSeed(page, tripId, dayId, title) {
  await page.goto(`${baseURL}/favicon.svg`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(async () => {
    window.localStorage.clear(); window.sessionStorage.clear()
    for (const name of ['TravelConsoleDB', 'TripMapRouteCacheDB']) await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name)
      request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error('blocked'))
    })
  })
  const now = Date.now()
  await page.goto(`${baseURL}/#/home`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(async ({ now, tripId, dayId, title }) => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('TravelConsoleDB'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['trips', 'days', 'itineraryItems', 'ticketMetas', 'ticketBlobs'], 'readwrite')
      tx.oncomplete = () => { db.close(); resolve() }; tx.onerror = () => reject(tx.error)
      tx.objectStore('trips').put({ createdAt: now, destination: '日本东京', endDate: '2026-04-12', id: tripId, startDate: '2026-04-12', title, updatedAt: now })
      tx.objectStore('days').put({ date: '2026-04-12', id: dayId, sortOrder: 1, title: '路线准备截图', tripId })
      for (const item of [
        { id: `${dayId}-a`, title: '东京站', locationName: 'Tokyo Station', lat: 35.681236, lng: 139.767125, sortOrder: 1 },
        { id: `${dayId}-b`, title: '日比谷公园', locationName: 'Hibiya Park', lat: 35.6745, lng: 139.7550, sortOrder: 2, previousTransportMode: 'car' },
      ]) tx.objectStore('itineraryItems').put({ address: item.locationName, createdAt: now, dayId, ticketIds: [], tripId, updatedAt: now, ...item })
    })
  }, { now, tripId, dayId, title })
}
async function shootPanel(page, name) {
  const panel = page.getByTestId('route-preparation-panel')
  await expect(panel).toBeVisible({ timeout: 15000 })
  await panel.scrollIntoViewIfNeeded()
  await page.waitForTimeout(500)
  const file = path.join(screenshotDir, name)
  await page.screenshot({ path: file, fullPage: false })
  summary.screenshots[name] = file
}
async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await context.newPage(); page.on('request', countProviderRequest)
  try {
    await resetAndSeed(page, 'qa-route-ready-shot-trip', 'qa-route-ready-shot-day', 'Route Ready Shot QA')
    await page.evaluate((key) => { window.localStorage.setItem('tripmap:routing:provider', 'openrouteservice'); window.localStorage.setItem('tripmap:routing:openrouteservice-api-key', key) }, orsKey)
    await page.goto(`${baseURL}/#/trip?tripId=qa-route-ready-shot-trip&dayId=qa-route-ready-shot-day`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('route-preparation-summary')).toContainText('可为 1 天生成路线预览', { timeout: 15000 })
    await shootPanel(page, 'trip-home-route-ready-before-confirm.png')
    await resetAndSeed(page, 'qa-provider-unavailable-shot-trip', 'qa-provider-unavailable-shot-day', 'Provider Unavailable QA')
    await page.evaluate(() => window.localStorage.setItem('tripmap:routing:provider', 'none'))
    await page.goto(`${baseURL}/#/trip?tripId=qa-provider-unavailable-shot-trip&dayId=qa-provider-unavailable-shot-day`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('route-preparation-panel')).toContainText('当前路线服务不可用', { timeout: 15000 })
    await shootPanel(page, 'provider-unavailable-state.png')
    summary.checks.noProviderRequests = summary.counts.googleRoutes === 0 && summary.counts.orsRoutes === 0
  } finally {
    await fs.promises.writeFile(summaryPath, JSON.stringify(summary, null, 2))
    await browser.close().catch(() => {})
  }
}
main().then(() => { console.log(`summary=${summaryPath}`); console.log(`googleRoutes=${summary.counts.googleRoutes}`); console.log(`orsRoutes=${summary.counts.orsRoutes}`) }).catch(async (error) => { summary.error = error.message; await fs.promises.writeFile(summaryPath, JSON.stringify(summary, null, 2)); console.error(`QA failed: ${error.message}`); process.exit(1) })
