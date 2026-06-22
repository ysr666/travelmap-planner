import { expect, type Locator, type Page } from '@playwright/test'

export async function clearTravelDatabase(page: Page) {
  await page.goto('/favicon.svg', { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => {
    window.localStorage.removeItem('tripmap:e2e:cloud-fixture')
    window.localStorage.removeItem('tripmap:cloud-auto-snapshot:enabled')
    window.localStorage.removeItem('tripmap:cloud-auto-snapshot:state')
    window.localStorage.setItem('tripmap:dev:route-proxy-provider', '')
    window.localStorage.setItem('tripmap:dev:route-proxy-url', '')
    window.localStorage.removeItem('tripmap:provider-proxy:session-id')
    window.sessionStorage.removeItem('tripmap:cloud-snapshot-check:dismissed')
    function deleteDatabase(name: string) {
      return new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name)

        request.onsuccess = () => resolve()
        request.onerror = () => {
          reject(request.error ?? new Error(`删除 ${name} 失败`))
        }
        request.onblocked = () => {
          reject(new Error(`删除 ${name} 被现有连接阻塞`))
        }
      })
    }

    return Promise.all([
      deleteDatabase('TravelConsoleDB'),
      deleteDatabase('TripMapRouteCacheDB'),
    ]).then(() => undefined)
  })
  await page.goto('/#/home', { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: '还没有旅行' })).toBeVisible()
}

export async function createDemoTripViaUi(page: Page) {
  await clearTravelDatabase(page)
  await expect(page.getByRole('heading', { name: '还没有旅行' })).toBeVisible()
  await page.getByRole('button', { name: '创建示例旅行' }).click()

  const tripCard = page.getByTestId('trip-card').filter({ hasText: '东京春日旅行' })
  await expect(tripCard).toBeVisible()
  await clickTripCard(tripCard)
  await expect(page).toHaveURL(/#\/trip\?tripId=/)
  await page.getByRole('button', { name: /抵达与涩谷/ }).click()
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=schedule/)
  await expect(page.getByTestId('day-selector')).toBeVisible()

  return getHashParam(page.url(), 'tripId')
}

export async function clickTripCard(tripCard: Locator) {
  const openButton = tripCard.getByRole('button').filter({ hasText: '东京春日旅行' })
  if (await openButton.count()) {
    await openButton.click()
    return
  }

  await tripCard.click()
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const documentWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth,
    )
    return documentWidth - window.innerWidth
  })

  expect(overflow).toBeLessThanOrEqual(2)
}

export async function forceSupabaseUnconfigured(page: Page) {
  await page.route('**/*.supabase.co/**', (route) => route.abort())
  await page.evaluate(() => {
    window.localStorage.removeItem('tripmap:e2e:cloud-fixture')
    window.localStorage.setItem('tripmap:e2e:supabase-unconfigured', '1')
  })
}

export async function forceSupabaseFixture(page: Page, fixture: unknown) {
  await page.route('**/*.supabase.co/**', (route) => route.abort())
  await page.evaluate((nextFixture) => {
    window.localStorage.removeItem('tripmap:e2e:supabase-unconfigured')
    window.localStorage.setItem('tripmap:e2e:cloud-fixture', JSON.stringify(nextFixture))
  }, fixture)
}

export async function seedTravelRecords(page: Page, seed: {
  days?: unknown[]
  itineraryItems?: unknown[]
  ticketBlobs?: unknown[]
  ticketMetas?: unknown[]
  trips: unknown[]
}) {
  await page.evaluate(async (nextSeed) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('TravelConsoleDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('打开测试数据库失败'))
    })

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(
        ['trips', 'days', 'itineraryItems', 'ticketMetas', 'ticketBlobs'],
        'readwrite',
      )
      transaction.oncomplete = () => {
        db.close()
        resolve()
      }
      transaction.onerror = () => reject(transaction.error ?? new Error('写入测试数据失败'))
      transaction.onabort = () => reject(transaction.error ?? new Error('写入测试数据中断'))

      for (const trip of nextSeed.trips) transaction.objectStore('trips').put(trip)
      for (const day of nextSeed.days ?? []) transaction.objectStore('days').put(day)
      for (const item of nextSeed.itineraryItems ?? []) transaction.objectStore('itineraryItems').put(item)
      for (const ticket of nextSeed.ticketMetas ?? []) transaction.objectStore('ticketMetas').put(ticket)
      for (const blob of nextSeed.ticketBlobs ?? []) transaction.objectStore('ticketBlobs').put(blob)
    })
  }, seed)
}

