import { expect, test, type Page } from '@playwright/test'
import {
  clearTravelDatabase,
  createDemoTripViaUi,
  expectNoHorizontalOverflow,
  forceRouteProxyFixture,
  forceSupabaseUnconfigured,
  getHashParam,
  mockGoogleMapsUnavailable,
  mockMapStyle,
  seedTravelRecords,
  setRouteProxyConfig,
} from './helpers'

test('旅行工作台可以在日程和地图视图之间切换', async ({ page }) => {
  await mockMapStyle(page)
  const tripId = await createDemoTripViaUi(page)
  expect(tripId).toBeTruthy()

  await expect(page.getByRole('heading', { name: '当天日程' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Hotel Metropolitan Tokyo 入住/ })).toBeVisible()
  const dayBrief = page.getByTestId('day-local-brief-card')
  await expect(dayBrief).toBeVisible()
  await expect(dayBrief).toContainText('当日简报')
  await expect(dayBrief).toContainText('本地检查')
  await expect(dayBrief).toContainText('准备提醒')
  await expect(dayBrief).toContainText(/根据已填写内容|基于当前本地行程信息/)
  await expect(dayBrief).toContainText('开放时间')
  await expect(dayBrief.getByRole('button')).toHaveCount(0)
  await expect(page).toHaveURL(/#\/day\?/)
  await expectNoHorizontalOverflow(page)

  await page.getByTestId('view-switch-map').click()
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=map/)
  await expect(page.getByTestId('map-sheet')).toHaveCount(0)
  await expect(page.getByTestId('map-marker-card')).toBeVisible({ timeout: 15000 })
  await expect(page.getByTestId('view-switch-schedule')).toBeVisible()
  await expect(dayBrief).toBeHidden()
  await expectNoHorizontalOverflow(page)

  await page.getByTestId('view-switch-schedule').click()
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=schedule/)
  await expect(page.getByRole('heading', { name: '当天日程' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Hotel Metropolitan Tokyo 入住/ })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.getByTestId('view-switch-map').click()
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=map/)
  await expect(page.getByTestId('map-sheet')).toHaveCount(0)
  await expect(page.getByTestId('map-marker-card')).toBeVisible({ timeout: 15000 })
  await expectNoHorizontalOverflow(page)

  await page.getByTestId('day-selector').getByRole('button', { name: /Day 2/ }).click()
  await expect(page).toHaveURL(/view=map/)
  await expect(page.getByTestId('map-sheet')).toHaveCount(0)
  await expect(page.getByTestId('map-marker-card')).toBeVisible({ timeout: 15000 })
  await expectNoHorizontalOverflow(page)

  const currentTripId = getHashParam(page.url(), 'tripId')
  const currentDayId = getHashParam(page.url(), 'dayId')
  expect(currentTripId).toBe(tripId)
  expect(currentDayId).toBeTruthy()

  await page.getByTestId('day-back-to-trip').click()
  await expect(page).toHaveURL(/#\/trip\?/)
  await expect(page.getByRole('heading', { name: '每日行程' })).toBeVisible()
  await expect(page.getByRole('button', { name: /抵达与涩谷/ })).toContainText('3 个行程点')
  await expect(page.getByRole('button', { name: /浅草与东京站/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /2026年4月12日/ })).toBeVisible()
  const mapOverview = page.getByTestId('trip-map-overview')
  const localCheck = page.getByTestId('local-trip-check-card')
  await expect(localCheck).toBeVisible()
  await expect(localCheck).toContainText('行程体检')
  await expect(localCheck).toContainText('本地检查')
  await expect(localCheck).toContainText('准备提醒')
  await expect(localCheck).toContainText('行程点')
  await expect(localCheck).toContainText('票据')
  await expect(localCheck).toContainText('开放时间')
  await expect(localCheck.getByRole('button')).toHaveCount(0)
  expect(await localCheck.getByTestId('local-trip-check-finding').count()).toBeLessThanOrEqual(3)
  await expectNoHorizontalOverflow(page)

  await expect(mapOverview).toBeVisible()
  await expect(mapOverview).toContainText('行程地图预览')
  await expect(mapOverview).toContainText('5 个有坐标地点')
  await expect(mapOverview.getByTestId('trip-map-preview-map')).toHaveAttribute('data-interactive', 'false')
  await expectTripPreviewRenderedInPlot(page, 5)
  await expect(mapOverview.getByTestId('trip-map-preview-overlay')).toHaveCount(0)
  await expect(mapOverview.getByTestId('trip-map-overview-marker')).toHaveCount(5)
  await expect(mapOverview.getByTestId('trip-map-overview-note')).toContainText(
    '路线仅供预览，不会自动改行程顺序。',
  )
  const noteIsOutsidePlot = await mapOverview.evaluate((overview) => {
    const plot = overview.querySelector('[data-testid="trip-map-overview-plot"]')
    const note = overview.querySelector('[data-testid="trip-map-overview-note"]')
    return Boolean(plot && note && !plot.contains(note))
  })
  expect(noteIsOutsidePlot).toBe(true)
  await expectNoHorizontalOverflow(page)
  await mapOverview.getByRole('button', { name: '查看地图' }).click()
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=map/)
  await expect(page.getByTestId('map-sheet')).toHaveCount(0)
  await expect(page.getByTestId('map-marker-card')).toBeVisible({ timeout: 15000 })

  await page.getByTestId('day-back-to-trip').click()
  await expect(page).toHaveURL(/#\/trip\?/)

  await page.getByRole('button', { name: '更多' }).click()
  const moreMenu = page.getByTestId('trip-more-menu')
  await expect(moreMenu).toBeVisible()
  await expect(moreMenu.getByRole('button', { name: '设置' })).toBeVisible()
  await expect(moreMenu).not.toContainText('设置与存储说明')
  await expect(moreMenu).not.toContainText(/Google Maps 配置|路线服务配置|路线服务|设备存储/)
  await moreMenu.getByRole('button', { name: '更多' }).click()
  await expectNoHorizontalOverflow(page)

  await page.goto(`/#/trip?tripId=${tripId}&dayId=${currentDayId}&view=map`, { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=map/)
  expect(getHashParam(page.url(), 'dayId')).toBe(currentDayId)
  await expect(page.getByTestId('day-selector')).toBeVisible()
  await expect(page.getByTestId('map-marker-card')).toBeVisible({ timeout: 15000 })

  await page.getByTestId('day-back-to-trip').click()
  await expect(page).toHaveURL(/#\/trip\?/)
  await page.getByTestId('trip-action-ticket-library').click()
  await expect(page).toHaveURL(/#\/documents\?/)
  const ticketLibraryHash = new URL(page.url()).hash
  expect(ticketLibraryHash).toContain(`tripId=${tripId}`)
  expect(ticketLibraryHash).toContain('tab=attachments')
  await expect(page.getByRole('heading', { name: '票据和订单' })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await forceSupabaseUnconfigured(page)
  await page.goto(`/#/settings?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: '设置' })).toBeVisible()
  await page.locator('summary').filter({ hasText: '关于' }).click()
  await expect(page.locator('main').getByText(/当前版本：v\d+\.\d+\.\d+(?:\.\d+)?/)).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('Trip Home 现在建议做什么面板只本地生成并把执行动作保持在确认后', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    const fixedNow = new Date(2026, 3, 13, 8, 30, 0).valueOf()
    const RealDate = Date
    class MockDate extends RealDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) {
          super(fixedNow)
        } else {
          super(args[0] as string | number | Date)
        }
      }

      static now() {
        return fixedNow
      }
    }
    Object.setPrototypeOf(MockDate, RealDate)
    window.Date = MockDate as DateConstructor
  })
  await mockMapStyle(page)

  let providerProxyRequests = 0
  await page.route('**/api/provider-proxy', async (route) => {
    providerProxyRequests += 1
    await route.fulfill({
      body: JSON.stringify({ error: 'unexpected provider call before Trip Operations confirmation', ok: false }),
      contentType: 'application/json',
      status: 500,
    })
  })

  await createDemoTripViaUi(page)
  await forceSupabaseUnconfigured(page)
  await setRouteProxyConfig(page)
  await page.getByTestId('day-back-to-trip').click()
  await expect(page).toHaveURL(/#\/trip\?/)

  const panel = page.getByTestId('trip-operations-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('现在建议做什么')
  await expect(panel.getByTestId('trip-operations-summary')).toContainText(/优先处理|可以继续按计划推进/)
  expect(await panel.getByTestId('trip-operations-recommendation').count()).toBeLessThanOrEqual(5)
  await expect(panel.getByRole('button', { name: '生成摘要' })).toBeDisabled()
  expect(providerProxyRequests).toBe(0)
  await expectNoHorizontalOverflow(page)

  let routeRecommendation = panel.locator('[data-testid="trip-operations-recommendation"][data-type="missing_route"]')
  expect(await routeRecommendation.count()).toBeGreaterThan(0)

  await routeRecommendation.first().getByRole('button', { name: /稍后处理/ }).click()
  await expect(routeRecommendation).toHaveCount(0)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('trip-operations-panel')).toBeVisible()
  routeRecommendation = page.getByTestId('trip-operations-panel').locator('[data-testid="trip-operations-recommendation"][data-type="missing_route"]')
  await expect(routeRecommendation).toHaveCount(0)
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) => candidate.startsWith('tripmap:trip-operations:v2:'))
    if (!key) throw new Error('missing Trip Operations state')
    const state = JSON.parse(localStorage.getItem(key) || '{}') as { dispositions?: Array<{ status: string; zonedDate: string }> }
    for (const disposition of state.dispositions ?? []) {
      if (disposition.status === 'snoozed') disposition.zonedDate = '2026-04-12'
    }
    localStorage.setItem(key, JSON.stringify(state))
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  routeRecommendation = page.getByTestId('trip-operations-panel').locator('[data-testid="trip-operations-recommendation"][data-type="missing_route"]')
  await expect(routeRecommendation).toHaveCount(1)

  await routeRecommendation.first().getByRole('button', { name: /忽略建议/ }).click()
  await expect(routeRecommendation).toHaveCount(0)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('summary').filter({ hasText: '已隐藏建议' }).click()
  await page.getByTestId('trip-operations-hidden-list').getByRole('button', { name: '恢复' }).first().click()
  routeRecommendation = page.getByTestId('trip-operations-panel').locator('[data-testid="trip-operations-recommendation"][data-type="missing_route"]')
  await expect(routeRecommendation).toHaveCount(1)

  await routeRecommendation.first().getByTestId('trip-operations-action').click()
  const confirmDialog = page.getByTestId('trip-operations-confirm-dialog')
  await expect(confirmDialog).toBeVisible()
  await expect(confirmDialog).toContainText('确认处理')
  expect(providerProxyRequests).toBe(0)
  await expectNoHorizontalOverflow(page)
})

test('Day View Trip Live Mode 只做本地计算并提供执行入口', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    const fixedNow = new Date(2026, 5, 5, 10, 5, 0).valueOf()
    const RealDate = Date
    class MockDate extends RealDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) {
          super(fixedNow)
        } else {
          super(args[0] as string | number | Date)
        }
      }

      static now() {
        return fixedNow
      }
    }
    Object.setPrototypeOf(MockDate, RealDate)
    window.Date = MockDate as DateConstructor
  })
  await mockMapStyle(page)
  await clearTravelDatabase(page)
  await forceSupabaseUnconfigured(page)

  let providerProxyRequests = 0
  await page.route('**/api/provider-proxy', async (route) => {
    providerProxyRequests += 1
    await route.fulfill({
      body: JSON.stringify({ error: 'unexpected provider call in day live briefing test', ok: false }),
      contentType: 'application/json',
      status: 500,
    })
  })

  const now = Date.now()
  await seedTravelRecords(page, {
    trips: [{
      createdAt: now,
      destination: '杭州',
      endDate: '2026-06-05',
      id: 'trip-live-briefing',
      startDate: '2026-06-05',
      title: '杭州现场旅行',
      updatedAt: now,
    }],
    days: [{
      date: '2026-06-05',
      id: 'day-live-briefing',
      sortOrder: 1,
      title: '西湖一日',
      tripId: 'trip-live-briefing',
    }],
    itineraryItems: [{
      createdAt: now,
      dayId: 'day-live-briefing',
      endTime: '10:00',
      id: 'item-live-hotel',
      lat: 30.24,
      lng: 120.15,
      locationName: '湖滨酒店',
      sortOrder: 1,
      startTime: '09:00',
      ticketIds: [],
      title: '酒店早餐',
      tripId: 'trip-live-briefing',
      updatedAt: now,
    }, {
      contentEnrichment: {
        baselineFingerprint: 'e2e',
        generatedAt: '2026-06-01T00:00:00.000Z',
        introduction: { sourceIds: ['source-opening'], text: '西湖是杭州代表性景区。' },
        notices: [{ sourceIds: ['source-opening'], text: '旺季请提前预约并预留排队时间。' }],
        openingHours: { sourceIds: ['source-opening'], text: '08:00-18:00' },
        recommendedStay: { basis: 'ai_estimate', durationMinutes: 120, reason: '本地估算', text: '建议停留 2 小时' },
        schemaVersion: 1,
        sources: [{
          confidence: 'high',
          id: 'source-opening',
          label: '官网',
          retrievedAt: '2026-06-01T00:00:00.000Z',
          sourceType: 'official',
          title: '西湖开放公告',
          url: 'https://example.com/west-lake',
        }],
        ticketPrice: { kind: 'admission', sourceIds: ['source-opening'], text: '主景区免费开放' },
        warnings: [],
      },
      createdAt: now,
      dayId: 'day-live-briefing',
      id: 'item-live-west-lake',
      lat: 30.25,
      lng: 120.16,
      locationName: '西湖风景名胜区',
      previousTransportDurationMinutes: 20,
      sortOrder: 2,
      startTime: '10:20',
      ticketIds: ['ticket-live-west-lake'],
      title: '西湖门票预约入场',
      tripId: 'trip-live-briefing',
      updatedAt: now,
    }],
    ticketMetas: [{
      createdAt: now,
      fileName: 'west-lake-ticket.pdf',
      fileType: 'pdf',
      id: 'ticket-live-west-lake',
      itemId: 'item-live-west-lake',
      mimeType: 'application/pdf',
      scope: 'item',
      size: 128,
      storageMode: 'external',
      title: '西湖预约凭证',
      tripId: 'trip-live-briefing',
      updatedAt: now,
    }],
  })

  await page.goto('/#/trip?tripId=trip-live-briefing', { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('trip-live-mode-card')).toBeVisible()
  await expect(page.getByTestId('trip-live-mode-card')).toContainText('西湖门票预约入场')
  expect(providerProxyRequests).toBe(0)
  await expectNoHorizontalOverflow(page)

  await page.goto('/#/day?tripId=trip-live-briefing&dayId=day-live-briefing&view=schedule', { waitUntil: 'domcontentloaded' })

  const liveBriefing = page.getByTestId('trip-live-mode-card')
  await expect(liveBriefing).toBeVisible()
  await expect(liveBriefing).toContainText('Trip Live Mode')
  await expect(liveBriefing).toContainText('当前 10:05')
  await expect(liveBriefing).toContainText('现在该去：西湖门票预约入场')
  await expect(liveBriefing).toContainText('不包含实时交通')
  await expect(liveBriefing).toContainText('西湖预约凭证')
  await expect(liveBriefing).toContainText('08:00-18:00')
  await expect(liveBriefing).toContainText('可能小幅迟到')
  await expect(page.getByTestId('day-local-brief-card')).toBeVisible()
  expect(providerProxyRequests).toBe(0)
  await expectNoHorizontalOverflow(page)

  await liveBriefing.getByRole('button', { name: '详情' }).click()
  await expect(page).toHaveURL(/#\/item\?/)
  await expect(page).toHaveURL(/itemId=item-live-west-lake/)
  expect(providerProxyRequests).toBe(0)

  await page.goto('/#/day?tripId=trip-live-briefing&dayId=day-live-briefing&view=schedule', { waitUntil: 'domcontentloaded' })
  await page.getByTestId('trip-live-mode-card').getByRole('button', { name: '地图' }).click()
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=map/)
  await expect(page.getByTestId('trip-live-mode-card')).toHaveCount(0)
  expect(providerProxyRequests).toBe(0)

  await page.goto('/#/day?tripId=trip-live-briefing&dayId=day-live-briefing&view=schedule', { waitUntil: 'domcontentloaded' })
  await page.getByTestId('trip-live-mode-card').getByRole('button', { name: '票据' }).click()
  await expect(page).toHaveURL(/#\/documents\?/)
  await expect(page).toHaveURL(/tab=attachments/)
  await expect(page.getByRole('heading', { name: '票据和订单' })).toBeVisible()
  expect(providerProxyRequests).toBe(0)
  await expectNoHorizontalOverflow(page)
})

test('Trip Home 旅行收件箱确认后生成 diff 并只在最终确认后写入当前旅行', async ({ page }) => {
  await mockMapStyle(page)
  await clearTravelDatabase(page)
  await forceSupabaseUnconfigured(page)
  await forceRouteProxyFixture(page)

  const now = Date.now()
  await seedTravelRecords(page, {
    trips: [{
      createdAt: now,
      destination: '杭州',
      endDate: '2026-04-02',
      id: 'trip-existing-import',
      notes: '原有备注',
      startDate: '2026-04-01',
      title: '杭州导入测试',
      updatedAt: now,
    }],
    days: [{
      date: '2026-04-01',
      id: 'day-existing-import',
      sortOrder: 1,
      title: 'Day 1',
      tripId: 'trip-existing-import',
    }, {
      date: '2026-04-02',
      id: 'day-existing-import-2',
      sortOrder: 2,
      title: 'Day 2',
      tripId: 'trip-existing-import',
    }],
    itineraryItems: [{
      createdAt: now,
      dayId: 'day-existing-import',
      id: 'item-existing-hotel',
      sortOrder: 1,
      startTime: '09:00',
      ticketIds: [],
      title: '酒店早餐',
      tripId: 'trip-existing-import',
      updatedAt: now,
    }],
  })

  let providerRequests = 0
  let importRequests = 0
  let unexpectedProviderOperation = ''
  await page.route('**/api/provider-proxy', async (route) => {
    providerRequests += 1
    const body = route.request().postDataJSON()
    if (body.operation !== 'ai_existing_trip_import') {
      unexpectedProviderOperation = String(body.operation)
      await route.fulfill({
        body: JSON.stringify({ code: 'unsupported', message: 'unexpected operation', ok: false, operation: body.operation }),
        contentType: 'application/json',
        status: 501,
      })
      return
    }
    importRequests += 1
    expect(JSON.stringify(body)).not.toContain('ticketIds')
    expect(JSON.stringify(body)).not.toContain('ticketBlobs')
    expect(JSON.stringify(body)).not.toContain('ticketMetas')
    expect(JSON.stringify(body)).not.toContain('routeCache')
    expect(JSON.stringify(body)).not.toContain('cloud')
    expect(body.sources).toHaveLength(1)
    expect(body.existingTicketSummaries).toEqual([])
    const sourceId = body.sources[0].id
    await route.fulfill({
      body: JSON.stringify({
        ok: true,
        operation: 'ai_existing_trip_import',
        result: {
          items: [{
            candidateId: 'i1',
            confidence: 'high',
            date: '2026-04-01',
            locationName: '西湖景区',
            note: '订单提醒：凭证入园。',
            reason: '文本包含明确日期、时间和地点。',
            sourceIds: [sourceId],
            startTime: '10:30',
            title: '西湖游船',
          }, {
            candidateId: 'i2',
            confidence: 'low',
            date: '2026-04-01',
            locationName: '灵隐寺',
            reason: '文本包含备选行程点。',
            sourceIds: [sourceId],
            startTime: '14:00',
            title: '灵隐寺',
          }],
          notes: [{
            candidateId: 'n1',
            confidence: 'medium',
            reason: '文本包含整体备注。',
            sourceIds: [sourceId],
            text: '导入备注：请提前 15 分钟到达码头。',
          }],
          tickets: [{
            candidateId: 't1',
            confidence: 'high',
            date: '2026-04-01',
            fileName: 'west-lake-ticket.txt',
            itemTitle: '西湖游船',
            reason: '文本包含订单/票据关键词。',
            sourceFileId: sourceId,
            sourceIds: [sourceId],
            ticketCategory: 'admission_ticket',
            title: '西湖游船票据',
          }],
        },
        source: 'mock',
      }),
      contentType: 'application/json',
    })
  })
  await page.route('**/*.supabase.co/**', (route) => route.abort())
  await page.route('https://routes.googleapis.com/**', (route) => route.abort())
  await page.route('https://api.openrouteservice.org/**', (route) => route.abort())

  await page.goto('/#/trip?tripId=trip-existing-import', { waitUntil: 'domcontentloaded' })
  const panel = page.getByTestId('travel-inbox-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('旅行收件箱')
  await panel.locator('input[type="file"]').setInputFiles({
    buffer: Buffer.from('2026-04-01 10:30 西湖游船 门票 订单'),
    mimeType: 'text/plain',
    name: 'west-lake-ticket.txt',
  })

  const beforeCounts = await readAiEditBoundaryCounts(page)
  await expect(panel).toContainText('west-lake-ticket.txt')
  await panel.getByRole('button', { name: '整理材料' }).click()
  await expect(page.getByTestId('travel-inbox-recognize-confirm')).toBeVisible()
  expect(providerRequests).toBe(0)
  expect(await readAiEditBoundaryCounts(page)).toEqual(beforeCounts)

  await page.getByTestId('travel-inbox-recognize-confirm').getByRole('button', { name: '确认识别' }).click()
  await expect(panel).toContainText('整理建议')
  await expect(panel).toContainText('可一键应用')
  await expect(panel).toContainText('需确认')
  await expect(panel).toContainText('保存票据')
  await expect(panel).toContainText('新增行程点「西湖游船」')
  await expect(panel).toContainText('新增行程点「灵隐寺」')
  await expect(panel).toContainText('新增票据「西湖游船票据」')
  expect(importRequests).toBe(1)
  expect(await readAiEditBoundaryCounts(page)).toEqual(beforeCounts)

  const westLakePreview = panel.locator('.rounded-lg', { hasText: '新增行程点「西湖游船」' })
  await westLakePreview.getByLabel('处理方式').selectOption('merge:item-existing-hotel')
  await expect(panel).toContainText('合并到「酒店早餐」')
  const lingyinPreview = panel.locator('.rounded-lg', { hasText: '新增行程点「灵隐寺」' })
  await lingyinPreview.locator('input[type="checkbox"]').check()
  await lingyinPreview.getByLabel('目标日期').selectOption('day:day-existing-import-2')
  const ticketPreview = panel.locator('.rounded-lg', { hasText: '新增票据「西湖游船票据」' })
  await ticketPreview.getByLabel('票据分类').selectOption('train_ticket')
  await panel.getByLabel('绑定目标').selectOption('item:item-existing-hotel')

  await panel.getByRole('button', { name: '应用选中建议' }).click()
  await expect(page.getByTestId('travel-inbox-apply-confirm')).toBeVisible()
  expect(await readAiEditBoundaryCounts(page)).toEqual(beforeCounts)
  await page.getByTestId('travel-inbox-apply-confirm').getByRole('button', { name: '确认应用' }).click()

  await expect.poll(async () => {
    const state = await readExistingTripImportState(page)
    return {
      ticketBlobSyncStates: state.ticketBlobSyncStates,
      ticketBlobs: state.ticketBlobs,
      ticketTitles: state.tickets.map((ticket) => ticket.title),
    }
  }).toEqual({
    ticketBlobSyncStates: [expect.objectContaining({
      cacheStatus: 'cached',
      uploadStatus: 'pending',
    })],
    ticketBlobs: 1,
    ticketTitles: ['西湖游船票据'],
  })
  const finalState = await readExistingTripImportState(page)
  expect(finalState.items.map((item) => item.title)).not.toContain('西湖游船')
  const mergedItem = finalState.items.find((item) => item.title === '酒店早餐')
  expect(mergedItem).toMatchObject({ locationName: '西湖景区', startTime: '09:00' })
  expect(mergedItem?.ticketIds).toHaveLength(1)
  const importedItem = finalState.items.find((item) => item.title === '灵隐寺')
  expect(importedItem).toMatchObject({ dayId: 'day-existing-import-2', startTime: '14:00' })
  expect(finalState.tickets).toHaveLength(1)
  expect(finalState.tickets[0]).toMatchObject({ itemId: 'item-existing-hotel', ticketCategory: 'train_ticket', title: '西湖游船票据' })
  expect(finalState.ticketBlobs).toBe(1)
  expect(finalState.syncOutboxTypes).toEqual(expect.arrayContaining(['item', 'ticket_meta', 'trip']))
  expect(finalState.ticketBlobSyncStates).toEqual([expect.objectContaining({
    cacheStatus: 'cached',
    uploadStatus: 'pending',
  })])
  expect(finalState.travelInboxEntries).toBe(0)
  expect(finalState.travelInboxBlobs).toBe(0)
  expect(finalState.travelInboxPreviews).toBe(0)
  expect(finalState.notes).toContain('原有备注')
  expect(finalState.notes).toContain('导入备注')
  await expect(page.getByTestId('travel-inbox-applied-changes')).toContainText('写入了什么')
  await expect(page.getByTestId('travel-inbox-applied-changes')).toContainText('新增票据')
  const afterCounts = await readAiEditBoundaryCounts(page)
  expect(afterCounts.routeCaches).toBe(beforeCounts.routeCaches)
  expect(afterCounts.ticketMetas).toBe(beforeCounts.ticketMetas + 1)
  expect(afterCounts.ticketBlobs).toBe(beforeCounts.ticketBlobs + 1)
  expect(afterCounts.itineraryItems).toBe(beforeCounts.itineraryItems + 1)
  expect(unexpectedProviderOperation).toBe('')
  await expectNoHorizontalOverflow(page)
})

test('Trip Home 旅行收件箱自动识别开启后只发送提取文本并保留预览确认', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('tripmap:travel-inbox:auto-recognize', '1')
  })
  await mockMapStyle(page)
  await clearTravelDatabase(page)
  await forceSupabaseUnconfigured(page)
  await forceRouteProxyFixture(page)

  const now = Date.now()
  await seedTravelRecords(page, {
    trips: [{
      createdAt: now,
      destination: '杭州',
      endDate: '2026-04-01',
      id: 'trip-inbox-auto',
      startDate: '2026-04-01',
      title: '杭州收件箱自动识别',
      updatedAt: now,
    }],
    days: [{
      date: '2026-04-01',
      id: 'day-inbox-auto',
      sortOrder: 1,
      title: 'Day 1',
      tripId: 'trip-inbox-auto',
    }],
  })

  let importRequests = 0
  await page.route('**/api/provider-proxy', async (route) => {
    const body = route.request().postDataJSON()
    expect(body.operation).toBe('ai_existing_trip_import')
    expect(JSON.stringify(body)).not.toContain('ticketBlobs')
    expect(JSON.stringify(body)).not.toContain('ticketIds')
    expect(JSON.stringify(body)).not.toContain('routeCache')
    expect(JSON.stringify(body)).not.toContain('cloud')
    expect(body.sources).toHaveLength(1)
    expect(body.existingTicketSummaries).toEqual([])
    importRequests += 1
    await route.fulfill({
      body: JSON.stringify({
        ok: true,
        operation: 'ai_existing_trip_import',
        result: {
          items: [{
            candidateId: 'i1',
            confidence: 'high',
            date: '2026-04-01',
            reason: '文本包含明确日期和地点。',
            sourceIds: [body.sources[0].id],
            startTime: '14:00',
            title: '灵隐寺',
          }],
        },
        source: 'mock',
      }),
      contentType: 'application/json',
    })
  })

  await page.goto('/#/trip?tripId=trip-inbox-auto', { waitUntil: 'domcontentloaded' })
  const panel = page.getByTestId('travel-inbox-panel')
  await expect(panel).toBeVisible()
  await expect(panel.getByLabel('提取后自动 AI 识别')).toBeChecked()
  expect(importRequests).toBe(0)

  await panel.locator('input[type="file"]').setInputFiles({
    buffer: Buffer.from('2026-04-01 14:00 灵隐寺'),
    mimeType: 'text/plain',
    name: 'lingyin.txt',
  })

  await expect(panel).toContainText('整理建议')
  await expect(panel).toContainText('新增行程点「灵隐寺」')
  expect(importRequests).toBe(1)
  const state = await readExistingTripImportState(page)
  expect(state.items.map((item) => item.title)).not.toContain('灵隐寺')
  await expectNoHorizontalOverflow(page)
})

test('Trip Home 路线准备在坐标不足时保持安静不可用', async ({ page }) => {
  await clearTravelDatabase(page)
  const now = Date.now()
  await seedTravelRecords(page, {
    trips: [{
      createdAt: now,
      destination: '日本东京',
      endDate: '2026-04-12',
      id: 'trip-no-route-coords',
      startDate: '2026-04-12',
      title: '坐标待补充旅行',
      updatedAt: now,
    }],
    days: [{
      date: '2026-04-12',
      id: 'day-no-route-coords',
      sortOrder: 1,
      title: '坐标待补充',
      tripId: 'trip-no-route-coords',
    }],
    itineraryItems: [{
      createdAt: now,
      dayId: 'day-no-route-coords',
      id: 'item-no-route-coords',
      sortOrder: 1,
      ticketIds: [],
      title: '还没有坐标的地点',
      tripId: 'trip-no-route-coords',
      updatedAt: now,
    }],
  })

  await page.goto('/#/trip?tripId=trip-no-route-coords&dayId=day-no-route-coords', { waitUntil: 'domcontentloaded' })
  const panel = page.getByTestId('route-preparation-panel')

  await expect(panel).toBeVisible()
  await expect(panel.getByTestId('route-preparation-summary')).toContainText('补充至少两个有坐标')
  await expect(panel.getByRole('button', { name: '生成路线预览' })).toBeDisabled()
  await expectNoHorizontalOverflow(page)
})

test('Trip Home 今日旅行提示本地展示并在确认后保存增强提示', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    const fixedNow = new Date(2026, 5, 5, 10, 0, 0).valueOf()
    const RealDate = Date
    class MockDate extends RealDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) {
          super(fixedNow)
        } else {
          super(args[0] as string | number | Date)
        }
      }

      static now() {
        return fixedNow
      }
    }
    Object.setPrototypeOf(MockDate, RealDate)
    window.Date = MockDate as DateConstructor
  })
  await mockMapStyle(page)
  await clearTravelDatabase(page)
  await setRouteProxyConfig(page)
  await forceSupabaseUnconfigured(page)
  let travelSearchRequests = 0
  let dailyTipRequests = 0
  let routePreviewRequests = 0
  let cloudRequests = 0
  let ticketRequests = 0

  await page.route('**/api/provider-proxy', async (route) => {
    const body = route.request().postDataJSON()
    if (body.operation === 'travel_search') {
      travelSearchRequests += 1
      expect(JSON.stringify(body)).not.toContain('ticketIds')
      expect(JSON.stringify(body)).not.toContain('routeCache')
      expect(JSON.stringify(body)).not.toContain('旅行备注')
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          operation: 'travel_search',
          query: body.query,
          results: [{
            confidence: 'high',
            displayUrl: 'transport.example/west-lake',
            domain: 'transport.example',
            retrievedAt: '2026-06-05T02:00:00.000Z',
            snippet: '出发前请核对景区周边交通管制和步行入口。',
            sourceType: 'official',
            title: '西湖交通提示',
            url: 'https://transport.example/west-lake',
          }],
          retrievedAt: '2026-06-05T02:00:00.000Z',
          source: 'mock',
        }),
        contentType: 'application/json',
      })
      return
    }
    if (body.operation === 'trip_daily_tip') {
      dailyTipRequests += 1
      expect(JSON.stringify(body)).not.toContain('ticketIds')
      expect(JSON.stringify(body)).not.toContain('routeCache')
      expect(JSON.stringify(body)).not.toContain('cloud')
      expect(JSON.stringify(body)).not.toContain('旅行备注')
      expect(body.sources.length).toBeGreaterThan(0)
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          operation: 'trip_daily_tip',
          sections: [
            { key: 'opening_hours', sourceIds: ['source-opening'], text: '西湖开放时间以官网为准。', title: '开放时间' },
            { key: 'ticket_price', sourceIds: ['source-opening'], text: '主景区免费，收费项目以现场公告为准。', title: '票价' },
          ],
          source: 'mock',
          sourceIds: ['source-opening'],
          summary: '出发前优先核对西湖开放状态、收费项目和路线风险。',
          warnings: [],
        }),
        contentType: 'application/json',
      })
      return
    }
    if (body.operation === 'route_preview') {
      routePreviewRequests += 1
    }
    await route.fulfill({
      body: JSON.stringify({ code: 'unsupported', message: 'unexpected operation', ok: false }),
      contentType: 'application/json',
      status: 501,
    })
  })
  await page.route('**/*.supabase.co/**', (route) => {
    cloudRequests += 1
    return route.abort()
  })
  await page.route('**/tickets/**', (route) => {
    ticketRequests += 1
    return route.abort()
  })

  const now = Date.now()
  await seedTravelRecords(page, {
    trips: [{
      createdAt: now,
      destination: '杭州',
      endDate: '2026-06-06',
      id: 'trip-daily-tip',
      notes: '旅行备注',
      startDate: '2026-06-05',
      title: '杭州今日提示测试',
      updatedAt: now,
    }],
    days: [
      { date: '2026-06-05', id: 'daily_tip_day_1', sortOrder: 1, title: '第一天', tripId: 'trip-daily-tip' },
      { date: '2026-06-06', id: 'daily_tip_day_2', sortOrder: 2, title: '第二天', tripId: 'trip-daily-tip' },
    ],
    itineraryItems: [
      {
        contentEnrichment: {
          baselineFingerprint: 'baseline',
          generatedAt: '2026-06-01T00:00:00.000Z',
          introduction: { sourceIds: ['source-opening'], text: '西湖介绍。' },
          notices: [{ sourceIds: ['source-opening'], text: '节假日建议提前预约。' }],
          openingHours: { sourceIds: ['source-opening'], text: '周一至周日 全天开放' },
          recommendedStay: { basis: 'ai_estimate', durationMinutes: 90, reason: '估算', text: '建议停留约 1.5 小时' },
          schemaVersion: 1,
          sources: [{
            confidence: 'high',
            id: 'source-opening',
            label: '官网',
            retrievedAt: '2026-06-01T00:00:00.000Z',
            sourceType: 'official',
            title: '西湖官网',
            url: 'https://westlake.example',
          }],
          ticketPrice: { kind: 'admission', sourceIds: ['source-opening'], text: '主景区免费。' },
          warnings: [],
        },
        createdAt: now,
        dayId: 'daily_tip_day_1',
        id: 'daily_tip_item_1',
        lat: 30.25,
        lng: 120.14,
        sortOrder: 1,
        startTime: '09:00',
        ticketIds: [],
        title: '西湖',
        tripId: 'trip-daily-tip',
        updatedAt: now,
      },
      {
        createdAt: now,
        dayId: 'daily_tip_day_1',
        id: 'daily_tip_item_2',
        lat: 30.26,
        lng: 120.15,
        sortOrder: 2,
        startTime: '13:00',
        ticketIds: [],
        title: '孤山',
        tripId: 'trip-daily-tip',
        updatedAt: now,
      },
    ],
  })

  await page.goto('/#/trip?tripId=trip-daily-tip&dayId=daily_tip_day_1', { waitUntil: 'domcontentloaded' })
  const card = page.getByTestId('trip-daily-travel-tip-card')
  await expect(card).toBeVisible()
  await expect(card).toContainText('今日旅行提示')
  await expect(card).toContainText('当日提示')
  await expect(card).toContainText('开放时间')
  await expect(card).toContainText('主景区免费')
  await expect(card).toContainText('节假日建议提前预约')
  expect(travelSearchRequests).toBe(0)
  expect(dailyTipRequests).toBe(0)
  expect(routePreviewRequests).toBe(0)
  expect(await readTripNotes(page, 'trip-daily-tip')).toBe('旅行备注')

  await card.getByRole('button', { name: '生成增强提示' }).click()
  await expect(page.getByRole('dialog')).toContainText('travel_search')
  expect(travelSearchRequests).toBe(0)
  expect(dailyTipRequests).toBe(0)
  await page.getByRole('dialog').getByRole('button', { name: '暂不生成' }).click()
  expect(travelSearchRequests).toBe(0)
  expect(dailyTipRequests).toBe(0)

  await card.getByRole('button', { name: '生成增强提示' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '确认生成' }).click()
  await expect(card.getByTestId('trip-daily-tip-preview')).toContainText('出发前优先核对')
  expect(dailyTipRequests).toBe(1)
  expect(routePreviewRequests).toBe(0)

  await card.getByRole('button', { name: '保存到旅行备注' }).click()
  await expect(page.getByRole('dialog')).toContainText('旅行备注')
  await page.getByRole('dialog').getByRole('button', { name: '暂不保存' }).click()
  expect(await readTripNotes(page, 'trip-daily-tip')).toBe('旅行备注')

  await card.getByRole('button', { name: '保存到旅行备注' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '确认保存' }).click()
  await expect.poll(() => readTripNotes(page, 'trip-daily-tip')).toContain('今日旅行提示')
  expect(await readRouteCacheEntryCount(page)).toBe(0)
  expect(routePreviewRequests).toBe(0)
  expect(cloudRequests).toBe(0)
  expect(ticketRequests).toBe(0)
  await expectNoHorizontalOverflow(page)
})

test('Trip Home 地图预览缓存路线并通过 proxy 应用路线顺序建议', async ({ page }) => {
  await mockMapStyle(page)
  let routePreviewRequests = 0
  let routeOrderRequests = 0
  let directGoogleRouteRequests = 0
  let directOrsRequests = 0
  await page.route('**/api/provider-proxy', async (route) => {
    const body = route.request().postDataJSON()
    if (body.operation === 'route_preview') {
      routePreviewRequests += 1
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
        contentType: 'application/json',
      })
      return
    }
    if (body.operation === 'route_order_suggestion') {
      routeOrderRequests += 1
      expect(body.provider).toBe('auto')
      expect(body.quotaSessionId).toBeTruthy()
      expect(JSON.stringify(body)).not.toContain('GOOGLE_ROUTES_API_KEY')
      expect(JSON.stringify(body)).not.toContain('OPENROUTESERVICE_API_KEY')
      expect(JSON.stringify(body)).not.toContain('ticketIds')
      expect(JSON.stringify(body)).not.toContain('notes')
      const requestItems = body.items as Array<{ coordinate?: unknown; id: string }>
      const coordinateItems = requestItems.filter((item) => item.coordinate)
      const suggestedItemIds = [
        coordinateItems[0]?.id,
        ...coordinateItems.slice(1, -1).reverse().map((item) => item.id),
        coordinateItems[coordinateItems.length - 1]?.id,
      ].filter(Boolean)
      await route.fulfill({
        body: JSON.stringify({
          distanceMeters: 1800,
          durationSeconds: 900,
          ok: true,
          operation: 'route_order_suggestion',
          provider: 'mock',
          retrievedAt: '2026-01-01T00:00:00.000Z',
          suggestedItemIds,
          summary: '模拟路线顺序建议',
          unchangedItemIds: requestItems.filter((item) => !item.coordinate).map((item) => item.id),
          warnings: [],
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
  await page.route('https://routes.googleapis.com/directions/v2:computeRoutes', async (route) => {
    directGoogleRouteRequests += 1
    await route.fulfill({
      body: JSON.stringify({
        routes: [
          {
            distanceMeters: 3200,
            duration: '840s',
            optimizedIntermediateWaypointIndex: [1, 0],
            polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' },
          },
        ],
      }),
      contentType: 'application/json',
    })
  })
  await page.route('https://api.openrouteservice.org/**', (route) => {
    directOrsRequests += 1
    return route.abort()
  })
  const tripId = await createDemoTripViaUi(page)
  const dayId = getHashParam(page.url(), 'dayId')
  expect(dayId).toBeTruthy()

  await page.evaluate(({ currentDayId, currentTripId }) => {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('TravelConsoleDB')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction(['itineraryItems'], 'readwrite')
        tx.objectStore('itineraryItems').add({
          createdAt: Date.now(),
          dayId: currentDayId,
          id: 'item_extra_optimization',
          lat: 35.6812,
          lng: 139.7671,
          previousTransportMode: 'car',
          sortOrder: 4,
          ticketIds: [],
          title: '东京站补充点',
          tripId: currentTripId,
          updatedAt: Date.now(),
        })
        tx.onerror = () => reject(tx.error)
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
      }
    })
  }, { currentDayId: dayId, currentTripId: tripId })

  await page.goto(`/#/trip?tripId=${tripId}&dayId=${dayId}`, { waitUntil: 'domcontentloaded' })
  await setRouteProxyConfig(page)
  const mapOverview = page.getByTestId('trip-map-overview')
  await expect(mapOverview).toContainText('行程地图预览')
  await expect(mapOverview.getByTestId('trip-map-preview-map')).toHaveAttribute('data-interactive', 'false')
  await expectTripPreviewRenderedInPlot(page, 6)
  await expect(mapOverview.getByTestId('trip-map-preview-overlay')).toHaveCount(0)
  await expect(mapOverview.getByTestId('trip-map-overview-marker')).toHaveCount(6)
  await expect(mapOverview.getByTestId('trip-map-overview-note')).toContainText('尚未生成路线预览')
  await expect(page.getByTestId('route-preparation-panel')).toContainText('路线准备')
  await expect(page.getByTestId('route-preparation-summary')).toContainText('可为 2 天生成路线预览')
  expect(await readRouteCacheEntryCount(page)).toBe(0)
  await expect(mapOverview.getByText(/加载地图预览/)).toHaveCount(0)
  expect(routeOrderRequests).toBe(0)

  await page.getByTestId('route-preparation-panel').getByRole('button', { name: '生成路线预览' }).click()
  const routeDialog = page.getByTestId('route-generation-confirm-dialog')
  await expect(routeDialog).toContainText('将调用路线服务')
  await expect(routeDialog).toContainText('不会自动调整')
  await expect(routeDialog).toContainText('不会生成公交')
  expect(await readRouteCacheEntryCount(page)).toBe(0)

  await routeDialog.getByRole('button', { name: '确认生成' }).click()
  await expect(page.getByTestId('route-preparation-result')).toContainText('已生成 1 天路线预览')
  await expect(mapOverview.getByTestId('trip-map-overview-note')).toContainText('已缓存的 ORS 路线几何')
  expect(routePreviewRequests).toBeGreaterThan(0)

  await page.reload({ waitUntil: 'domcontentloaded' })
  const reloadedMapOverview = page.getByTestId('trip-map-overview')
  await expect(reloadedMapOverview.getByTestId('trip-map-overview-note')).toContainText('已缓存的 ORS 路线几何')
  await expect(reloadedMapOverview.getByText(/加载地图预览/)).toHaveCount(0)

  await page.evaluate(() => {
    window.localStorage.setItem('tripmap:google-maps-api-key', 'fake-google-key')
    window.dispatchEvent(new Event('tripmap:google-maps-config-changed'))
  })
  const originalOrder = await readDayItemOrder(page, dayId as string)
  const cacheCountBeforeSuggestion = await readRouteCacheEntryCount(page)
  const routeOrderPanel = page.getByTestId('trip-map-route-order-panel')
  await expect(routeOrderPanel).toBeVisible()
  expect(routeOrderRequests).toBe(0)
  await routeOrderPanel.getByRole('button', { name: '查看建议（仅建议）' }).click()
  await expect(routeOrderPanel.getByTestId('trip-map-route-order-suggestion')).toContainText('建议顺序')
  expect(routeOrderRequests).toBe(1)
  expect(await readDayItemOrder(page, dayId as string)).toEqual(originalOrder)

  await routeOrderPanel.getByRole('button', { name: '应用建议' }).click()
  const orderDialog = page.getByTestId('trip-map-route-order-confirm-dialog')
  await expect(orderDialog).toContainText('只会更新')
  await expect(orderDialog).toContainText('不会生成路线')
  await expect(orderDialog).toContainText('不会写入云端')
  await expect(orderDialog).toContainText('不会创建票据')
  await orderDialog.getByRole('button', { name: '暂不应用' }).click()
  expect(await readDayItemOrder(page, dayId as string)).toEqual(originalOrder)

  await routeOrderPanel.getByRole('button', { name: '应用建议' }).click()
  await page.getByTestId('trip-map-route-order-confirm-dialog').getByRole('button', { name: '确认应用' }).click()
  const expectedOrder = [
    originalOrder[0],
    ...originalOrder.slice(1, -1).reverse(),
    originalOrder[originalOrder.length - 1],
  ]
  await expect.poll(() => readDayItemOrder(page, dayId as string)).toEqual(expectedOrder)
  expect(await readRouteCacheEntryCount(page)).toBe(cacheCountBeforeSuggestion)
  expect(directGoogleRouteRequests).toBe(0)
  expect(directOrsRequests).toBe(0)
  await expectNoHorizontalOverflow(page)
})

test('Trip Home 路线生成可在确认后使用 mock provider proxy', async ({ page }) => {
  await mockMapStyle(page)
  let proxyCalls = 0
  await page.route('**/api/provider-proxy', async (route) => {
    proxyCalls += 1
    const body = route.request().postDataJSON() as {
      coordinates: number[][]
      operation: string
      provider: string
      quotaSessionId?: string
      segments: Array<{
        fromCoordinateIndex: number
        fromItemId?: string
        segmentIndex: number
        toCoordinateIndex: number
        toItemId?: string
      }>
    }
    expect(body.operation).toBe('route_preview')
    expect(body.provider).toBe('openrouteservice')
    expect(body.quotaSessionId).toBeTruthy()
    expect(JSON.stringify(body)).not.toContain('OPENROUTESERVICE_API_KEY')
    expect(JSON.stringify(body)).not.toContain('GOOGLE_ROUTES_API_KEY')
    await route.fulfill({
      body: JSON.stringify({
        ok: true,
        operation: 'route_preview',
        provider: 'openrouteservice',
        route: {
          lineStrings: body.segments.map((segment) => [
            body.coordinates[segment.fromCoordinateIndex],
            body.coordinates[segment.toCoordinateIndex],
          ]),
          segments: body.segments.map((segment) => ({
            coordinates: [
              body.coordinates[segment.fromCoordinateIndex],
              body.coordinates[segment.toCoordinateIndex],
            ],
            distanceMeters: 1200,
            durationSeconds: 600,
            fromItemId: segment.fromItemId,
            kind: 'road',
            segmentIndex: segment.segmentIndex,
            toItemId: segment.toItemId,
          })),
          status: 'road',
          warnings: [],
        },
      }),
      contentType: 'application/json',
    })
  })

  const tripId = await createDemoTripViaUi(page)
  const dayId = getHashParam(page.url(), 'dayId')
  expect(dayId).toBeTruthy()
  await forceRouteProxyFixture(page)
  await page.goto(`/#/trip?tripId=${tripId}&dayId=${dayId}`, { waitUntil: 'domcontentloaded' })

  await expect(page.getByTestId('route-preparation-summary')).toContainText('可为')
  expect(proxyCalls).toBe(0)
  await page.getByTestId('route-preparation-panel').getByRole('button', { name: '生成路线预览' }).click()
  const routeDialog = page.getByTestId('route-generation-confirm-dialog')
  await expect(routeDialog).toContainText('将调用路线服务')
  expect(proxyCalls).toBe(0)
  await routeDialog.getByRole('button', { name: '确认生成' }).click()

  await expect(page.getByTestId('route-preparation-result')).toContainText('已生成')
  expect(proxyCalls).toBeGreaterThan(0)
  await expectNoHorizontalOverflow(page)
})

test('Trip Home 地图预览在 MapLibre 样式失败时仍显示轻量预览', async ({ page }) => {
  await mockGoogleMapsUnavailable(page)
  await page.route('https://*.basemaps.cartocdn.com/**', (route) => route.abort())
  await page.route('https://tiles.openfreemap.org/styles/**', (route) => route.abort())
  const tripId = await createDemoTripViaUi(page)
  const dayId = getHashParam(page.url(), 'dayId')
  expect(dayId).toBeTruthy()

  await page.goto(`/#/trip?tripId=${tripId}&dayId=${dayId}`, { waitUntil: 'domcontentloaded' })
  const mapOverview = page.getByTestId('trip-map-overview')

  await expect(mapOverview).toContainText('行程地图预览')
  await expect(mapOverview.getByTestId('trip-map-preview-map')).toHaveAttribute('data-interactive', 'false')
  await expectTripPreviewRenderedInPlot(page, 5, { requireMarkers: true })
  await expect(mapOverview.getByTestId('trip-map-preview-overlay')).toHaveCount(0)
  await expect(mapOverview.getByTestId('trip-map-overview-marker')).toHaveCount(5)
  await expect(mapOverview.getByText('地图底图暂时无法加载')).toBeVisible()
  await expect(mapOverview.getByText(/加载地图预览/)).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('Trip Home Google 地图预览不依赖 AdvancedMarker', async ({ page }) => {
  await mockGoogleMapsScript(page)
  let googleRouteCalls = 0
  await page.route('https://routes.googleapis.com/directions/v2:computeRoutes', async (route) => {
    googleRouteCalls += 1
    await route.fulfill({
      body: JSON.stringify({
        routes: [
          {
            distanceMeters: 1200,
            duration: '600s',
            polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' },
          },
        ],
      }),
      contentType: 'application/json',
    })
  })
  const tripId = await createDemoTripViaUi(page)
  const dayId = getHashParam(page.url(), 'dayId')
  expect(dayId).toBeTruthy()

  await page.evaluate(() => {
    window.localStorage.setItem('tripmap:google-maps-api-key', 'fake-google-key')
  })
  await setRouteProxyConfig(page)
  await page.goto(`/#/trip?tripId=${tripId}&dayId=${dayId}`, { waitUntil: 'domcontentloaded' })
  const mapOverview = page.getByTestId('trip-map-overview')

  await expect(mapOverview.getByTestId('trip-map-preview-map')).toHaveAttribute('data-interactive', 'false')
  await expect(mapOverview.getByTestId('trip-map-preview-overlay')).toHaveCount(0)
  await expect(mapOverview.getByTestId('trip-map-overview-marker')).toHaveCount(5)
  await expect(mapOverview.getByTestId('trip-map-google-route-line')).toHaveCount(1)
  await expect(mapOverview.getByTestId('trip-map-overview-note')).toContainText('尚未生成路线预览')
  await expect(mapOverview.locator('.maplibregl-map')).toHaveCount(0)
  expect(googleRouteCalls).toBe(0)
  await expectNoHorizontalOverflow(page)
})

test('Trip Home AI 修改建议需要两次确认且只在最终确认后写入', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockMapStyle(page)
  await clearTravelDatabase(page)
  await setRouteProxyConfig(page)
  let editRequests = 0
  let travelSearchRequests = 0
  let routePreviewRequests = 0
  let cloudRequests = 0
  let deepSeekRequests = 0

  await page.route('**/api/provider-proxy', async (route) => {
    const body = route.request().postDataJSON()
    if (body.operation === 'ai_trip_edit_plan') {
      editRequests += 1
      expect(body.searchResults).toBeUndefined()
      expect(JSON.stringify(body)).not.toContain('ticket_1')
      expect(JSON.stringify(body)).not.toContain('ticketMetas')
      expect(JSON.stringify(body)).not.toContain('ticketBlobs')
      expect(JSON.stringify(body)).not.toContain('routeCache')
      expect(JSON.stringify(body)).not.toContain('cloudToken')
      expect(JSON.stringify(body)).not.toContain('lat')
      expect(JSON.stringify(body)).not.toContain('lng')
      expect(JSON.stringify(body)).not.toContain('默认不发送的备注')
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          operation: 'ai_trip_edit_plan',
          patchPlan: {
            operations: [
              { itemId: 'item_ai_edit_1', reason: '把标题改得更明确。', title: '西湖深度散步', type: 'update_item_title' },
            ],
            summary: '把西湖安排改得更明确。',
          },
          source: 'mock',
        }),
        contentType: 'application/json',
      })
      return
    }
    if (body.operation === 'travel_search') {
      travelSearchRequests += 1
    }
    if (body.operation === 'route_preview') {
      routePreviewRequests += 1
    }
    await route.fulfill({
      body: JSON.stringify({ code: 'unsupported', message: 'unexpected operation', ok: false }),
      contentType: 'application/json',
      status: 501,
    })
  })
  await page.route('https://api.deepseek.com/**', (route) => {
    deepSeekRequests += 1
    return route.abort()
  })
  await page.route('**/*.supabase.co/**', (route) => {
    cloudRequests += 1
    return route.abort()
  })
  await page.evaluate(() => {
    window.localStorage.setItem('tripmap:e2e:supabase-unconfigured', '1')
  })

  const now = Date.now()
  await seedTravelRecords(page, {
    trips: [{
      createdAt: now,
      destination: '杭州',
      endDate: '2026-07-11',
      id: 'trip-ai-edit',
      notes: '旅行备注也不应默认发送',
      startDate: '2026-07-10',
      title: '杭州 AI 修改测试',
      updatedAt: now,
    }],
    days: [
      { date: '2026-07-10', id: 'day_ai_edit_1', sortOrder: 1, title: '第一天', tripId: 'trip-ai-edit' },
      { date: '2026-07-11', id: 'day_ai_edit_2', sortOrder: 2, title: '第二天', tripId: 'trip-ai-edit' },
    ],
    itineraryItems: [
      {
        createdAt: now,
        dayId: 'day_ai_edit_1',
        id: 'item_ai_edit_1',
        lat: 30.244,
        lng: 120.155,
        notes: '默认不发送的备注',
        sortOrder: 1,
        ticketIds: [],
        title: '西湖',
        tripId: 'trip-ai-edit',
        updatedAt: now,
      },
      {
        createdAt: now,
        dayId: 'day_ai_edit_1',
        id: 'item_ai_edit_2',
        sortOrder: 2,
        ticketIds: ['ticket_1'],
        title: '演出票项目',
        tripId: 'trip-ai-edit',
        updatedAt: now,
      },
    ],
    ticketMetas: [{
      createdAt: now,
      fileName: 'ticket.pdf',
      fileType: 'pdf',
      id: 'ticket_1',
      itemId: 'item_ai_edit_2',
      mimeType: 'application/pdf',
      size: 1,
      tripId: 'trip-ai-edit',
      updatedAt: now,
    }],
  })

  await page.goto('/#/trip?tripId=trip-ai-edit&dayId=day_ai_edit_1', { waitUntil: 'domcontentloaded' })
  const panel = page.getByTestId('ai-trip-edit-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('AI 修改建议')
  await expect(panel).toContainText('当前仍不会自动查询网页')
  await expect(panel.getByRole('button', { name: '生成修改方案' })).toBeDisabled()
  await expectNoHorizontalOverflow(page)

  const beforeCounts = await readAiEditBoundaryCounts(page)
  await panel.getByTestId('ai-trip-edit-command').fill('第二天太满了，帮我放松一点')
  await panel.getByRole('button', { name: '生成修改方案' }).click()
  const sendDialog = page.getByTestId('ai-trip-edit-send-confirm-dialog')
  await expect(sendDialog).toContainText('不会直接修改旅行')
  expect(editRequests).toBe(0)
  await sendDialog.getByRole('button', { name: '暂不发送' }).click()
  expect(editRequests).toBe(0)
  expect(await readItemTitle(page, 'item_ai_edit_1')).toBe('西湖')

  await panel.getByRole('button', { name: '生成修改方案' }).click()
  await page.getByTestId('ai-trip-edit-send-confirm-dialog').getByRole('button', { name: '确认发送' }).click()
  await expect(panel.getByTestId('ai-trip-edit-preview')).toContainText('西湖深度散步')
  expect(editRequests).toBe(1)
  expect(travelSearchRequests).toBe(0)
  expect(await readItemTitle(page, 'item_ai_edit_1')).toBe('西湖')
  expect(await readAiEditBoundaryCounts(page)).toEqual(beforeCounts)

  await writeItemTitle(page, 'item_ai_edit_1', '西湖手动调整')
  await panel.getByRole('button', { name: '应用修改' }).click()
  await page.getByTestId('ai-trip-edit-apply-confirm-dialog').getByRole('button', { name: '确认应用' }).click()
  await expect(panel.getByTestId('ai-trip-edit-error')).toContainText('本地行程已变化，请重新生成 AI 修改方案。')
  expect(await readItemTitle(page, 'item_ai_edit_1')).toBe('西湖手动调整')

  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(panel).toBeVisible()
  await panel.getByTestId('ai-trip-edit-command').fill('第二天太满了，帮我放松一点')
  await panel.getByRole('button', { name: '生成修改方案' }).click()
  await page.getByTestId('ai-trip-edit-send-confirm-dialog').getByRole('button', { name: '确认发送' }).click()
  await expect(panel.getByTestId('ai-trip-edit-preview')).toContainText('西湖深度散步')
  expect(editRequests).toBe(2)

  await panel.getByRole('button', { name: '应用修改' }).click()
  const applyDialog = page.getByTestId('ai-trip-edit-apply-confirm-dialog')
  await expect(applyDialog).toContainText('不会生成路线')
  await expect(applyDialog).toContainText('不会联网搜索或查询网页')
  await applyDialog.getByRole('button', { name: '确认应用' }).click()
  await expect.poll(() => readItemTitle(page, 'item_ai_edit_1')).toBe('西湖深度散步')
  const afterCounts = await readAiEditBoundaryCounts(page)
  expect(afterCounts.trips).toBe(beforeCounts.trips)
  expect(afterCounts.days).toBe(beforeCounts.days)
  expect(afterCounts.itineraryItems).toBe(beforeCounts.itineraryItems)
  expect(afterCounts.ticketMetas).toBe(beforeCounts.ticketMetas)
  expect(afterCounts.ticketBlobs).toBe(beforeCounts.ticketBlobs)
  expect(afterCounts.routeCaches).toBe(beforeCounts.routeCaches)
  expect(travelSearchRequests).toBe(0)
  expect(routePreviewRequests).toBe(0)
  expect(cloudRequests).toBe(0)
  expect(deepSeekRequests).toBe(0)
  await expectNoHorizontalOverflow(page)
})

test('Trip Home 智能整理此行程先确认再生成可勾选 diff 并批量应用', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockMapStyle(page)
  await clearTravelDatabase(page)
  await setRouteProxyConfig(page)
  let placeLookupRequests = 0
  let routeOrderRequests = 0
  let travelSearchRequests = 0
  let cloudRequests = 0
  let deepSeekRequests = 0

  await page.route('**/api/provider-proxy', async (route) => {
    const body = route.request().postDataJSON()
    if (body.operation === 'place_lookup') {
      placeLookupRequests += 1
      expect(body.maxResults).toBe(3)
      expect(JSON.stringify(body)).not.toContain('ticket_')
      expect(JSON.stringify(body)).not.toContain('ticketBlobs')
      expect(JSON.stringify(body)).not.toContain('routeCache')
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          operation: 'place_lookup',
          retrievedAt: '2026-06-02T01:02:03.000Z',
          source: 'mock',
          results: [
            {
              displayName: '西湖相似地点',
              formattedAddress: '杭州西湖相似地点',
              location: { lat: 30.2, lng: 120.1 },
              placeId: 'place-weak',
              provider: 'google_places',
              retrievedAt: '2026-06-02T01:02:03.000Z',
            },
            {
              displayName: '西湖风景名胜区',
              formattedAddress: '杭州西湖风景名胜区',
              googleMapsUri: 'https://maps.google.com/west-lake',
              location: { lat: 30.25, lng: 120.14 },
              placeId: 'place-west-lake',
              provider: 'google_places',
              retrievedAt: '2026-06-02T01:02:03.000Z',
            },
          ],
        }),
        contentType: 'application/json',
      })
      return
    }
    if (body.operation === 'route_order_suggestion') {
      routeOrderRequests += 1
      expect(body.items.find((item: { id: string }) => item.id === 'smart_item_1')?.coordinate).toMatchObject({ lat: 30.25, lng: 120.14 })
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          operation: 'route_order_suggestion',
          provider: 'mock',
          requestId: body.requestId,
          retrievedAt: '2026-06-02T01:02:03.000Z',
          suggestedItemIds: ['smart_item_2', 'smart_item_1'],
          summary: '已生成模拟路线顺序建议。',
          unchangedItemIds: [],
          warnings: [],
        }),
        contentType: 'application/json',
      })
      return
    }
    if (body.operation === 'travel_search') {
      travelSearchRequests += 1
      expect(JSON.stringify(body)).not.toContain('ticket_')
      expect(JSON.stringify(body)).not.toContain('ticketBlobs')
      expect(JSON.stringify(body)).not.toContain('routeCache')
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          operation: 'travel_search',
          query: body.query,
          retrievedAt: '2026-06-02T01:02:03.000Z',
          source: 'mock',
          results: [
            {
              confidence: 'low',
              displayUrl: 'unknown.example/smart-trip',
              domain: 'unknown.example',
              retrievedAt: '2026-06-02T01:02:03.000Z',
              snippet: '低质量搬运摘要。',
              sourceType: 'unknown',
              title: '智能整理搬运来源',
              url: 'https://unknown.example/smart-trip',
            },
            {
              confidence: 'high',
              displayUrl: 'travel.example/smart-trip',
              domain: 'travel.example',
              retrievedAt: '2026-06-02T01:02:03.000Z',
              snippet: '模拟来源摘要：开放时间和票价请以官方信息为准。',
              sourceType: 'official',
              title: '智能整理模拟来源',
              url: 'https://travel.example/smart-trip',
            },
          ],
        }),
        contentType: 'application/json',
      })
      return
    }
    if (body.operation === 'route_preview') {
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          operation: 'route_preview',
          provider: 'openrouteservice',
          route: {
            lineStrings: [],
            segments: [],
            status: 'failed',
            warnings: ['route preview ignored in smart workspace test'],
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
  await page.route('https://api.deepseek.com/**', (route) => {
    deepSeekRequests += 1
    return route.abort()
  })
  await page.route('**/*.supabase.co/**', (route) => {
    cloudRequests += 1
    return route.abort()
  })

  const now = Date.now()
  await seedTravelRecords(page, {
    trips: [{
      createdAt: now,
      destination: '杭州',
      endDate: '2026-07-10',
      id: 'trip-smart-workspace',
      notes: '原旅行备注',
      startDate: '2026-07-10',
      title: '杭州智能整理测试',
      updatedAt: now,
    }],
    days: [
      { date: '2026-07-10', id: 'smart_day_1', sortOrder: 1, title: '第一天', tripId: 'trip-smart-workspace' },
    ],
    itineraryItems: [
      {
        createdAt: now,
        dayId: 'smart_day_1',
        id: 'smart_item_1',
        sortOrder: 1,
        ticketIds: [],
        title: '西湖',
        tripId: 'trip-smart-workspace',
        updatedAt: now,
      },
      {
        createdAt: now,
        dayId: 'smart_day_1',
        id: 'smart_item_2',
        lat: 30.24,
        lng: 120.16,
        sortOrder: 2,
        ticketIds: [],
        title: '灵隐寺',
        tripId: 'trip-smart-workspace',
        updatedAt: now,
      },
    ],
  })

  await page.goto('/#/trip?tripId=trip-smart-workspace&dayId=smart_day_1', { waitUntil: 'domcontentloaded' })
  const panel = page.getByTestId('smart-trip-workspace-panel')
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: '智能整理此行程' }).click()
  const sendDialog = page.getByTestId('smart-trip-workspace-send-confirm-dialog')
  await expect(sendDialog).toContainText('预计最多')
  await expect(sendDialog).toContainText('不会直接写入旅行')
  expect(placeLookupRequests).toBe(0)
  expect(routeOrderRequests).toBe(0)
  expect(travelSearchRequests).toBe(0)
  await sendDialog.getByRole('button', { name: '暂不整理' }).click()
  expect(placeLookupRequests).toBe(0)
  expect(routeOrderRequests).toBe(0)
  expect(travelSearchRequests).toBe(0)

  await panel.getByRole('button', { name: '智能整理此行程' }).click()
  await page.getByTestId('smart-trip-workspace-send-confirm-dialog').getByRole('button', { name: '确认整理' }).click()
  await expect(panel.getByTestId('smart-trip-workspace-preview')).toContainText('地点校准：西湖')
  await expect(panel.getByTestId('smart-trip-workspace-preview')).toContainText('路线顺序：第一天')
  await expect(panel.getByTestId('smart-trip-workspace-preview')).toContainText('景点提示：西湖')
  await expect(panel.getByTestId('smart-trip-workspace-preview')).toContainText('每日提示')
  await expect(panel.getByTestId('smart-trip-workspace-preview')).toContainText('官网')
  await expect(panel.getByTestId('smart-trip-workspace-preview')).toContainText('来源时间：2026-06-02')
  await expect(panel.getByTestId('smart-trip-workspace-preview')).toContainText('可信度：高')
  await expect(panel.getByTestId('smart-trip-workspace-preview')).toContainText('建议理由')
  await expect(panel.getByTestId('smart-trip-workspace-category-controls')).toContainText('地点校准')
  await expect(panel.getByTestId('smart-trip-workspace-category-controls')).toContainText('景点提示')
  await panel.getByTestId('smart-trip-workspace-category-clear-place_calibration').click()
  await expect(panel.getByTestId('smart-trip-workspace-category-controls')).toContainText(/地点校准\s*0\/1/)
  await panel.getByTestId('smart-trip-workspace-category-select-place_calibration').click()
  await expect(panel.getByTestId('smart-trip-workspace-category-controls')).toContainText(/地点校准\s*1\/1/)
  expect(placeLookupRequests).toBe(1)
  expect(routeOrderRequests).toBe(1)
  expect(travelSearchRequests).toBe(2)
  expect(await readDayItemOrder(page, 'smart_day_1')).toEqual(['smart_item_1', 'smart_item_2'])

  await panel.getByRole('button', { name: '批量应用' }).click()
  const applyDialog = page.getByTestId('smart-trip-workspace-apply-confirm-dialog')
  await expect(applyDialog).toContainText('不会创建票据')
  await expect(applyDialog).toContainText('登录状态下会自动同步')
  await expect(applyDialog).toContainText('不会清除路线缓存')
  await applyDialog.getByRole('button', { name: '确认应用' }).click()
  await expect.poll(() => readDayItemOrder(page, 'smart_day_1')).toEqual(['smart_item_2', 'smart_item_1'])
  const smartItem = await readItineraryItem(page, 'smart_item_1')
  expect(smartItem.locationName).toBe('西湖风景名胜区')
  expect(smartItem.notes).toContain('模拟来源摘要')
  expect(await readTripNotes(page, 'trip-smart-workspace')).toContain('智能整理每日提示')
  expect(cloudRequests).toBe(0)
  expect(deepSeekRequests).toBe(0)
  await expectNoHorizontalOverflow(page)
})

