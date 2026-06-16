import { expect, test } from '@playwright/test'
import { clearTravelDatabase, expectNoHorizontalOverflow, seedTravelRecords } from './helpers'

test('旅行账单档案支持后台归档、时间线、完整性、查询和结算', async ({ page }) => {
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
  await page.getByRole('button', { name: /全部账单/ }).click()
  await expect(page.getByTestId('ledger-expense-row').filter({ hasText: '浅草晚餐订单' })).toBeVisible({ timeout: 10_000 })

  await page.getByRole('button', { name: '报告' }).click()
  await page.getByRole('button', { name: '同行人管理' }).click()
  await page.getByLabel('同行人姓名').fill('小林')
  await page.getByRole('button', { name: '添加同行人' }).click()
  await expect(page.getByLabel('小林 姓名')).toBeVisible()

  await page.getByRole('button', { name: '账单' }).click()
  await page.getByRole('button', { name: '记一笔' }).click()
  const editor = page.getByTestId('ledger-expense-editor')
  await editor.getByLabel('费用名称').fill('东京酒店')
  await editor.getByLabel('金额').fill('3000')
  await editor.getByLabel('类别').selectOption('lodging')
  await editor.getByLabel('商户 / 服务商').fill('Tokyo Stay')
  await editor.getByLabel('完整订单号').fill('HOTEL-12345')
  await editor.getByLabel('预订时间').fill('2026-03-01T10:00')
  await editor.getByLabel('付款时间').fill('2026-03-02T10:00')
  await editor.getByLabel('使用开始').fill('2026-04-01T15:00')
  await editor.getByLabel('付款人').selectOption({ label: '我' })
  await editor.getByRole('button', { name: '保存' }).click()
  await page.getByRole('button', { name: /全部账单/ }).click()
  const hotelRow = page.getByTestId('ledger-expense-row').filter({ hasText: '东京酒店' })
  await expect(hotelRow).toBeVisible()
  await expect(page.getByTestId('ledger-summary')).toContainText('JP¥6,600')
  await expect(page.getByTestId('ledger-summary')).toContainText('已超预算')
  await hotelRow.locator('button').first().click()
  await expect(page.getByTestId('ledger-expense-detail')).toContainText('HOTEL-12345')
  await expect(page.getByText('来源已不可用')).toHaveCount(0)
  await page.getByRole('button', { name: '返回旅行账本' }).click()

  await page.getByRole('button', { name: '时间线' }).click()
  await page.getByRole('button', { name: '预订' }).click()
  await expect(page.getByText('东京酒店')).toBeVisible()

  await page.getByRole('button', { name: '完整性' }).click()
  await expect(page.getByText(/尚未关联行程/).first()).toBeVisible()

  await page.getByRole('button', { name: '报告' }).click()
  await expect(page.getByText('旅行结束报告').first()).toBeVisible()
  await page.getByPlaceholder('例如：东京酒店一共多少钱？').fill('酒店一共多少钱？')
  await page.getByRole('button', { name: '查询' }).click()
  await expect(page.getByText(/找到 1 笔账单/)).toBeVisible()
  await page.getByRole('button', { name: '查看结算' }).click()
  await expect(page.getByText('小林 → 我')).toBeVisible()
  await expect(page.getByText('¥75.00')).toBeVisible()
  await expect(page.getByText(/未纳入结算/)).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.getByRole('button', { name: '返回旅行总览' }).click()
  await expect(page.getByTestId('trip-ledger-summary')).toContainText('JP¥6,600')
})

