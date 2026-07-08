import { expect, test, type Page } from '@playwright/test'
import { clearTravelDatabase, clickTripCard, expectNoHorizontalOverflow } from './helpers'

test('全局 AI 在无旅行上下文时离线回答能力问题', async ({ page }) => {
  await clearTravelDatabase(page)
  const providerProxyRequests: string[] = []
  await page.route('**/api/provider-proxy', (route) => {
    providerProxyRequests.push(route.request().url())
    return route.abort()
  })

  await expect(page.getByTestId('global-ai-command-bar')).toBeVisible()
  await expect(page.getByTestId('global-ai-context-label')).toContainText('全部旅行')
  await page.getByLabel('全局 AI 指令').fill('你能做什么？')
  await page.getByRole('button', { name: '发送 AI 指令' }).click()

  const result = page.getByTestId('global-ai-command-result')
  await expect(result).toContainText('我能帮你做什么')
  await expect(page.getByTestId('global-ai-help-result')).toContainText('预览和确认')
  expect(providerProxyRequests).toHaveLength(0)
  await expectNoHorizontalOverflow(page)
})

test('全局 AI 输入在移动端承接 what-if 重排且预览不落库', async ({ page }) => {
  await clearTravelDatabase(page)

  const commandBar = page.getByTestId('global-ai-command-bar')
  await expect(commandBar).toBeVisible()
  await expect(page.getByLabel('全局 AI 指令')).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await expectCommandBarAboveBottomTab(page)

  await page.getByRole('button', { name: '创建示例旅行' }).click()
  const tripCard = page.getByTestId('trip-card').filter({ hasText: '东京春日旅行' })
  await expect(tripCard).toBeVisible()
  await clickTripCard(tripCard)
  await expect(page).toHaveURL(/#\/trip\?tripId=/)
  await page.getByRole('button', { name: /抵达与涩谷/ }).click()
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page.getByTestId('global-ai-context-label')).toContainText(/Day|当前日期/)

  await expect(commandBar).toBeVisible()
  await expectCommandBarAboveBottomTab(page)
  await expect(await countStore(page, 'tripReplanEvents')).toBe(0)
  await expect(await countStore(page, 'tripReplanRecords')).toBe(0)

  await page.getByLabel('全局 AI 指令').fill('如果我晚到 45 分钟怎么办？')
  await page.getByRole('button', { name: '发送 AI 指令' }).click()

  const result = page.getByTestId('global-ai-command-result')
  await expect(result).toContainText('What-if 重排预览')
  await expect(result).toContainText('确认应用前不会创建事件或同步云端')
  await expect(page.getByTestId('global-ai-action-proposal')).toContainText('Live Mode 重排建议')
  await expect(result.getByRole('button', { name: '确认应用重排' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await expect(await countStore(page, 'tripReplanEvents')).toBe(0)
  await expect(await countStore(page, 'tripReplanRecords')).toBe(0)

  await result.getByRole('button', { name: '确认应用重排' }).click()
  await expect(page.getByTestId('global-ai-write-confirm-dialog')).toBeVisible()
  await page.getByRole('button', { name: '写入' }).click()
  await expect(page.getByText(/已应用模拟重排|已应用突发重排/)).toBeVisible()
  await expect(await countStore(page, 'tripReplanEvents')).toBeGreaterThan(0)
  await expect(await countStore(page, 'tripReplanRecords')).toBeGreaterThan(0)
  await expect(await countStore(page, 'tripIntelligenceAppliedChanges')).toBeGreaterThan(0)
})

test('全局 AI 普通咨询走助手回答且不触发写入确认', async ({ page }) => {
  await clearTravelDatabase(page)
  const providerProxyRequests: string[] = []
  await page.route('**/api/provider-proxy', (route) => {
    providerProxyRequests.push(route.request().url())
    return route.abort()
  })

  const commandBar = page.getByTestId('global-ai-command-bar')
  await expect(commandBar).toBeVisible()
  await page.getByRole('button', { name: '创建示例旅行' }).click()
  const tripCard = page.getByTestId('trip-card').filter({ hasText: '东京春日旅行' })
  await expect(tripCard).toBeVisible()
  await clickTripCard(tripCard)
  await page.getByRole('button', { name: /抵达与涩谷/ }).click()
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page.getByTestId('global-ai-context-label')).toContainText(/Day|当前日期/)

  await page.getByLabel('全局 AI 指令').fill('今天接下来应该先确认什么？')
  await page.getByRole('button', { name: '发送 AI 指令' }).click()

  const result = page.getByTestId('global-ai-command-result')
  await expect(result).toContainText('旅图助手')
  await expect(page.getByTestId('global-ai-assistant-answer-result')).toContainText('当前正在看')
  await expect(result).toContainText('我看到')
  await expect(page.getByTestId('global-ai-send-confirm-dialog')).not.toBeVisible()
  await expectNoHorizontalOverflow(page)
  expect(providerProxyRequests.length).toBeLessThanOrEqual(1)
  await expect(await countStore(page, 'tripReplanEvents')).toBe(0)
  await expect(await countStore(page, 'tripReplanRecords')).toBe(0)
})

test('全局 AI 会话面板支持上下文切换和内存清空', async ({ page }) => {
  await clearTravelDatabase(page)
  await page.route('**/api/provider-proxy', (route) => route.abort())

  await expect(page.getByTestId('global-ai-command-bar')).toBeVisible()
  await page.getByRole('button', { name: '创建示例旅行' }).click()
  const tripCard = page.getByTestId('trip-card').filter({ hasText: '东京春日旅行' })
  await expect(tripCard).toBeVisible()
  await clickTripCard(tripCard)
  await expect(page.getByTestId('global-ai-context-label')).toContainText('当前旅行')

  await page.getByRole('button', { name: '展开 AI 会话' }).click()
  await expect(page.getByTestId('global-ai-conversation-panel')).toBeVisible()
  await expect(page.getByTestId('global-ai-conversation-messages')).toContainText('还没有对话')

  await page.getByTestId('global-ai-context-switch').getByRole('button', { name: '全部旅行' }).click()
  await expect(page.getByTestId('global-ai-context-label')).toContainText('全部旅行')

  await page.getByLabel('全局 AI 指令').fill('你能做什么？')
  await page.getByRole('button', { name: '发送 AI 指令' }).click()
  await expect(page.getByTestId('global-ai-conversation-messages')).toContainText('你')
  await expect(page.getByTestId('global-ai-conversation-messages')).toContainText('助手')

  await page.getByRole('button', { name: '清空 AI 会话' }).click()
  await expect(page.getByTestId('global-ai-conversation-messages')).toContainText('还没有对话')
  await expectNoHorizontalOverflow(page)
})

async function expectCommandBarAboveBottomTab(page: Page) {
  const commandBox = await page.getByTestId('global-ai-command-bar').boundingBox()
  const tabBox = await page.locator('nav').filter({ has: page.getByRole('button', { name: '首页' }) }).boundingBox()

  expect(commandBox, 'global AI command bar is visible').not.toBeNull()
  expect(tabBox, 'bottom tab bar is visible').not.toBeNull()
  expect(commandBox!.y + commandBox!.height, 'global AI command bar stays above bottom tabs').toBeLessThanOrEqual(tabBox!.y - 4)
}

async function countStore(page: Page, storeName: string) {
  return await page.evaluate(async (nextStoreName) => {
    const request = indexedDB.open('TravelConsoleDB')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('打开测试数据库失败'))
    })

    if (!db.objectStoreNames.contains(nextStoreName)) {
      db.close()
      return 0
    }

    return await new Promise<number>((resolve, reject) => {
      const transaction = db.transaction(nextStoreName, 'readonly')
      const countRequest = transaction.objectStore(nextStoreName).count()
      countRequest.onsuccess = () => resolve(countRequest.result)
      countRequest.onerror = () => reject(countRequest.error ?? new Error('读取测试数据库失败'))
      transaction.oncomplete = () => db.close()
      transaction.onerror = () => {
        db.close()
        reject(transaction.error ?? new Error('读取测试数据库失败'))
      }
    })
  }, storeName)
}
