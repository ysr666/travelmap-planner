import { test, expect } from '@playwright/test'

test.describe('AI Draft Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#/ai-draft')
  })

  test('shows request builder section', async ({ page }) => {
    await expect(page.getByText('生成草稿请求')).toBeVisible()
    await expect(page.getByLabel(/目的地/)).toBeVisible()
    await expect(page.getByRole('button', { name: '生成本地示例草稿' })).toBeVisible()
  })

  test('shows paste area section', async ({ page }) => {
    await expect(page.getByText('粘贴 JSON 草稿')).toBeVisible()
  })

  test('shows validation error for empty destination', async ({ page }) => {
    await page.getByRole('button', { name: '生成本地示例草稿' }).click()
    await expect(page.getByText('请输入目的地。')).toBeVisible()
  })

  test('generates mock draft from valid request', async ({ page }) => {
    await page.getByLabel(/目的地/).fill('东京')
    await page.getByLabel(/开始日期/).fill('2025-06-01')
    await page.getByLabel(/结束日期/).fill('2025-06-03')
    await page.getByRole('button', { name: '生成本地示例草稿' }).click()
    await expect(page.getByText('草稿摘要')).toBeVisible()
    await expect(page.getByText('东京之旅', { exact: true })).toBeVisible()
    await expect(page.getByText('3 天')).toBeVisible()
  })

  test('generates mock draft shows preview', async ({ page }) => {
    await page.getByLabel(/目的地/).fill('巴黎')
    await page.getByLabel(/开始日期/).fill('2025-07-01')
    await page.getByLabel(/结束日期/).fill('2025-07-02')
    await page.getByRole('button', { name: '生成本地示例草稿' }).click()
    await expect(page.getByText('行程预览')).toBeVisible()
    await expect(page.getByRole('button', { name: '确认导入' })).toBeVisible()
  })

  test('loads sample draft', async ({ page }) => {
    await page.getByText('粘贴 JSON 草稿').click()
    await page.getByRole('button', { name: '加载示例草稿' }).click()
    const textarea = page.getByPlaceholder('{"title": "...", "startDate')
    const value = await textarea.inputValue()
    expect(value).toContain('东京五日游')
  })

  test('shows validation errors for invalid draft', async ({ page }) => {
    await page.getByText('粘贴 JSON 草稿').click()
    await page.getByPlaceholder('{"title": "...", "startDate').fill('{"title": ""}')
    await page.getByRole('button', { name: '解析草稿' }).click()
    await expect(page.getByText('验证错误')).toBeVisible()
    await expect(page.getByText('旅行标题不能为空。')).toBeVisible()
  })

  test('shows summary for valid draft', async ({ page }) => {
    await page.getByText('粘贴 JSON 草稿').click()
    await page.getByRole('button', { name: '加载示例草稿' }).click()
    await page.getByRole('button', { name: '解析草稿' }).click()
    await expect(page.getByText('草稿摘要')).toBeVisible()
    await expect(page.getByRole('heading', { name: '草稿摘要' })).toBeVisible()
    await expect(page.locator('dd').filter({ hasText: '东京五日游' }).first()).toBeVisible()
    await expect(page.locator('dd').filter({ hasText: '东京' }).first()).toBeVisible()
    await expect(page.getByText('2025-04-01 至 2025-04-05')).toBeVisible()
    await expect(page.getByText('2 天')).toBeVisible()
    await expect(page.getByText('4 个')).toBeVisible()
  })

  test('shows preview for valid draft', async ({ page }) => {
    await page.getByText('粘贴 JSON 草稿').click()
    await page.getByRole('button', { name: '加载示例草稿' }).click()
    await page.getByRole('button', { name: '解析草稿' }).click()
    await expect(page.getByText('行程预览')).toBeVisible()
    await expect(page.locator('li').filter({ hasText: '浅草寺' }).first()).toBeVisible()
    await expect(page.locator('li').filter({ hasText: '明治神宫' }).first()).toBeVisible()
  })

  test('shows privacy notice', async ({ page }) => {
    await page.getByText('粘贴 JSON 草稿').click()
    await page.getByRole('button', { name: '加载示例草稿' }).click()
    await page.getByRole('button', { name: '解析草稿' }).click()
    await expect(page.getByText('当前仅在本机解析草稿，不会调用外部 AI。')).toBeVisible()
    await expect(page.getByText('确认导入后才会写入本地旅行。')).toBeVisible()
  })

  test('shows confirm button only for valid draft', async ({ page }) => {
    await expect(page.getByRole('button', { name: '确认导入' })).not.toBeVisible()
    await page.getByText('粘贴 JSON 草稿').click()
    await page.getByRole('button', { name: '加载示例草稿' }).click()
    await page.getByRole('button', { name: '解析草稿' }).click()
    await expect(page.getByRole('button', { name: '确认导入' })).toBeVisible()
  })

  test('shows confirm dialog on import click', async ({ page }) => {
    await page.getByText('粘贴 JSON 草稿').click()
    await page.getByRole('button', { name: '加载示例草稿' }).click()
    await page.getByRole('button', { name: '解析草稿' }).click()
    await page.getByRole('button', { name: '确认导入' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByText('将创建新的本地旅行')).toBeVisible()
    await expect(page.getByText('不会自动生成路线')).toBeVisible()
    await expect(page.getByText('不会创建票据')).toBeVisible()
    await expect(page.getByText('不会上传云端')).toBeVisible()
    await expect(page.getByText('可在创建后继续编辑')).toBeVisible()
  })

  test('creates trip on confirm from pasted draft', async ({ page }) => {
    await page.getByText('粘贴 JSON 草稿').click()
    await page.getByRole('button', { name: '加载示例草稿' }).click()
    await page.getByRole('button', { name: '解析草稿' }).click()
    await page.getByRole('button', { name: '确认导入' }).click()
    await page.getByRole('dialog').getByRole('button', { name: '确认导入' }).click()
    await page.waitForURL(/#\/trip/)
    await expect(page.locator('h1').filter({ hasText: '东京五日游' })).toBeVisible()
  })

  test('creates trip on confirm from generated draft', async ({ page }) => {
    await page.getByLabel(/目的地/).fill('大阪')
    await page.getByLabel(/开始日期/).fill('2025-08-01')
    await page.getByLabel(/结束日期/).fill('2025-08-02')
    await page.getByRole('button', { name: '生成本地示例草稿' }).click()
    await expect(page.getByText('草稿摘要')).toBeVisible()
    await page.getByRole('button', { name: '确认导入' }).click()
    await page.getByRole('dialog').getByRole('button', { name: '确认导入' }).click()
    await page.waitForURL(/#\/trip/)
    await expect(page.locator('h1').filter({ hasText: '大阪之旅' })).toBeVisible()
  })

  test('does not create trip before confirm', async ({ page }) => {
    await page.getByText('粘贴 JSON 草稿').click()
    await page.getByRole('button', { name: '加载示例草稿' }).click()
    await page.getByRole('button', { name: '解析草稿' }).click()
    await page.goto('/#/home')
    await expect(page.locator('h1').filter({ hasText: '东京五日游' })).not.toBeVisible()
  })

  test('does not create trip from generated draft before confirm', async ({ page }) => {
    await page.getByLabel(/目的地/).fill('京都')
    await page.getByLabel(/开始日期/).fill('2025-09-01')
    await page.getByLabel(/结束日期/).fill('2025-09-02')
    await page.getByRole('button', { name: '生成本地示例草稿' }).click()
    await expect(page.getByText('草稿摘要')).toBeVisible()
    await page.goto('/#/home')
    await expect(page.locator('h1').filter({ hasText: '京都之旅' })).not.toBeVisible()
  })

  test('390px viewport does not overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByLabel(/目的地/).fill('东京')
    await page.getByLabel(/开始日期/).fill('2025-06-01')
    await page.getByLabel(/结束日期/).fill('2025-06-03')
    await page.getByRole('button', { name: '生成本地示例草稿' }).click()
    await expect(page.getByText('草稿摘要')).toBeVisible()
    const body = await page.evaluate(() => document.body.scrollWidth)
    expect(body).toBeLessThanOrEqual(390)
  })
})
