import { expect, test, type Page } from '@playwright/test'
import {
  clearTravelDatabase,
  clickTripCard,
  expectNoHorizontalOverflow,
  forceRouteProxyFixture,
  getFirstTripDayAndItemIds,
  seedTravelRecords,
} from './helpers'

test('全局 AI 在无旅行上下文时离线回答能力问题', async ({ page }) => {
  await clearTravelDatabase(page)
  const providerProxyRequests: string[] = []
  await page.route('**/api/provider-proxy', (route) => {
    providerProxyRequests.push(route.request().url())
    return route.abort()
  })

  await expect(page.getByTestId('global-ai-command-bar')).toBeVisible()
  await expect(page.getByTestId('global-ai-context-label')).toContainText('全部旅行')
  await page.getByLabel('全局 AI 指令').fill('你能做什么？')
  await page.getByRole('button', { name: '发送 AI 指令' }).click()

  const result = page.getByTestId('global-ai-command-result')
  await expect(result).toContainText('我能帮你做什么')
  await expect(page.getByTestId('global-ai-help-result')).toContainText('预览和确认')
  expect(providerProxyRequests).toHaveLength(0)
  await expectNoHorizontalOverflow(page)
})

test('全局 AI 查找票据后直接打开画廊目标并收起结果面板', async ({ page }) => {
  await clearTravelDatabase(page)
  await page.getByRole('button', { name: '创建示例旅行' }).click()
  const tripCard = page.getByTestId('trip-card').filter({ hasText: '东京春日旅行' })
  await expect(tripCard).toBeVisible()
  await clickTripCard(tripCard)
  const tripId = new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('tripId')
  expect(tripId).toBeTruthy()

  await page.evaluate(async (nextTripId) => {
    const request = indexedDB.open('TravelConsoleDB')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('打开测试数据库失败'))
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('ticketMetas', 'readwrite')
      transaction.objectStore('ticketMetas').put({
        createdAt: Date.now(),
        fileName: 'edinburgh-castle-ticket.pdf',
        fileType: 'pdf',
        id: 'ticket-ai-edinburgh',
        mimeType: 'application/pdf',
        referenceLocation: '测试票据位置',
        scope: 'trip',
        size: 1024,
        storageMode: 'reference',
        title: '爱丁堡城堡门票',
        tripId: nextTripId,
        updatedAt: Date.now(),
      })
      transaction.oncomplete = () => {
        db.close()
        resolve()
      }
      transaction.onerror = () => reject(transaction.error ?? new Error('写入票据失败'))
    })
  }, tripId!)

  await page.getByLabel('全局 AI 指令').fill('找一下爱丁堡的门票')
  await page.getByRole('button', { name: '发送 AI 指令' }).click()

  await expect(page).toHaveURL(/#\/documents\?/)
  await expect(page).toHaveURL(/tab=attachments/)
  await expect(page).toHaveURL(/ticketId=ticket-ai-edinburgh/)
  await expect(page.getByTestId('ticket-gallery')).toContainText('爱丁堡城堡门票')
  await expect(page.getByTestId('global-ai-command-result')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('全局 AI 通过注册动作直接打开资料中心且不调用 Provider', async ({ page }) => {
  await clearTravelDatabase(page)
  const providerProxyRequests: string[] = []
  await page.route('**/api/provider-proxy', (route) => {
    providerProxyRequests.push(route.request().url())
    return route.abort()
  })

  await page.getByRole('button', { name: '创建示例旅行' }).click()
  const tripCard = page.getByTestId('trip-card').filter({ hasText: '东京春日旅行' })
  await clickTripCard(tripCard)

  await page.getByLabel('全局 AI 指令').fill('打开资料中心')
  await page.getByRole('button', { name: '发送 AI 指令' }).click()

  await expect(page).toHaveURL(/#\/documents\?/)
  await expect(page).toHaveURL(/tab=documents/)
  await expect(page.getByRole('heading', { name: '旅行资料' })).toBeVisible()
  await expect(page.getByTestId('global-ai-action-confirm-dialog')).not.toBeVisible()
  await expect(page.getByTestId('global-ai-command-result')).toHaveCount(0)
  expect(providerProxyRequests).toHaveLength(0)
  await expectNoHorizontalOverflow(page)
})

test('全局 AI 时间调整只在一次确认后写入并保留原时长', async ({ page }) => {
  await clearTravelDatabase(page)
  const providerProxyRequests: string[] = []
  await page.route('**/api/provider-proxy', (route) => {
    providerProxyRequests.push(route.request().url())
    return route.abort()
  })

  await page.getByRole('button', { name: '创建示例旅行' }).click()
  const tripCard = page.getByTestId('trip-card').filter({ hasText: '东京春日旅行' })
  await clickTripCard(tripCard)
  const tripId = new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('tripId')
  expect(tripId).toBeTruthy()
  const { firstItemId } = await getFirstTripDayAndItemIds(page, tripId!)
  await updateItineraryItemTimes(page, firstItemId, '09:00', '10:30')

  await page.getByLabel('全局 AI 指令').fill('把第一站改到11点')
  await page.getByRole('button', { name: '发送 AI 指令' }).click()

  const result = page.getByTestId('global-ai-command-result')
  await expect(result).toContainText('调整行程时间')
  await expect(result).toContainText('09:00-10:30 → 11:00-12:30')
  await expect(page.getByTestId('global-ai-action-details')).not.toHaveAttribute('open', '')
  await expect(result.getByRole('button', { name: '确认执行' })).toHaveCount(1)
  await expect.poll(async () => await readItineraryItem(page, firstItemId)).toMatchObject({
    endTime: '10:30',
    startTime: '09:00',
  })
  await expect(page.getByTestId('global-ai-action-confirm-dialog')).toHaveCount(0)

  await result.getByRole('button', { name: '确认执行' }).click()

  await expect(result).toContainText('已完成')
  await expect.poll(async () => await readItineraryItem(page, firstItemId)).toMatchObject({
    endTime: '12:30',
    startTime: '11:00',
  })
  await expect(await countStore(page, 'tripIntelligenceAppliedChanges')).toBeGreaterThan(0)
  expect(providerProxyRequests).toHaveLength(0)
  await expectNoHorizontalOverflow(page)
})

test('全局 AI 在 390px 仅经一次确认更新进度和重排偏好', async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 })
  await clearTravelDatabase(page)
  const providerProxyRequests: string[] = []
  await page.route('**/api/provider-proxy', (route) => {
    providerProxyRequests.push(route.request().url())
    return route.abort()
  })
  const now = Date.now()
  await seedTravelRecords(page, {
    days: [{
      date: '2026-07-10',
      id: 'gateway-state-day',
      sortOrder: 1,
      title: '伦敦第一天',
      tripId: 'gateway-state-trip',
    }],
    itineraryItems: [{
      createdAt: now,
      dayId: 'gateway-state-day',
      id: 'gateway-state-eye',
      sortOrder: 1,
      ticketIds: [],
      title: '伦敦眼',
      tripId: 'gateway-state-trip',
      updatedAt: now,
    }],
    trips: [{
      createdAt: now,
      destination: '英国伦敦',
      endDate: '2026-07-10',
      id: 'gateway-state-trip',
      startDate: '2026-07-10',
      title: '进度动作测试旅行',
      updatedAt: now,
    }],
  })
  await page.goto('/#/trip?tripId=gateway-state-trip', { waitUntil: 'domcontentloaded' })

  await page.getByLabel('全局 AI 指令').fill('第一站已完成')
  await page.getByRole('button', { name: '发送 AI 指令' }).click()

  const result = page.getByTestId('global-ai-command-result')
  await expect(result).toContainText('更新行程进度')
  await expect(result).toContainText('标记为已完成')
  await expect(page.getByTestId('global-ai-action-details')).not.toHaveAttribute('open', '')
  await expect(result.getByRole('button', { name: '确认执行' })).toHaveCount(1)
  expect(await readItineraryItem(page, 'gateway-state-eye')).not.toHaveProperty('executionState')
  await expectNoHorizontalOverflow(page)

  await result.getByRole('button', { name: '确认执行' }).click()

  await expect(result).toContainText('已完成')
  await expect.poll(async () => await readItineraryItem(page, 'gateway-state-eye'))
    .toMatchObject({ executionState: { status: 'completed' } })

  await page.getByLabel('全局 AI 指令')
    .fill('第一站不能动，必须保留，下雨别去，预留30分钟')
  await page.getByRole('button', { name: '发送 AI 指令' }).click()

  await expect(result).toContainText('更新重排偏好')
  await expect(result).toContainText('缓冲 30 分钟')
  await expect(page.getByTestId('global-ai-action-details')).not.toHaveAttribute('open', '')
  await expect(result.getByRole('button', { name: '确认执行' })).toHaveCount(1)
  expect(await readItineraryItem(page, 'gateway-state-eye')).not.toHaveProperty('replanPreference')
  await expectNoHorizontalOverflow(page)

  await result.getByRole('button', { name: '确认执行' }).click()

  await expect.poll(async () => await readItineraryItem(page, 'gateway-state-eye'))
    .toMatchObject({
      replanPreference: {
        bufferMinutes: 30,
        flexibility: 'fixed',
        priority: 'must_keep',
        weatherSuitability: 'avoid_rain',
      },
    })
  expect(await countStore(page, 'tripIntelligenceAppliedChanges')).toBe(2)
  expect(providerProxyRequests).toHaveLength(0)
  await expectNoHorizontalOverflow(page)
})

