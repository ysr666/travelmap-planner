import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
const baseURL = 'http://127.0.0.1:4173'
const outPath = path.resolve('output/playwright/route-provider-real-qa/google-browser-network-variants-summary.json')
const key = fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).find((line) => line.startsWith('VITE_GOOGLE_MAPS_API_KEY='))?.split('=')[1]?.trim() || ''
async function attempt(args, timeoutMs = 15000) {
  const events = []
  const browser = await chromium.launch({ headless: true, args })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  page.on('request', (request) => {
    const url = request.url()
    if (url.includes('routes.googleapis.com/directions/v2:computeRoutes')) events.push({ event: 'request', method: request.method(), resourceType: request.resourceType() })
  })
  page.on('requestfailed', (request) => {
    const url = request.url()
    if (url.includes('routes.googleapis.com/directions/v2:computeRoutes')) events.push({ event: 'requestfailed', method: request.method(), failure: request.failure()?.errorText })
  })
  page.on('response', (response) => {
    const url = response.url()
    if (url.includes('routes.googleapis.com/directions/v2:computeRoutes')) events.push({ event: 'response', status: response.status(), ok: response.ok() })
  })
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' })
  const result = await page.evaluate(async ({ key, timeoutMs }) => {
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
      return { elapsedMs: Date.now() - started, status: response.status, ok: response.ok, routeCount: parsed?.routes?.length ?? null, hasPolyline: Boolean(parsed?.routes?.[0]?.polyline?.encodedPolyline), errorStatus: parsed?.error?.status, errorMessage: parsed?.error?.message }
    } catch (error) {
      return { elapsedMs: Date.now() - started, errorName: error?.name, errorMessage: error?.message ?? String(error) }
    } finally {
      clearTimeout(timeout)
    }
  }, { key, timeoutMs })
  await browser.close()
  return { args, result, events }
}
const summary = []
summary.push(await attempt([], 15000))
summary.push(await attempt(['--disable-quic'], 15000))
summary.push(await attempt(['--disable-http2', '--disable-quic'], 15000))
await fs.promises.writeFile(outPath, JSON.stringify(summary, null, 2))
console.log(`summary=${outPath}`)
console.log(JSON.stringify(summary, null, 2))