export async function forceRoutingUnconfigured(page: Page) {
  await page.route('https://api.openrouteservice.org/**', (route) => route.abort())
  await page.evaluate(() => {
    window.localStorage.setItem('tripmap:dev:route-proxy-provider', '')
    window.localStorage.setItem('tripmap:dev:route-proxy-url', '')
    window.localStorage.setItem('tripmap:routing:provider', 'none')
    window.localStorage.removeItem('tripmap:routing:openrouteservice-api-key')
    window.dispatchEvent(new Event('tripmap:routing-config-changed'))
  })
}

export async function forceRouteProxyFixture(page: Page, options: { provider?: 'google' | 'openrouteservice'; url?: string } = {}) {
  const proxyUrl = options.url ?? '/api/provider-proxy'
  const provider = options.provider ?? 'openrouteservice'
  await page.evaluate((config) => {
    window.localStorage.removeItem('tripmap:routing:provider')
    window.localStorage.removeItem('tripmap:routing:openrouteservice-api-key')
    window.localStorage.setItem('tripmap:dev:route-proxy-provider', config.provider)
    window.localStorage.setItem('tripmap:dev:route-proxy-url', config.proxyUrl)
    window.dispatchEvent(new Event('tripmap:routing-config-changed'))
  }, { provider, proxyUrl })
}

export async function mockMapStyle(page: Page) {
  await mockGoogleMapsUnavailable(page)
  await page.route('https://tiles.openfreemap.org/styles/**', (route) =>
    route.fulfill({
      body: JSON.stringify({
        layers: [],
        name: 'TripMap E2E Empty Style',
        sources: {},
        version: 8,
      }),
      contentType: 'application/json',
    }),
  )
}

export async function mockGoogleMapsUnavailable(page: Page) {
  await page.route('https://maps.googleapis.com/maps/api/js**', (route) => route.abort())
}

export async function setRouteProxyConfig(page: Page) {
  await page.evaluate(() => {
    window.localStorage.setItem('tripmap:dev:route-proxy-provider', 'openrouteservice')
    window.localStorage.setItem('tripmap:dev:route-proxy-url', '/api/provider-proxy')
    window.dispatchEvent(new Event('tripmap:routing-config-changed'))
  })
}

export async function mockProviderProxyForOrsRoute(page: Page) {
  await page.route('**/api/provider-proxy', async (route) => {
    const body = route.request().postDataJSON()
    if (body.operation !== 'route_preview') {
      await route.fallback()
      return
    }
    const coords = body.coordinates ?? [[139.1, 35.1], [139.2, 35.2]]
    const segments = (body.segments ?? []).map((seg: Record<string, unknown>, i: number) => ({
      coordinates: [coords[seg.fromCoordinateIndex as number] ?? coords[0], coords[seg.toCoordinateIndex as number] ?? coords[1]],
      distanceMeters: 1200,
      durationSeconds: 600,
      fromItemId: seg.fromItemId,
      segmentIndex: seg.segmentIndex ?? i,
      toItemId: seg.toItemId,
    }))
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        operation: 'route_preview',
        provider: 'openrouteservice',
        route: {
          lineStrings: segments.map((s: { coordinates: unknown }) => s.coordinates),
          segments,
          status: 'road',
          warnings: [],
        },
      }),
    })
  })
}

export function getHashParam(url: string, key: string) {
  const hash = new URL(url).hash
  const query = hash.split('?')[1] ?? ''
  return new URLSearchParams(query).get(key)
}
