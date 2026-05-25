import { test, expect, type Page } from '@playwright/test'

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

test.describe('AI Draft Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#/ai-draft')
  })

  test('shows description and context note', async ({ page }) => {
    const header = page.getByTestId('ai-draft-page-header')
    await expect(header.getByRole('heading', { name: 'AI 行程草稿' })).toBeVisible()
    await expect(header).toContainText('当前为本地示例流程')
  })

  test('shows request builder section', async ({ page }) => {
    const form = requestForm(page)
    await expect(form.getByLabel(/目的地/)).toBeVisible()
    await expect(form.getByRole('button', { name: '根据表单生成示例草稿' })).toBeVisible()
  })

  test('shows paste area section', async ({ page }) => {
    await expect(page.getByTestId('ai-draft-json-section').locator('summary')).toBeVisible()
  })

  test('shows validation error for empty destination', async ({ page }) => {
    const form = requestForm(page)
    await form.getByRole('button', { name: '根据表单生成示例草稿' }).click()
    await expect(form).toContainText('请输入目的地')
  })

  test('generates mock draft from valid request', async ({ page }) => {
    const form = requestForm(page)
    await form.getByLabel(/目的地/).fill('东京')
    await form.getByLabel(/开始日期/).fill('2025-06-01')
    await form.getByLabel(/结束日期/).fill('2025-06-03')
    await form.getByRole('button', { name: '根据表单生成示例草稿' }).click()
    const summary = page.getByTestId('ai-draft-summary')
    await expect(summary).toBeVisible()
    await expect(summary).toContainText('东京之旅')
    await expect(summary).toContainText('3 天')
  })

  test('generates mock draft shows preview', async ({ page }) => {
    const form = requestForm(page)
    await form.getByLabel(/目的地/).fill('巴黎')
    await form.getByLabel(/开始日期/).fill('2025-07-01')
    await form.getByLabel(/结束日期/).fill('2025-07-02')
    await form.getByRole('button', { name: '根据表单生成示例草稿' }).click()
    await expect(page.getByTestId('ai-draft-preview')).toBeVisible()
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
    await expect(preview).toContainText('浅草寺')
    await expect(preview).toContainText('明治神宫')
  })

  test('shows privacy notice', async ({ page }) => {
    await parseSampleDraft(page)
    const privacyNote = page.getByTestId('ai-draft-privacy-note')
    await expect(privacyNote).toContainText('当前仅在本机解析草稿')
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
    await expect(dialog).toContainText('不会自动生成路线')
    await expect(dialog).toContainText('不会创建票据')
    await expect(dialog).toContainText('不会上传云端')
    await expect(dialog).toContainText('可在创建后继续编辑')
  })

  test('creates trip on confirm from pasted draft', async ({ page }) => {
    await parseSampleDraft(page)
    await page.getByRole('button', { name: '确认导入' }).click()
    await page.getByTestId('ai-draft-import-confirm-dialog').getByRole('button', { name: '确认导入' }).click()
    await page.waitForURL(/#\/trip/)
    await expect(page.locator('h1').filter({ hasText: '东京五日游' })).toBeVisible()
  })

  test('creates trip on confirm from generated draft', async ({ page }) => {
    const form = requestForm(page)
    await form.getByLabel(/目的地/).fill('大阪')
    await form.getByLabel(/开始日期/).fill('2025-08-01')
    await form.getByLabel(/结束日期/).fill('2025-08-02')
    await form.getByRole('button', { name: '根据表单生成示例草稿' }).click()
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
    await form.getByLabel(/结束日期/).fill('2025-09-02')
    await form.getByRole('button', { name: '根据表单生成示例草稿' }).click()
    await expect(page.getByTestId('ai-draft-summary')).toBeVisible()
    await page.goto('/#/home')
    await expect(page.locator('h1').filter({ hasText: '京都之旅' })).not.toBeVisible()
  })

  test('390px viewport does not overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const form = requestForm(page)
    await form.getByLabel(/目的地/).fill('东京')
    await form.getByLabel(/开始日期/).fill('2025-06-01')
    await form.getByLabel(/结束日期/).fill('2025-06-03')
    await form.getByRole('button', { name: '根据表单生成示例草稿' }).click()
    await expect(page.getByTestId('ai-draft-summary')).toBeVisible()
    const body = await page.evaluate(() => document.body.scrollWidth)
    expect(body).toBeLessThanOrEqual(390)
  })

  test('shows proxy generate button', async ({ page }) => {
    // In e2e environment, proxy is configured so the button is enabled
    const proxyBtn = page.getByRole('button', { name: '通过旅图服务生成草稿' })
    await proxyBtn.scrollIntoViewIfNeeded()
    await expect(proxyBtn).toBeVisible()
  })
})

test.describe('AI Draft Quality Check', () => {
  test('shows quality check card after generating mock draft', async ({ page }) => {
    await page.goto('/#/ai-draft')
    const form = requestForm(page)
    await form.getByLabel(/目的地/).fill('东京')
    await form.getByLabel(/开始日期/).fill('2025-06-01')
    await form.getByLabel(/结束日期/).fill('2025-06-03')
    await form.getByRole('button', { name: '根据表单生成示例草稿' }).click()
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
    await page.locator('summary').filter({ hasText: 'AI 行程导入' }).click()
    await page.getByRole('button', { name: '或者，试试本地草稿生成 →' }).click()
    await page.waitForURL(/#\/ai-draft/)
    await expect(page.getByRole('heading', { name: 'AI 行程草稿' })).toBeVisible()
  })
})