test('全局 AI 新增行程点只在一次确认后幂等写入', async ({ page }) => {
  await clearTravelDatabase(page)
  const providerProxyRequests: string[] = []
  await page.route('**/api/provider-proxy', (route) => {
    providerProxyRequests.push(route.request().url())
    return route.abort()
  })
  const now = Date.now()
  await seedTravelRecords(page, {
    days: [{
      date: '2026-07-10',
      id: 'gateway-create-day',
      sortOrder: 1,
      title: '伦敦第一天',
      tripId: 'gateway-create-trip',
    }],
    itineraryItems: [{
      createdAt: now,
      dayId: 'gateway-create-day',
      id: 'gateway-create-hotel',
      sortOrder: 1,
      ticketIds: [],
      title: '伦敦酒店',
      tripId: 'gateway-create-trip',
      updatedAt: now,
    }],
    trips: [{
      createdAt: now,
      destination: '英国伦敦',
      endDate: '2026-07-10',
      id: 'gateway-create-trip',
      startDate: '2026-07-10',
      title: '新增动作测试旅行',
      updatedAt: now,
    }],
  })
  await page.goto('/#/trip?tripId=gateway-create-trip', { waitUntil: 'domcontentloaded' })

  await page.getByLabel('全局 AI 指令').fill('第一天新增伦敦眼，10:00-11:00')
  await page.getByRole('button', { name: '发送 AI 指令' }).click()

  const result = page.getByTestId('global-ai-command-result')
  await expect(result).toContainText('新增行程点')
  await expect(result).toContainText('将在末尾新增')
  await expect(page.getByTestId('global-ai-action-details')).not.toHaveAttribute('open', '')
  await expect(result.getByRole('button', { name: '确认执行' })).toHaveCount(1)
  expect(await readItineraryItemsByDay(page, 'gateway-create-day')).toHaveLength(1)
  expect(providerProxyRequests).toHaveLength(0)
  await expectNoHorizontalOverflow(page)

  await result.getByRole('button', { name: '确认执行' }).click()

  await expect(page).toHaveURL(/#\/day\?/)
  const items = await readItineraryItemsByDay(page, 'gateway-create-day')
  expect(items).toHaveLength(2)
  expect(items[1]).toMatchObject({
    endTime: '11:00',
    sortOrder: 2,
    startTime: '10:00',
    title: '伦敦眼',
    tripId: 'gateway-create-trip',
  })
  expect(providerProxyRequests).toHaveLength(0)
  await expectNoHorizontalOverflow(page)
})

test('全局 AI 当天重排只在一次确认后改变顺序', async ({ page }) => {
  await clearTravelDatabase(page)
  const providerProxyRequests: string[] = []
  await page.route('**/api/provider-proxy', (route) => {
    providerProxyRequests.push(route.request().url())
    return route.abort()
  })
  const now = Date.now()
  await seedTravelRecords(page, {
    days: [{
      date: '2026-07-10',
      id: 'gateway-reorder-day',
      sortOrder: 1,
      title: '伦敦第一天',
      tripId: 'gateway-reorder-trip',
    }],
    itineraryItems: [
      {
        createdAt: now,
        dayId: 'gateway-reorder-day',
        id: 'gateway-reorder-hotel',
        sortOrder: 1,
        ticketIds: [],
        title: '伦敦酒店',
        tripId: 'gateway-reorder-trip',
        updatedAt: now,
      },
      {
        createdAt: now,
        dayId: 'gateway-reorder-day',
        id: 'gateway-reorder-big-ben',
        sortOrder: 2,
        ticketIds: [],
        title: '大本钟',
        tripId: 'gateway-reorder-trip',
        updatedAt: now,
      },
      {
        createdAt: now,
        dayId: 'gateway-reorder-day',
        id: 'gateway-reorder-eye',
        sortOrder: 3,
        ticketIds: [],
        title: '伦敦眼',
        tripId: 'gateway-reorder-trip',
        updatedAt: now,
      },
    ],
    trips: [{
      createdAt: now,
      destination: '英国伦敦',
      endDate: '2026-07-10',
      id: 'gateway-reorder-trip',
      startDate: '2026-07-10',
      title: '重排动作测试旅行',
      updatedAt: now,
    }],
  })
  await page.goto('/#/trip?tripId=gateway-reorder-trip', { waitUntil: 'domcontentloaded' })

  await page.getByLabel('全局 AI 指令').fill('把伦敦眼移到大本钟前面')
  await page.getByRole('button', { name: '发送 AI 指令' }).click()

  const result = page.getByTestId('global-ai-command-result')
  await expect(result).toContainText('调整当天顺序')
  await expect(result).toContainText('第 3 位 → 第 2 位')
  await expect(page.getByTestId('global-ai-action-details')).not.toHaveAttribute('open', '')
  await expect(result.getByRole('button', { name: '确认执行' })).toHaveCount(1)
  expect((await readItineraryItemsByDay(page, 'gateway-reorder-day')).map((item) => item.title))
    .toEqual(['伦敦酒店', '大本钟', '伦敦眼'])
  expect(providerProxyRequests).toHaveLength(0)
  await expectNoHorizontalOverflow(page)

  await result.getByRole('button', { name: '确认执行' }).click()

  await expect(page).toHaveURL(/#\/day\?/)
  expect((await readItineraryItemsByDay(page, 'gateway-reorder-day')).map((item) => item.title))
    .toEqual(['伦敦酒店', '伦敦眼', '大本钟'])
  expect(providerProxyRequests).toHaveLength(0)
  await expectNoHorizontalOverflow(page)
})

test('全局 AI 跨日移动只在一次确认后同时更新两个日期', async ({ page }) => {
  await clearTravelDatabase(page)
  const providerProxyRequests: string[] = []
  await page.route('**/api/provider-proxy', (route) => {
    providerProxyRequests.push(route.request().url())
    return route.abort()
  })
  const now = Date.now()
  await seedTravelRecords(page, {
    days: [
      {
        date: '2026-07-10',
        id: 'gateway-move-source-day',
        sortOrder: 1,
        title: '抵达伦敦',
        tripId: 'gateway-move-trip',
      },
      {
        date: '2026-07-11',
        id: 'gateway-move-destination-day',
        sortOrder: 2,
        title: '伦敦市区',
        tripId: 'gateway-move-trip',
      },
    ],
    itineraryItems: [
      {
        createdAt: now,
        dayId: 'gateway-move-source-day',
        id: 'gateway-move-hotel',
        sortOrder: 1,
        ticketIds: [],
        title: '伦敦酒店',
        tripId: 'gateway-move-trip',
        updatedAt: now,
      },
      {
        createdAt: now,
        dayId: 'gateway-move-source-day',
        id: 'gateway-move-eye',
        sortOrder: 2,
        ticketIds: [],
        title: '伦敦眼',
        tripId: 'gateway-move-trip',
        updatedAt: now,
      },
      {
        createdAt: now,
        dayId: 'gateway-move-destination-day',
        id: 'gateway-move-big-ben',
        sortOrder: 1,
        ticketIds: [],
        title: '大本钟',
        tripId: 'gateway-move-trip',
        updatedAt: now,
      },
      {
        createdAt: now,
        dayId: 'gateway-move-destination-day',
        id: 'gateway-move-museum',
        sortOrder: 2,
        ticketIds: [],
        title: '大英博物馆',
        tripId: 'gateway-move-trip',
        updatedAt: now,
      },
    ],
    trips: [{
      createdAt: now,
      destination: '英国伦敦',
      endDate: '2026-07-11',
      id: 'gateway-move-trip',
      startDate: '2026-07-10',
      title: '跨日移动测试旅行',
      updatedAt: now,
    }],
  })
  await page.goto('/#/trip?tripId=gateway-move-trip', { waitUntil: 'domcontentloaded' })

  await page.getByLabel('全局 AI 指令').fill('把第一天的伦敦眼移到第二天大本钟后面')
  await page.getByRole('button', { name: '发送 AI 指令' }).click()

  const result = page.getByTestId('global-ai-command-result')
  await expect(result).toContainText('跨日移动行程点')
  await expect(result).toContainText('「抵达伦敦」第 2 位 → 「伦敦市区」第 2 位')
  await expect(page.getByTestId('global-ai-action-details')).not.toHaveAttribute('open', '')
  await expect(result.getByRole('button', { name: '确认执行' })).toHaveCount(1)
  expect((await readItineraryItemsByDay(page, 'gateway-move-source-day')).map((item) => item.title))
    .toEqual(['伦敦酒店', '伦敦眼'])
  expect((await readItineraryItemsByDay(page, 'gateway-move-destination-day')).map((item) => item.title))
    .toEqual(['大本钟', '大英博物馆'])
  expect(providerProxyRequests).toHaveLength(0)
  await expectNoHorizontalOverflow(page)

  await result.getByRole('button', { name: '确认执行' }).click()

  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/dayId=gateway-move-destination-day/)
  expect((await readItineraryItemsByDay(page, 'gateway-move-source-day')).map((item) => item.title))
    .toEqual(['伦敦酒店'])
  expect((await readItineraryItemsByDay(page, 'gateway-move-destination-day')).map((item) => item.title))
    .toEqual(['大本钟', '伦敦眼', '大英博物馆'])
  expect(providerProxyRequests).toHaveLength(0)
  await expectNoHorizontalOverflow(page)
})

test('全局 AI 删除与撤销在 390px 保留票据账本并恢复原顺序', async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 })
  await clearTravelDatabase(page)
  const providerProxyRequests: string[] = []
  await page.route('**/api/provider-proxy', (route) => {
    providerProxyRequests.push(route.request().url())
    return route.abort()
  })
  const now = Date.now()
  await seedTravelRecords(page, {
    days: [{
      date: '2026-07-10',
      id: 'gateway-delete-day',
      sortOrder: 1,
      title: '抵达伦敦',
      tripId: 'gateway-delete-trip',
    }],
    itineraryItems: [
      {
        createdAt: now,
        dayId: 'gateway-delete-day',
        id: 'gateway-delete-hotel',
        sortOrder: 1,
        ticketIds: [],
        title: '伦敦酒店',
        tripId: 'gateway-delete-trip',
        updatedAt: now,
      },
      {
        createdAt: now,
        dayId: 'gateway-delete-day',
        id: 'gateway-delete-eye',
        sortOrder: 2,
        ticketIds: ['gateway-delete-ticket'],
        title: '伦敦眼',
        tripId: 'gateway-delete-trip',
        updatedAt: now,
      },
      {
        createdAt: now,
        dayId: 'gateway-delete-day',
        id: 'gateway-delete-dinner',
        sortOrder: 3,
        ticketIds: [],
        title: '晚餐',
        tripId: 'gateway-delete-trip',
        updatedAt: now,
      },
    ],
    ticketMetas: [{
      createdAt: now,
      fileName: 'london-eye.pdf',
      fileType: 'pdf',
      id: 'gateway-delete-ticket',
      itemId: 'gateway-delete-eye',
      mimeType: 'application/pdf',
      scope: 'item',
      size: 1024,
      storageMode: 'reference',
      title: '伦敦眼门票',
      tripId: 'gateway-delete-trip',
      updatedAt: now,
    }],
    trips: [{
      createdAt: now,
      destination: '英国伦敦',
      endDate: '2026-07-10',
      id: 'gateway-delete-trip',
      startDate: '2026-07-10',
      title: '可逆删除测试旅行',
      updatedAt: now,
    }],
  })
  await seedDeletionLedgerRelation(page)
  await page.goto('/#/trip?tripId=gateway-delete-trip', { waitUntil: 'domcontentloaded' })

  await page.getByLabel('全局 AI 指令').fill('删除第一天的伦敦眼')
  await page.getByRole('button', { name: '发送 AI 指令' }).click()

  const result = page.getByTestId('global-ai-command-result')
  await expect(result).toContainText('删除行程点')
  await expect(result).toContainText('保留 1 张票据、1 笔账本关联和订单，可撤销')
  await expect(page.getByTestId('global-ai-action-details')).not.toHaveAttribute('open', '')
  await expect(result.getByRole('button', { name: '确认执行' })).toHaveCount(1)
  expect((await readItineraryItemsByDay(page, 'gateway-delete-day')).map((item) => item.title))
    .toEqual(['伦敦酒店', '伦敦眼', '晚餐'])
  expect(providerProxyRequests).toHaveLength(0)
  await expectNoHorizontalOverflow(page)

  await result.getByRole('button', { name: '确认执行' }).click()

  await expect(page).toHaveURL(/#\/day\?/)
  await expect.poll(async () =>
    (await readItineraryItemsByDay(page, 'gateway-delete-day')).map((item) => item.title),
  ).toEqual(['伦敦酒店', '晚餐'])
  expect(await readFirstStoreRecord(page, 'ticketMetas')).toMatchObject({
    id: 'gateway-delete-ticket',
    itemId: 'gateway-delete-eye',
  })
  expect(await readFirstStoreRecord(page, 'ledgerExpenses')).toMatchObject({
    id: 'gateway-delete-expense',
    itemIds: ['gateway-delete-eye'],
    status: 'confirmed',
  })
  expect(await countStore(page, 'tripReplanRecords')).toBe(1)
  expect(providerProxyRequests).toHaveLength(0)
  await expectNoHorizontalOverflow(page)

  await page.getByLabel('全局 AI 指令').fill('撤销刚才的删除')
  await page.getByRole('button', { name: '发送 AI 指令' }).click()

  await expect(result).toContainText('撤销行程点删除')
  await expect(result).toContainText('恢复「伦敦眼」到第 2 位')
  await expect(result.getByRole('button', { name: '确认执行' })).toHaveCount(1)
  await expectNoHorizontalOverflow(page)
  await result.getByRole('button', { name: '确认执行' }).click()

  await expect.poll(async () =>
    (await readItineraryItemsByDay(page, 'gateway-delete-day')).map((item) => item.title),
  ).toEqual(['伦敦酒店', '伦敦眼', '晚餐'])
  expect(await readFirstStoreRecord(page, 'ticketMetas')).toMatchObject({
    id: 'gateway-delete-ticket',
    itemId: 'gateway-delete-eye',
  })
  expect(await readFirstStoreRecord(page, 'ledgerExpenses')).toMatchObject({
    id: 'gateway-delete-expense',
    itemIds: ['gateway-delete-eye'],
    status: 'confirmed',
  })
  expect(providerProxyRequests).toHaveLength(0)
  await expectNoHorizontalOverflow(page)
})

