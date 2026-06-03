import { test, expect, type Page } from '@playwright/test'
import { clearTravelDatabase, expectNoHorizontalOverflow, forceRouteProxyFixture } from './helpers'

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

test.describe('AI Trip Builder Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#/ai-draft')
  })

  test('shows description and context note', async ({ page }) => {
    const header = page.getByTestId('ai-draft-page-header')
    await expect(header.getByRole('heading', { name: 'AI 生成行程' })).toBeVisible()
    await expect(header).toContainText('生成可预览、可修改、可确认导入的完整行程草案')
    await expect(header).toContainText('确认导入后才会创建行程')
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
    await expect(dialog).toContainText('将创建新的本地旅行')
    await expect(dialog).toContainText('导入后会检查可生成路线的日程')
    await expect(dialog).toContainText('确认生成前不会调用路线服务')
    await expect(dialog).toContainText('不会创建票据')
    await expect(dialog).toContainText('不会上传云端')
    await expect(dialog).toContainText('可在创建后继续编辑')
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
    const body = await page.evaluate(() => document.body.scrollWidth)
    expect(body).toBeLessThanOrEqual(390)
  })
})

test.describe('Settings AI draft entry', () => {
  test('settings page links to ai-draft page', async ({ page }) => {
    await page.goto('/#/settings')
    await page.getByRole('button', { name: '打开 AI 生成行程 →' }).click()
    await page.waitForURL(/#\/ai-draft/)
    await expect(page.getByRole('heading', { name: 'AI 生成行程' })).toBeVisible()
  })
})
