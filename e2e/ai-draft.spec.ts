import { test, expect, type Page } from '@playwright/test'
import { clearTravelDatabase, expectNoHorizontalOverflow, forceRouteProxyFixture, openDetailsSection } from './helpers'

type TestDraftDay = {
  date: string
  title?: string
  tips?: string[]
  items: Array<Record<string, unknown>>
}

type RefineProxyBody = {
  draft: {
    days: TestDraftDay[]
    [key: string]: unknown
  }
  guidance?: string
  operation: string
  preferences?: Record<string, unknown>
  scope: unknown
}

async function openJsonDraftSection(page: Page) {
  const section = page.getByTestId('ai-draft-json-section')
  await section.locator('summary').click()
  return section
}

async function loadSampleDraft(page: Page) {
  const section = await openJsonDraftSection(page)
  await section.getByRole('button', { name: '加载固定示例' }).click()
  return section
}

async function parseSampleDraft(page: Page) {
  const section = await loadSampleDraft(page)
  await section.getByRole('button', { name: '解析草稿' }).click()
  return section
}

function requestForm(page: Page) {
  return page.getByTestId('ai-draft-request-form')
}

function draftTextarea(page: Page) {
  return page.getByTestId('ai-draft-json-section').getByPlaceholder('{"title": "...", "startDate')
}

function threeDayDraft() {
  return {
    title: '局部优化测试',
    destination: '东京',
    startDate: '2025-04-01',
    endDate: '2025-04-03',
    days: [
      {
        date: '2025-04-01',
        title: '抵达日',
        tips: ['保持轻松。'],
        items: [{ title: '浅草寺', locationName: '浅草寺', startTime: '09:00' }],
      },
      {
        date: '2025-04-02',
        title: '文化日',
        tips: ['预留排队时间。'],
        items: [{ title: '上野公园', locationName: '上野公园', startTime: '10:00' }],
      },
      {
        date: '2025-04-03',
        title: '购物日',
        tips: ['保留退税时间。'],
        items: [{ title: '银座', locationName: '银座', startTime: '14:00' }],
      },
    ],
  }
}

function qualityIssueDraft() {
  return {
    title: '质量检查测试',
    destination: '杭州',
    startDate: '2025-04-01',
    endDate: '2025-04-01',
    days: [{
      date: '2025-04-01',
      title: '密集测试日',
      items: [
        { title: '西湖', locationName: '西湖', startTime: '08:00', endTime: '10:00' },
        {
          title: '再次西湖',
          locationName: '西湖（湖滨）',
          previousTransportDurationMinutes: 90,
          previousTransportMode: 'walk',
          startTime: '09:30',
          endTime: '11:00',
        },
        { title: '自由活动', startTime: '11:05', endTime: '11:45' },
        { title: '景点参观', startTime: '12:00', endTime: '12:45' },
        { title: '景点A', locationName: 'A', startTime: '13:00', endTime: '13:45' },
        { title: '景点B', locationName: 'B', startTime: '14:00', endTime: '14:45' },
        { title: '景点C', locationName: 'C', startTime: '15:00', endTime: '15:45' },
      ],
    }],
  }
}

function mapPreviewDraft() {
  return {
    title: '地图预览测试',
    destination: '东京',
    startDate: '2025-04-01',
    endDate: '2025-04-01',
    days: [{
      date: '2025-04-01',
      title: '地图日',
      items: [
        {
          title: '短 A',
          locationName: '东京站',
          lat: 35,
          lng: 139,
          startTime: '09:00',
        },
        {
          title: '短 B',
          locationName: '有乐町',
          lat: 35.001,
          lng: 139.001,
          startTime: '10:00',
        },
        {
          title: '短 C',
          locationName: '银座',
          lat: 35.002,
          lng: 139.002,
          startTime: '11:00',
        },
        {
          title: '近 D',
          locationName: '日比谷',
          lat: 35.003,
          lng: 139.003,
          startTime: '12:00',
        },
      ],
    }],
  }
}

function mapOrderDraft() {
  return {
    title: '地图顺序测试',
    destination: '东京',
    startDate: '2025-04-01',
    endDate: '2025-04-02',
    days: [
      {
        date: '2025-04-01',
        title: '第一天地图日',
        items: [
          { title: '一日保持起点', locationName: '起点', lat: 35, lng: 139, startTime: '09:00' },
          { title: '一日绕远点', locationName: '远点', lat: 35.4, lng: 139.4, startTime: '10:00' },
          { title: '一日近点', locationName: '近点', lat: 35.001, lng: 139.001, startTime: '11:00' },
        ],
      },
      {
        date: '2025-04-02',
        title: '第二天地图日',
        items: [
          { title: '二日起点', locationName: '起点', lat: 36, lng: 140, startTime: '09:00' },
          { title: '二日绕远点', locationName: '远点', lat: 36.4, lng: 140.4, startTime: '10:00' },
          { title: '二日近点', locationName: '近点', lat: 36.001, lng: 140.001, startTime: '11:00' },
        ],
      },
    ],
  }
}

function missingCoordinateLookupDraft() {
  return {
    title: '缺坐标补全测试',
    destination: '东京',
    startDate: '2025-04-01',
    endDate: '2025-04-01',
    days: [{
      date: '2025-04-01',
      title: '补全日',
      items: [
        {
          title: '有坐标',
          locationName: '东京站',
          lat: 35.6812,
          lng: 139.7671,
          startTime: '09:00',
        },
        {
          title: '待补全地点',
          locationName: '东京国立博物馆',
          address: '上野公园',
          previousTransportMode: 'transit',
          previousTransportDurationMinutes: 18,
          startTime: '10:00',
        },
      ],
    }],
  }
}

function variantDraft(title: string, dayCount = 2) {
  const dates = Array.from({ length: dayCount }, (_, index) => `2025-10-0${index + 1}`)
  return {
    title,
    destination: '首尔',
    startDate: '2025-10-01',
    endDate: dates[dates.length - 1],
    days: dates.map((date, index) => ({
        date,
        title: `${title}第 ${index + 1} 天`,
        tips: ['提前确认开放时间。'],
        items: index === 0
          ? [
            { title: `${title}景福宫`, locationName: '景福宫', lat: 37.5796, lng: 126.977, startTime: '09:00' },
            {
              title: `${title}首尔塔`,
              locationName: '首尔塔',
              lat: 37.5512,
              lng: 126.9882,
              previousTransportMode: 'transit',
              previousTransportDurationMinutes: 35,
              startTime: '10:00',
            },
            {
            title: `${title}北村韩屋村`,
            locationName: '北村韩屋村',
            lat: 37.5826,
            lng: 126.983,
            previousTransportMode: 'walk',
            previousTransportDurationMinutes: 20,
            startTime: '11:00',
            },
          ]
          : [{ title: `${title}明洞`, locationName: '明洞', lat: 37.5637, lng: 126.985, startTime: '10:00' }],
      })),
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/favicon.svg', { waitUntil: 'domcontentloaded' })
  await forceRouteProxyFixture(page)
})