test('Trip Home 智能整理分阶段失败后可单独重新生成路线顺序', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockMapStyle(page)
  await clearTravelDatabase(page)
  await setRouteProxyConfig(page)
  let placeLookupRequests = 0
  let routeOrderRequests = 0
  let travelSearchRequests = 0
  let cloudRequests = 0
  let deepSeekRequests = 0

  await page.route('**/api/provider-proxy', async (route) => {
    const body = route.request().postDataJSON()
    if (body.operation === 'place_lookup') {
      placeLookupRequests += 1
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          operation: 'place_lookup',
          retrievedAt: '2026-06-02T01:02:03.000Z',
          source: 'mock',
          results: [
            {
              displayName: '西湖风景名胜区',
              formattedAddress: '杭州西湖风景名胜区',
              googleMapsUri: 'https://maps.google.com/west-lake',
              location: { lat: 30.25, lng: 120.14 },
              placeId: 'place-west-lake',
              provider: 'google_places',
              retrievedAt: '2026-06-02T01:02:03.000Z',
            },
          ],
        }),
        contentType: 'application/json',
      })
      return
    }
    if (body.operation === 'route_order_suggestion') {
      routeOrderRequests += 1
      expect(body.items.find((item: { id: string }) => item.id === 'smart_recover_item_1')?.coordinate).toMatchObject({ lat: 30.25, lng: 120.14 })
      if (routeOrderRequests === 1) {
        await route.fulfill({
          body: JSON.stringify({
            code: 'provider_unavailable',
            ok: false,
            operation: 'route_order_suggestion',
          }),
          contentType: 'application/json',
          status: 503,
        })
        return
      }
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          operation: 'route_order_suggestion',
          provider: 'mock',
          requestId: body.requestId,
          retrievedAt: '2026-06-02T01:02:03.000Z',
          suggestedItemIds: ['smart_recover_item_2', 'smart_recover_item_1'],
          summary: '已重新生成路线顺序建议。',
          unchangedItemIds: [],
          warnings: [],
        }),
        contentType: 'application/json',
      })
      return
    }
    if (body.operation === 'travel_search') {
      travelSearchRequests += 1
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          operation: 'travel_search',
          query: body.query,
          retrievedAt: '2026-06-02T01:02:03.000Z',
          source: 'mock',
          results: [
            {
              confidence: 'high',
              displayUrl: 'travel.example/smart-recover',
              domain: 'travel.example',
              retrievedAt: '2026-06-02T01:02:03.000Z',
              snippet: '模拟来源摘要：保留其他阶段建议。',
              sourceType: 'official',
              title: '智能整理恢复模拟来源',
              url: 'https://travel.example/smart-recover',
            },
          ],
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
  await page.route('https://api.deepseek.com/**', (route) => {
    deepSeekRequests += 1
    return route.abort()
  })
  await page.route('**/*.supabase.co/**', (route) => {
    cloudRequests += 1
    return route.abort()
  })

  const now = Date.now()
  await seedTravelRecords(page, {
    trips: [{
      createdAt: now,
      destination: '杭州',
      endDate: '2026-07-10',
      id: 'trip-smart-recover',
      notes: '原旅行备注',
      startDate: '2026-07-10',
      title: '杭州智能整理恢复测试',
      updatedAt: now,
    }],
    days: [
      { date: '2026-07-10', id: 'smart_recover_day_1', sortOrder: 1, title: '第一天', tripId: 'trip-smart-recover' },
    ],
    itineraryItems: [
      {
        createdAt: now,
        dayId: 'smart_recover_day_1',
        id: 'smart_recover_item_1',
        sortOrder: 1,
        ticketIds: [],
        title: '西湖',
        tripId: 'trip-smart-recover',
        updatedAt: now,
      },
      {
        createdAt: now,
        dayId: 'smart_recover_day_1',
        id: 'smart_recover_item_2',
        lat: 30.24,
        lng: 120.16,
        sortOrder: 2,
        ticketIds: [],
        title: '灵隐寺',
        tripId: 'trip-smart-recover',
        updatedAt: now,
      },
    ],
  })

  await page.goto('/#/trip?tripId=trip-smart-recover&dayId=smart_recover_day_1', { waitUntil: 'domcontentloaded' })
  const panel = page.getByTestId('smart-trip-workspace-panel')
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: '智能整理此行程' }).click()
  await page.getByTestId('smart-trip-workspace-send-confirm-dialog').getByRole('button', { name: '确认整理' }).click()

  const preview = panel.getByTestId('smart-trip-workspace-preview')
  await expect(preview).toContainText('地点校准：西湖')
  await expect(preview).toContainText('景点提示：西湖')
  await expect(preview).toContainText('每日提示')
  await expect(preview).not.toContainText('路线顺序：第一天')
  await expect(panel.getByTestId('smart-trip-workspace-stage-status-route_order')).toContainText('失败')
  await expect(panel.getByTestId('smart-trip-workspace-warnings')).toContainText('路线顺序建议失败')
  expect(placeLookupRequests).toBe(1)
  expect(routeOrderRequests).toBe(1)
  expect(travelSearchRequests).toBe(2)

  await panel.getByTestId('smart-trip-workspace-category-regenerate-route_order').click()
  const stageDialog = page.getByTestId('smart-trip-workspace-stage-confirm-dialog')
  await expect(stageDialog).toContainText('重新生成路线顺序预览')
  await expect(stageDialog).toContainText('确认前不会发送请求')
  expect(routeOrderRequests).toBe(1)
  await stageDialog.getByRole('button', { name: '确认重新生成' }).click()

  await expect(preview).toContainText('路线顺序：第一天')
  await expect(panel.getByTestId('smart-trip-workspace-stage-status-route_order')).toContainText('已完成')
  expect(routeOrderRequests).toBe(2)
  expect(placeLookupRequests).toBe(1)
  expect(travelSearchRequests).toBe(2)
  expect(await readDayItemOrder(page, 'smart_recover_day_1')).toEqual(['smart_recover_item_1', 'smart_recover_item_2'])
  expect(cloudRequests).toBe(0)
  expect(deepSeekRequests).toBe(0)
  await expectNoHorizontalOverflow(page)
})

