import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import {
  clearTravelDatabase,
  expectNoHorizontalOverflow,
  forceRouteProxyFixture,
  forceSupabaseUnconfigured,
} from './helpers'

const fixturesDir = path.join(process.cwd(), 'e2e', 'fixtures')

async function openAiTripImportSection(page: Page) {
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
    guide.getByText(/已复制提示词。|当前浏览器不支持自动复制，请手动复制说明中的提示词。/),
  ).toBeVisible()

  await page
    .getByTestId('ai-trip-plan-file-input')
    .setInputFiles(path.join(fixturesDir, 'trip-plan-basic.json'))

  const preview = page.getByTestId('ai-trip-plan-preview')
  await expect(preview).toBeVisible()
  await expect(preview).toContainText('AI 测试东京旅行')
  await expect(preview.getByText('行程点', { exact: true })).toBeVisible()
  await expect(page.getByTestId('ai-trip-plan-validation-status')).toContainText('可导入')

  await page.getByTestId('ai-trip-plan-import-button').click()
  const checklist = page.getByTestId('ai-trip-plan-success-checklist')
  await expect(checklist).toBeVisible()
  await expect(checklist.getByText('地图坐标是否准确')).toBeVisible()
  await expect(checklist.getByText('可生成路线的日程是否需要批量生成路线预览')).toBeVisible()
  await checklist.getByRole('button', { name: '进入旅行工作台' }).click()
  await expect(page).toHaveURL(/#\/trip\?tripId=/)
  await page.getByRole('button', { name: /抵达与涩谷/ }).click()
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=schedule/)
  await expect(page.getByTestId('day-selector')).toBeVisible()
  await expect(page.getByRole('button', { name: /Hotel Metropolitan Tokyo 入住/ })).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('AI 行程导入完成页列出可生成路线日程并在确认后批量生成', async ({ page }) => {
  await clearTravelDatabase(page)
  await forceSupabaseUnconfigured(page)
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
            distanceMeters: 900,
            durationSeconds: 480,
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
  await page.goto('/#/settings', { waitUntil: 'domcontentloaded' })
  await forceRouteProxyFixture(page)
  await openAiTripImportSection(page)

  await page
    .getByTestId('ai-trip-plan-file-input')
    .setInputFiles(path.join(fixturesDir, 'trip-plan-route-ready.json'))
  await expect(page.getByTestId('ai-trip-plan-validation-status')).toContainText('可导入')
  await page.getByTestId('ai-trip-plan-import-button').click()

  const panel = page.getByTestId('import-route-generation-panel')
  await expect(panel).toBeVisible()
  await expect(panel.getByTestId('import-route-generation-summary')).toContainText('已找到 1 天可生成路线')
  await expect(panel.getByTestId('import-route-generation-day')).toContainText('步行与驾车测试日')
  await expect(panel.getByTestId('import-route-generation-day-list')).not.toContainText('坐标不足')
  expect(routePreviewRequests).toBe(0)
  expect(await readRouteCacheEntryCount(page)).toBe(0)

  await panel.getByTestId('import-route-generate-button').click()
  const dialog = page.getByTestId('import-route-generation-confirm-dialog')
  await expect(dialog).toContainText('确认后才会调用路线服务')
  expect(routePreviewRequests).toBe(0)
  await dialog.getByRole('button', { name: '暂不生成' }).click()
  expect(routePreviewRequests).toBe(0)
  expect(await readRouteCacheEntryCount(page)).toBe(0)

  await panel.getByTestId('import-route-generate-button').click()
  await page.getByTestId('import-route-generation-confirm-dialog').getByRole('button', { name: '确认生成' }).click()
  await expect(panel.getByTestId('import-route-generation-result')).toContainText('已生成 1 天路线预览')
  expect(routePreviewRequests).toBeGreaterThan(0)
  expect(await readRouteCacheEntryCount(page)).toBeGreaterThan(0)
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
  await page.getByRole('button', { name: /缺坐标测试日/ }).click()
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=schedule/)
  await expect(page.getByRole('button', { name: /无坐标餐厅/ })).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

async function readRouteCacheEntryCount(page: Page) {
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