test.describe('AI Trip Builder Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#/ai-draft')
  })

  test('shows description and context note', async ({ page }) => {
    const header = page.getByTestId('ai-draft-page-header')
    await expect(header.getByRole('heading', { name: 'AI 生成行程' })).toBeVisible()
    await expect(header).toContainText('生成可预览、可修改、可确认导入的完整行程草案')
    await expect(header).toContainText('确认后创建行程')
  })

  test('shows request builder section', async ({ page }) => {
    const form = requestForm(page)
    await expect(form.getByLabel(/目的地/)).toBeVisible()
    await expect(form.getByLabel(/天数/)).toBeVisible()
    await expect(form.getByLabel(/同行人数/)).toBeVisible()
    await expect(form.getByText('兴趣标签')).toBeVisible()
    await expect(form.getByRole('button', { name: '生成本地示例草案' })).toBeVisible()
  })

  test('shows paste area section', async ({ page }) => {
    await expect(page.getByTestId('ai-draft-json-section').locator('summary')).toBeVisible()
  })

  test('shows validation error for empty destination', async ({ page }) => {
    const form = requestForm(page)
    await form.getByRole('button', { name: '生成本地示例草案' }).click()
    await expect(form).toContainText('请输入目的地')
  })

  test('generates mock draft from valid request', async ({ page }) => {
    const form = requestForm(page)
    await form.getByLabel(/目的地/).fill('东京')
    await form.getByLabel(/开始日期/).fill('2025-06-01')
    await form.getByLabel(/天数/).fill('3')
    await form.getByLabel(/同行人数/).fill('4')
    await form.getByRole('button', { name: '美食' }).click()
    await form.getByLabel(/兴趣偏好/).fill('咖啡馆和建筑')
    await form.getByRole('button', { name: '生成本地示例草案' }).click()
    const summary = page.getByTestId('ai-draft-summary')
    await expect(summary).toBeVisible()
    await expect(summary).toContainText('东京之旅')
    await expect(summary).toContainText('3 天')
  })

  test('generates mock draft shows preview', async ({ page }) => {
    const form = requestForm(page)
    await form.getByLabel(/目的地/).fill('巴黎')
    await form.getByLabel(/开始日期/).fill('2025-07-01')
    await form.getByLabel(/天数/).fill('2')
    await form.getByRole('button', { name: '生成本地示例草案' }).click()
    await expect(page.getByTestId('ai-draft-preview')).toBeVisible()
    await expect(page.getByTestId('ai-draft-preview')).toContainText('每日提示')
    await expect(page.getByTestId('ai-draft-preview')).toContainText('交通分钟')
    await expect(page.getByRole('button', { name: '确认导入' })).toBeVisible()
  })

  test('loads sample draft', async ({ page }) => {
    await loadSampleDraft(page)
    const textarea = draftTextarea(page)
    const value = await textarea.inputValue()
    expect(value).toContain('东京五日游')
  })

  test('shows validation errors for invalid draft', async ({ page }) => {
    await openJsonDraftSection(page)
    await draftTextarea(page).fill('{"title": ""}')
    await page.getByRole('button', { name: '解析草稿' }).click()
    const errors = page.getByTestId('ai-draft-errors')
    await expect(errors.getByRole('heading', { name: '草稿错误' })).toBeVisible()
    await expect(errors).toContainText('旅行标题不能为空')
  })

  test('shows summary for valid draft', async ({ page }) => {
    await parseSampleDraft(page)
    const summary = page.getByTestId('ai-draft-summary')
    await expect(summary.getByRole('heading', { name: '草稿摘要' })).toBeVisible()
    await expect(summary).toContainText('东京五日游')
    await expect(summary).toContainText('东京')
    await expect(summary).toContainText('2025-04-01 至 2025-04-05')
    await expect(summary).toContainText('2 天')
    await expect(summary).toContainText('4 个')
  })

  test('shows preview for valid draft', async ({ page }) => {
    await parseSampleDraft(page)
    const preview = page.getByTestId('ai-draft-preview')
    await expect(preview).toBeVisible()
    await expect(preview.getByTestId('ai-draft-item-editor').nth(0).getByLabel('标题')).toHaveValue('浅草寺')
    await expect(preview.getByTestId('ai-draft-item-editor').nth(2).getByLabel('标题')).toHaveValue('明治神宫')
  })

  test('shows draft map preview with markers path and current order', async ({ page }) => {
    let providerRequests = 0
    await page.route('**/api/provider-proxy', async (route) => {
      providerRequests += 1
      await route.fulfill({
        body: JSON.stringify({ ok: false, operation: 'unexpected' }),
        contentType: 'application/json',
        status: 500,
      })
    })

    await openJsonDraftSection(page)
    await draftTextarea(page).fill(JSON.stringify(mapPreviewDraft()))
    await page.getByRole('button', { name: '解析草稿' }).click()

    const map = page.getByTestId('ai-draft-map-preview')
    await expect(map).toBeVisible()
    await expect(map).toContainText('地图预览')
    await expect(map.getByTestId('ai-draft-map-preview-marker')).toHaveCount(4)
    await expect(map.getByTestId('ai-draft-map-preview-segment')).toHaveCount(3)
    await expect(map.getByTestId('ai-draft-map-preview-path')).toBeVisible()
    await expect(map).toContainText('直线距离')
    await expect(map.getByTestId('ai-draft-map-preview-order-item')).toHaveCount(4)
    await expect(map.getByTestId('ai-draft-map-preview-order-item').first()).toContainText('短 A')
    expect(providerRequests).toBe(0)
  })

  test('draft map preview refreshes after item move and coordinate edits', async ({ page }) => {
    let providerRequests = 0
    await page.route('**/api/provider-proxy', async (route) => {
      providerRequests += 1
      await route.fulfill({
        body: JSON.stringify({ ok: false, operation: 'unexpected' }),
        contentType: 'application/json',
        status: 500,
      })
    })

    await openJsonDraftSection(page)
    await draftTextarea(page).fill(JSON.stringify(mapPreviewDraft()))
    await page.getByRole('button', { name: '解析草稿' }).click()

    const map = page.getByTestId('ai-draft-map-preview')
    const preview = page.getByTestId('ai-draft-preview')
    await expect(map.getByTestId('ai-draft-map-preview-order-item').first()).toContainText('短 A')
    await preview.getByTestId('ai-draft-item-editor').first().getByRole('button', { name: '下移' }).click()
    await expect(map.getByTestId('ai-draft-map-preview-order-item').first()).toContainText('短 B')

    const lastItem = preview.getByTestId('ai-draft-item-editor').last()
    await lastItem.getByLabel('纬度').fill('35.4')
    await lastItem.getByLabel('经度').fill('139.4')
    const routeWarning = map.getByTestId('ai-draft-map-preview-warning').filter({ hasText: '直线距离约' })
    await expect(routeWarning).toContainText('可能需要检查顺序')
    expect(providerRequests).toBe(0)
  })

  test('draft map order action reorders only the selected day without provider calls', async ({ page }) => {
    let providerRequests = 0
    await page.route('**/api/provider-proxy', async (route) => {
      providerRequests += 1
      await route.fulfill({
        body: JSON.stringify({ ok: false, operation: 'unexpected' }),
        contentType: 'application/json',
        status: 500,
      })
    })

    await openJsonDraftSection(page)
    await draftTextarea(page).fill(JSON.stringify(mapOrderDraft()))
    await page.getByRole('button', { name: '解析草稿' }).click()

    const map = page.getByTestId('ai-draft-map-preview')
    await map.getByTestId('ai-draft-map-preview-day-select').selectOption('2025-04-02')
    await expect(map.getByTestId('ai-draft-map-preview-warning').filter({ hasText: '二日绕远点 前后出现折返' })).toBeVisible()
    await expect(map.getByTestId('ai-draft-map-order-action')).toBeEnabled()
    await map.getByTestId('ai-draft-map-order-action').click()

    await expect(map.getByTestId('ai-draft-map-order-message')).toContainText('已按地图直线顺序重排本日行程')
    await expect(map.getByTestId('ai-draft-map-preview-warning').filter({ hasText: '二日绕远点 前后出现折返' })).not.toBeVisible()
    await expect(map.getByTestId('ai-draft-map-preview-order-item').nth(1)).toContainText('二日近点')
    await expect(map.getByTestId('ai-draft-map-preview-marker').nth(1)).toContainText('2')

    const firstDay = page.getByTestId('ai-draft-day-editor').nth(0)
    const secondDay = page.getByTestId('ai-draft-day-editor').nth(1)
    await expect(firstDay.getByTestId('ai-draft-item-editor').nth(1).getByLabel('标题')).toHaveValue('一日绕远点')
    await expect(secondDay.getByTestId('ai-draft-item-editor').nth(1).getByLabel('标题')).toHaveValue('二日近点')
    await expect(map.getByTestId('ai-draft-map-order-action')).toBeDisabled()
    expect(providerRequests).toBe(0)
  })

  test('draft map preview keeps missing-coordinate items local without provider calls', async ({ page }) => {
    let providerRequests = 0
    await page.route('**/api/provider-proxy', async (route) => {
      providerRequests += 1
      await route.fulfill({
        body: JSON.stringify({ ok: false, operation: 'unexpected' }),
        contentType: 'application/json',
        status: 500,
      })
    })

    const draft = {
      title: '缺坐标测试',
      destination: '东京',
      startDate: '2025-04-01',
      endDate: '2025-04-01',
      days: [{
        date: '2025-04-01',
        items: [
          { title: '有坐标', locationName: '东京站', lat: 35.6812, lng: 139.7671 },
          { title: '没有坐标', locationName: '待校准地点' },
        ],
      }],
    }
    await openJsonDraftSection(page)
    await draftTextarea(page).fill(JSON.stringify(draft))
    await page.getByRole('button', { name: '解析草稿' }).click()

    const map = page.getByTestId('ai-draft-map-preview')
    await expect(map).toContainText('坐标点不足 2 个')
    await expect(map).toContainText('未参与地图线段')
    await expect(map.getByTestId('ai-draft-map-preview-marker')).toHaveCount(1)
    await expect(map.getByTestId('ai-draft-map-order-action')).toBeDisabled()
    expect(providerRequests).toBe(0)
  })

  test('draft map missing-coordinate lookup is click-gated and confirm-gated', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await forceRouteProxyFixture(page)
    const providerBodies: Array<Record<string, unknown>> = []
    await page.route('**/api/provider-proxy', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>
      providerBodies.push(body)
      expect(body.operation).toBe('place_lookup')
      expect(body.locale).toBe('zh-CN')
      expect(body.maxResults).toBe(3)
      expect(String(body.query)).toContain('东京国立博物馆')
      const serialized = JSON.stringify(body)
      expect(serialized).not.toContain('ticket')
      expect(serialized).not.toContain('routeCache')
      expect(serialized).not.toContain('cloud')
      expect(serialized).not.toContain('days')
      expect(serialized).not.toContain('trip')
      expect(serialized).not.toContain('notes')
      expect(serialized).not.toContain('Bearer')
      expect(serialized).not.toContain('Authorization')
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          operation: 'place_lookup',
          requestId: body.requestId,
          results: [{
            displayName: '东京国立博物馆',
            formattedAddress: '东京都台东区上野公园13-9',
            googleMapsUri: 'https://maps.google.com/?cid=123',
            location: { lat: 35.718835, lng: 139.776522 },
            placeId: 'tokyo-national-museum',
            provider: 'google_places',
            retrievedAt: '2026-06-04T00:00:00.000Z',
          }],
          retrievedAt: '2026-06-04T00:00:00.000Z',
          source: 'mock',
        }),
        contentType: 'application/json',
      })
    })

    await openJsonDraftSection(page)
    await draftTextarea(page).fill(JSON.stringify(missingCoordinateLookupDraft()))
    await page.getByRole('button', { name: '解析草稿' }).click()

    const map = page.getByTestId('ai-draft-map-preview')
    await expect(map.getByTestId('ai-draft-place-lookup-panel')).toContainText('1 个待补全')
    await expect(map.getByTestId('ai-draft-place-lookup-item')).toContainText('东京国立博物馆')
    await expect(map.getByTestId('ai-draft-map-preview-marker')).toHaveCount(1)
    expect(providerBodies).toHaveLength(0)

    await map.getByTestId('ai-draft-place-lookup-search').click()
    await expect(map.getByTestId('ai-draft-place-lookup-result')).toContainText('Google Places')
    await expect(map.getByTestId('ai-draft-place-lookup-result')).toContainText('35.71883, 139.77652')
    expect(providerBodies).toHaveLength(1)

    const preview = page.getByTestId('ai-draft-preview')
    const missingItemEditor = preview.getByTestId('ai-draft-item-editor').nth(1)
    await expect(missingItemEditor.getByLabel('纬度')).toHaveValue('')
    await map.getByTestId('ai-draft-place-lookup-use-result').click()
    const dialog = page.getByTestId('ai-draft-place-lookup-confirm-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('只更新地点名称、地址和坐标')
    await dialog.getByRole('button', { name: '取消' }).click()
    await expect(missingItemEditor.getByLabel('纬度')).toHaveValue('')
    await expect(map.getByTestId('ai-draft-map-preview-marker')).toHaveCount(1)

    await map.getByTestId('ai-draft-place-lookup-use-result').click()
    await page.getByTestId('ai-draft-place-lookup-confirm-dialog').getByRole('button', { name: '填入草案' }).click()
    await expect(missingItemEditor.getByLabel('地点')).toHaveValue('东京国立博物馆')
    await expect(missingItemEditor.getByLabel('地址')).toHaveValue('东京都台东区上野公园13-9')
    await expect(missingItemEditor.getByLabel('纬度')).toHaveValue('35.718835')
    await expect(missingItemEditor.getByLabel('经度')).toHaveValue('139.776522')
    await expect(map.getByTestId('ai-draft-map-preview-marker')).toHaveCount(2)
    await expect(map.getByTestId('ai-draft-place-lookup-panel')).toContainText('0 个待补全')
    expect(providerBodies.map((body) => body.operation)).toEqual(['place_lookup'])
    await expectNoHorizontalOverflow(page)
  })

  test('structured preview can be edited before import', async ({ page }) => {
    await parseSampleDraft(page)
    const preview = page.getByTestId('ai-draft-preview')
    await preview.getByLabel('旅行标题').fill('东京编辑版')
    await preview.getByLabel('每日主题').first().fill('浅草编辑日')
    await preview.getByTestId('ai-draft-item-editor').first().getByLabel('标题').fill('浅草寺编辑点')
    await preview.getByRole('button', { name: '添加提示' }).first().click()
    await preview.getByPlaceholder('例如：提前确认预约时间').last().fill('新增每日提示')

    await expect(page.getByTestId('ai-draft-summary')).toContainText('东京编辑版')
    await expect(preview.getByLabel('每日主题').first()).toHaveValue('浅草编辑日')
    await expect(preview.getByTestId('ai-draft-item-editor').first().getByLabel('标题')).toHaveValue('浅草寺编辑点')
    await expect(preview.getByPlaceholder('例如：提前确认预约时间').last()).toHaveValue('新增每日提示')
    await expect(page.getByRole('button', { name: '确认导入' })).toBeEnabled()
  })

  test('single-day regeneration is confirmation gated and only replaces target day', async ({ page }) => {
    let refineRequests = 0
    await page.route('**/api/provider-proxy', async (route) => {
      const body = route.request().postDataJSON() as RefineProxyBody
      expect(body.operation).toBe('ai_trip_draft_refine')
      expect(body.scope).toEqual({ kind: 'day', date: '2025-04-01' })
      expect(body.guidance).toBe('让第一天更轻松')
      expect(JSON.stringify(body)).not.toContain('TRIPMAP_AI_API_KEY')
      expect(JSON.stringify(body)).not.toContain('Bearer')
      refineRequests += 1
      const draft = body.draft
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          operation: 'ai_trip_draft_refine',
          source: 'mock',
          draft: {
            ...draft,
            title: '不应采用的新标题',
            destination: '不应采用的新目的地',
            days: draft.days.map((day) => day.date === '2025-04-01'
              ? { ...day, title: 'AI 优化第一天', items: [{ title: 'AI 第一日景点', startTime: '09:30' }] }
              : { ...day, title: '不应替换第二天', items: [{ title: '不应替换景点' }] }),
          },
        }),
        contentType: 'application/json',
      })
    })

    await parseSampleDraft(page)
    const preview = page.getByTestId('ai-draft-preview')
    await preview.getByTestId('ai-draft-day-regenerate-button').first().click()
    const dialog = page.getByTestId('ai-draft-day-refine-confirm-dialog')
    await expect(dialog).toBeVisible()
    expect(refineRequests).toBe(0)
    await dialog.getByRole('button', { name: '取消' }).click()
    expect(refineRequests).toBe(0)

    await preview.getByTestId('ai-draft-day-regenerate-button').first().click()
    await page.getByTestId('ai-draft-day-refine-guidance').fill('让第一天更轻松')
    await dialog.getByRole('button', { name: '确认重新生成' }).click()

    await expect(page.getByTestId('ai-draft-refine-success')).toContainText('已重新生成 2025-04-01')
    await expect(preview.getByLabel('每日主题').first()).toHaveValue('AI 优化第一天')
    await expect(preview.getByLabel('每日主题').nth(1)).toHaveValue('涩谷与原宿')
    await expect(preview.getByTestId('ai-draft-item-editor').first().getByLabel('标题')).toHaveValue('AI 第一日景点')
    expect(refineRequests).toBe(1)
  })

  test('range preference regeneration only replaces selected dates and preserves outside edits', async ({ page }) => {
    let refineRequests = 0
    await page.route('**/api/provider-proxy', async (route) => {
      const body = route.request().postDataJSON() as RefineProxyBody
      expect(body.operation).toBe('ai_trip_draft_refine')
      expect(body.scope).toEqual({ kind: 'date_range', startDate: '2025-04-01', endDate: '2025-04-02' })
      expect(body.preferences).toMatchObject({
        interestText: '咖啡馆和博物馆',
        partySize: 4,
        preferTransport: 'walking',
      })
      expect(body.guidance).toBe('少购物，多休息')
      refineRequests += 1
      const draft = body.draft
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          operation: 'ai_trip_draft_refine',
          source: 'mock',
          draft: {
            ...draft,
            days: draft.days.map((day) => ({
              ...day,
              title: `AI 优化 ${day.date}`,
              items: [{ title: `AI 景点 ${day.date}`, startTime: '10:00' }],
            })),
          },
        }),
        contentType: 'application/json',
      })
    })

    await openJsonDraftSection(page)
    await draftTextarea(page).fill(JSON.stringify(threeDayDraft()))
    await page.getByRole('button', { name: '解析草稿' }).click()
    const preview = page.getByTestId('ai-draft-preview')
    await preview.getByLabel('每日主题').nth(2).fill('用户保留第三天')
    const panel = page.getByTestId('ai-draft-refine-panel')
    await panel.getByTestId('ai-draft-refine-start-date').selectOption('2025-04-01')
    await panel.getByTestId('ai-draft-refine-end-date').selectOption('2025-04-02')
    await panel.getByLabel(/同行人数/).fill('4')
    await panel.getByLabel(/交通偏好/).selectOption('walking')
    await panel.getByTestId('ai-draft-refine-interest-text').fill('咖啡馆和博物馆')
    await panel.getByTestId('ai-draft-refine-guidance').fill('少购物，多休息')
    await panel.getByTestId('ai-draft-range-refine-action').click()
    await expect(page.getByTestId('ai-draft-range-refine-confirm-dialog')).toBeVisible()
    expect(refineRequests).toBe(0)

    await page.getByTestId('ai-draft-range-refine-confirm-dialog').getByRole('button', { name: '确认优化' }).click()

    await expect(page.getByTestId('ai-draft-refine-success')).toContainText('已重新生成 2025-04-01 至 2025-04-02')
    await expect(preview.getByLabel('每日主题').nth(0)).toHaveValue('AI 优化 2025-04-01')
    await expect(preview.getByLabel('每日主题').nth(1)).toHaveValue('AI 优化 2025-04-02')
    await expect(preview.getByLabel('每日主题').nth(2)).toHaveValue('用户保留第三天')
    expect(refineRequests).toBe(1)
  })

  test('refine provider failure and stale draft keep current draft unchanged', async ({ page }) => {
    await page.route('**/api/provider-proxy', async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          code: 'provider_error',
          message: 'AI 行程优化服务请求失败。',
          ok: false,
          operation: 'ai_trip_draft_refine',
        }),
        contentType: 'application/json',
        status: 502,
      })
    })

    await openJsonDraftSection(page)
    await draftTextarea(page).fill(JSON.stringify(threeDayDraft()))
    await page.getByRole('button', { name: '解析草稿' }).click()
    const preview = page.getByTestId('ai-draft-preview')
    await preview.getByTestId('ai-draft-day-regenerate-button').nth(1).click()
    await page.getByTestId('ai-draft-day-refine-confirm-dialog').getByRole('button', { name: '确认重新生成' }).click()

    await expect(page.getByTestId('ai-draft-refine-error')).toContainText('AI 行程优化服务请求失败')
    await expect(preview.getByLabel('每日主题').nth(1)).toHaveValue('文化日')

    await page.unroute('**/api/provider-proxy')
    let releaseRefine: (() => void) | undefined
    const releasePromise = new Promise<void>((resolve) => {
      releaseRefine = resolve
    })
    await page.route('**/api/provider-proxy', async (route) => {
      const body = route.request().postDataJSON() as RefineProxyBody
      await releasePromise
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          operation: 'ai_trip_draft_refine',
          source: 'mock',
          draft: {
            ...body.draft,
            days: body.draft.days.map((day) => day.date === '2025-04-02'
              ? { ...day, title: '不应应用的优化结果', items: [{ title: '不应应用' }] }
              : day),
          },
        }),
        contentType: 'application/json',
      })
    })

    await preview.getByTestId('ai-draft-day-regenerate-button').nth(1).click()
    await page.getByTestId('ai-draft-day-refine-confirm-dialog').getByRole('button', { name: '确认重新生成' }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('ai-draft-day-refine-confirm-dialog')).not.toBeVisible()
    await preview.getByLabel('每日主题').nth(2).fill('用户请求中编辑第三天')
    releaseRefine?.()

    await expect(page.getByTestId('ai-draft-refine-error')).toContainText('草案已变化，请重新生成')
    await expect(preview.getByLabel('每日主题').nth(1)).toHaveValue('文化日')
    await expect(preview.getByLabel('每日主题').nth(2)).toHaveValue('用户请求中编辑第三天')
  })

  test('shows privacy notice', async ({ page }) => {
    await parseSampleDraft(page)
    const privacyNote = page.getByTestId('ai-draft-privacy-note')
    await expect(privacyNote).toContainText('这里的修改只更新当前草案')
    await expect(privacyNote).toContainText('确认导入后才会写入本地旅行')
  })

  test('shows confirm button only for valid draft', async ({ page }) => {
    await expect(page.getByRole('button', { name: '确认导入' })).not.toBeVisible()
    await parseSampleDraft(page)
    await expect(page.getByRole('button', { name: '确认导入' })).toBeVisible()
  })

  test('shows confirm dialog on import click', async ({ page }) => {
    await parseSampleDraft(page)
    await page.getByRole('button', { name: '确认导入' }).click()
    const dialog = page.getByTestId('ai-draft-import-confirm-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: '最终导入检查' })).toBeVisible()
    await expect(dialog).toContainText('导入确认会先写入此设备')
    await expect(dialog).toContainText('东京五日游')
    await expect(dialog.getByTestId('ai-draft-import-check')).toContainText('2 天')
    await expect(dialog.getByTestId('ai-draft-import-check')).toContainText('4 个')
    await expect(dialog.getByTestId('ai-draft-import-check')).toContainText('缺坐标')
    await expect(dialog.getByTestId('ai-draft-import-check-route-summary')).toContainText('暂无可生成路线')
    await expect(dialog.getByTestId('ai-draft-import-check-sync-summary')).toContainText('等待同步')
    await expect(dialog).toContainText('每日提示会按天追加到旅行备注')
    await expect(dialog).toContainText('确认生成前不会调用路线服务')
  })

  test('final import check cancel keeps draft local and sends no provider request', async ({ page }) => {
    await clearTravelDatabase(page)
    await page.goto('/#/ai-draft')
    let providerRequests = 0
    await page.route('**/api/provider-proxy', async (route) => {
      providerRequests += 1
      await route.fulfill({
        body: JSON.stringify({ ok: false, operation: 'unexpected' }),
        contentType: 'application/json',
        status: 500,
      })
    })

    await parseSampleDraft(page)
    await page.getByRole('button', { name: '确认导入' }).click()
    await expect(page.getByTestId('ai-draft-import-confirm-dialog')).toBeVisible()
    expect(providerRequests).toBe(0)
    await page.getByTestId('ai-draft-import-confirm-dialog').getByRole('button', { name: '取消' }).click()
    expect(providerRequests).toBe(0)
    await page.goto('/#/home')
    await expect(page.locator('h1').filter({ hasText: '东京五日游' })).not.toBeVisible()
  })

  test('shows route generation prompt after import and generates only after confirmation', async ({ page }) => {
    await clearTravelDatabase(page)
    let routePreviewRequests = 0
    await page.route('**/api/provider-proxy', async (route) => {
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
      routePreviewRequests += 1
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
              distanceMeters: 1100,
              durationSeconds: 540,
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
    await page.goto('/#/ai-draft')
    await forceRouteProxyFixture(page)
    const draft = {
      title: '路线提示测试旅行',
      destination: '东京',
      startDate: '2026-04-12',
      endDate: '2026-04-12',
      days: [{
        date: '2026-04-12',
        title: '路线测试日',
        items: [
          {
            title: '东京站',
            lat: 35.681236,
            lng: 139.767125,
            locationName: 'Tokyo Station',
            startTime: '09:00',
          },
          {
            title: '皇居外苑',
            lat: 35.680959,
            lng: 139.757133,
            locationName: 'Kokyo Gaien',
            previousTransportMode: 'walk',
            startTime: '10:00',
          },
          {
            title: '东京塔',
            lat: 35.658581,
            lng: 139.745433,
            locationName: 'Tokyo Tower',
            previousTransportMode: 'car',
            startTime: '14:00',
          },
        ],
      }],
    }

    await openJsonDraftSection(page)
    await draftTextarea(page).fill(JSON.stringify(draft))
    await page.getByRole('button', { name: '解析草稿' }).click()
    await expect(page.getByTestId('ai-draft-summary')).toBeVisible()
    await page.getByRole('button', { name: '确认导入' }).click()
    const importDialog = page.getByTestId('ai-draft-import-confirm-dialog')
    await expect(importDialog.getByTestId('ai-draft-import-check')).toContainText('1 天')
    await expect(importDialog.getByTestId('ai-draft-import-check-route-summary')).toContainText('可生成 1 天路线')
    expect(routePreviewRequests).toBe(0)
    await page.getByTestId('ai-draft-import-confirm-dialog').getByRole('button', { name: '确认导入' }).click()
    await page.waitForURL(/#\/trip\?/)
    await expect(page).toHaveURL(/postImportRoutePrompt=1/)

    const panel = page.getByTestId('import-route-generation-panel')
    await expect(panel).toBeVisible()
    await expect(panel.getByTestId('import-route-generation-summary')).toContainText('已找到 1 天可生成路线')
    expect(routePreviewRequests).toBe(0)

    await panel.getByTestId('import-route-generate-button').click()
    await expect(page.getByTestId('import-route-generation-confirm-dialog')).toContainText('点击确认后才会调用路线服务')
    expect(routePreviewRequests).toBe(0)
    await page.getByTestId('import-route-generation-confirm-dialog').getByRole('button', { name: '确认生成' }).click()

    await expect(panel.getByTestId('import-route-generation-result')).toContainText('已生成 1 天路线预览')
    expect(routePreviewRequests).toBeGreaterThan(0)
    await expect.poll(() => new URL(page.url()).hash.includes('postImportRoutePrompt')).toBe(false)
    await expectNoHorizontalOverflow(page)
  })

  test('creates trip on confirm from pasted draft', async ({ page }) => {
    await parseSampleDraft(page)
    await page.getByRole('button', { name: '确认导入' }).click()
    await page.getByTestId('ai-draft-import-confirm-dialog').getByRole('button', { name: '确认导入' }).click()
    await page.waitForURL(/#\/trip/)
    await expect(page.locator('h1').filter({ hasText: '东京五日游' })).toBeVisible()
    await expect(page.getByText('旅行备注')).toBeVisible()
    await expect(page.getByText('AI 生成每日提示')).toBeVisible()
  })

  test('creates trip on confirm from generated draft', async ({ page }) => {
    const form = requestForm(page)
    await form.getByLabel(/目的地/).fill('大阪')
    await form.getByLabel(/开始日期/).fill('2025-08-01')
    await form.getByLabel(/天数/).fill('2')
    await form.getByRole('button', { name: '生成本地示例草案' }).click()
    await expect(page.getByTestId('ai-draft-summary')).toBeVisible()
    await page.getByRole('button', { name: '确认导入' }).click()
    await page.getByTestId('ai-draft-import-confirm-dialog').getByRole('button', { name: '确认导入' }).click()
    await page.waitForURL(/#\/trip/)
    await expect(page.locator('h1').filter({ hasText: '大阪之旅' })).toBeVisible()
  })

  test('does not create trip before confirm', async ({ page }) => {
    await parseSampleDraft(page)
    await page.goto('/#/home')
    await expect(page.locator('h1').filter({ hasText: '东京五日游' })).not.toBeVisible()
  })

  test('does not create trip from generated draft before confirm', async ({ page }) => {
    const form = requestForm(page)
    await form.getByLabel(/目的地/).fill('京都')
    await form.getByLabel(/开始日期/).fill('2025-09-01')
    await form.getByLabel(/天数/).fill('2')
    await form.getByRole('button', { name: '生成本地示例草案' }).click()
    await expect(page.getByTestId('ai-draft-summary')).toBeVisible()
    await page.goto('/#/home')
    await expect(page.locator('h1').filter({ hasText: '京都之旅' })).not.toBeVisible()
  })

  test('390px viewport does not overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const form = requestForm(page)
    await form.getByLabel(/目的地/).fill('东京')
    await form.getByLabel(/开始日期/).fill('2025-06-01')
    await form.getByLabel(/天数/).fill('3')
    await form.getByRole('button', { name: '生成本地示例草案' }).click()
    await expect(page.getByTestId('ai-draft-summary')).toBeVisible()
    const body = await page.evaluate(() => document.body.scrollWidth)
    expect(body).toBeLessThanOrEqual(390)
  })

  test('shows proxy generate button', async ({ page }) => {
    // In e2e environment, proxy is configured so the button is enabled
    const proxyBtn = page.getByRole('button', { name: '生成完整行程' })
    await proxyBtn.scrollIntoViewIfNeeded()
    await expect(proxyBtn).toBeVisible()
  })

  test('provider generation is confirmation gated and sends builder fields only after confirm', async ({ page }) => {
    let aiDraftRequests = 0
    await page.route('**/api/provider-proxy', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>
      expect(body.operation).toBe('ai_trip_draft')
      expect(body).toMatchObject({
        dayCount: 2,
        destination: '首尔',
        interestTags: ['美食'],
        interestText: '咖啡馆',
        partySize: 3,
        startDate: '2025-10-01',
        endDate: '2025-10-02',
      })
      expect(JSON.stringify(body)).not.toContain('TRIPMAP_AI_API_KEY')
      aiDraftRequests += 1
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          operation: 'ai_trip_draft',
          source: 'mock',
          draft: {
            title: '首尔之旅',
            destination: '首尔',
            startDate: '2025-10-01',
            endDate: '2025-10-02',
            days: [
              {
                date: '2025-10-01',
                title: '抵达与美食',
                tips: ['提前确认餐厅营业时间。'],
                items: [
                  {
                    title: '景福宫',
                    locationName: '景福宫',
                    startTime: '09:00',
                  },
                  {
                    title: '北村韩屋村',
                    locationName: '北村韩屋村',
                    previousTransportMode: 'walk',
                    previousTransportDurationMinutes: 20,
                    previousTransportNote: '步行前往即可。',
                    startTime: '11:00',
                  },
                ],
              },
              { date: '2025-10-02', title: '城市漫游', tips: ['预留购物时间。'], items: [{ title: '明洞', startTime: '10:00' }] },
            ],
          },
        }),
        contentType: 'application/json',
      })
    })

    const form = requestForm(page)
    await form.getByLabel(/目的地/).fill('首尔')
    await form.getByLabel(/开始日期/).fill('2025-10-01')
    await form.getByLabel(/天数/).fill('2')
    await form.getByLabel(/同行人数/).fill('3')
    await form.getByRole('button', { name: '美食' }).click()
    await form.getByLabel(/兴趣偏好/).fill('咖啡馆')
    await form.getByRole('button', { name: '生成完整行程' }).click()
    await expect(page.getByTestId('ai-draft-generate-confirm-dialog')).toBeVisible()
    expect(aiDraftRequests).toBe(0)

    await page.getByTestId('ai-draft-generate-confirm-dialog').getByRole('button', { name: '取消' }).click()
    expect(aiDraftRequests).toBe(0)

    await form.getByRole('button', { name: '生成完整行程' }).click()
    await page.getByTestId('ai-draft-generate-confirm-dialog').getByRole('button', { name: '确认生成' }).click()
    await expect(page.getByTestId('ai-draft-summary')).toContainText('首尔之旅')
    await expect(page.getByTestId('ai-draft-day-editor').first().getByPlaceholder('例如：提前确认预约时间').first()).toHaveValue('提前确认餐厅营业时间。')
    expect(aiDraftRequests).toBe(1)
  })

  test('multi-variant generation is gated supports partial failure retry and selects one draft', async ({ page }) => {
    let aiDraftRequests = 0
    let relaxedAttempts = 0
    const seenStyles: string[] = []

    await page.route('**/api/provider-proxy', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>
      expect(body.operation).toBe('ai_trip_draft')
      expect(body).toMatchObject({
        dayCount: 2,
        destination: '首尔',
        interestTags: ['美食'],
        interestText: '咖啡馆',
        partySize: 3,
        startDate: '2025-10-01',
        endDate: '2025-10-02',
      })
      expect(JSON.stringify(body)).not.toContain('TRIPMAP_AI_API_KEY')
      expect(JSON.stringify(body)).not.toContain('route_cache')
      expect(JSON.stringify(body)).not.toContain('ticket')
      aiDraftRequests += 1

      const freeTextRequirement = String(body.freeTextRequirement ?? '')
      if (freeTextRequirement.includes('经典游')) {
        seenStyles.push('classic')
        await route.fulfill({
          body: JSON.stringify({
            ok: true,
            operation: 'ai_trip_draft',
            source: 'mock',
            warnings: ['经典游 warning'],
            draft: variantDraft('经典游方案'),
          }),
          contentType: 'application/json',
        })
        return
      }
      if (freeTextRequirement.includes('轻松游')) {
        seenStyles.push('relaxed')
        relaxedAttempts += 1
        if (relaxedAttempts === 1) {
          await route.fulfill({
            body: JSON.stringify({
              ok: false,
              code: 'provider_error',
              message: '轻松游暂时失败',
              operation: 'ai_trip_draft',
            }),
            contentType: 'application/json',
            status: 502,
          })
          return
        }
        await route.fulfill({
          body: JSON.stringify({
            ok: true,
            operation: 'ai_trip_draft',
            source: 'mock',
            draft: variantDraft('轻松游方案'),
          }),
          contentType: 'application/json',
        })
        return
      }
      if (freeTextRequirement.includes('深度游')) {
        seenStyles.push('deep')
        await route.fulfill({
          body: JSON.stringify({
            ok: true,
            operation: 'ai_trip_draft',
            source: 'mock',
            draft: variantDraft('深度游方案'),
          }),
          contentType: 'application/json',
        })
        return
      }
      throw new Error(`Missing variant guidance: ${freeTextRequirement}`)
    })

    const form = requestForm(page)
    await form.getByLabel(/目的地/).fill('首尔')
    await form.getByLabel(/开始日期/).fill('2025-10-01')
    await form.getByLabel(/天数/).fill('2')
    await form.getByLabel(/同行人数/).fill('3')
    await form.getByRole('button', { name: '美食' }).click()
    await form.getByLabel(/兴趣偏好/).fill('咖啡馆')

    await form.getByRole('button', { name: '生成三种方案' }).click()
    await expect(page.getByTestId('ai-draft-variants-confirm-dialog')).toBeVisible()
    expect(aiDraftRequests).toBe(0)
    await page.getByTestId('ai-draft-variants-confirm-dialog').getByRole('button', { name: '取消' }).click()
    expect(aiDraftRequests).toBe(0)

    await form.getByRole('button', { name: '生成三种方案' }).click()
    await page.getByTestId('ai-draft-variants-confirm-dialog').getByRole('button', { name: '确认生成' }).click()
    const panel = page.getByTestId('ai-draft-variant-panel')
    await expect(panel).toBeVisible()
    await expect(panel.getByTestId('ai-draft-variant-card')).toHaveCount(3)
    await expect(panel).toContainText('经典游方案')
    await expect(panel).toContainText('深度游方案')
    await expect(panel).toContainText('轻松游暂时失败')
    const comparison = panel.getByTestId('ai-draft-variant-comparison')
    await expect(comparison).toBeVisible()
    await expect(comparison).toContainText('方案对比')
    await expect(comparison).toContainText('节奏')
    await expect(comparison).toContainText('每日强度')
    await expect(comparison).toContainText('交通复杂度')
    await expect(comparison).toContainText('景点数量')
    await expect(comparison).toContainText('适合人群')
    await expect(comparison).toContainText('首次到访 / 想稳妥覆盖')
    await expect(comparison).toContainText('文化爱好者 / 二刷 / 体力较好')
    const relaxedComparison = comparison.getByTestId('ai-draft-variant-comparison-card').filter({ hasText: '轻松游' })
    await expect(relaxedComparison).toContainText('生成失败，可重新生成')
    expect(aiDraftRequests).toBe(3)
    expect(new Set(seenStyles)).toEqual(new Set(['classic', 'relaxed', 'deep']))
    await expectNoHorizontalOverflow(page)

    const relaxedCard = panel.getByTestId('ai-draft-variant-card').filter({ hasText: '轻松游' })
    await relaxedCard.getByTestId('ai-draft-variant-retry').click()
    await expect(page.getByTestId('ai-draft-variant-retry-confirm-dialog')).toBeVisible()
    expect(aiDraftRequests).toBe(3)
    await page.getByTestId('ai-draft-variant-retry-confirm-dialog').getByRole('button', { name: '取消' }).click()
    expect(aiDraftRequests).toBe(3)

    await relaxedCard.getByTestId('ai-draft-variant-retry').click()
    await page.getByTestId('ai-draft-variant-retry-confirm-dialog').getByRole('button', { name: '确认重新生成' }).click()
    await expect(relaxedCard).toContainText('轻松游方案')
    await expect(relaxedComparison).toContainText('亲子 / 长辈 / 慢节奏')
    await expect(relaxedComparison).toContainText('约')
    expect(aiDraftRequests).toBe(4)

    await relaxedCard.getByTestId('ai-draft-variant-select').click()
    await expect(page.getByTestId('ai-draft-variant-panel')).not.toBeVisible()
    await expect(page.getByTestId('ai-draft-summary')).toContainText('轻松游方案')
    await expect(page.getByTestId('ai-draft-quality-card')).toBeVisible()
  })

  test('multi-variant comparison can mix selected days into a new draft without extra provider calls', async ({ page }) => {
    let aiDraftRequests = 0
    await page.route('**/api/provider-proxy', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>
      expect(body.operation).toBe('ai_trip_draft')
      expect(body).toMatchObject({
        dayCount: 3,
        destination: '首尔',
        partySize: 3,
        startDate: '2025-10-01',
        endDate: '2025-10-03',
      })
      expect(JSON.stringify(body)).not.toContain('route_cache')
      expect(JSON.stringify(body)).not.toContain('ticket')
      aiDraftRequests += 1

      const freeTextRequirement = String(body.freeTextRequirement ?? '')
      const title = freeTextRequirement.includes('轻松游')
        ? '轻松游方案'
        : freeTextRequirement.includes('深度游')
          ? '深度游方案'
          : '经典游方案'
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          operation: 'ai_trip_draft',
          source: 'mock',
          draft: variantDraft(title, 3),
        }),
        contentType: 'application/json',
      })
    })

    const form = requestForm(page)
    await form.getByLabel(/目的地/).fill('首尔')
    await form.getByLabel(/开始日期/).fill('2025-10-01')
    await form.getByLabel(/天数/).fill('3')
    await form.getByLabel(/同行人数/).fill('3')

    await form.getByRole('button', { name: '生成三种方案' }).click()
    await page.getByTestId('ai-draft-variants-confirm-dialog').getByRole('button', { name: '确认生成' }).click()

    const panel = page.getByTestId('ai-draft-variant-panel')
    await expect(panel).toBeVisible()
    const mixPanel = panel.getByTestId('ai-draft-variant-mix-panel')
    await expect(mixPanel).toContainText('混合生成')
    await expect(mixPanel.getByTestId('ai-draft-variant-mix-day')).toHaveCount(3)
    await mixPanel.getByTestId('ai-draft-variant-mix-select').nth(1).selectOption('relaxed')
    await mixPanel.getByTestId('ai-draft-variant-mix-select').nth(2).selectOption('deep')
    await mixPanel.getByTestId('ai-draft-variant-mix-action').click()

    expect(aiDraftRequests).toBe(3)
    await expect(page.getByTestId('ai-draft-variant-panel')).not.toBeVisible()
    await expect(page.getByTestId('ai-draft-summary')).toContainText('首尔混合方案')
    await expect(page.getByTestId('ai-draft-day-editor').nth(0).getByLabel('每日主题')).toHaveValue('经典游方案第 1 天')
    await expect(page.getByTestId('ai-draft-day-editor').nth(1).getByLabel('每日主题')).toHaveValue('轻松游方案第 2 天')
    await expect(page.getByTestId('ai-draft-day-editor').nth(2).getByLabel('每日主题')).toHaveValue('深度游方案第 3 天')
    await expect(page.getByTestId('ai-draft-quality-card')).toBeVisible()
    await expect(page.getByTestId('ai-draft-map-preview')).toBeVisible()
    await expect(page.getByTestId('ai-draft-map-preview-marker')).toHaveCount(3)
    await page.getByTestId('ai-draft-map-order-action').click()
    await expect(page.getByTestId('ai-draft-map-order-message')).toContainText('已按地图直线顺序重排本日行程')
    await expect(page.getByTestId('ai-draft-day-editor').nth(0).getByTestId('ai-draft-item-editor').nth(1).getByLabel('标题')).toHaveValue('经典游方案北村韩屋村')
    await expectNoHorizontalOverflow(page)
  })

  test('provider error does not create a draft', async ({ page }) => {
    await page.route('**/api/provider-proxy', async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          ok: false,
          code: 'provider_error',
          message: 'AI 服务暂时不可用',
          operation: 'ai_trip_draft',
        }),
        contentType: 'application/json',
        status: 502,
      })
    })
    const form = requestForm(page)
    await form.getByLabel(/目的地/).fill('曼谷')
    await form.getByLabel(/开始日期/).fill('2025-11-01')
    await form.getByRole('button', { name: '生成完整行程' }).click()
    await page.getByTestId('ai-draft-generate-confirm-dialog').getByRole('button', { name: '确认生成' }).click()
    await expect(form).toContainText('AI 服务暂时不可用')
    await expect(page.getByTestId('ai-draft-summary')).not.toBeVisible()
  })

  test('invalid provider draft enters validation errors and cannot import', async ({ page }) => {
    await page.route('**/api/provider-proxy', async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          operation: 'ai_trip_draft',
          source: 'future_ai',
          draft: {
            title: '',
            destination: '曼谷',
            startDate: '2025-11-01',
            endDate: '2025-11-03',
            days: [],
          },
        }),
        contentType: 'application/json',
      })
    })
    const form = requestForm(page)
    await form.getByLabel(/目的地/).fill('曼谷')
    await form.getByLabel(/开始日期/).fill('2025-11-01')
    await form.getByRole('button', { name: '生成完整行程' }).click()
    await page.getByTestId('ai-draft-generate-confirm-dialog').getByRole('button', { name: '确认生成' }).click()
    await expect(page.getByTestId('ai-draft-errors')).toContainText('旅行标题不能为空')
    await expect(page.getByRole('button', { name: '确认导入' })).not.toBeVisible()
  })
})