test('Trip Home 出行前检查先预览再批量修复低风险项', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    const fixedNow = new Date(2026, 5, 5, 10, 0, 0).valueOf()
    const RealDate = Date
    class MockDate extends RealDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) {
          super(fixedNow)
        } else {
          super(args[0] as string | number | Date)
        }
      }

      static now() {
        return fixedNow
      }
    }
    Object.setPrototypeOf(MockDate, RealDate)
    window.Date = MockDate as DateConstructor
  })
  await mockMapStyle(page)
  await clearTravelDatabase(page)
  await setRouteProxyConfig(page)
  await forceSupabaseUnconfigured(page)

  let routePreviewRequests = 0
  let placeLookupRequests = 0
  let placeDetailsRequests = 0
  let travelSearchRequests = 0
  let contentEnrichmentRequests = 0
  let dailyTipRequests = 0
  let cloudRequests = 0
  let directAiRequests = 0

  await page.route('**/api/provider-proxy', async (route) => {
    const body = route.request().postDataJSON()
    if (body.operation === 'route_preview') {
      routePreviewRequests += 1
      const coords = body.coordinates ?? [[120.16, 30.25], [121.55, 31.2]]
      const segments = (body.segments ?? []).map((segment: Record<string, number>, index: number) => ({
        coordinates: [coords[segment.fromCoordinateIndex] ?? coords[0], coords[segment.toCoordinateIndex] ?? coords[1]],
        distanceMeters: 1500,
        durationSeconds: 900,
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
            lineStrings: segments.map((segment: { coordinates: unknown }) => segment.coordinates),
            segments,
            status: 'road',
            warnings: [],
          },
        }),
        contentType: 'application/json',
      })
      return
    }
    if (body.operation === 'place_lookup') {
      placeLookupRequests += 1
      expect(JSON.stringify(body)).not.toContain('ticketIds')
      expect(JSON.stringify(body)).not.toContain('ticketBlobs')
      expect(JSON.stringify(body)).not.toContain('syncOutbox')
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          operation: 'place_lookup',
          retrievedAt: '2026-06-05T02:00:00.000Z',
          results: [{
            displayName: body.query.includes('绍兴') ? '绍兴古镇' : '西湖风景名胜区',
            formattedAddress: body.query.includes('绍兴') ? '绍兴古镇' : '杭州西湖',
            location: body.query.includes('绍兴') ? { lat: 31.2, lng: 121.55 } : { lat: 30.25, lng: 120.16 },
            placeId: body.query.includes('绍兴') ? 'place-shaoxing' : 'place-west-lake',
            provider: 'google_places',
            retrievedAt: '2026-06-05T02:00:00.000Z',
          }],
          source: 'mock',
        }),
        contentType: 'application/json',
      })
      return
    }
    if (body.operation === 'place_details') {
      placeDetailsRequests += 1
      await route.fulfill({
        body: JSON.stringify({
          details: {
            displayName: body.placeId === 'place-shaoxing' ? '绍兴古镇' : '西湖风景名胜区',
            editorialSummary: '模拟地点简介。',
            formattedAddress: body.placeId === 'place-shaoxing' ? '绍兴古镇' : '杭州西湖',
            location: body.placeId === 'place-shaoxing' ? { lat: 31.2, lng: 121.55 } : { lat: 30.25, lng: 120.16 },
            placeId: body.placeId,
            provider: 'google_places',
            regularOpeningHours: { weekdayDescriptions: ['周一至周日 09:00-18:00'] },
            retrievedAt: '2026-06-05T02:00:00.000Z',
            websiteUri: 'https://travel.example/place',
          },
          ok: true,
          operation: 'place_details',
          retrievedAt: '2026-06-05T02:00:00.000Z',
          source: 'mock',
        }),
        contentType: 'application/json',
      })
      return
    }
    if (body.operation === 'travel_search') {
      travelSearchRequests += 1
      expect(JSON.stringify(body)).not.toContain('ticketBlobs')
      expect(JSON.stringify(body)).not.toContain('syncOutbox')
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          operation: 'travel_search',
          query: body.query,
          results: [{
            confidence: 'high',
            displayUrl: 'travel.example/readiness',
            domain: 'travel.example',
            retrievedAt: '2026-06-05T02:00:00.000Z',
            snippet: '模拟来源：开放时间、票价和出行提示。',
            sourceType: body.searchType === 'ticket_price' ? 'ticketing' : 'official',
            title: '出行前检查模拟来源',
            url: 'https://travel.example/readiness',
          }],
          retrievedAt: '2026-06-05T02:00:00.000Z',
          source: 'mock',
        }),
        contentType: 'application/json',
      })
      return
    }
    if (body.operation === 'trip_content_enrichment') {
      contentEnrichmentRequests += 1
      expect(JSON.stringify(body)).not.toContain('ticketIds')
      expect(JSON.stringify(body)).not.toContain('ticketBlobs')
      expect(JSON.stringify(body)).not.toContain('routeCache')
      await route.fulfill({
        body: JSON.stringify({
          items: body.items.map((item: { itemId: string; sources: Array<{ id: string }> }) => ({
            introduction: { sourceIds: [item.sources[0]?.id].filter(Boolean), text: '模拟地点简介。' },
            itemId: item.itemId,
            openingHours: { sourceIds: [item.sources[0]?.id].filter(Boolean), text: '09:00-18:00。' },
            recommendedStay: { basis: 'ai_estimate', durationMinutes: 90, reason: '模拟估算。', text: '建议停留约 1.5 小时' },
            ticketPrice: { kind: 'admission', sourceIds: [item.sources[0]?.id].filter(Boolean), text: '以现场公告为准。' },
          })),
          ok: true,
          operation: 'trip_content_enrichment',
          source: 'mock',
        }),
        contentType: 'application/json',
      })
      return
    }
    if (body.operation === 'trip_daily_tip') {
      dailyTipRequests += 1
      expect(JSON.stringify(body)).not.toContain('ticketBlobs')
      expect(JSON.stringify(body)).not.toContain('routeCache')
      expect(JSON.stringify(body)).not.toContain('syncOutbox')
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          operation: 'trip_daily_tip',
          sections: [
            { key: 'opening_hours', sourceIds: [body.sources[0]?.id].filter(Boolean), text: '出发前核对开放时间。', title: '开放时间' },
            { key: 'ticket_price', sourceIds: [body.sources[0]?.id].filter(Boolean), text: '票价以现场公告为准。', title: '票价' },
          ],
          source: 'mock',
          sourceIds: [body.sources[0]?.id].filter(Boolean),
          summary: '出发前优先核对路线、票据和同步状态。',
          warnings: [],
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
  await page.route('**/*.supabase.co/**', (route) => {
    cloudRequests += 1
    return route.abort()
  })
  await page.route('https://api.deepseek.com/**', (route) => {
    directAiRequests += 1
    return route.abort()
  })

  const now = Date.now()
  const trip = {
    createdAt: now,
    destination: '杭州',
    endDate: '2026-06-11',
    id: 'trip-readiness',
    notes: '原始旅行备注',
    startDate: '2026-06-10',
    title: '杭州出行前检查',
    updatedAt: now,
  }
  const pendingTicket = {
    createdAt: now,
    fileName: '高铁票.pdf',
    fileType: 'pdf',
    id: 'readiness_ticket_pending',
    mimeType: 'application/pdf',
    size: 128,
    storageMode: 'copy',
    ticketCategory: 'train_ticket',
    title: '高铁票',
    tripId: trip.id,
    updatedAt: now,
  }
  const errorTicket = {
    createdAt: now,
    fileName: '酒店订单.pdf',
    fileType: 'pdf',
    id: 'readiness_ticket_error',
    mimeType: 'application/pdf',
    size: 128,
    storageMode: 'copy',
    ticketCategory: 'hotel_booking',
    title: '酒店订单',
    tripId: trip.id,
    updatedAt: now,
  }
  await seedTravelRecords(page, {
    trips: [trip],
    days: [
      { date: '2026-06-10', id: 'readiness_day_1', sortOrder: 1, title: '第一天', tripId: trip.id },
    ],
    itineraryItems: [
      {
        createdAt: now,
        dayId: 'readiness_day_1',
        id: 'readiness_item_missing_coord',
        locationName: '雷峰塔',
        sortOrder: 1,
        ticketIds: [],
        title: '雷峰塔门票',
        tripId: trip.id,
        updatedAt: now,
      },
      {
        createdAt: now,
        dayId: 'readiness_day_1',
        endTime: '09:30',
        id: 'readiness_item_west_lake',
        lat: 30.25,
        lng: 120.16,
        locationName: '西湖',
        previousTransportMode: 'walk',
        sortOrder: 2,
        startTime: '09:00',
        ticketIds: [],
        title: '西湖',
        tripId: trip.id,
        updatedAt: now,
      },
      {
        createdAt: now,
        dayId: 'readiness_day_1',
        id: 'readiness_item_far',
        lat: 31.2,
        lng: 121.55,
        locationName: '绍兴古镇',
        previousTransportMode: 'car',
        sortOrder: 3,
        startTime: '09:40',
        ticketIds: [],
        title: '绍兴古镇',
        tripId: trip.id,
        updatedAt: now,
      },
    ],
    ticketMetas: [pendingTicket, errorTicket],
  })
  await seedReadinessSyncState(page, { errorTicket, pendingTicket, trip })

  await page.goto('/#/trip?tripId=trip-readiness&dayId=readiness_day_1', { waitUntil: 'domcontentloaded' })
  const panel = page.getByTestId('trip-readiness-center-panel')
  await expect(panel).toBeVisible()
  await expect(panel.getByTestId('trip-readiness-status')).toContainText('高风险')
  await expect(panel).toContainText('缺少地点坐标')
  await expect(panel).toContainText('缺少路线预览')
  await expect(panel).toContainText('可能缺少票据')
  await expect(panel).toContainText('票据等待同步')
  await expect(panel).toContainText('票据同步失败')
  await expect(panel).toContainText('缺少出行信息')
  await expect(panel).toContainText('路线距离高风险')
  await expect(panel).toContainText(/行程间隔偏短|缺少交通耗时/)
  await expect(panel).toContainText('缺少每日旅行提示')
  await expect(panel).toContainText('云同步存在风险')
  expect(await panel.getByTestId('trip-readiness-issue').evaluateAll((rows) =>
    rows.map((row) => row.getAttribute('data-issue-type')),
  )).toEqual(expect.arrayContaining([
    'cloud_sync_pending',
    'daily_tip_missing',
    'missing_content',
    'missing_coordinate',
    'missing_route',
    'missing_ticket',
    'route_long_distance',
    'ticket_unsynced',
    'time_conflict',
  ]))
  expect(routePreviewRequests).toBe(0)
  expect(placeLookupRequests).toBe(0)
  expect(placeDetailsRequests).toBe(0)
  expect(travelSearchRequests).toBe(0)
  expect(contentEnrichmentRequests).toBe(0)
  expect(dailyTipRequests).toBe(0)
  expect(cloudRequests).toBe(0)
  expect(directAiRequests).toBe(0)

  await panel.getByTestId('trip-readiness-batch-button').click()
  const confirmDialog = page.getByTestId('trip-readiness-repair-confirm-dialog')
  await expect(confirmDialog).toContainText('确认前不会调用')
  await confirmDialog.getByRole('button', { name: '暂不处理' }).click()
  expect(routePreviewRequests).toBe(0)
  expect(placeLookupRequests).toBe(0)
  expect(contentEnrichmentRequests).toBe(0)
  expect(dailyTipRequests).toBe(0)
  expect(await readReadinessDbState(page, trip.id)).toMatchObject({
    routeCacheCount: 0,
    notes: '原始旅行备注',
  })

  await panel.getByTestId('trip-readiness-batch-button').click()
  await page.getByTestId('trip-readiness-repair-confirm-dialog').getByRole('button', { name: '确认处理' }).click()
  await expect(panel.getByTestId('trip-readiness-repair-result')).toContainText('已处理 1 天路线缓存')
  await expect(panel.getByTestId('trip-readiness-content-preview')).toContainText('确认后才会写入')
  await expect(panel.getByTestId('trip-readiness-daily-tip-preview')).toContainText('确认后写入旅行备注')

  expect(routePreviewRequests).toBe(1)
  expect(placeLookupRequests).toBeGreaterThan(0)
  expect(placeDetailsRequests).toBeGreaterThan(0)
  expect(travelSearchRequests).toBeGreaterThan(0)
  expect(contentEnrichmentRequests).toBe(1)
  expect(dailyTipRequests).toBe(1)
  expect(cloudRequests).toBe(0)
  expect(directAiRequests).toBe(0)

  const state = await readReadinessDbState(page, trip.id)
  expect(state.routeCacheCount).toBe(1)
  expect(state.pendingTicketState?.uploadStatus).toBe('pending')
  expect(state.pendingTicketState?.lastError).toBeUndefined()
  expect(state.errorTicketState).toMatchObject({ uploadStatus: 'error' })
  expect(state.notes).toBe('原始旅行备注')
  expect(state.westLakeContentEnrichment).toBeUndefined()
  expect(state.pendingOutboxTypes).toContain('trip')
  await expectNoHorizontalOverflow(page)
})