test('全局 AI 路线配置变化后重新预览确认才请求服务并写入缓存', async ({ page }) => {
  await clearTravelDatabase(page)
  await forceRouteProxyFixture(page)
  await page.reload({ waitUntil: 'domcontentloaded' })
  let routePreviewRequests = 0
  await page.route('**/api/provider-proxy*', async (route) => {
    const body = route.request().postDataJSON()
    if (body.operation !== 'route_preview') {
      await route.fulfill({
        body: JSON.stringify({ code: 'unsupported', message: 'unexpected operation', ok: false }),
        contentType: 'application/json',
        status: 501,
      })
      return
    }
    routePreviewRequests += 1
    const coordinates = body.coordinates as Array<[number, number]>
    const segments = (body.segments as Array<Record<string, number | string>>).map((segment, index) => ({
      coordinates: [
        coordinates[segment.fromCoordinateIndex as number],
        coordinates[segment.toCoordinateIndex as number],
      ],
      distanceMeters: 24000,
      durationSeconds: 2700,
      fromItemId: segment.fromItemId,
      segmentIndex: segment.segmentIndex ?? index,
      toItemId: segment.toItemId,
    }))
    await new Promise((resolve) => setTimeout(resolve, 200))
    await route.fulfill({
      body: JSON.stringify({
        ok: true,
        operation: 'route_preview',
        provider: 'openrouteservice',
        route: {
          lineStrings: segments.map((segment) => segment.coordinates),
          segments,
          status: 'road',
          warnings: [],
        },
      }),
      contentType: 'application/json',
    })
  })

  const now = Date.now()
  await seedTravelRecords(page, {
    days: [{
      date: '2026-07-10',
      id: 'gateway-route-day',
      sortOrder: 1,
      title: '抵达伦敦',
      tripId: 'gateway-route-trip',
    }],
    itineraryItems: [
      {
        createdAt: now,
        dayId: 'gateway-route-day',
        id: 'gateway-route-airport',
        lat: 51.47,
        lng: -0.4543,
        sortOrder: 1,
        startTime: '09:00',
        ticketIds: [],
        title: '伦敦希思罗机场',
        tripId: 'gateway-route-trip',
        updatedAt: now,
      },
      {
        createdAt: now,
        dayId: 'gateway-route-day',
        id: 'gateway-route-hotel',
        lat: 51.501,
        lng: -0.158,
        sortOrder: 2,
        startTime: '11:00',
        ticketIds: [],
        title: '伦敦酒店',
        tripId: 'gateway-route-trip',
        updatedAt: now,
      },
    ],
    trips: [{
      createdAt: now,
      destination: '英国伦敦',
      endDate: '2026-07-10',
      id: 'gateway-route-trip',
      startDate: '2026-07-10',
      timeZone: 'Europe/London',
      title: '路线动作测试旅行',
      updatedAt: now,
    }],
  })
  await page.goto('/#/trip?tripId=gateway-route-trip', { waitUntil: 'domcontentloaded' })

  await page.getByLabel('全局 AI 指令').fill('生成第一天路线预览')
  await page.getByRole('button', { name: '发送 AI 指令' }).click()

  const result = page.getByTestId('global-ai-command-result')
  await expect(result).toContainText('生成路线预览')
  await expect(result).toContainText('确认后才调用路线服务')
  await expect(page.getByTestId('global-ai-action-details')).not.toHaveAttribute('open', '')
  await expect(result.getByRole('button', { name: '确认执行' })).toHaveCount(1)
  expect(routePreviewRequests).toBe(0)
  expect(await countRouteCacheEntries(page)).toBe(0)
  await expectNoHorizontalOverflow(page)

  await page.evaluate(() => {
    window.localStorage.setItem('tripmap:dev:route-proxy-url', '/api/provider-proxy-v2')
    window.dispatchEvent(new Event('tripmap:routing-config-changed'))
  })
  await result.getByRole('button', { name: '确认执行' }).click()

  await expect(result).toContainText('路线服务配置已变化')
  expect(routePreviewRequests).toBe(0)
  expect(await countRouteCacheEntries(page)).toBe(0)
  await result.getByRole('button', { name: '重新生成预览' }).click()
  await expect(result.getByRole('button', { name: '确认执行' })).toHaveCount(1)
  expect(routePreviewRequests).toBe(0)
  expect(await countRouteCacheEntries(page)).toBe(0)

  await result.getByRole('button', { name: '确认执行' }).click()
  await expect(page.getByLabel('全局 AI 指令')).toBeDisabled()

  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/dayId=gateway-route-day/)
  await expect(page).toHaveURL(/view=map/)
  await expect.poll(() => countRouteCacheEntries(page)).toBeGreaterThan(0)
  expect(routePreviewRequests).toBe(1)
  await expectNoHorizontalOverflow(page)
})

