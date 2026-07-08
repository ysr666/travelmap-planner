import { expect, test } from '@playwright/test'
import {
  clearTravelDatabase,
  clickTripCard,
  expectNoHorizontalOverflow,
  getFirstTripDayAndItemIds,
  getHashParam,
  mockMapStyle,
  openDetailsSection,
} from './helpers'

test('桌面 Beta smoke 覆盖核心页面与 AI 确认边界', async ({ page }) => {
  await mockMapStyle(page)

  let providerProxyRequests = 0
  await page.route('**/api/provider-proxy', async (route) => {
    providerProxyRequests += 1
    await route.fulfill({
      body: JSON.stringify({ error: 'desktop smoke must not call provider proxy', ok: false }),
      contentType: 'application/json',
      status: 500,
    })
  })

  await clearTravelDatabase(page)
  await expect(page.getByRole('heading', { name: '还没有旅行' })).toBeVisible()
  await expect(page.getByTestId('global-ai-command-bar')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.getByRole('button', { name: '创建示例旅行' }).click()
  const tripCard = page.getByTestId('trip-card').filter({ hasText: '东京春日旅行' })
  await expect(tripCard).toBeVisible()
  await clickTripCard(tripCard)
  await expect(page).toHaveURL(/#\/trip\?tripId=/)

  const tripId = getHashParam(page.url(), 'tripId')
  expect(tripId).toBeTruthy()
  const { dayId, firstItemId } = await getFirstTripDayAndItemIds(page, tripId!)

  await expect(page.getByText('更多工具与详情')).toBeVisible()
  await expect(page.getByTestId('trip-operations-panel')).toBeHidden()
  await openDetailsSection(page, '更多工具与详情')
  const operationsPanel = page.getByTestId('trip-operations-panel')
  await expect(operationsPanel).toBeVisible()
  await expect(operationsPanel).toContainText('现在建议做什么')
  await expect(page.getByTestId('trip-map-overview')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.goto(`/#/day?tripId=${tripId}&dayId=${dayId}&view=map`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('map-marker-card')).toBeVisible({ timeout: 15000 })
  await expect(page.getByTestId('view-switch-schedule')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.goto(`/#/item?tripId=${tripId}&dayId=${dayId}&itemId=${firstItemId}&view=schedule`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('item-detail-page')).toBeVisible()
  await expect(page.getByTestId('item-field-action-deck')).toBeVisible()
  await expect(page.getByTestId('item-detail-tickets')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.goto(`/#/tickets?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(new RegExp(`#/documents\\?tripId=${tripId}&tab=attachments`))
  await expect(page.getByRole('heading', { name: '票据和订单' })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.goto(`/#/ledger?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: /旅行账本|建立旅行账本/ })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.goto(`/#/documents?tripId=${tripId}&tab=documents`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: '旅行资料中心' })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.goto(`/#/settings?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: '设置' })).toBeVisible()
  await openDetailsSection(page, '外观')
  await expect(page.getByTestId('appearance-mode-system')).toBeVisible()
  await openDetailsSection(page, '路线服务')
  await expect(page.getByTestId('routing-settings-section')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.goto(`/#/day?tripId=${tripId}&dayId=${dayId}&view=schedule`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('global-ai-command-bar')).toBeVisible()
  await page.getByLabel('全局 AI 指令').fill('如果我晚到 45 分钟怎么办？')
  await page.getByRole('button', { name: '发送 AI 指令' }).click()

  const result = page.getByTestId('global-ai-command-result')
  await expect(result).toContainText('What-if 重排预览')
  await expect(result).toContainText('确认应用前不会创建事件或同步云端')
  await expect(result.getByRole('button', { name: '确认应用重排' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  expect(providerProxyRequests).toBe(0)
})