test('Trip Home 内容补充使用 Places 优先来源并在确认后写入结构化字段', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockMapStyle(page)
  await clearTravelDatabase(page)
  await setRouteProxyConfig(page)
  let placeLookupRequests = 0
  let placeDetailsRequests = 0
  let travelSearchRequests = 0
  let contentEnrichmentRequests = 0
  let routeRequests = 0
  let cloudRequests = 0
  let directAiRequests = 0

  await page.route('**/api/provider-proxy', async (route) => {
    const body = route.request().postDataJSON()
    if (body.operation === 'place_lookup') {
      placeLookupRequests += 1
      expect(JSON.stringify(body)).not.toContain('ticketIds')
      expect(JSON.stringify(body)).not.toContain('routeCache')
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          operation: 'place_lookup',
          retrievedAt: '2026-06-01T00:00:00.000Z',
          source: 'mock',
          results: [{
            displayName: '西湖风景名胜区',
            formattedAddress: '杭州西湖',
            googleMapsUri: 'https://maps.google.com/west-lake',
            location: { lat: 30.25, lng: 120.14 },
            placeId: 'place-west-lake',
            provider: 'google_places',
            retrievedAt: '2026-06-01T00:00:00.000Z',
          }],
        }),
        contentType: 'application/json',
      })
      return
    }
    if (body.operation === 'place_details') {
      placeDetailsRequests += 1
      expect(body.placeId).toBe('place-west-lake')
      expect(JSON.stringify(body)).not.toContain('notes')
      await route.fulfill({
        body: JSON.stringify({
          details: {
            displayName: '西湖风景名胜区',
            editorialSummary: '西湖是杭州代表性湖泊景观。',
            formattedAddress: '杭州西湖',
            googleMapsUri: 'https://maps.google.com/west-lake',
            location: { lat: 30.25, lng: 120.14 },
            placeId: 'place-west-lake',
            provider: 'google_places',
            regularOpeningHours: { weekdayDescriptions: ['周一至周日 全天开放'] },
            retrievedAt: '2026-06-01T00:00:00.000Z',
            websiteUri: 'https://westlake.example',
          },
          ok: true,
          operation: 'place_details',
          retrievedAt: '2026-06-01T00:00:00.000Z',
          source: 'mock',
        }),
        contentType: 'application/json',
      })
      return
    }
    if (body.operation === 'travel_search') {
      travelSearchRequests += 1
      expect(body.searchType).toBe('ticket_price')
      expect(JSON.stringify(body)).not.toContain('ticketIds')
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          operation: 'travel_search',
          query: body.query,
          retrievedAt: '2026-06-01T00:00:00.000Z',
          source: 'mock',
          results: [{
            confidence: 'high',
            displayUrl: 'tickets.example/west-lake',
            domain: 'tickets.example',
            retrievedAt: '2026-06-01T00:00:00.000Z',
            snippet: '主景区免费，部分项目另行收费。',
            sourceType: 'ticketing',
            title: '西湖票价来源',
            url: 'https://tickets.example/west-lake',
          }],
        }),
        contentType: 'application/json',
      })
      return
    }
    if (body.operation === 'trip_content_enrichment') {
      contentEnrichmentRequests += 1
      expect(body.items).toHaveLength(1)
      expect(JSON.stringify(body)).not.toContain('ticketIds')
      expect(JSON.stringify(body)).not.toContain('routeCache')
      expect(JSON.stringify(body)).not.toContain('notes')
      const item = body.items[0]
      const placeSource = item.sources.find((source: { sourceType: string }) => source.sourceType === 'google_places')
      const ticketSource = item.sources.find((source: { sourceType: string }) => source.sourceType === 'ticketing')
      await route.fulfill({
        body: JSON.stringify({
          items: [{
            introduction: { sourceIds: [placeSource.id], text: '西湖是杭州代表性湖泊景观。' },
            itemId: item.itemId,
            openingHours: { sourceIds: [placeSource.id], text: '周一至周日全天开放。' },
            recommendedStay: { basis: 'ai_estimate', durationMinutes: 120, reason: '湖区范围较大，适合慢游。', text: '建议停留约 2 小时' },
            ticketPrice: { kind: 'admission', sourceIds: [ticketSource.id], text: '主景区免费，部分项目另行收费。' },
          }],
          ok: true,
          operation: 'trip_content_enrichment',
          source: 'mock',
        }),
        contentType: 'application/json',
      })
      return
    }
    if (body.operation === 'route_preview' || body.operation === 'route_order_suggestion') {
      routeRequests += 1
    }
    await route.fulfill({
      body: JSON.stringify({ code: 'unsupported', message: 'unexpected operation', ok: false }),
      contentType: 'application/json',
      status: 501,
    })
  })
  await page.route('https://api.deepseek.com/**', (route) => {
    directAiRequests += 1
    return route.abort()
  })
  await page.route('**/*.supabase.co/**', (route) => {
    cloudRequests += 1
    return route.abort()
  })

  const now = Date.now()
  await seedTravelRecords(page, {
    trips: [{
      createdAt: now,
      destination: '杭州',
      endDate: '2026-07-10',
      id: 'trip-content-enrichment',
      startDate: '2026-07-10',
      title: '杭州内容补充测试',
      updatedAt: now,
    }],
    days: [
      { date: '2026-07-10', id: 'content_day_1', sortOrder: 1, title: '第一天', tripId: 'trip-content-enrichment' },
    ],
    itineraryItems: [
      {
        createdAt: now,
        dayId: 'content_day_1',
        id: 'content_item_1',
        locationName: '西湖',
        sortOrder: 1,
        ticketIds: [],
        title: '西湖',
        tripId: 'trip-content-enrichment',
        updatedAt: now,
      },
    ],
  })

  await page.goto('/#/trip?tripId=trip-content-enrichment&dayId=content_day_1', { waitUntil: 'domcontentloaded' })
  const panel = page.getByTestId('trip-content-enrichment-panel')
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: '补充景点内容' }).click()
  const confirmDialog = page.getByTestId('trip-content-enrichment-confirm-dialog')
  await expect(confirmDialog).toContainText('预计最多')
  expect(placeLookupRequests).toBe(0)
  expect(placeDetailsRequests).toBe(0)
  expect(travelSearchRequests).toBe(0)
  expect(contentEnrichmentRequests).toBe(0)
  await confirmDialog.getByRole('button', { name: '暂不补充' }).click()
  expect(placeLookupRequests).toBe(0)

  await panel.getByRole('button', { name: '补充景点内容' }).click()
  await page.getByTestId('trip-content-enrichment-confirm-dialog').getByRole('button', { name: '确认补充' }).click()
  await expect(panel.getByTestId('trip-content-enrichment-preview')).toContainText('西湖是杭州代表性湖泊景观')
  await expect(panel.getByTestId('trip-content-enrichment-preview')).toContainText('Google Places')
  await expect(panel.getByTestId('trip-content-enrichment-preview')).toContainText('购票来源')
  await expect(panel.getByTestId('trip-content-enrichment-preview')).toContainText('AI 估算')
  expect(placeLookupRequests).toBe(1)
  expect(placeDetailsRequests).toBe(1)
  expect(travelSearchRequests).toBe(1)
  expect(contentEnrichmentRequests).toBe(1)
  expect((await readItineraryItem(page, 'content_item_1')).contentEnrichment).toBeUndefined()

  await panel.getByRole('button', { name: '应用内容' }).click()
  await page.getByTestId('trip-content-enrichment-apply-dialog').getByRole('button', { name: '暂不应用' }).click()
  expect((await readItineraryItem(page, 'content_item_1')).contentEnrichment).toBeUndefined()

  await panel.getByRole('button', { name: '应用内容' }).click()
  await page.getByTestId('trip-content-enrichment-apply-dialog').getByRole('button', { name: '确认应用' }).click()
  await expect.poll(async () => {
    const current = await readItineraryItem(page, 'content_item_1')
    return (current.contentEnrichment as { introduction?: { text?: string } } | undefined)?.introduction?.text ?? ''
  }).toContain('西湖')
  const updated = await readItineraryItem(page, 'content_item_1')
  expect((updated.contentEnrichment as { introduction?: { text?: string }; recommendedStay?: { basis?: string } }).introduction?.text).toContain('西湖')
  expect((updated.contentEnrichment as { recommendedStay?: { basis?: string } }).recommendedStay?.basis).toBe('ai_estimate')
  expect(routeRequests).toBe(0)
  expect(cloudRequests).toBe(0)
  expect(directAiRequests).toBe(0)
  await expectNoHorizontalOverflow(page)
})

