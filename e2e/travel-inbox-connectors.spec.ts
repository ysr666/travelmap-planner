import { expect, test, type Page } from '@playwright/test'
import {
  clearTravelDatabase,
  createDemoTripViaUi,
  expectNoHorizontalOverflow,
  forceSupabaseUnconfigured,
  openDetailsSection,
  seedTravelRecords,
} from './helpers'

test('账号旅行收件箱在连接器后端未配置时保留本地能力', async ({ page }) => {
  await clearTravelDatabase(page)
  await forceSupabaseUnconfigured(page)
  await page.goto('/#/inbox', { waitUntil: 'domcontentloaded' })

  await expect(page.getByTestId('travel-inbox-page')).toBeVisible()
  await expect(page.getByRole('heading', { name: '收件箱', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '导入旅行材料' })).toBeVisible()
  await expect(page.getByRole('button', { exact: true, name: '导入材料' })).toHaveCount(1)
  await expect(page.getByRole('button', { name: '来源与导入 0' })).toBeVisible()
  await expect(page.getByRole('button', { name: '资料', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('button', { name: '连接 Gmail' })).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('账号旅行收件箱可从移动端文件选择器直接导入材料', async ({ page }) => {
  await clearTravelDatabase(page)
  await forceSupabaseUnconfigured(page)
  await page.route('**/api/provider-proxy', (route) => void route.abort())
  await page.goto('/#/inbox', { waitUntil: 'domcontentloaded' })

  await page.getByLabel('选择旅行材料').setInputFiles({
    buffer: Buffer.from('museum ticket'),
    mimeType: 'application/pdf',
    name: '爱丁堡城堡门票.pdf',
  })

  await expect(page.getByTestId('travel-inbox-source')).toHaveCount(1)
  await expect(page.getByText('爱丁堡城堡门票.pdf', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { exact: true, name: '待整理' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('Trip Home 用轻量入口保留材料输入并经资料页进入账号总收件箱', async ({ page }) => {
  const tripId = await createDemoTripViaUi(page)
  await page.goto(`/#/trip?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })

  await expect(page.getByTestId('travel-inbox-panel')).toHaveCount(0)
  await openDetailsSection(page, '旅行工具')
  await expect(page.getByTestId('trip-action-travel-inbox')).toBeVisible()
  await page.getByTestId('trip-action-travel-inbox').click()
  await expect(page.getByTestId('travel-inbox-panel')).toBeVisible()
  await page.getByRole('button', { name: '资料', exact: true }).click()
  await expect(page).toHaveURL(/#\/documents/)
  await expect(page.getByRole('heading', { exact: true, name: '资料' })).toBeVisible()
  await page.getByRole('button', { name: '来源与导入' }).click()
  await expect(page).toHaveURL(/#\/inbox/)
  await expect(page.getByTestId('travel-inbox-page')).toBeVisible()
})

test('账号旅行收件箱把待分配来源合并为一个移动端确认入口', async ({ page }) => {
  await clearTravelDatabase(page)
  await forceSupabaseUnconfigured(page)
  const now = Date.now()
  await seedTravelRecords(page, {
    trips: [{
      createdAt: now,
      destination: '英国',
      endDate: '2026-07-21',
      id: 'trip-inbox-batch',
      startDate: '2026-07-10',
      title: '英国12天家庭旅行',
      updatedAt: now,
    }],
  })
  await seedTravelInboxAccountSources(page, 2)

  let importRequests = 0
  await page.route('**/api/provider-proxy', async (route) => {
    const body = route.request().postDataJSON()
    expect(body.operation).toBe('ai_existing_trip_import')
    expect(body.sources).toHaveLength(2)
    importRequests += 1
    await route.fulfill({
      body: JSON.stringify({
        ok: true,
        operation: 'ai_existing_trip_import',
        result: {
          tickets: [{
            candidateId: 'ticket-1',
            confidence: 'high',
            sourceIds: [body.sources[0].id],
            title: '英国行程票据',
          }],
        },
        source: 'mock',
      }),
      contentType: 'application/json',
    })
  })

  await page.goto('/#/inbox', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: '整理 2 项' })).toBeVisible()
  await expect(page.getByTestId('travel-inbox-source')).toHaveCount(2)
  await page.getByRole('button', { name: '整理 2 项' }).click()

  await expect(page.getByText('已将 2 项整理为一个确认预览。')).toBeVisible()
  expect(importRequests).toBe(1)
  await expect(page.getByTestId('travel-inbox-source').filter({ hasText: '预览就绪' })).toHaveCount(2)
  await expectNoHorizontalOverflow(page)
  await expect.poll(() => readTravelInboxBatchState(page)).toEqual({
    accountSourceRefs: 2,
    previews: 1,
    previewReadySources: 2,
  })
})

async function seedTravelInboxAccountSources(page: Page, count: number) {
  await page.evaluate(async (sourceCount) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('TravelConsoleDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('打开测试数据库失败'))
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(
        ['travelInboxAccountSources', 'travelInboxAccountSourceBlobs'],
        'readwrite',
      )
      transaction.oncomplete = () => {
        db.close()
        resolve()
      }
      transaction.onerror = () => reject(transaction.error ?? new Error('写入收件箱测试数据失败'))
      transaction.onabort = () => reject(transaction.error ?? new Error('写入收件箱测试数据中断'))
      for (let index = 0; index < sourceCount; index += 1) {
        const sourceId = `batch-source-${index + 1}`
        const text = `2026-07-${String(index + 10).padStart(2, '0')} 英国票据 ${index + 1}`
        const blob = new Blob([text], { type: 'text/plain' })
        transaction.objectStore('travelInboxAccountSources').put({
          connectorId: 'local-folder-1',
          connectorKind: 'local_folder',
          createdAt: Date.now() + index,
          fileName: `ticket-${index + 1}.txt`,
          id: sourceId,
          label: `ticket-${index + 1}.txt`,
          mimeType: 'text/plain',
          receivedAt: Date.now() + index,
          size: blob.size,
          sourceKind: 'text_file',
          status: 'needs_assignment',
          updatedAt: Date.now() + index,
          warnings: [],
        })
        transaction.objectStore('travelInboxAccountSourceBlobs').put({ blob, sourceId })
      }
    })
  }, count)
}

async function readTravelInboxBatchState(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('TravelConsoleDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('打开测试数据库失败'))
    })
    try {
      const transaction = db.transaction(
        ['travelInboxAccountSources', 'travelInboxPreviews'],
        'readonly',
      )
      const sources = await new Promise<Array<{ status: string }>>((resolve, reject) => {
        const request = transaction.objectStore('travelInboxAccountSources').getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('读取收件箱来源失败'))
      })
      const previews = await new Promise<Array<{ accountSourceRefs?: string[] }>>((resolve, reject) => {
        const request = transaction.objectStore('travelInboxPreviews').getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('读取收件箱预览失败'))
      })
      return {
        accountSourceRefs: previews[0]?.accountSourceRefs?.length ?? 0,
        previews: previews.length,
        previewReadySources: sources.filter((source) => source.status === 'preview_ready').length,
      }
    } finally {
      db.close()
    }
  })
}
