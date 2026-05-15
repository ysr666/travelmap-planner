import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { clearTravelDatabase, expectNoHorizontalOverflow, forceSupabaseUnconfigured } from './helpers'

const fixturesDir = path.join(process.cwd(), 'e2e', 'fixtures')

async function openAiTripImportSection(page: Page) {
  await page.getByText('AI 行程导入', { exact: true }).click()
  await expect(page.getByRole('heading', { name: '导入 AI 行程包' })).toBeVisible()
}

test('可以导入 AI 行程 JSON 并进入旅行工作台', async ({ page }) => {
  await clearTravelDatabase(page)
  await forceSupabaseUnconfigured(page)
  await page.goto('/#/settings', { waitUntil: 'domcontentloaded' })

  await openAiTripImportSection(page)
  const guide = page.getByTestId('ai-trip-plan-guide')
  await expect(guide).toBeVisible()
  await expect(guide.getByText('JSON 单文件', { exact: true })).toBeVisible()
  await expect(guide.getByText('zip 行程包', { exact: true })).toBeVisible()
  await expect(page.getByTestId('ai-trip-plan-prompt-text')).toBeVisible()
  await page.getByTestId('ai-trip-plan-copy-prompt').click()
  await expect(
    page.getByText(/已复制提示词。|当前浏览器不支持自动复制，请手动复制说明中的提示词。/),
  ).toBeVisible()

  await page
    .getByTestId('ai-trip-plan-file-input')
    .setInputFiles(path.join(fixturesDir, 'trip-plan-basic.json'))

  const preview = page.getByTestId('ai-trip-plan-preview')
  await expect(preview).toBeVisible()
  await expect(page.getByText('AI 测试东京旅行')).toBeVisible()
  await expect(preview.getByText('行程点', { exact: true })).toBeVisible()
  await expect(page.getByTestId('ai-trip-plan-validation-status')).toContainText('可导入')

  await page.getByTestId('ai-trip-plan-import-button').click()
  const checklist = page.getByTestId('ai-trip-plan-success-checklist')
  await expect(checklist).toBeVisible()
  await expect(checklist.getByText('地图坐标是否准确')).toBeVisible()
  await checklist.getByRole('button', { name: '进入旅行工作台' }).click()
  await expect(page).toHaveURL(/#\/trip\?tripId=/)
  await expect(page.getByRole('heading', { name: 'AI 测试东京旅行' }).first()).toBeVisible()
  await page.getByText('第一天', { exact: true }).click()
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=schedule/)
  await expect(page.getByTestId('day-selector')).toBeVisible()
  await expect(page.getByText('Hotel Metropolitan Tokyo 入住')).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('JSON 单文件出现 copy 票据时阻止导入', async ({ page }) => {
  await clearTravelDatabase(page)
  await forceSupabaseUnconfigured(page)
  await page.goto('/#/settings', { waitUntil: 'domcontentloaded' })
  await openAiTripImportSection(page)

  await page
    .getByTestId('ai-trip-plan-file-input')
    .setInputFiles(path.join(fixturesDir, 'trip-plan-invalid-copy.json'))

  await expect(page.getByTestId('ai-trip-plan-preview')).toBeVisible()
  await expect(page.getByTestId('ai-trip-plan-validation-status')).toContainText('必须修复')
  await expect(page.getByTestId('ai-trip-plan-errors')).toContainText('JSON 单文件不支持 copy 模式票据')
  await expect(page.getByTestId('ai-trip-plan-import-button')).toBeDisabled()
  await expectNoHorizontalOverflow(page)
})

test('AI 行程包有建议检查时仍可导入', async ({ page }) => {
  await clearTravelDatabase(page)
  await forceSupabaseUnconfigured(page)
  await page.goto('/#/settings', { waitUntil: 'domcontentloaded' })
  await openAiTripImportSection(page)

  await page
    .getByTestId('ai-trip-plan-file-input')
    .setInputFiles(path.join(fixturesDir, 'trip-plan-warning-missing-coordinates.json'))

  const preview = page.getByTestId('ai-trip-plan-preview')
  await expect(preview).toBeVisible()
  await expect(page.getByTestId('ai-trip-plan-validation-status')).toContainText('建议检查')
  await expect(page.getByTestId('ai-trip-plan-warnings')).toContainText('缺少经纬度')
  await expect(page.getByTestId('ai-trip-plan-import-button')).toBeEnabled()
  await expect(page.getByTestId('ai-trip-plan-import-button')).toContainText('仍然导入')

  await page.getByTestId('ai-trip-plan-import-button').click()
  await expect(page.getByTestId('ai-trip-plan-success-checklist')).toBeVisible()
  await page.getByRole('button', { name: '进入旅行工作台' }).click()
  await expect(page).toHaveURL(/#\/trip\?tripId=/)
  await expect(page.getByRole('heading', { name: 'AI 缺坐标测试旅行' }).first()).toBeVisible()
  await page.getByText('第一天', { exact: true }).click()
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=schedule/)
  await expect(page.getByText('无坐标餐厅')).toBeVisible()
  await expectNoHorizontalOverflow(page)
})
