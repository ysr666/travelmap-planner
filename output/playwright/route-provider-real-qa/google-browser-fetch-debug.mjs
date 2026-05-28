import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
const baseURL = 'http://127.0.0.1:4173'
const outPath = path.resolve('output/playwright/route-provider-real-qa/google-browser-fetch-debug-summary.json')
const key = fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).find((line) => line.startsWith('VITE_GOOGLE_MAPS_API_KEY='))?.split('=')[1]?.trim() || ''
const summary = { attempts: [] }
async function runAttempt(page, timeoutMs) {
  return await page.evaluate(async ({ key, timeoutMs }) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)
    const started = Date.now()
    try {
      const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline',
        },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: 35.681236, longitude: 139.767125 } } },
          destination: { location: { latLng: { latitude: 35.685176, longitude: 139.710052 } } },
          travelMode: 'DRIVE',
          routingPreference: 'TRAFFIC_UNAWARE',
        }),
        signal: controller.signal,
      })
      const text = await response.text()
      let parsed = null
      try { parsed = JSON.parse(text) } catch {}
      const route = parsed?.routes?.[0]
      return {
        elapsedMs: Date.now() - started,
        ok: response.ok,
        routeCount: Array.isArray(parsed?.routes) ? parsed.routes.length : null,
        status: response.status,
        hasPolyline: Boolean(route?.polyline?.encodedPolyline),
        distanceMeters: route?.distanceMeters,
        duration: route?.duration,
        errorStatus: parsed?.error?.status,
        errorMessage: parsed?.error?.message,
      }
    } catch (error) {
      return { elapsedMs: Date.now() - started, errorName: error?.name, errorMessage: error?.message ?? String(error) }
    } finally {
      clearTimeout(timeout)
    }
  }, { key, timeoutMs })
}
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const page = await context.newPage()
await page.goto(baseURL, { waitUntil: 'domcontentloaded' })
summary.attempts.push({ timeoutMs: 10000, result: await runAttempt(page, 10000) })
summary.attempts.push({ timeoutMs: 30000, result: await runAttempt(page, 30000) })
await fs.promises.writeFile(outPath, JSON.stringify(summary, null, 2))
await browser.close()
console.log(`summary=${outPath}`)
console.log(JSON.stringify(summary, null, 2))
