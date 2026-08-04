import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import lowFrequencyFixture from './fixtures/home-v3-visual.json' with { type: 'json' }
import {
  clearTravelDatabase,
  expectNoHorizontalOverflow,
  forceSupabaseUnconfigured,
  seedTravelRecords,
} from './helpers'

test.use({ colorScheme: 'light', locale: 'zh-CN', timezoneId: 'Europe/London' })

const captureGoldens = process.env.CAPTURE_UI_V3_GOLDENS === '1'
const goldenOutputDirectory = resolve('output/playwright/ui-v3-low-frequency')
const requiredViewports = [
  { height: 568, name: '320x568', width: 320 },
  { height: 844, name: '390x844', width: 390 },
  { height: 932, name: '430x932', width: 430 },
  { height: 1024, name: '768x1024', width: 768 },
  { height: 720, name: '1280x720', width: 1280 },
  { height: 900, name: '1440x900', width: 1440 },
]

test('UI V3 搜索、AI 草稿、账本与同行页保持单一层级和受控宽度', async ({ page }) => {
  const browserErrors: string[] = []
  let providerRequests = 0
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))
  await page.route('**/api/provider-proxy', (route) => {
    providerRequests += 1
    void route.abort()
  })

  await page.clock.setFixedTime(new Date(lowFrequencyFixture.fixedNow))
  await clearTravelDatabase(page)
  await forceSupabaseUnconfigured(page)
  await seedTravelRecords(page, lowFrequencyFixture.records)
  if (captureGoldens) await mkdir(goldenOutputDirectory, { recursive: true })

  const trip = lowFrequencyFixture.records.trips[0]

  await page.goto(`/#/search?from=trip&tripId=${trip.id}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { exact: true, name: '搜索' })).toHaveCount(1)
  await expect(page.getByTestId('local-search-results')).toBeVisible()
  await capturePage(page, { maxWidth: 770, name: 'search', testId: 'search-page' })

  await page.goto('/#/ai-draft', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { exact: true, name: 'AI 生成行程' })).toHaveCount(1)
  await expect(page.getByText('告诉 AI 目的地和日期')).toHaveCount(0)
  for (const testId of ['ai-draft-preferences', 'ai-draft-generation-options']) {
    await expect(page.getByTestId(testId)).not.toHaveAttribute('open', '')
  }
  await expect(page.getByTestId('ai-draft-json-section').locator('details')).not.toHaveAttribute('open', '')
  await capturePage(page, { maxWidth: 514, name: 'ai-draft', testId: 'ai-draft-page' })

  await page.getByLabel(/目的地/).fill('东京')
  await page.getByLabel(/开始日期/).fill('2026-09-01')
  await page.getByTestId('ai-draft-generation-options').locator('summary').click()
  await page.getByRole('button', { exact: true, name: '生成本地示例草案' }).click()
  await expect(page.getByTestId('ai-draft-preview')).toBeVisible()
  await expect(page.getByTestId('ai-draft-request-settings')).not.toHaveAttribute('open', '')
  await expect(page.getByTestId('ai-draft-request-form')).toBeHidden()
  await expect(page.getByTestId('ai-draft-json-section')).toBeHidden()
  await capturePage(page, { maxWidth: 898, name: 'ai-draft-preview', testId: 'ai-draft-page' })

  await page.goto(`/#/ledger?tripId=${trip.id}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('ledger-setup')).toBeVisible()
  await capturePage(page, { maxWidth: 770, name: 'ledger-setup', testId: 'ledger-content' })

  await seedLedger(page, trip.id)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('ledger-page')).toBeVisible()
  await expect(page.getByTestId('ledger-content').getByText(trip.title, { exact: true })).toHaveCount(0)
  await capturePage(page, { maxWidth: 770, name: 'ledger-active', testId: 'ledger-content' })

  await page.goto(`/#/ledger/expense?tripId=${trip.id}&expenseId=expense-low-frequency-v3`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('ledger-expense-detail')).toBeVisible()
  await capturePage(page, { maxWidth: 770, name: 'ledger-expense', testId: 'ledger-expense-detail' })

  await page.goto(`/#/shared-trip?tripId=${trip.id}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('shared-trip-owner-page')).toBeVisible()
  await expect(page.getByText('同行共享暂不可用', { exact: true })).toBeVisible()
  await expect(page.getByText(/Supabase|VITE_|ANON_KEY|API.?KEY|Provider/i)).toHaveCount(0)
  await capturePage(page, { maxWidth: 770, name: 'shared-owner', testId: 'shared-trip-surface' })

  expect(providerRequests).toBe(0)
  expect(browserErrors).toEqual([])
})

async function capturePage(
  page: Page,
  options: { maxWidth: number; name: string; testId: string },
) {
  for (const viewport of requiredViewports) {
    await page.setViewportSize({ height: viewport.height, width: viewport.width })
    await page.evaluate(() => {
      const main = document.querySelector<HTMLElement>('main')
      main?.scrollTo(0, 0)
      window.scrollTo(0, 0)
    })
    await expectNoHorizontalOverflow(page)
    await expectContentBounds(page, options.testId, options.maxWidth)
    if (captureGoldens) {
      await page.screenshot({
        animations: 'disabled',
        caret: 'hide',
        path: resolve(goldenOutputDirectory, `${options.name}-${viewport.name}.png`),
      })
    }
  }
}

async function expectContentBounds(page: Page, testId: string, desktopMaxWidth: number) {
  const bounds = await page.getByTestId(testId).evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { left: rect.left, right: rect.right, viewportWidth: innerWidth, width: rect.width }
  })
  expect(bounds.left).toBeGreaterThanOrEqual(-1)
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth + 1)
  if (bounds.viewportWidth >= 1024) expect(bounds.width).toBeLessThanOrEqual(desktopMaxWidth)
}

async function seedLedger(page: Page, tripId: string) {
  await page.evaluate(async ({ id, now }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('TravelConsoleDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction(
      ['ledgerSettings', 'ledgerParticipants', 'ledgerBudgets', 'ledgerExpenses'],
      'readwrite',
    )
    transaction.objectStore('ledgerSettings').put({
      createdAt: now,
      homeCurrency: 'CNY',
      id: 'settings-low-frequency-v3',
      settlementCurrency: 'CNY',
      tripCurrency: 'GBP',
      tripId: id,
      updatedAt: now,
    })
    transaction.objectStore('ledgerParticipants').put({
      createdAt: now,
      displayName: '我',
      id: 'participant-low-frequency-v3',
      isSelf: true,
      source: 'manual',
      tripId: id,
      updatedAt: now,
    })
    transaction.objectStore('ledgerBudgets').put({
      amountMinor: 240_000,
      createdAt: now,
      currency: 'GBP',
      id: 'budget-low-frequency-v3',
      scope: 'trip',
      tripId: id,
      updatedAt: now,
    })
    transaction.objectStore('ledgerExpenses').put({
      amountMinor: 12_950,
      category: 'admission',
      createdAt: now,
      currency: 'GBP',
      date: '2026-07-30',
      id: 'expense-low-frequency-v3',
      itemIds: ['item_home_v3_castle'],
      payerParticipantId: 'participant-low-frequency-v3',
      paymentStatus: 'paid',
      reviewStatus: 'reviewed',
      source: { kind: 'manual' },
      splitMode: 'equal',
      splitShares: [{ participantId: 'participant-low-frequency-v3', weight: 1 }],
      status: 'confirmed',
      title: '爱丁堡城堡门票',
      tripId: id,
      updatedAt: now,
    })
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    database.close()
  }, { id: tripId, now: Date.now() })
}