test('全局 AI 费用动作只在一次确认后创建待审核草稿', async ({ page }) => {
  await clearTravelDatabase(page)
  const providerProxyRequests: string[] = []
  await page.route('**/api/provider-proxy', (route) => {
    providerProxyRequests.push(route.request().url())
    return route.abort()
  })

  const now = Date.now()
  await seedTravelRecords(page, {
    days: [{
      date: '2026-07-10',
      id: 'gateway-expense-day',
      sortOrder: 1,
      title: '抵达伦敦',
      tripId: 'gateway-expense-trip',
    }],
    itineraryItems: [],
    trips: [{
      createdAt: now,
      destination: '英国伦敦',
      endDate: '2026-07-10',
      id: 'gateway-expense-trip',
      startDate: '2026-07-10',
      timeZone: 'Europe/London',
      title: '费用动作测试旅行',
      updatedAt: now,
    }],
  })
  await seedLedgerSetup(page, 'gateway-expense-trip')
  await page.goto('/#/trip?tripId=gateway-expense-trip', { waitUntil: 'domcontentloaded' })

  await page.getByLabel('全局 AI 指令').fill('记一笔午餐 32.50 GBP')
  await page.getByRole('button', { name: '发送 AI 指令' }).click()

  const result = page.getByTestId('global-ai-command-result')
  await expect(result).toContainText('创建费用草稿')
  await expect(result).toContainText('待审核草稿')
  await expect(page.getByTestId('global-ai-action-details')).not.toHaveAttribute('open', '')
  await expect(result.getByRole('button', { name: '确认执行' })).toHaveCount(1)
  expect(await countStore(page, 'ledgerExpenses')).toBe(0)
  expect(providerProxyRequests).toHaveLength(0)
  await expectNoHorizontalOverflow(page)

  await result.getByRole('button', { name: '确认执行' }).click()

  await expect(page).toHaveURL(/#\/ledger\/expense\?/)
  const expense = await readFirstStoreRecord(page, 'ledgerExpenses')
  expect(expense).toMatchObject({
    amountMinor: 3250,
    category: 'food',
    currency: 'GBP',
    date: '2026-07-10',
    orderStatus: 'active',
    paymentStatus: 'unknown',
    reviewStatus: 'needs_review',
    status: 'draft',
    title: '午餐',
    tripId: 'gateway-expense-trip',
  })
  expect(expense.payerParticipantId).toBeUndefined()
  expect(providerProxyRequests).toHaveLength(0)
  await expectNoHorizontalOverflow(page)
})

test('全局 AI 地点补全显示折叠预览并在一次确认后写入', async ({ page }) => {
  await clearTravelDatabase(page)
  await forceRouteProxyFixture(page)
  await page.reload({ waitUntil: 'domcontentloaded' })
  let placeLookupRequests = 0
  await page.route('**/api/provider-proxy', async (route) => {
    const body = route.request().postDataJSON()
    if (body.operation !== 'place_lookup') {
      await route.fallback()
      return
    }
    placeLookupRequests += 1
    expect(body).toMatchObject({
      locale: 'zh-CN',
      maxResults: 3,
      operation: 'place_lookup',
    })
    await route.fulfill({
      body: JSON.stringify({
        ok: true,
        operation: 'place_lookup',
        results: [{
          displayName: '伦敦希思罗机场',
          formattedAddress: 'Hounslow, United Kingdom',
          location: { lat: 51.47, lng: -0.4543 },
          placeId: 'places/e2e-heathrow',
          provider: 'google_places',
          retrievedAt: '2026-07-25T00:00:00.000Z',
        }],
        retrievedAt: '2026-07-25T00:00:00.000Z',
        source: 'mock',
      }),
      contentType: 'application/json',
    })
  })

  await page.getByRole('button', { name: '创建示例旅行' }).click()
  const tripCard = page.getByTestId('trip-card').filter({ hasText: '东京春日旅行' })
  await clickTripCard(tripCard)
  await expect(page).toHaveURL(/#\/trip\?tripId=/)
  const tripId = new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('tripId')
  expect(tripId).toBeTruthy()
  const { firstItemId } = await getFirstTripDayAndItemIds(page, tripId!)

  await page.getByLabel('全局 AI 指令').fill('补全第一站地点信息')
  await page.getByRole('button', { name: '发送 AI 指令' }).click()

  const result = page.getByTestId('global-ai-command-result')
  await expect(result).toContainText('补全地点')
  await expect(page.getByTestId('global-ai-action-summary')).toContainText('1 个步骤')
  const details = page.getByTestId('global-ai-action-details')
  await expect(details).not.toHaveAttribute('open', '')
  await expect(details).toContainText('来源：测试地点服务')
  await expect(result.getByRole('button', { name: '确认执行' })).toHaveCount(1)
  await expect.poll(async () => (await readItineraryItem(page, firstItemId)).lat).toBe(35.72918)
  await expectNoHorizontalOverflow(page)

  await result.getByRole('button', { name: '确认执行' }).click()

  await expect(result).toContainText('已完成')
  await expect.poll(async () => await readItineraryItem(page, firstItemId)).toMatchObject({
    address: 'Hounslow, United Kingdom',
    lat: 51.47,
    lng: -0.4543,
    locationName: '伦敦希思罗机场',
  })
  expect(placeLookupRequests).toBe(1)
  await expectNoHorizontalOverflow(page)
})

test('全局 AI 一键修复会先补地点再生成被解锁的路线', async ({ page }) => {
  await clearTravelDatabase(page)
  await forceRouteProxyFixture(page)
  await page.reload({ waitUntil: 'domcontentloaded' })
  let placeLookupRequests = 0
  let routePreviewRequests = 0
  await page.route('**/api/provider-proxy', async (route) => {
    const body = route.request().postDataJSON()
    if (body.operation === 'place_lookup') {
      placeLookupRequests += 1
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          operation: 'place_lookup',
          results: [{
            displayName: '伦敦希思罗机场',
            formattedAddress: 'Hounslow, United Kingdom',
            location: { lat: 51.47, lng: -0.4543 },
            placeId: 'places/e2e-heathrow-repair',
            provider: 'google_places',
            retrievedAt: '2026-07-25T00:00:00.000Z',
          }],
          retrievedAt: '2026-07-25T00:00:00.000Z',
          source: 'mock',
        }),
        contentType: 'application/json',
      })
      return
    }
    if (body.operation === 'route_preview') {
      routePreviewRequests += 1
      const coordinates = body.coordinates as Array<[number, number]>
      const segments = (body.segments as Array<Record<string, number>>).map((segment, index) => ({
        coordinates: [
          coordinates[segment.fromCoordinateIndex],
          coordinates[segment.toCoordinateIndex],
        ],
        distanceMeters: 24000,
        durationSeconds: 2700,
        fromItemId: segment.fromItemId,
        segmentIndex: segment.segmentIndex ?? index,
        toItemId: segment.toItemId,
      }))
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          operation: 'route_preview',
          provider: 'openrouteservice',
          route: {
            lineStrings: segments.map((segment) => segment.coordinates),
            segments,
            status: 'road',
            warnings: [],
          },
        }),
        contentType: 'application/json',
      })
      return
    }
    await route.fulfill({
      body: JSON.stringify({ code: 'unsupported', message: 'unexpected operation', ok: false }),
      contentType: 'application/json',
      status: 501,
    })
  })

  const now = Date.now()
  await seedTravelRecords(page, {
    days: [{
      date: '2026-07-25',
      id: 'gateway-repair-day',
      sortOrder: 1,
      title: '抵达伦敦',
      tripId: 'gateway-repair-trip',
    }],
    itineraryItems: [
      {
        createdAt: now,
        dayId: 'gateway-repair-day',
        id: 'gateway-repair-airport',
        sortOrder: 1,
        startTime: '09:00',
        ticketIds: [],
        title: '抵达伦敦希思罗机场',
        tripId: 'gateway-repair-trip',
        updatedAt: now,
      },
      {
        address: '1 Hamilton Place, London',
        createdAt: now,
        dayId: 'gateway-repair-day',
        id: 'gateway-repair-hotel',
        lat: 51.501,
        lng: -0.158,
        locationName: '伦敦酒店',
        sortOrder: 2,
        startTime: '11:00',
        ticketIds: [],
        title: '伦敦酒店入住',
        tripId: 'gateway-repair-trip',
        updatedAt: now,
      },
    ],
    trips: [{
      createdAt: now,
      destination: '英国伦敦',
      endDate: '2026-07-26',
      id: 'gateway-repair-trip',
      notes: '## 今日旅行提示 · 2026-07-25\n已核对当天提示。',
      startDate: '2026-07-25',
      timeZone: 'Europe/London',
      title: '英国测试旅行',
      updatedAt: now,
    }],
  })
  await page.goto('/#/trip?tripId=gateway-repair-trip', { waitUntil: 'domcontentloaded' })

  await page.getByLabel('全局 AI 指令').fill('把缺失地点、路线和建议全部修复')
  await page.getByRole('button', { name: '发送 AI 指令' }).click()

  const result = page.getByTestId('global-ai-command-result')
  await expect(result).toContainText('智能修复行程')
  await expect(page.getByTestId('global-ai-action-details')).toContainText('地点 1、路线 1')
  expect((await readItineraryItem(page, 'gateway-repair-airport')).lat).toBeUndefined()
  expect(await countRouteCacheEntries(page)).toBe(0)
  expect(routePreviewRequests).toBe(0)

  await result.getByRole('button', { name: '确认执行' }).click()

  await expect(result).toContainText('已完成')
  await expect.poll(async () => (await readItineraryItem(page, 'gateway-repair-airport')).lat).toBe(51.47)
  await expect.poll(() => countRouteCacheEntries(page)).toBeGreaterThan(0)
  expect(placeLookupRequests).toBe(1)
  expect(routePreviewRequests).toBe(1)
  await expectNoHorizontalOverflow(page)
})

