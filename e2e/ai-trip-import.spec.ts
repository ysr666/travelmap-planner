import path from 'node:path'
import { expect, test } from '@playwright/test'
import { clearTravelDatabase, expectNoHorizontalOverflow } from './helpers'

const fixturesDir = path.join(process.cwd(), 'e2e', 'fixtures')

test('可以导入 AI 行程 JSON 并进入旅行工作台', async ({ page }) => {
  await clearTravelDatabase(page)
  await page.goto('/#/settings', { waitUntil: 'domcontentloaded' })

  await expect(page.getByRole('heading', { name: '导入 AI 行程包' })).toBeVisible()
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
  await expect(preview.getByText('校验通过')).toBeVisible()

  await page.getByTestId('ai-trip-plan-import-button').click()
  await expect(page).toHaveURL(/#\/trip\?tripId=/)
  await expect(page.getByText('AI 测试东京旅行')).toBeVisible()
  await expect(page.getByTestId('day-selector')).toBeVisible()
  await expect(page.getByText('Hotel Metropolitan Tokyo 入住')).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('JSON 单文件出现 copy 票据时阻止导入', async ({ page }) => {
  await clearTravelDatabase(page)
  await page.goto('/#/settings', { waitUntil: 'domcontentloaded' })

  await page
    .getByTestId('ai-trip-plan-file-input')
    .setInputFiles(path.join(fixturesDir, 'trip-plan-invalid-copy.json'))

  await expect(page.getByTestId('ai-trip-plan-preview')).toBeVisible()
  await expect(page.getByText('JSON 单文件不支持 copy 模式票据')).toBeVisible()
  await expect(page.getByTestId('ai-trip-plan-import-button')).toBeDisabled()
  await expectNoHorizontalOverflow(page)
})
