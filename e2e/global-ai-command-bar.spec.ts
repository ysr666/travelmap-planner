import { expect, test, type Page } from '@playwright/test'
import { clearTravelDatabase, clickTripCard, expectNoHorizontalOverflow } from './helpers'

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

  await expect(commandBar).toBeVisible()
  await expectCommandBarAboveBottomTab(page)
  await expect(await countStore(page, 'tripReplanEvents')).toBe(0)
  await expect(await countStore(page, 'tripReplanRecords')).toBe(0)

  await page.getByLabel('全局 AI 指令').fill('如果我晚到 45 分钟怎么办？')
  await page.getByRole('button', { name: '发送 AI 指令' }).click()

  const result = page.getByTestId('global-ai-command-result')
  await expect(result).toContainText('What-if 重排预览')
  await expect(result).toContainText('确认应用前不会创建事件或同步云端')
  await expect(result.getByRole('button', { name: '确认应用重排' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await expect(await countStore(page, 'tripReplanEvents')).toBe(0)
  await expect(await countStore(page, 'tripReplanRecords')).toBe(0)
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
