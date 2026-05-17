import { expect, test } from '@playwright/test'
import {
  createDemoTripViaUi,
  expectNoHorizontalOverflow,
  forceSupabaseUnconfigured,
  getHashParam,
} from './helpers'

test('旅行工作台可以在日程和地图视图之间切换', async ({ page }) => {
  const tripId = await createDemoTripViaUi(page)
  expect(tripId).toBeTruthy()

  await expect(page.getByText('当天日程')).toBeVisible()
  await expect(page.getByText('Hotel Metropolitan Tokyo 入住')).toBeVisible()
  await expect(page).toHaveURL(/#\/day\?/)
  await expectNoHorizontalOverflow(page)

  await page.getByTestId('view-switch-map').click()
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=map/)
  await expect(page.getByTestId('map-sheet')).toBeVisible()
  await expect(page.getByRole('heading', { name: '抵达与涩谷' })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.getByTestId('view-switch-schedule').click()
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=schedule/)
  await expect(page.getByText('当天日程')).toBeVisible()
  await expect(page.getByText('Hotel Metropolitan Tokyo 入住')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.getByTestId('view-switch-map').click()
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=map/)
  await expect(page.getByTestId('map-sheet')).toBeVisible()
  await expect(page.getByRole('heading', { name: '抵达与涩谷' })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.getByTestId('day-selector').getByRole('button', { name: /Day 2/ }).click()
  await expect(page).toHaveURL(/view=map/)
  await expect(page.getByTestId('map-sheet')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  const currentTripId = getHashParam(page.url(), 'tripId')
  const currentDayId = getHashParam(page.url(), 'dayId')
  expect(currentTripId).toBe(tripId)
  expect(currentDayId).toBeTruthy()

  await page.goto(`/#/trip?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('每日行程')).toBeVisible()
  await expect(page.getByText('第一天')).toBeVisible()
  await expect(page.getByText('第二天')).toBeVisible()
  await expect(page.getByText('抵达与涩谷')).toBeVisible()
  await expect(page.getByText('浅草与东京站')).toBeVisible()
  await expect(page.getByText('2026年4月12日')).toBeVisible()
  await expect(page.getByText('3 个行程点')).toBeVisible()
  const mapOverview = page.getByTestId('trip-map-overview')
  await expect(mapOverview).toBeVisible()
  await expect(mapOverview).toContainText('旅行地图')
  await expect(mapOverview).toContainText('5 个有坐标地点')
  await mapOverview.getByRole('button', { name: '查看地图' }).click()
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=map/)
  await expect(page.getByTestId('map-sheet')).toBeVisible()

  await page.goto(`/#/trip?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })

  await page.getByRole('button', { name: '更多' }).click()
  const moreMenu = page.getByTestId('trip-more-menu')
  await expect(moreMenu).toBeVisible()
  await expect(moreMenu.getByRole('button', { name: '设置' })).toBeVisible()
  await expect(moreMenu.getByText('设置与存储说明')).toHaveCount(0)
  await expect(moreMenu.getByText(/Google Maps 配置|路线服务配置|设备存储/)).toHaveCount(0)
  await moreMenu.getByRole('button', { name: '更多' }).click()
  await expectNoHorizontalOverflow(page)

  await page.goto(`/#/trip?tripId=${tripId}&dayId=${currentDayId}&view=map`, { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=map/)

  await page.goto(`/#/tickets?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('票据库')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await forceSupabaseUnconfigured(page)
  await page.goto(`/#/settings?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('PWA 和离线使用')).toBeVisible()
  await page.getByText('关于', { exact: true }).click()
  await expect(page.getByText(/当前版本：v\d+\.\d+\.\d+(?:\.\d+)?/)).toBeVisible()
  await expectNoHorizontalOverflow(page)
})
