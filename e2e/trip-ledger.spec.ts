import { expect, test } from '@playwright/test'
import { clearTravelDatabase, expectNoHorizontalOverflow, seedTravelRecords } from './helpers'

test('旅行账本支持双币种、费用草稿、分摊预算和结算', async ({ page }) => {
  const now = Date.now()
  const trip = {
    createdAt: now,
    destination: '日本东京',
    endDate: '2026-04-03',
    id: 'trip_ledger_e2e',
    startDate: '2026-04-01',
    title: '东京账本旅行',
    updatedAt: now,
  }
  await clearTravelDatabase(page)
  await seedTravelRecords(page, {
    days: [{ date: '2026-04-01', id: 'day_ledger', sortOrder: 0, title: '第一天', tripId: trip.id }],
    trips: [trip],
  })
  await page.evaluate(async (tripId) => {
    const request = indexedDB.open('TravelConsoleDB')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('travelInboxEntries', 'readwrite')
      transaction.objectStore('travelInboxEntries').put({
        category: 'ticket',
        createdAt: Date.now(),
        extractedText: '浅草晚餐 实付 JPY 3600 付款人 我',
        id: 'inbox_ledger',
        label: '浅草晚餐订单',
        sourceKind: 'pasted_text',
        status: 'ready',
        tripId,
        updatedAt: Date.now(),
        warnings: [],
      })
      transaction.oncomplete = () => { db.close(); resolve() }
      transaction.onerror = () => reject(transaction.error)
    })
  }, trip.id)
  await page.route('**/api/provider-proxy', async (route) => {
    const body = route.request().postDataJSON()
    if (body.operation === 'exchange_rate') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          baseCurrency: body.baseCurrency,
          effectiveDate: '2026-04-01',
          fetchedAt: '2026-04-01T12:00:00.000Z',
          ok: true,
          operation: 'exchange_rate',
          provider: 'frankfurter',
          rates: body.quoteCurrencies.map((quoteCurrency: string) => ({ quoteCurrency, rate: quoteCurrency === 'CNY' ? '0.05' : '1' })),
          requestedDate: body.requestedDate,
          sourceUrl: 'https://api.frankfurter.dev/v2/rates',
        }),
      })
      return
    }
    await route.fallback()
  })

  await page.goto(`/#/ledger?tripId=${trip.id}`, { waitUntil: 'domcontentloaded' })
  const setup = page.getByTestId('ledger-setup')
  await expect(setup).toBeVisible()
  await setup.getByLabel('常住地币种').selectOption('CNY')
  await setup.getByLabel('旅行币种').selectOption('JPY')
  await setup.getByLabel('旅行总预算（JPY）').fill('2000')
  await setup.getByRole('button', { name: '创建账本' }).click()

  await expect(page.getByTestId('ledger-summary')).toBeVisible()
  await page.getByRole('button', { name: '同行人' }).click()
  await page.getByLabel('同行人姓名').fill('小林')
  await page.getByRole('button', { name: '添加同行人' }).click()
  await expect(page.getByLabel('小林 姓名')).toBeVisible()

  await page.getByRole('button', { name: '明细' }).click()
  await page.getByRole('button', { name: '整理费用' }).click()
  const preview = page.getByTestId('ledger-scan-preview')
  await expect(preview).toContainText('浅草晚餐订单')
  await expect(preview).toContainText('JP¥3,600')
  await preview.getByRole('button', { name: '生成待确认费用' }).click()
  await expect(page.getByTestId('ledger-expense-row')).toContainText('浅草晚餐订单')

  await page.getByRole('button', { name: '记一笔' }).click()
  const editor = page.getByTestId('ledger-expense-editor')
  await editor.getByLabel('费用名称').fill('东京酒店')
  await editor.getByLabel('金额').fill('3000')
  await editor.getByLabel('类别').selectOption('lodging')
  await editor.getByLabel('付款人').selectOption({ label: '我' })
  await editor.getByRole('button', { name: '保存' }).click()
  await expect(page.getByTestId('ledger-expense-row').filter({ hasText: '东京酒店' })).toBeVisible()
  await expect(page.getByTestId('ledger-summary')).toContainText('JP¥3,000')
  await expect(page.getByTestId('ledger-summary')).toContainText('已超预算')

  await page.getByRole('button', { name: '结算' }).click()
  await expect(page.getByText('小林 → 我')).toBeVisible()
  await expect(page.getByText('¥75.00')).toBeVisible()
  await expect(page.getByText(/未纳入结算/)).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.getByRole('button', { name: '返回旅行总览' }).click()
  await expect(page.getByTestId('trip-ledger-summary')).toContainText('JP¥3,000')
})