test('全局 AI 组合计划部分失败后只重试失败步骤且不跳过写入确认', async ({ page }) => {
  await clearTravelDatabase(page)
  await forceRouteProxyFixture(page)
  await page.reload({ waitUntil: 'domcontentloaded' })
  let placeLookupRequests = 0
  await page.route('**/api/provider-proxy', async (route) => {
    const body = route.request().postDataJSON()
    if (body.operation !== 'place_lookup') {
      await route.fulfill({
        body: JSON.stringify({ code: 'unsupported', message: 'unexpected operation', ok: false }),
        contentType: 'application/json',
        status: 501,
      })
      return
    }
    placeLookupRequests += 1
    if (placeLookupRequests === 1) {
      await route.fulfill({
        body: JSON.stringify({
          code: 'provider_unavailable',
          message: 'temporary place failure',
          ok: false,
          operation: 'place_lookup',
        }),
        contentType: 'application/json',
        status: 503,
      })
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
    await route.fulfill({
      body: JSON.stringify({
        ok: true,
        operation: 'place_lookup',
        results: [{
          displayName: '伦敦希思罗机场',
          formattedAddress: 'Hounslow, United Kingdom',
          location: { lat: 51.47, lng: -0.4543 },
          placeId: 'places/e2e-combo-heathrow',
          provider: 'google_places',
          retrievedAt: '2026-07-25T00:00:00.000Z',
        }],
        retrievedAt: '2026-07-25T00:00:00.000Z',
        source: 'mock',
      }),
      contentType: 'application/json',
    })
  })

  const now = Date.now()
  await seedTravelRecords(page, {
    days: [{
      date: '2026-07-25',
      id: 'gateway-combo-day',
      sortOrder: 1,
      title: '抵达伦敦',
      tripId: 'gateway-combo-trip',
    }],
    itineraryItems: [{
      contentEnrichment: {
        baselineFingerprint: 'e2e',
        generatedAt: '2026-07-25T00:00:00.000Z',
        notices: [],
        openingHours: { sourceIds: ['source-combo'], text: '全天开放' },
        schemaVersion: 1,
        sources: [{
          confidence: 'high',
          id: 'source-combo',
          label: '官网',
          retrievedAt: '2026-07-25T00:00:00.000Z',
          sourceType: 'official',
          title: '机场官网',
        }],
        ticketPrice: { kind: 'admission', sourceIds: ['source-combo'], text: '无需门票' },
        warnings: [],
      },
      createdAt: now,
      dayId: 'gateway-combo-day',
      id: 'gateway-combo-airport',
      sortOrder: 1,
      startTime: '09:00',
      ticketIds: ['gateway-combo-ticket'],
      title: '伦敦希思罗机场',
      tripId: 'gateway-combo-trip',
      updatedAt: now,
    }],
    ticketMetas: [{
      createdAt: now,
      fileName: 'london-arrival.pdf',
      fileType: 'pdf',
      id: 'gateway-combo-ticket',
      itemId: 'gateway-combo-airport',
      mimeType: 'application/pdf',
      scope: 'item',
      size: 128,
      storageMode: 'reference',
      title: '伦敦抵达凭证',
      tripId: 'gateway-combo-trip',
      updatedAt: now,
    }],
    trips: [{
      createdAt: now,
      destination: '英国伦敦',
      endDate: '2026-07-25',
      id: 'gateway-combo-trip',
      notes: '## 今日旅行提示 · 2026-07-25\n已核对当天提示。',
      startDate: '2026-07-25',
      timeZone: 'Europe/London',
      title: '组合动作测试旅行',
      updatedAt: now,
    }],
  })
  await page.goto('/#/trip?tripId=gateway-combo-trip', { waitUntil: 'domcontentloaded' })

  await page.getByLabel('全局 AI 指令').fill('找一下伦敦的票据并修复所有问题')
  await page.getByRole('button', { name: '发送 AI 指令' }).click()
  const result = page.getByTestId('global-ai-command-result')
  await expect(page.getByTestId('global-ai-action-summary')).toContainText('2 个步骤')
  await result.getByRole('button', { name: '确认执行' }).click()

  await expect(page).toHaveURL(/#\/documents\?/)
  const ticketPreview = page.getByTestId('ticket-preview')
  await expect(ticketPreview).toBeVisible()
  await ticketPreview.getByTestId('ticket-preview-close').click()
  await expect(ticketPreview).toHaveCount(0)
  await expect(result).toContainText('部分完成')
  expect((await readItineraryItem(page, 'gateway-combo-airport')).lat).toBeUndefined()
  expect(placeLookupRequests).toBe(1)

  const retryButton = result.getByRole('button', { name: '重试失败项' })
  await retryButton.evaluate((button) => {
    button.click()
    button.click()
  })
  await expect(retryButton).toBeDisabled()
  await expect(page.getByLabel('全局 AI 指令')).toBeDisabled()
  await expect.poll(async () => (await readItineraryItem(page, 'gateway-combo-airport')).lat).toBeUndefined()
  await expect(result.getByRole('button', { name: '确认执行' })).toHaveCount(1)
  await result.getByRole('button', { name: '确认执行' }).click()
  await expect.poll(async () => (await readItineraryItem(page, 'gateway-combo-airport')).lat).toBe(51.47)
  await page.getByTestId('global-ai-action-details').getByText('查看步骤').click()
  await expect(page.getByTestId('global-ai-action-details')).toContainText('此前已完成，未重复执行')
  expect(placeLookupRequests).toBe(2)
  await expectNoHorizontalOverflow(page)
})

test('全局 AI 在 390px 通过一次确认应用本地突发重排', async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 })
  await clearTravelDatabase(page)
  const providerProxyRequests: string[] = []
  await page.route('**/api/provider-proxy', (route) => {
    providerProxyRequests.push(route.request().url())
    return route.abort()
  })
  const now = Date.now()
  await seedTravelRecords(page, {
    days: [{
      date: '2026-07-10',
      id: 'gateway-replan-day',
      sortOrder: 1,
      title: '伦敦第一天',
      tripId: 'gateway-replan-trip',
    }],
    itineraryItems: [
      {
        createdAt: now,
        dayId: 'gateway-replan-day',
        endTime: '11:00',
        id: 'gateway-replan-eye',
        sortOrder: 1,
        startTime: '10:00',
        ticketIds: [],
        title: '伦敦眼',
        tripId: 'gateway-replan-trip',
        updatedAt: now,
      },
      {
        createdAt: now,
        dayId: 'gateway-replan-day',
        endTime: '13:00',
        id: 'gateway-replan-clock',
        sortOrder: 2,
        startTime: '12:00',
        ticketIds: [],
        title: '大本钟',
        tripId: 'gateway-replan-trip',
        updatedAt: now,
      },
    ],
    trips: [{
      createdAt: now,
      destination: '英国伦敦',
      endDate: '2026-07-10',
      id: 'gateway-replan-trip',
      startDate: '2026-07-10',
      timeZone: 'Europe/London',
      title: '突发重排测试旅行',
      updatedAt: now,
    }],
  })
  await page.goto(
    '/#/day?tripId=gateway-replan-trip&dayId=gateway-replan-day&view=schedule',
    { waitUntil: 'domcontentloaded' },
  )

  await page.getByLabel('全局 AI 指令').fill('我晚到30分钟，按最少改动调整')
  await page.getByRole('button', { name: '发送 AI 指令' }).click()

  const result = page.getByTestId('global-ai-command-result')
  await expect(result).toContainText('应用突发重排')
  await expect(result).toContainText('伦敦眼将改为 10:30')
  await expect(result).toContainText('按最少改动调整 2 项')
  await expect(page.getByTestId('global-ai-action-summary')).toContainText('1 个步骤 · 影响 2 项')
  await expect(page.getByTestId('global-ai-action-details')).not.toHaveAttribute('open', '')
  await expect(result.getByRole('button', { name: '确认执行' })).toHaveCount(1)
  await expect.poll(async () => await readItineraryItem(page, 'gateway-replan-eye'))
    .toMatchObject({ endTime: '11:00', startTime: '10:00' })
  await expect(await countStore(page, 'tripReplanEvents')).toBe(0)
  await expect(await countStore(page, 'tripReplanRecords')).toBe(0)

  await result.getByRole('button', { name: '确认执行' }).click()

  await expect.poll(async () => await readItineraryItem(page, 'gateway-replan-eye'))
    .toMatchObject({ endTime: '11:30', startTime: '10:30' })
  await expect.poll(async () => await readItineraryItem(page, 'gateway-replan-clock'))
    .toMatchObject({ endTime: '13:30', startTime: '12:30' })
  expect(await countStore(page, 'tripReplanEvents')).toBe(1)
  expect(await countStore(page, 'tripReplanRecords')).toBe(1)
  expect(await countStore(page, 'tripIntelligenceAppliedChanges')).toBe(1)
  expect(providerProxyRequests).toHaveLength(0)
  await expectNoHorizontalOverflow(page)
})