test.describe('AI Trip Builder Quality Check', () => {
  test('shows quality check card after generating mock draft', async ({ page }) => {
    await page.goto('/#/ai-draft')
    const form = requestForm(page)
    await form.getByLabel(/目的地/).fill('东京')
    await form.getByLabel(/开始日期/).fill('2025-06-01')
    await form.getByLabel(/天数/).fill('3')
    await form.getByRole('button', { name: '生成本地示例草案' }).click()
    await expect(page.getByTestId('ai-draft-summary')).toBeVisible()
    await expect(page.getByTestId('ai-draft-quality-card')).toBeVisible()
  })

  test('shows quality findings for draft with issues', async ({ page }) => {
    await page.goto('/#/ai-draft')
    // Paste a draft with many items in one day (triggers dense_day)
    const denseDraft = {
      title: '密集行程',
      destination: '东京',
      startDate: '2025-04-01',
      endDate: '2025-04-01',
      days: [{
        date: '2025-04-01',
        items: [
          { title: '景点A', locationName: 'A', startTime: '08:00', endTime: '09:00' },
          { title: '景点B', locationName: 'B', startTime: '09:30', endTime: '10:30' },
          { title: '景点C', locationName: 'C', startTime: '11:00', endTime: '12:00' },
          { title: '景点D', locationName: 'D', startTime: '13:00', endTime: '14:00' },
          { title: '景点E', locationName: 'E', startTime: '14:30', endTime: '15:30' },
          { title: '景点F', locationName: 'F', startTime: '16:00', endTime: '17:00' },
          { title: '景点G', locationName: 'G', startTime: '17:30', endTime: '18:30' },
        ],
      }],
    }
    await openJsonDraftSection(page)
    await draftTextarea(page).fill(JSON.stringify(denseDraft))
    await page.getByRole('button', { name: '解析草稿' }).click()
    const quality = page.getByTestId('ai-draft-quality-card')
    await expect(quality).toBeVisible()
    await expect(quality).toContainText('不会阻止导入')
  })

  test('shows clean status for well-structured draft', async ({ page }) => {
    await page.goto('/#/ai-draft')
    const cleanDraft = {
      title: '轻松旅行',
      destination: '杭州',
      startDate: '2025-04-01',
      endDate: '2025-04-01',
      days: [{
        date: '2025-04-01',
        items: [
          { title: '游览西湖', locationName: '西湖', address: '杭州市西湖区', startTime: '09:00', endTime: '11:00', previousTransportMode: 'walk' },
          { title: '午餐休息', locationName: '楼外楼', address: '杭州市上城区', startTime: '12:00', endTime: '13:00' },
          { title: '参观灵隐寺', locationName: '灵隐寺', address: '杭州市西湖区', startTime: '14:00', endTime: '16:00', previousTransportMode: 'transit' },
        ],
      }],
    }
    await openJsonDraftSection(page)
    await draftTextarea(page).fill(JSON.stringify(cleanDraft))
    await page.getByRole('button', { name: '解析草稿' }).click()
    const quality = page.getByTestId('ai-draft-quality-card')
    await expect(quality).toBeVisible()
    // Clean draft should not show warning findings
    await expect(quality).not.toContainText('不会阻止导入')
  })

  test('repair request strips notes when privacy is default (all off)', async ({ page }) => {
    await page.goto('/#/ai-draft')
    // Ensure default privacy (all off) which strips notes
    await page.evaluate(() => localStorage.setItem('tripmap:ai-privacy', JSON.stringify({
      allowItineraryBasics: false,
      allowLocationText: false,
      allowCoordinateState: false,
      allowTransportInfo: false,
      allowTicketMetadata: false,
      allowTicketFileNames: false,
      allowNotesSummary: false,
      allowFullNotes: false,
      allowTicketFileContent: false,
      allowCloudSyncStatus: false,
    })))

    // Paste a draft with notes and enough items to trigger quality warnings
    const draftWithNotes = {
      title: '测试行程',
      destination: '东京',
      startDate: '2025-04-01',
      endDate: '2025-04-01',
      days: [{
        date: '2025-04-01',
        items: [
          { title: '景点A', locationName: 'A', startTime: '08:00', endTime: '09:00', note: '这是用户备注，不应发送给 AI' },
          { title: '景点B', locationName: 'B', startTime: '09:30', endTime: '10:30' },
          { title: '景点C', locationName: 'C', startTime: '11:00', endTime: '12:00' },
          { title: '景点D', locationName: 'D', startTime: '13:00', endTime: '14:00' },
          { title: '景点E', locationName: 'E', startTime: '14:30', endTime: '15:30' },
          { title: '景点F', locationName: 'F', startTime: '16:00', endTime: '17:00' },
          { title: '景点G', locationName: 'G', startTime: '17:30', endTime: '18:30' },
        ],
      }],
    }
    await openJsonDraftSection(page)
    await draftTextarea(page).fill(JSON.stringify(draftWithNotes))
    await page.getByRole('button', { name: '解析草稿' }).click()
    await expect(page.getByTestId('ai-draft-quality-card')).toBeVisible()

    // Intercept the repair request to verify no notes
    let repairedDraftJson: string | null = null
    await page.route('**/api/provider-proxy', async (route) => {
      const body = route.request().postDataJSON()
      if (body.operation === 'ai_trip_draft_repair') {
        repairedDraftJson = JSON.stringify(body.draft)
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          draft: draftWithNotes,
          operation: 'ai_trip_draft_repair',
          source: 'mock',
        }),
      })
    })

    // Click repair and confirm
    const repairBtn = page.getByTestId('ai-draft-repair-action')
    await repairBtn.scrollIntoViewIfNeeded()
    await repairBtn.click()
    await page.getByTestId('ai-draft-repair-confirm-dialog').getByRole('button', { name: '确认修复' }).click()

    // Wait for intercepted request
    await page.waitForTimeout(1000)
    expect(repairedDraftJson).not.toBeNull()

    // Verify notes are stripped from the repaired draft
    const repairedDraft = JSON.parse(repairedDraftJson!)
    const itemWithNote = repairedDraft.days[0].items.find(
      (item: { title: string }) => item.title === '景点A',
    )
    expect(itemWithNote.note).toBeUndefined()
  })

  test('shows repair button when draft has warnings', async ({ page }) => {
    await page.goto('/#/ai-draft')
    // Paste a draft with dense day (7 items triggers dense_day warning)
    const draftWithIssues = {
      title: '密集行程',
      destination: '东京',
      startDate: '2025-04-01',
      endDate: '2025-04-01',
      days: [{
        date: '2025-04-01',
        items: [
          { title: '景点A', locationName: 'A', startTime: '08:00', endTime: '09:00' },
          { title: '景点B', locationName: 'B', startTime: '09:30', endTime: '10:30' },
          { title: '景点C', locationName: 'C', startTime: '11:00', endTime: '12:00' },
          { title: '景点D', locationName: 'D', startTime: '13:00', endTime: '14:00' },
          { title: '景点E', locationName: 'E', startTime: '14:30', endTime: '15:30' },
          { title: '景点F', locationName: 'F', startTime: '16:00', endTime: '17:00' },
          { title: '景点G', locationName: 'G', startTime: '17:30', endTime: '18:30' },
        ],
      }],
    }
    await openJsonDraftSection(page)
    await draftTextarea(page).fill(JSON.stringify(draftWithIssues))
    await page.getByRole('button', { name: '解析草稿' }).click()
    const quality = page.getByTestId('ai-draft-quality-card')
    await expect(quality).toBeVisible()
    await expect(quality).toContainText('不会阻止导入')
    // Repair button should be visible when draft has warnings
    const repairBtn = page.getByTestId('ai-draft-repair-action')
    await repairBtn.scrollIntoViewIfNeeded()
    await expect(repairBtn).toBeVisible()
  })

  test('quality check groups issues with selectable defaults', async ({ page }) => {
    await page.goto('/#/ai-draft')
    await openJsonDraftSection(page)
    await draftTextarea(page).fill(JSON.stringify(qualityIssueDraft()))
    await page.getByRole('button', { name: '解析草稿' }).click()

    const quality = page.getByTestId('ai-draft-quality-card')
    await expect(quality).toContainText('方案质量检查')
    await expect(quality).toContainText('过密日程')
    await expect(quality).toContainText('交通合理性')
    await expect(quality).toContainText('缺地点信息')
    await expect(quality).toContainText('时间冲突')
    await expect(quality).toContainText('重复景点')
    await expect(quality.getByTestId('ai-draft-quality-finding')).toHaveCount(await quality.getByTestId('ai-draft-quality-checkbox').count())
    const checkedCount = await quality.locator('[data-testid="ai-draft-quality-checkbox"]:checked').count()
    expect(checkedCount).toBeGreaterThan(0)
    await expect(page.getByTestId('ai-draft-repair-action')).toContainText('修复选中问题')
  })

  test('selected quality repair is confirmation gated and sends only selected findings', async ({ page }) => {
    let repairRequests = 0
    await page.route('**/api/provider-proxy', async (route) => {
      const body = route.request().postDataJSON() as {
        draft: ReturnType<typeof qualityIssueDraft>
        operation: string
        qualityFindings: Array<{ ruleId: string; message: string }>
      }
      expect(body.operation).toBe('ai_trip_draft_repair')
      expect(body.qualityFindings).toHaveLength(1)
      expect(body.qualityFindings[0].ruleId).toBe('missing_location')
      expect(JSON.stringify(body)).not.toContain('这是用户备注')
      expect(JSON.stringify(body)).not.toContain('TRIPMAP_AI_API_KEY')
      repairRequests += 1
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          draft: {
            ...body.draft,
            days: body.draft.days.map((day) => ({
              ...day,
              items: day.items.map((item) => item.title === '自由活动'
                ? { ...item, locationName: '自由活动地点' }
                : item),
            })),
          },
          operation: 'ai_trip_draft_repair',
          source: 'mock',
        }),
        contentType: 'application/json',
      })
    })

    await page.goto('/#/ai-draft')
    await openJsonDraftSection(page)
    await draftTextarea(page).fill(JSON.stringify(qualityIssueDraft()))
    await page.getByRole('button', { name: '解析草稿' }).click()
    const quality = page.getByTestId('ai-draft-quality-card')
    await quality.getByTestId('ai-draft-quality-clear-selection').click()
    await quality.getByTestId('ai-draft-quality-finding').filter({ hasText: '缺少地点信息' }).getByTestId('ai-draft-quality-checkbox').first().check()
    await page.getByTestId('ai-draft-repair-action').click()
    await expect(page.getByTestId('ai-draft-repair-confirm-dialog')).toBeVisible()
    expect(repairRequests).toBe(0)
    await page.getByTestId('ai-draft-repair-confirm-dialog').getByRole('button', { name: '取消' }).click()
    expect(repairRequests).toBe(0)

    await page.getByTestId('ai-draft-repair-action').click()
    await page.getByTestId('ai-draft-repair-confirm-dialog').getByRole('button', { name: '确认修复' }).click()
    await expect(page.getByTestId('ai-draft-refine-panel')).toBeVisible()
    await expect(page.getByTestId('ai-draft-preview').getByTestId('ai-draft-item-editor').nth(2).getByLabel('地点')).toHaveValue('自由活动地点')
    expect(repairRequests).toBe(1)
  })

  test('quality repair failure invalid response and stale draft preserve current draft', async ({ page }) => {
    await page.route('**/api/provider-proxy', async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          code: 'provider_error',
          message: 'AI 行程修复服务请求失败。',
          ok: false,
          operation: 'ai_trip_draft_repair',
        }),
        contentType: 'application/json',
        status: 502,
      })
    })

    await page.goto('/#/ai-draft')
    await openJsonDraftSection(page)
    await draftTextarea(page).fill(JSON.stringify(qualityIssueDraft()))
    await page.getByRole('button', { name: '解析草稿' }).click()
    await page.getByTestId('ai-draft-repair-action').click()
    await page.getByTestId('ai-draft-repair-confirm-dialog').getByRole('button', { name: '确认修复' }).click()
    await expect(page.getByText('AI 行程修复服务请求失败。')).toBeVisible()
    await expect(page.getByTestId('ai-draft-preview').getByTestId('ai-draft-item-editor').first().getByLabel('标题')).toHaveValue('西湖')

    await page.unroute('**/api/provider-proxy')
    await page.route('**/api/provider-proxy', async (route) => {
      const body = route.request().postDataJSON() as { draft: ReturnType<typeof qualityIssueDraft> }
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          draft: {
            ...body.draft,
            days: [{
              ...body.draft.days[0],
              items: [{ title: '' }],
            }],
          },
          operation: 'ai_trip_draft_repair',
          source: 'mock',
        }),
        contentType: 'application/json',
      })
    })
    await page.getByTestId('ai-draft-repair-action').click()
    await page.getByTestId('ai-draft-repair-confirm-dialog').getByRole('button', { name: '确认修复' }).click()
    await expect(page.getByText('行程点标题不能为空')).toBeVisible()
    await expect(page.getByTestId('ai-draft-preview').getByTestId('ai-draft-item-editor').first().getByLabel('标题')).toHaveValue('西湖')

    await page.unroute('**/api/provider-proxy')
    let releaseRepair: (() => void) | undefined
    const releasePromise = new Promise<void>((resolve) => {
      releaseRepair = resolve
    })
    await page.route('**/api/provider-proxy', async (route) => {
      const body = route.request().postDataJSON() as { draft: ReturnType<typeof qualityIssueDraft> }
      await releasePromise
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          draft: {
            ...body.draft,
            days: body.draft.days.map((day) => ({
              ...day,
              items: day.items.map((item, index) => index === 0 ? { ...item, title: '不应应用的修复' } : item),
            })),
          },
          operation: 'ai_trip_draft_repair',
          source: 'mock',
        }),
        contentType: 'application/json',
      })
    })
    await page.getByTestId('ai-draft-repair-action').click()
    await page.getByTestId('ai-draft-repair-confirm-dialog').getByRole('button', { name: '确认修复' }).click()
    await page.getByTestId('ai-draft-preview').getByTestId('ai-draft-item-editor').last().getByLabel('标题').fill('用户请求中编辑')
    releaseRepair?.()
    await expect(page.getByText('草案已变化，请重新检查后再修复。')).toBeVisible()
    await expect(page.getByTestId('ai-draft-preview').getByTestId('ai-draft-item-editor').first().getByLabel('标题')).toHaveValue('西湖')
    await expect(page.getByTestId('ai-draft-preview').getByTestId('ai-draft-item-editor').last().getByLabel('标题')).toHaveValue('用户请求中编辑')
  })

  test('no horizontal overflow at 390px with quality card', async ({ page }) => {
    await page.goto('/#/ai-draft')
    const draft = {
      title: '测试',
      destination: '东京',
      startDate: '2025-04-01',
      endDate: '2025-04-01',
      days: [{
        date: '2025-04-01',
        items: [
          { title: '景点A', locationName: 'A', startTime: '09:00', endTime: '10:00' },
          { title: '景点B', locationName: 'B', startTime: '10:30', endTime: '11:30' },
        ],
      }],
    }
    await openJsonDraftSection(page)
    await draftTextarea(page).fill(JSON.stringify(draft))
    await page.getByRole('button', { name: '解析草稿' }).click()
    await expect(page.getByTestId('ai-draft-quality-card')).toBeVisible()
    await expect(page.getByTestId('ai-draft-map-preview')).toBeVisible()
    const body = await page.evaluate(() => document.body.scrollWidth)
    expect(body).toBeLessThanOrEqual(390)
  })
})

test.describe('Settings AI draft entry', () => {
  test('settings page links to ai-draft page', async ({ page }) => {
    await page.goto('/#/settings')
    await openDetailsSection(page, 'AI 生成行程')
    await page.getByRole('button', { name: '打开 AI 生成行程 →' }).click()
    await page.waitForURL(/#\/ai-draft/)
    await expect(page.getByRole('heading', { name: 'AI 生成行程' })).toBeVisible()
  })
})
