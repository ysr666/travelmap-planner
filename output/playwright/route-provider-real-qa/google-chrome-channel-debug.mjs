import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
const outPath = path.resolve('output/playwright/route-provider-real-qa/google-chrome-channel-debug-summary.json')
const key = fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).find((line) => line.startsWith('VITE_GOOGLE_MAPS_API_KEY='))?.split('=')[1]?.trim() || ''
async function attempt(channel) {
  const summary = { channel, events: [] }
  let browser
  try {
    browser = await chromium.launch({ channel, headless: true, args: ['--disable-quic'] })
  } catch (error) {
    return { channel, launchError: error.message }
  }
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  page.on('request', (request) => {
    if (request.url().includes('routes.googleapis.com/directions/v2:computeRoutes')) summary.events.push({ event: 'request', method: request.method() })
  })
  page.on('response', (response) => {
    if (response.url().includes('routes.googleapis.com/directions/v2:computeRoutes')) summary.events.push({ event: 'response', status: response.status(), ok: response.ok() })
  })
  page.on('requestfailed', (request) => {
    if (request.url().includes('routes.googleapis.com/directions/v2:computeRoutes')) summary.events.push({ event: 'requestfailed', method: request.method(), failure: request.failure()?.errorText })
  })
  await page.goto('http://127.0.0.1:4173', { waitUntil: 'domcontentloaded' })
  summary.result = await page.evaluate(async ({ key }) => {
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
      return { elapsedMs: Date.now() - started, status: response.status, ok: response.ok, routeCount: parsed?.routes?.length ?? null, hasPolyline: Boolean(parsed?.routes?.[0]?.polyline?.encodedPolyline), errorStatus: parsed?.error?.status, errorMessage: parsed?.error?.message }
    } catch (error) {
      return { elapsedMs: Date.now() - started, errorName: error?.name, errorMessage: error?.message ?? String(error) }
    } finally {
      clearTimeout(timeout)
    }
  }, { key })
  await browser.close()
  return summary
}
const results = []
for (const channel of ['chrome', 'chromium']) results.push(await attempt(channel))
await fs.promises.writeFile(outPath, JSON.stringify(results, null, 2))
console.log(`summary=${outPath}`)
console.log(JSON.stringify(results, null, 2))