test('全局 AI 输入在移动端承接只读 what-if 重排且永不落库', async ({ page }) => {
  await clearTravelDatabase(page)

  const commandBar = page.getByTestId('global-ai-command-bar')
  await expect(commandBar).toBeVisible()
  await expect(page.getByLabel('全局 AI 指令')).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await expectCommandBarAboveBottomTab(page)

  await page.getByRole('button', { name: '创建示例旅行' }).click()
  const tripCard = page.getByTestId('trip-card').filter({ hasText: '东京春日旅行' })
  await expect(tripCard).toBeVisible()
  await clickTripCard(tripCard)
  await expect(page).toHaveURL(/#\/trip\?tripId=/)
  await page.getByRole('button', { name: /抵达与涩谷/ }).click()
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page.getByTestId('global-ai-context-label')).toContainText(/Day|当前日期/)

  await expect(commandBar).toBeVisible()
  await expectCommandBarAboveBottomTab(page)
  await expect(await countStore(page, 'tripReplanEvents')).toBe(0)
  await expect(await countStore(page, 'tripReplanRecords')).toBe(0)

  await page.getByLabel('全局 AI 指令').fill('如果我晚到 45 分钟怎么办？')
  await page.getByRole('button', { name: '发送 AI 指令' }).click()

  const result = page.getByTestId('global-ai-command-result')
  await expect(result).toContainText('What-if 重排预览')
  await expect(result).toContainText('这是只读模拟')
  await expect(page.getByTestId('global-ai-action-proposal')).toHaveCount(0)
  await expect(result.getByRole('button', { name: '确认应用重排' })).toHaveCount(0)
  await expect(page.getByTestId('global-ai-write-confirm-dialog')).not.toBeVisible()
  await expectNoHorizontalOverflow(page)
  await expect(await countStore(page, 'tripReplanEvents')).toBe(0)
  await expect(await countStore(page, 'tripReplanRecords')).toBe(0)
  await expect(await countStore(page, 'tripIntelligenceAppliedChanges')).toBe(0)
})