test('Trip Home AI 修改建议搜索意图先确认并显示来源', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockMapStyle(page)
  await clearTravelDatabase(page)
  await setRouteProxyConfig(page)
  let editRequests = 0
  let travelSearchRequests = 0
  let routePreviewRequests = 0
  let cloudRequests = 0
  let deepSeekRequests = 0

  await page.route('**/api/provider-proxy', async (route) => {
    const body = route.request().postDataJSON()
    if (body.operation === 'travel_search') {
      travelSearchRequests += 1
      expect(editRequests).toBe(0)
      expect(body.searchType).toBe('opening_hours')
      expect(JSON.stringify(body)).not.toContain('ticket_1')
      expect(JSON.stringify(body)).not.toContain('ticketBlobs')
      expect(JSON.stringify(body)).not.toContain('routeCache')
      expect(JSON.stringify(body)).not.toContain('lat')
      expect(JSON.stringify(body)).not.toContain('lng')
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          operation: 'travel_search',
          query: body.query,
          retrievedAt: '2026-01-01T00:00:00.000Z',
          source: 'mock',
          results: [
            {
              confidence: 'medium',
              displayUrl: 'travel.example/search/west-lake-hours',
              domain: 'travel.example',
              retrievedAt: '2026-01-01T00:00:00.000Z',
              snippet: '模拟搜索片段：西湖开放时间。此结果仅用于测试。',
              sourceType: 'official',
              title: '西湖开放时间模拟来源',
              url: 'https://travel.example/search/west-lake-hours',
            },
          ],
          warnings: ['当前为模拟搜索结果，不代表实时网页信息。'],
        }),
        contentType: 'application/json',
      })
      return
    }
    if (body.operation === 'ai_trip_edit_plan') {
      editRequests += 1
      expect(travelSearchRequests).toBe(1)
      expect(body.searchResults.results[0]).toMatchObject({
        domain: 'travel.example',
        retrievedAt: '2026-01-01T00:00:00.000Z',
        title: '西湖开放时间模拟来源',
      })
      expect(JSON.stringify(body)).not.toContain('rawProviderBody')
      expect(JSON.stringify(body)).not.toContain('ticket_1')
      expect(JSON.stringify(body)).not.toContain('routeCache')
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          operation: 'ai_trip_edit_plan',
          patchPlan: {
            operations: [
              { itemId: 'item_ai_edit_1', reason: '参考搜索来源后，让标题更明确。', title: '西湖开放时间确认后散步', type: 'update_item_title' },
            ],
            summary: '根据搜索来源调整西湖安排标题。',
          },
          source: 'mock',
        }),
        contentType: 'application/json',
      })
      return
    }
    if (body.operation === 'route_preview') routePreviewRequests += 1
    await route.fulfill({
      body: JSON.stringify({ code: 'unsupported', message: 'unexpected operation', ok: false }),
      contentType: 'application/json',
      status: 501,
    })
  })
  await page.route('https://api.deepseek.com/**', (route) => {
    deepSeekRequests += 1
    return route.abort()
  })
  await page.route('**/*.supabase.co/**', (route) => {
    cloudRequests += 1
    return route.abort()
  })
  await page.evaluate(() => {
    window.localStorage.setItem('tripmap:e2e:supabase-unconfigured', '1')
  })
  await seedAiEditSearchTrip(page)

  await page.goto('/#/trip?tripId=trip-ai-edit-search&dayId=day_ai_edit_search_1', { waitUntil: 'domcontentloaded' })
  const panel = page.getByTestId('ai-trip-edit-panel')
  await expect(panel).toBeVisible()
  await panel.getByTestId('ai-trip-edit-command').fill('查一下西湖今天开门吗，然后把标题改清楚')
  await expect(panel.getByTestId('ai-trip-edit-search-intent-note')).toContainText('此请求可能需要联网搜索')
  await panel.getByRole('button', { name: '生成修改方案' }).click()
  const sendDialog = page.getByTestId('ai-trip-edit-send-confirm-dialog')
  await expect(sendDialog).toContainText('会先通过旅图服务查询一次')
  expect(travelSearchRequests).toBe(0)
  expect(editRequests).toBe(0)
  await sendDialog.getByRole('button', { name: '暂不发送' }).click()
  expect(travelSearchRequests).toBe(0)
  expect(editRequests).toBe(0)

  await panel.getByRole('button', { name: '生成修改方案' }).click()
  await page.getByTestId('ai-trip-edit-send-confirm-dialog').getByRole('button', { name: '确认发送' }).click()
  await expect(panel.getByTestId('ai-trip-edit-preview')).toContainText('西湖开放时间确认后散步')
  await expect(panel.getByTestId('ai-trip-edit-search-sources')).toContainText('搜索来源')
  await expect(panel.getByTestId('ai-trip-edit-search-sources')).toContainText('西湖开放时间模拟来源')
  await expect(panel.getByTestId('ai-trip-edit-search-sources')).toContainText('travel.example')
  await expect(panel.getByTestId('ai-trip-edit-search-sources')).toContainText('2026-01-01T00:00:00.000Z')
  expect(travelSearchRequests).toBe(1)
  expect(editRequests).toBe(1)
  expect(await readItemTitle(page, 'item_ai_edit_1')).toBe('西湖')

  await panel.getByRole('button', { name: '应用修改' }).click()
  await page.getByTestId('ai-trip-edit-apply-confirm-dialog').getByRole('button', { name: '暂不应用' }).click()
  expect(await readItemTitle(page, 'item_ai_edit_1')).toBe('西湖')
  expect(routePreviewRequests).toBe(0)
  expect(cloudRequests).toBe(0)
  expect(deepSeekRequests).toBe(0)
  await expectNoHorizontalOverflow(page)
})

