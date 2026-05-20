import { expect, type Locator, type Page } from '@playwright/test'

export async function clearTravelDatabase(page: Page) {
  await page.goto('/favicon.svg', { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => {
    window.localStorage.removeItem('tripmap:e2e:cloud-fixture')
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
}

export async function createDemoTripViaUi(page: Page) {
  await clearTravelDatabase(page)
  await expect(page.getByText('还没有旅行')).toBeVisible()
  await page.getByRole('button', { name: '创建示例旅行' }).click()

  const tripCard = page.getByTestId('trip-card').first()
  await expect(tripCard).toBeVisible()
  await clickTripCard(tripCard)
  await expect(page).toHaveURL(/#\/trip\?tripId=/)
  await page.getByText('第一天', { exact: true }).click()
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=schedule/)
  await expect(page.getByTestId('day-selector')).toBeVisible()

  return getHashParam(page.url(), 'tripId')
}

export async function clickTripCard(tripCard: Locator) {
  const openButton = tripCard.getByRole('button').filter({ hasText: '东京春日旅行' }).first()
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
    window.localStorage.setItem('tripmap:routing:provider', 'none')
    window.localStorage.removeItem('tripmap:routing:openrouteservice-api-key')
  })
}

export async function mockMapStyle(page: Page) {
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

export function getHashParam(url: string, key: string) {
  const hash = new URL(url).hash
  const query = hash.split('?')[1] ?? ''
  return new URLSearchParams(query).get(key)
}
