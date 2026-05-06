import { expect, type Locator, type Page } from '@playwright/test'

export async function clearTravelDatabase(page: Page) {
  await page.goto('/favicon.svg', { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('TravelConsoleDB')

      request.onsuccess = () => resolve()
      request.onerror = () => {
        reject(request.error ?? new Error('删除 IndexedDB 失败'))
      }
      request.onblocked = () => {
        reject(new Error('删除 IndexedDB 被现有连接阻塞'))
      }
    })
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
    window.localStorage.setItem('tripmap:e2e:supabase-unconfigured', '1')
  })
}

export function getHashParam(url: string, key: string) {
  const hash = new URL(url).hash
  const query = hash.split('?')[1] ?? ''
  return new URLSearchParams(query).get(key)
}
