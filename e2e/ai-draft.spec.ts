import { test, expect } from '@playwright/test'

test.describe('AI Draft Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#/ai-draft')
  })

  test('shows paste area and sample draft button', async ({ page }) => {
    await expect(page.getByRole('textbox')).toBeVisible()
    await expect(page.getByRole('button', { name: '加载示例草稿' })).toBeVisible()
    await expect(page.getByRole('button', { name: '解析草稿' })).toBeVisible()
  })

  test('loads sample draft', async ({ page }) => {
    await page.getByRole('button', { name: '加载示例草稿' }).click()
    const textarea = page.getByRole('textbox')
    const value = await textarea.inputValue()
    expect(value).toContain('东京五日游')
  })

  test('shows validation errors for invalid draft', async ({ page }) => {
    await page.getByRole('textbox').fill('{"title": ""}')
    await page.getByRole('button', { name: '解析草稿' }).click()
    await expect(page.getByText('验证错误')).toBeVisible()
    await expect(page.getByText('旅行标题不能为空。')).toBeVisible()
  })

  test('shows summary for valid draft', async ({ page }) => {
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
    await page.getByRole('button', { name: '加载示例草稿' }).click()
    await page.getByRole('button', { name: '解析草稿' }).click()
    await expect(page.getByText('行程预览')).toBeVisible()
    await expect(page.locator('li').filter({ hasText: '浅草寺' }).first()).toBeVisible()
    await expect(page.locator('li').filter({ hasText: '明治神宫' }).first()).toBeVisible()
  })

  test('shows privacy notice', async ({ page }) => {
    await page.getByRole('button', { name: '加载示例草稿' }).click()
    await page.getByRole('button', { name: '解析草稿' }).click()
    await expect(page.getByText('当前仅在本机解析草稿，不会调用外部 AI。')).toBeVisible()
    await expect(page.getByText('确认导入后才会写入本地旅行。')).toBeVisible()
  })

  test('shows confirm button only for valid draft', async ({ page }) => {
    await expect(page.getByRole('button', { name: '确认导入' })).not.toBeVisible()
    await page.getByRole('button', { name: '加载示例草稿' }).click()
    await page.getByRole('button', { name: '解析草稿' }).click()
    await expect(page.getByRole('button', { name: '确认导入' })).toBeVisible()
  })

  test('shows confirm dialog on import click', async ({ page }) => {
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

  test('creates trip on confirm', async ({ page }) => {
    await page.getByRole('button', { name: '加载示例草稿' }).click()
    await page.getByRole('button', { name: '解析草稿' }).click()
    await page.getByRole('button', { name: '确认导入' }).click()
    await page.getByRole('dialog').getByRole('button', { name: '确认导入' }).click()
    await page.waitForURL(/#\/trip/)
    await expect(page.locator('h1').filter({ hasText: '东京五日游' })).toBeVisible()
  })

  test('does not create trip before confirm', async ({ page }) => {
    await page.getByRole('button', { name: '加载示例草稿' }).click()
    await page.getByRole('button', { name: '解析草稿' }).click()
    await page.goto('/#/home')
    await expect(page.locator('h1').filter({ hasText: '东京五日游' })).not.toBeVisible()
  })

  test('390px viewport does not overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: '加载示例草稿' }).click()
    await page.getByRole('button', { name: '解析草稿' }).click()
    const body = await page.evaluate(() => document.body.scrollWidth)
    expect(body).toBeLessThanOrEqual(390)
  })
})
