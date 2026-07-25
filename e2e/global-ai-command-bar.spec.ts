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
  const dialog = page.getByTestId('global-ai-action-confirm-dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '确认执行' }).click()

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
  await page.getByTestId('global-ai-action-confirm-dialog').getByRole('button', { name: '确认执行' }).click()

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
  await page.getByTestId('global-ai-action-confirm-dialog').getByRole('button', { name: '确认执行' }).click()

  await expect(page).toHaveURL(/#\/documents\?/)
  const ticketPreview = page.getByTestId('ticket-preview')
  await expect(ticketPreview).toBeVisible()
  await ticketPreview.getByTestId('ticket-preview-close').click()
  await expect(ticketPreview).toHaveCount(0)
  await expect(result).toContainText('部分完成')
  expect((await readItineraryItem(page, 'gateway-combo-airport')).lat).toBeUndefined()
  expect(placeLookupRequests).toBe(1)

  await result.getByRole('button', { name: '重试失败项' }).click()
  await expect.poll(async () => (await readItineraryItem(page, 'gateway-combo-airport')).lat).toBe(51.47)
  await expect(page.getByTestId('global-ai-action-confirm-dialog')).not.toBeVisible()
  await page.getByTestId('global-ai-action-details').getByText('查看步骤').click()
  await expect(page.getByTestId('global-ai-action-details')).toContainText('此前已完成，未重复执行')
  expect(placeLookupRequests).toBe(2)
  await expectNoHorizontalOverflow(page)
})

test('全局 AI 输入在移动端承接 what-if 重排且预览不落库', async ({ page }) => {
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
  await expect(result).toContainText('确认应用前不会创建事件或同步云端')
  await expect(page.getByTestId('global-ai-action-proposal')).toContainText('Live Mode 重排建议')
  await expect(result.getByRole('button', { name: '确认应用重排' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await expect(await countStore(page, 'tripReplanEvents')).toBe(0)
  await expect(await countStore(page, 'tripReplanRecords')).toBe(0)

  await result.getByRole('button', { name: '确认应用重排' }).click()
  await expect(page.getByTestId('global-ai-write-confirm-dialog')).toBeVisible()
  await page.getByRole('button', { name: '写入' }).click()
  await expect(page.getByText(/已应用模拟重排|已应用突发重排/)).toBeVisible()
  await expect(await countStore(page, 'tripReplanEvents')).toBeGreaterThan(0)
  await expect(await countStore(page, 'tripReplanRecords')).toBeGreaterThan(0)
  await expect(await countStore(page, 'tripIntelligenceAppliedChanges')).toBeGreaterThan(0)
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