test('Trip Home AI 修改建议搜索不可用时只显示未接入警告', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockMapStyle(page)
  await clearTravelDatabase(page)
  await setRouteProxyConfig(page)
  let editRequests = 0
  let travelSearchRequests = 0

  await page.route('**/api/provider-proxy', async (route) => {
    const body = route.request().postDataJSON()
    if (body.operation === 'travel_search') {
      travelSearchRequests += 1
      await route.fulfill({
        body: JSON.stringify({
          code: 'provider_unavailable',
          message: '搜索服务暂不可用。',
          ok: false,
          operation: 'travel_search',
        }),
        contentType: 'application/json',
        status: 503,
      })
      return
    }
    if (body.operation === 'ai_trip_edit_plan') {
      editRequests += 1
      expect(body.searchResults).toBeUndefined()
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          operation: 'ai_trip_edit_plan',
          patchPlan: {
            operations: [
              { itemId: 'item_ai_edit_1', reason: '未查询实时网页，仅按本地上下文调整标题。', title: '西湖本地散步', type: 'update_item_title' },
            ],
            summary: '按本地上下文生成修改建议。',
            warnings: ['联网搜索暂未接入，未查询实时信息。'],
          },
          source: 'mock',
          warnings: ['联网搜索暂未接入，未查询实时信息。'],
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
  await seedAiEditSearchTrip(page)

  await page.goto('/#/trip?tripId=trip-ai-edit-search&dayId=day_ai_edit_search_1', { waitUntil: 'domcontentloaded' })
  const panel = page.getByTestId('ai-trip-edit-panel')
  await panel.getByTestId('ai-trip-edit-command').fill('查询西湖最新开放时间，并把标题改清楚')
  await panel.getByRole('button', { name: '生成修改方案' }).click()
  await page.getByTestId('ai-trip-edit-send-confirm-dialog').getByRole('button', { name: '确认发送' }).click()
  await expect(panel.getByTestId('ai-trip-edit-preview')).toContainText('西湖本地散步')
  await expect(panel.getByTestId('ai-trip-edit-warnings')).toContainText('联网搜索暂未接入，未查询实时信息。')
  await expect(panel.getByTestId('ai-trip-edit-search-sources')).toHaveCount(0)
  expect(travelSearchRequests).toBe(1)
  expect(editRequests).toBe(1)
  await expectNoHorizontalOverflow(page)
})

async function seedAiEditSearchTrip(page: Page) {
  const now = Date.now()
  await seedTravelRecords(page, {
    trips: [{
      createdAt: now,
      destination: '杭州',
      endDate: '2026-07-11',
      id: 'trip-ai-edit-search',
      notes: '搜索测试备注不应发送',
      startDate: '2026-07-10',
      title: '杭州搜索测试',
      updatedAt: now,
    }],
    days: [
      { date: '2026-07-10', id: 'day_ai_edit_search_1', sortOrder: 1, title: '第一天', tripId: 'trip-ai-edit-search' },
    ],
    itineraryItems: [
      {
        address: '杭州市西湖区',
        createdAt: now,
        dayId: 'day_ai_edit_search_1',
        id: 'item_ai_edit_1',
        lat: 30.244,
        lng: 120.155,
        locationName: '西湖风景名胜区',
        notes: '默认不发送的备注',
        sortOrder: 1,
        ticketIds: ['ticket_1'],
        title: '西湖',
        tripId: 'trip-ai-edit-search',
        updatedAt: now,
      },
    ],
    ticketMetas: [{
      createdAt: now,
      fileName: 'ticket.pdf',
      fileType: 'pdf',
      id: 'ticket_1',
      itemId: 'item_ai_edit_1',
      mimeType: 'application/pdf',
      size: 1,
      tripId: 'trip-ai-edit-search',
      updatedAt: now,
    }],
  })
}

async function readItemTitle(page: import('@playwright/test').Page, itemId: string) {
  return page.evaluate(async (currentItemId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('TravelConsoleDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const tx = db.transaction(['itineraryItems'], 'readonly')
    const title = await new Promise<string | undefined>((resolve, reject) => {
      const request = tx.objectStore('itineraryItems').get(currentItemId)
      request.onsuccess = () => resolve(request.result?.title)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return title
  }, itemId)
}

async function readItineraryItem(page: import('@playwright/test').Page, itemId: string) {
  return page.evaluate(async (currentItemId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('TravelConsoleDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const item = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = db.transaction(['itineraryItems'], 'readonly').objectStore('itineraryItems').get(currentItemId)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return item
  }, itemId)
}

async function readTripNotes(page: import('@playwright/test').Page, tripId: string) {
  return page.evaluate(async (currentTripId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('TravelConsoleDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const notes = await new Promise<string | undefined>((resolve, reject) => {
      const request = db.transaction(['trips'], 'readonly').objectStore('trips').get(currentTripId)
      request.onsuccess = () => resolve(request.result?.notes)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return notes
  }, tripId)
}

async function seedReadinessSyncState(
  page: import('@playwright/test').Page,
  input: {
    errorTicket: { fileName: string; id: string; mimeType: string; size: number; tripId: string }
    pendingTicket: { fileName: string; id: string; mimeType: string; size: number; tripId: string }
    trip: { id: string; updatedAt: number }
  },
) {
  await page.evaluate(async ({ errorTicket, pendingTicket, trip }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('TravelConsoleDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['syncOutbox', 'objectSyncStates', 'ticketBlobSyncStates', 'ticketBlobs'], 'readwrite')
      transaction.oncomplete = () => {
        db.close()
        resolve()
      }
      transaction.onerror = () => reject(transaction.error ?? new Error('写入出行前检查同步状态失败'))
      transaction.onabort = () => reject(transaction.error ?? new Error('写入出行前检查同步状态中断'))
      const objectKey = `trip:${trip.id}`
      transaction.objectStore('syncOutbox').put({
        attempts: 0,
        createdAt: Date.now(),
        deviceId: 'e2e-device',
        id: 'sync_outbox_readiness',
        objectId: trip.id,
        objectKey,
        objectType: 'trip',
        operation: 'upsert',
        opId: 'op_readiness',
        payload: trip,
        status: 'pending',
        tripId: trip.id,
        updatedAt: Date.now(),
        updatedAtMs: trip.updatedAt,
      })
      transaction.objectStore('objectSyncStates').put({
        localUpdatedAtMs: trip.updatedAt,
        objectId: trip.id,
        objectKey,
        objectType: 'trip',
        tripId: trip.id,
      })
      transaction.objectStore('ticketBlobs').put({
        blob: new Blob(['pending ticket'], { type: pendingTicket.mimeType }),
        ticketId: pendingTicket.id,
      })
      transaction.objectStore('ticketBlobSyncStates').put({
        cacheStatus: 'cached',
        fileName: pendingTicket.fileName,
        lastError: '之前等待上传',
        mimeType: pendingTicket.mimeType,
        size: pendingTicket.size,
        ticketId: pendingTicket.id,
        tripId: pendingTicket.tripId,
        updatedAt: Date.now(),
        uploadStatus: 'pending',
      })
      transaction.objectStore('ticketBlobSyncStates').put({
        cacheStatus: 'cached',
        fileName: errorTicket.fileName,
        lastError: '模拟上传失败',
        mimeType: errorTicket.mimeType,
        size: errorTicket.size,
        ticketId: errorTicket.id,
        tripId: errorTicket.tripId,
        updatedAt: Date.now(),
        uploadStatus: 'error',
      })
    })
  }, input)
}

async function readReadinessDbState(page: import('@playwright/test').Page, tripId: string) {
  return page.evaluate(async (currentTripId) => {
    async function openDb(name: string) {
      return new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    }
    function get<T>(db: IDBDatabase, storeName: string, key: IDBValidKey) {
      return new Promise<T | undefined>((resolve, reject) => {
        const request = db.transaction([storeName], 'readonly').objectStore(storeName).get(key)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    }
    function getAll<T>(db: IDBDatabase, storeName: string) {
      return new Promise<T[]>((resolve, reject) => {
        const request = db.transaction([storeName], 'readonly').objectStore(storeName).getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    }
    function count(db: IDBDatabase, storeName: string) {
      return new Promise<number>((resolve, reject) => {
        if (!db.objectStoreNames.contains(storeName)) {
          resolve(0)
          return
        }
        const request = db.transaction([storeName], 'readonly').objectStore(storeName).count()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    }
    const travelDb = await openDb('TravelConsoleDB')
    const databases = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : []
    const hasRouteCacheDb = databases.some((database) => database.name === 'TripMapRouteCacheDB')
    const trip = await get<{ notes?: string }>(travelDb, 'trips', currentTripId)
    const westLake = await get<{ contentEnrichment?: unknown }>(travelDb, 'itineraryItems', 'readiness_item_west_lake')
    const ticketStates = await getAll<{ lastError?: string; ticketId: string; uploadStatus: string }>(travelDb, 'ticketBlobSyncStates')
    const outbox = await getAll<{ objectType: string; status: string }>(travelDb, 'syncOutbox')
    const routeDb = hasRouteCacheDb ? await openDb('TripMapRouteCacheDB') : null
    const routeCacheCount = routeDb ? await count(routeDb, 'routeCaches') : 0
    travelDb.close()
    routeDb?.close()
    return {
      errorTicketState: ticketStates.find((state) => state.ticketId === 'readiness_ticket_error'),
      notes: trip?.notes,
      pendingOutboxTypes: outbox.filter((entry) => entry.status === 'pending').map((entry) => entry.objectType),
      pendingTicketState: ticketStates.find((state) => state.ticketId === 'readiness_ticket_pending'),
      routeCacheCount,
      westLakeContentEnrichment: westLake?.contentEnrichment,
    }
  }, tripId)
}

async function writeItemTitle(page: import('@playwright/test').Page, itemId: string, title: string) {
  return page.evaluate(async ({ currentItemId, nextTitle }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('TravelConsoleDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['itineraryItems'], 'readwrite')
      const store = tx.objectStore('itineraryItems')
      const getRequest = store.get(currentItemId)
      getRequest.onsuccess = () => {
        store.put({ ...getRequest.result, title: nextTitle })
      }
      getRequest.onerror = () => reject(getRequest.error)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  }, { currentItemId: itemId, nextTitle: title })
}

async function readAiEditBoundaryCounts(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    async function openDb(name: string) {
      return new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    }
    async function countStore(db: IDBDatabase, storeName: string) {
      if (!Array.from(db.objectStoreNames).includes(storeName)) return 0
      const tx = db.transaction([storeName], 'readonly')
      return new Promise<number>((resolve, reject) => {
        const request = tx.objectStore(storeName).count()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    }

    const travelDb = await openDb('TravelConsoleDB')
    const routeDb = await openDb('TripMapRouteCacheDB')
    const counts = {
      days: await countStore(travelDb, 'days'),
      itineraryItems: await countStore(travelDb, 'itineraryItems'),
      routeCaches: await countStore(routeDb, 'routeCaches'),
      ticketBlobs: await countStore(travelDb, 'ticketBlobs'),
      ticketMetas: await countStore(travelDb, 'ticketMetas'),
      trips: await countStore(travelDb, 'trips'),
    }
    travelDb.close()
    routeDb.close()
    return counts
  })
}

async function readExistingTripImportState(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('TravelConsoleDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    async function getAll<T>(storeName: string) {
      return new Promise<T[]>((resolve, reject) => {
        const request = db.transaction([storeName], 'readonly').objectStore(storeName).getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    }
    async function count(storeName: string) {
      return new Promise<number>((resolve, reject) => {
        const request = db.transaction([storeName], 'readonly').objectStore(storeName).count()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    }
    const trips = await getAll<{ id: string; notes?: string }>('trips')
    const items = await getAll<{ dayId: string; locationName?: string; startTime?: string; ticketIds: string[]; title: string }>('itineraryItems')
    const tickets = await getAll<{ fileName: string; itemId?: string; ticketCategory?: string; title?: string }>('ticketMetas')
    const syncOutbox = await getAll<{ objectType: string; status: string }>('syncOutbox')
    const ticketBlobSyncStates = await getAll<{ cacheStatus: string; ticketId: string; uploadStatus: string }>('ticketBlobSyncStates')
    const ticketBlobs = await count('ticketBlobs')
    const travelInboxEntries = await count('travelInboxEntries')
    const travelInboxBlobs = await count('travelInboxBlobs')
    const travelInboxPreviews = await count('travelInboxPreviews')
    db.close()
    return {
      items,
      notes: trips.find((trip) => trip.id === 'trip-existing-import')?.notes ?? '',
      syncOutboxTypes: syncOutbox.filter((entry) => entry.status === 'pending').map((entry) => entry.objectType),
      ticketBlobSyncStates,
      ticketBlobs,
      tickets,
      travelInboxBlobs,
      travelInboxEntries,
      travelInboxPreviews,
    }
  })
}

async function readDayItemOrder(page: import('@playwright/test').Page, dayId: string) {
  return page.evaluate(async (currentDayId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('TravelConsoleDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const tx = db.transaction(['itineraryItems'], 'readonly')
    const index = tx.objectStore('itineraryItems').index('dayId')
    const items = await new Promise<Array<{ id: string; sortOrder: number; title: string }>>((resolve, reject) => {
      const request = index.getAll(currentDayId)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return items.sort((first, second) => first.sortOrder - second.sortOrder).map((item) => item.id)
  }, dayId)
}

async function readRouteCacheEntryCount(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('TripMapRouteCacheDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    if (!Array.from(db.objectStoreNames).includes('routeCaches')) {
      db.close()
      return 0
    }
    const tx = db.transaction(['routeCaches'], 'readonly')
    const count = await new Promise<number>((resolve, reject) => {
      const request = tx.objectStore('routeCaches').count()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return count
  })
}

async function expectTripPreviewRenderedInPlot(
  page: Page,
  expectedMarkerCount: number,
  options: { requireMarkers?: boolean } = {},
) {
  await expect.poll(async () => {
    return page.evaluate(({ expectedMarkerCount: markerCount, requireMarkers }) => {
      const plot = document.querySelector<HTMLElement>('[data-testid="trip-map-overview-plot"]')
      const map = document.querySelector<HTMLElement>('[data-testid="trip-map-preview-map"]')
      if (!plot || !map) return false

      const plotRect = plot.getBoundingClientRect()
      const mapRect = map.getBoundingClientRect()
      const hasVisiblePlot =
        plotRect.width > 0 &&
        plotRect.height > 0 &&
        mapRect.width > 0 &&
        mapRect.height > 0
      if (!hasVisiblePlot) return false

      const isCenteredInPlot = (rect: DOMRect) => {
        const centerX = rect.left + rect.width / 2
        const centerY = rect.top + rect.height / 2
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          centerX >= plotRect.left &&
          centerX <= plotRect.right &&
          centerY >= plotRect.top &&
          centerY <= plotRect.bottom
        )
      }

      const markers = Array.from(plot.querySelectorAll<HTMLElement>('[data-testid="trip-map-overview-marker"]'))
      const markersAreReady =
        markers.length === markerCount &&
        markers.every((marker) => isCenteredInPlot(marker.getBoundingClientRect()))
      if (markersAreReady) return true
      if (requireMarkers) return false

      const canvas = map.querySelector<HTMLCanvasElement>('canvas')
      return Boolean(canvas && isCenteredInPlot(canvas.getBoundingClientRect()))
    }, { expectedMarkerCount, requireMarkers: options.requireMarkers ?? false })
  }).toBe(true)
}

async function mockGoogleMapsScript(page: Page) {
  await page.route('https://maps.googleapis.com/maps/api/js**', async (route) => {
    await route.fulfill({
      body: `
        (() => {
          const listeners = new WeakMap();
          function getListeners(target, event) {
            let targetListeners = listeners.get(target);
            if (!targetListeners) {
              targetListeners = {};
              listeners.set(target, targetListeners);
            }
            targetListeners[event] ||= [];
            return targetListeners[event];
          }
          class LatLng {
            constructor(lat, lng) {
              this._lat = lat;
              this._lng = lng;
            }
            lat() { return this._lat; }
            lng() { return this._lng; }
          }
          class LatLngBounds {
            constructor(sw, ne) {
              this.sw = sw;
              this.ne = ne;
            }
          }
          class Map {
            constructor(container, options) {
              this.container = container;
              this.center = new LatLng(options.center.lat, options.center.lng);
              this.zoom = options.zoom;
              this.panes = { overlayMouseTarget: container };
              window.setTimeout(() => {
                google.maps.event.trigger(this, 'tilesloaded');
                google.maps.event.trigger(this, 'idle');
              }, 0);
            }
            fitBounds() { google.maps.event.trigger(this, 'idle'); }
            getCenter() { return this.center; }
            getZoom() { return this.zoom; }
            panTo(center) { this.center = new LatLng(center.lat, center.lng); google.maps.event.trigger(this, 'idle'); }
            setCenter(center) { this.center = new LatLng(center.lat, center.lng); }
            setOptions(options) {
              if (options.center) this.setCenter(options.center);
              if (options.zoom != null) this.zoom = options.zoom;
            }
            setZoom(zoom) { this.zoom = zoom; }
          }
          class OverlayView {
            setMap(map) {
              this.map = map;
              if (map) {
                this.onAdd?.();
                this.draw?.();
              } else {
                this.onRemove?.();
              }
            }
            getPanes() { return this.map?.panes; }
            getProjection() {
              return {
                fromLatLngToDivPixel: (position) => ({
                  x: (position.lng() - 139) * 1000 + 160,
                  y: (36 - position.lat()) * 1000 + 80,
                }),
              };
            }
          }
          class Polyline {
            constructor(options) {
              this.path = options.path ?? [];
              this.element = document.createElement('div');
              this.element.dataset.testid = 'trip-map-google-route-line';
              this.element.setAttribute('data-point-count', String(this.path.length));
              this.setMap(options.map ?? null);
            }
            setMap(map) {
              this.map = map;
              this.element.remove();
              if (map && this.path.length > 0) {
                map.container.appendChild(this.element);
              }
            }
            setPath(path) {
              this.path = path;
              this.element.setAttribute('data-point-count', String(this.path.length));
              this.setMap(this.map);
            }
          }
          const event = {
            addListener(target, name, handler) {
              getListeners(target, name).push(handler);
              return { remove() {} };
            },
            addListenerOnce(target, name, handler) {
              const wrapped = () => handler();
              getListeners(target, name).push(wrapped);
              return { remove() {} };
            },
            trigger(target, name) {
              for (const handler of getListeners(target, name)) handler();
            },
          };
          window.google = { maps: { event, LatLng, LatLngBounds, Map, OverlayView, Polyline } };
          window.__googleMapsInitCallback?.();
        })();
      `,
      contentType: 'application/javascript',
    })
  })
}
