import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
const outPath = path.resolve('output/playwright/route-provider-real-qa/google-proxy-debug-summary.json')
const key = fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).find((line) => line.startsWith('VITE_GOOGLE_MAPS_API_KEY='))?.split('=')[1]?.trim() || ''
async function attempt(name, launchOptions) {
  const browser = await chromium.launch({ headless: true, ...launchOptions })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  const events = []
  page.on('request', (request) => {
    if (request.url().includes('routes.googleapis.com/directions/v2:computeRoutes')) events.push({ event: 'request', method: request.method() })
  })
  page.on('response', (response) => {
    if (response.url().includes('routes.googleapis.com/directions/v2:computeRoutes')) events.push({ event: 'response', status: response.status(), ok: response.ok() })
  })
  page.on('requestfailed', (request) => {
    if (request.url().includes('routes.googleapis.com/directions/v2:computeRoutes')) events.push({ event: 'requestfailed', failure: request.failure()?.errorText })
  })
  await page.goto('http://127.0.0.1:4173', { waitUntil: 'domcontentloaded' })
  const result = await page.evaluate(async ({ key }) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(new Error('timeout')), 20000)
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
      return { elapsedMs: Date.now() - started, status: response.status, ok: response.ok, routeCount: parsed?.routes?.length ?? null, hasPolyline: Boolean(parsed?.routes?.[0]?.polyline?.encodedPolyline) }
    } catch (error) {
      return { elapsedMs: Date.now() - started, errorName: error?.name, errorMessage: error?.message ?? String(error) }
    } finally {
      clearTimeout(timeout)
    }
  }, { key })
  await browser.close()
  return { name, result, events }
}
const results = []
results.push(await attempt('bundled-no-proxy', {}))
results.push(await attempt('bundled-http-proxy-10808', { proxy: { server: 'http://127.0.0.1:10808', bypass: '127.0.0.1,localhost' } }))
results.push(await attempt('bundled-socks5-proxy-10808', { proxy: { server: 'socks5://127.0.0.1:10808', bypass: '127.0.0.1,localhost' } }))
await fs.promises.writeFile(outPath, JSON.stringify(results, null, 2))
console.log(`summary=${outPath}`)
console.log(JSON.stringify(results, null, 2))