test('全局 AI 普通咨询走助手回答且不触发写入确认', async ({ page }) => {
  await clearTravelDatabase(page)
  const providerProxyRequests: string[] = []
  await page.route('**/api/provider-proxy', (route) => {
    providerProxyRequests.push(route.request().url())
    return route.abort()
  })

  const commandBar = page.getByTestId('global-ai-command-bar')
  await expect(commandBar).toBeVisible()
  await page.getByRole('button', { name: '创建示例旅行' }).click()
  const tripCard = page.getByTestId('trip-card').filter({ hasText: '东京春日旅行' })
  await expect(tripCard).toBeVisible()
  await clickTripCard(tripCard)
  await page.getByRole('button', { name: /抵达与涩谷/ }).click()
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page.getByTestId('global-ai-context-label')).toContainText(/Day|当前日期/)

  await page.getByLabel('全局 AI 指令').fill('今天接下来应该先确认什么？')
  await page.getByRole('button', { name: '发送 AI 指令' }).click()

  const result = page.getByTestId('global-ai-command-result')
  await expect(result).toContainText('旅图助手')
  await expect(page.getByTestId('global-ai-assistant-answer-result')).toContainText('当前正在看')
  await expect(result).toContainText('需要实时信息时')
  await expect(page.getByTestId('global-ai-send-confirm-dialog')).not.toBeVisible()
  await expectNoHorizontalOverflow(page)
  expect(providerProxyRequests.length).toBeLessThanOrEqual(1)
  await expect(await countStore(page, 'tripReplanEvents')).toBe(0)
  await expect(await countStore(page, 'tripReplanRecords')).toBe(0)
})

test('全局 AI 会话面板支持上下文切换和内存清空', async ({ page }) => {
  await clearTravelDatabase(page)
  await page.route('**/api/provider-proxy', (route) => route.abort())

  await expect(page.getByTestId('global-ai-command-bar')).toBeVisible()
  await page.getByRole('button', { name: '创建示例旅行' }).click()
  const tripCard = page.getByTestId('trip-card').filter({ hasText: '东京春日旅行' })
  await expect(tripCard).toBeVisible()
  await clickTripCard(tripCard)
  await expect(page.getByTestId('global-ai-context-label')).toContainText('当前旅行')

  await page.getByRole('button', { name: '展开 AI 会话' }).click()
  await expect(page.getByTestId('global-ai-conversation-panel')).toBeVisible()
  await expect(page.getByTestId('global-ai-conversation-messages')).toContainText('还没有对话')

  await page.getByTestId('global-ai-context-switch').getByRole('button', { name: '全部旅行' }).click()
  await expect(page.getByTestId('global-ai-context-label')).toContainText('全部旅行')

  await page.getByLabel('全局 AI 指令').fill('你能做什么？')
  await page.getByRole('button', { name: '发送 AI 指令' }).click()
  await expect(page.getByTestId('global-ai-conversation-messages')).toContainText('你')
  await expect(page.getByTestId('global-ai-conversation-messages')).toContainText('助手')

  await page.getByRole('button', { name: '清空 AI 会话' }).click()
  await expect(page.getByTestId('global-ai-conversation-messages')).toContainText('还没有对话')
  await expectNoHorizontalOverflow(page)
})