test('票据审核队列批量处理合格账单并保留风险项', async ({ page }) => {
  const now = Date.now()
  const tripId = 'trip_ledger_review_e2e'
  await clearTravelDatabase(page)
  await seedTravelRecords(page, {
    days: [{ date: '2026-06-01', id: 'day-review', sortOrder: 0, title: '第一天', tripId }],
    itineraryItems: [{ createdAt: now, dayId: 'day-review', id: 'item-review', sortOrder: 0, ticketIds: ['ticket-auto'], title: '酒店入住', tripId, updatedAt: now }],
    ticketMetas: [{ createdAt: now, fileName: 'hotel.txt', fileType: 'text', id: 'ticket-auto', itemId: 'item-review', mimeType: 'text/plain', referenceLocation: '订单邮件', scope: 'item', storageMode: 'reference', title: '酒店付款票据', tripId, updatedAt: now }],
    trips: [{ createdAt: now, destination: '东京', endDate: '2026-06-03', id: tripId, startDate: '2026-06-01', title: '审核队列旅行', updatedAt: now }],
  })
  await page.evaluate(async ({ now, tripId }) => {
    const request = indexedDB.open('TravelConsoleDB')
    const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    const transaction = db.transaction(['ledgerSettings', 'ledgerParticipants', 'ledgerBudgets', 'ledgerExpenses'], 'readwrite')
    transaction.objectStore('ledgerSettings').put({ createdAt: now, homeCurrency: 'CNY', id: 'settings-review', settlementCurrency: 'CNY', tripCurrency: 'CNY', tripId, updatedAt: now })
    transaction.objectStore('ledgerParticipants').put({ createdAt: now, displayName: '我', id: 'person-review', isSelf: true, source: 'manual', tripId, updatedAt: now })
    transaction.objectStore('ledgerBudgets').put({ amountMinor: 100000, createdAt: now, currency: 'CNY', id: 'budget-review', scope: 'trip', tripId, updatedAt: now })
    const base = {
      category: 'other', createdAt: now, currency: 'CNY', date: '2026-06-01', itemIds: ['item-review'], orderStatus: 'active', payerParticipantId: 'person-review', paymentStatus: 'paid', splitMode: 'equal', splitShares: [{ participantId: 'person-review', weight: 1 }], tripId, updatedAt: now,
    }
    const expenses = [
      { ...base, amountMinor: 12000, category: 'lodging', id: 'expense-auto', reviewStatus: 'auto_confirmed', source: { kind: 'ticket', sourceId: 'ticket-auto' }, sourceLinks: [{ available: true, id: 'ticket:auto', kind: 'ticket', role: 'payment_receipt', sourceId: 'ticket-auto', title: '酒店付款票据' }], status: 'confirmed', title: '自动酒店' },
      { ...base, amountMinor: 8000, category: 'admission', id: 'expense-eligible', reviewStatus: 'needs_review', source: { kind: 'inbox', sourceId: 'eligible' }, sourceLinks: [{ available: true, id: 'inbox:eligible', kind: 'inbox', role: 'payment_receipt', sourceId: 'eligible' }], status: 'draft', title: '可确认门票' },
      { ...base, amountMinor: 3000, id: 'expense-duplicate-a', reviewStatus: 'needs_review', source: { kind: 'inbox', sourceId: 'duplicate-a' }, sourceLinks: [{ available: true, id: 'inbox:duplicate-a', kind: 'inbox', role: 'payment_receipt', sourceId: 'duplicate-a' }], status: 'draft', title: '重复账单' },
      { ...base, amountMinor: 3000, id: 'expense-duplicate-b', reviewStatus: 'needs_review', source: { kind: 'inbox', sourceId: 'duplicate-b' }, sourceLinks: [{ available: true, id: 'inbox:duplicate-b', kind: 'inbox', role: 'payment_receipt', sourceId: 'duplicate-b' }], status: 'draft', title: '重复账单' },
      { ...base, amountMinor: undefined, id: 'expense-missing', reviewStatus: 'needs_review', source: { kind: 'manual' }, sourceLinks: [], status: 'draft', title: '缺金额账单' },
    ]
    for (const expense of expenses) transaction.objectStore('ledgerExpenses').put(expense)
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => { db.close(); resolve() }; transaction.onerror = () => reject(transaction.error) })
  }, { now, tripId })

  await page.goto(`/#/ledger?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('ledger-review-queue')).toBeVisible()
  await expect(page.getByRole('button', { name: /已自动归档 1/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /疑似重复 2/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /缺字段/ })).toBeVisible()
  await expect(page.getByLabel('选择 重复账单').first()).toBeDisabled()

  await page.getByLabel('选择 可确认门票').check()
  await page.getByRole('button', { name: '确认可处理项（1）' }).click()
  await expect(page.getByText('已确认 1 笔账单')).toBeVisible()
  await page.getByLabel('选择 自动酒店').check()
  await page.getByRole('button', { name: '标记已阅（1）' }).click()
  await expect(page.getByText('已将 1 笔自动归档标记为已阅')).toBeVisible()

  await page.getByRole('button', { name: /全部账单/ }).click()
  const autoRow = page.getByTestId('ledger-expense-row').filter({ hasText: '自动酒店' })
  await autoRow.locator('button').first().click()
  await expect(page.getByTestId('ledger-expense-detail')).toBeVisible()
  await expect(page.getByText('酒店付款票据').first()).toBeVisible()
  await page.getByRole('button', { name: '打开原始来源' }).click()
  await expect(page).toHaveURL(/#\/documents\?.*ticketId=ticket-auto/)
  await expectNoHorizontalOverflow(page)
})