async function expectCommandBarAboveBottomTab(page: Page) {
  const commandBox = await page.getByTestId('global-ai-command-bar').boundingBox()
  const tabBox = await page.locator('nav').filter({ has: page.getByRole('button', { name: '首页' }) }).boundingBox()

  expect(commandBox, 'global AI command bar is visible').not.toBeNull()
  expect(tabBox, 'bottom tab bar is visible').not.toBeNull()
  expect(commandBox!.y + commandBox!.height, 'global AI command bar stays above bottom tabs').toBeLessThanOrEqual(tabBox!.y)
}

async function countStore(page: Page, storeName: string) {
  return await page.evaluate(async (nextStoreName) => {
    const request = indexedDB.open('TravelConsoleDB')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('打开测试数据库失败'))
    })

    if (!db.objectStoreNames.contains(nextStoreName)) {
      db.close()
      return 0
    }

    return await new Promise<number>((resolve, reject) => {
      const transaction = db.transaction(nextStoreName, 'readonly')
      const countRequest = transaction.objectStore(nextStoreName).count()
      countRequest.onsuccess = () => resolve(countRequest.result)
      countRequest.onerror = () => reject(countRequest.error ?? new Error('读取测试数据库失败'))
      transaction.oncomplete = () => db.close()
      transaction.onerror = () => {
        db.close()
        reject(transaction.error ?? new Error('读取测试数据库失败'))
      }
    })
  }, storeName)
}

async function readItineraryItem(page: Page, itemId: string) {
  return page.evaluate(async (targetItemId) => {
    const request = indexedDB.open('TravelConsoleDB')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('打开测试数据库失败'))
    })
    try {
      return await new Promise<Record<string, unknown>>((resolve, reject) => {
        const transaction = db.transaction('itineraryItems', 'readonly')
        const itemRequest = transaction.objectStore('itineraryItems').get(targetItemId)
        itemRequest.onsuccess = () => resolve(itemRequest.result as Record<string, unknown>)
        itemRequest.onerror = () => reject(itemRequest.error ?? new Error('读取行程点失败'))
      })
    } finally {
      db.close()
    }
  }, itemId)
}

async function seedLedgerSetup(page: Page, tripId: string) {
  await page.evaluate(async (targetTripId) => {
    const request = indexedDB.open('TravelConsoleDB')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('打开测试数据库失败'))
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(['ledgerSettings', 'ledgerParticipants'], 'readwrite')
        const now = Date.now()
        transaction.objectStore('ledgerSettings').put({
          createdAt: now,
          homeCurrency: 'CNY',
          id: 'gateway-ledger-settings',
          settlementCurrency: 'CNY',
          tripCurrency: 'GBP',
          tripId: targetTripId,
          updatedAt: now,
        })
        transaction.objectStore('ledgerParticipants').put({
          createdAt: now,
          displayName: '我',
          id: 'gateway-ledger-person',
          isSelf: true,
          source: 'manual',
          tripId: targetTripId,
          updatedAt: now,
        })
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error ?? new Error('写入账本测试数据失败'))
      })
    } finally {
      db.close()
    }
  }, tripId)
}

async function seedDeletionLedgerRelation(page: Page) {
  await page.evaluate(async () => {
    const request = indexedDB.open('TravelConsoleDB')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('打开测试数据库失败'))
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('ledgerExpenses', 'readwrite')
        transaction.objectStore('ledgerExpenses').put({
          amountMinor: 4200,
          category: 'admission',
          createdAt: Date.now(),
          currency: 'GBP',
          date: '2026-07-10',
          id: 'gateway-delete-expense',
          itemIds: ['gateway-delete-eye'],
          source: { kind: 'ticket', sourceId: 'gateway-delete-ticket' },
          splitMode: 'equal',
          splitShares: [],
          status: 'confirmed',
          title: '伦敦眼',
          tripId: 'gateway-delete-trip',
          updatedAt: Date.now(),
        })
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error ?? new Error('写入删除关系测试数据失败'))
      })
    } finally {
      db.close()
    }
  })
}

async function readFirstStoreRecord(page: Page, storeName: string) {
  return page.evaluate(async (targetStoreName) => {
    const request = indexedDB.open('TravelConsoleDB')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('打开测试数据库失败'))
    })
    try {
      return await new Promise<Record<string, unknown>>((resolve, reject) => {
        const transaction = db.transaction(targetStoreName, 'readonly')
        const cursorRequest = transaction.objectStore(targetStoreName).openCursor()
        cursorRequest.onsuccess = () => resolve(
          (cursorRequest.result?.value ?? {}) as Record<string, unknown>,
        )
        cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error('读取测试数据失败'))
      })
    } finally {
      db.close()
    }
  }, storeName)
}

async function readItineraryItemsByDay(page: Page, dayId: string) {
  return page.evaluate(async (targetDayId) => {
    const request = indexedDB.open('TravelConsoleDB')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('打开测试数据库失败'))
    })
    try {
      return await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
        const transaction = db.transaction('itineraryItems', 'readonly')
        const cursorRequest = transaction.objectStore('itineraryItems').openCursor()
        const items: Array<Record<string, unknown>> = []
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result
          if (!cursor) {
            resolve(items.sort((first, second) =>
              Number(first.sortOrder ?? 0) - Number(second.sortOrder ?? 0),
            ))
            return
          }
          const item = cursor.value as Record<string, unknown>
          if (item.dayId === targetDayId) items.push(item)
          cursor.continue()
        }
        cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error('读取行程点失败'))
      })
    } finally {
      db.close()
    }
  }, dayId)
}

async function updateItineraryItemTimes(
  page: Page,
  itemId: string,
  startTime: string,
  endTime: string,
) {
  await page.evaluate(async ({ nextEndTime, nextStartTime, targetItemId }) => {
    const request = indexedDB.open('TravelConsoleDB')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('打开测试数据库失败'))
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('itineraryItems', 'readwrite')
        const store = transaction.objectStore('itineraryItems')
        const itemRequest = store.get(targetItemId)
        itemRequest.onsuccess = () => {
          store.put({
            ...itemRequest.result,
            endTime: nextEndTime,
            startTime: nextStartTime,
            updatedAt: Date.now(),
          })
        }
        itemRequest.onerror = () => reject(itemRequest.error ?? new Error('读取行程点失败'))
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error ?? new Error('更新行程点时间失败'))
      })
    } finally {
      db.close()
    }
  }, { nextEndTime: endTime, nextStartTime: startTime, targetItemId: itemId })
}

async function countRouteCacheEntries(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open('TripMapRouteCacheDB')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('打开路线缓存失败'))
    })
    try {
      if (!db.objectStoreNames.contains('routeCaches')) return 0
      return await new Promise<number>((resolve, reject) => {
        const transaction = db.transaction('routeCaches', 'readonly')
        const countRequest = transaction.objectStore('routeCaches').count()
        countRequest.onsuccess = () => resolve(countRequest.result)
        countRequest.onerror = () => reject(countRequest.error ?? new Error('读取路线缓存失败'))
      })
    } finally {
      db.close()
    }
  })
}
