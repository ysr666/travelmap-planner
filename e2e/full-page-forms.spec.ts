import { expect, test } from '@playwright/test'
import {
  clearTravelDatabase,
  createDemoTripViaUi,
  expectNoHorizontalOverflow,
} from './helpers'

async function getDemoIds(page: import('@playwright/test').Page, tripId: string) {
  return page.evaluate(async (tid) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('TravelConsoleDB')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })

    const tx = db.transaction(['days', 'itineraryItems'], 'readonly')
    const daysStore = tx.objectStore('days')
    const itemsStore = tx.objectStore('itineraryItems')

    const daysIndex = daysStore.index('tripId')
    const days = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      const req = daysIndex.getAll(tid)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })

    const day = days[0]
    if (!day) return { dayId: null, itemId: null }

    const itemsIndex = itemsStore.index('dayId')
    const items = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      const req = itemsIndex.getAll(day.id as string)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })

    db.close()
    return { dayId: day.id as string, itemId: (items[0]?.id as string) ?? null }
  }, tripId)
}

test('新建旅行页面可以创建旅行并跳转到工作台', async ({ page }) => {
  await clearTravelDatabase(page)

  await page.getByRole('button', { name: '新建旅行' }).click()
  await expect(page).toHaveURL(/#\/trip\/new/)
  await expect(page.getByTestId('trip-form-page')).toBeVisible()
  await expect(page.getByRole('heading', { name: '新建旅行' })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.getByLabel('旅行标题').fill('测试旅行')
  await page.getByLabel('目的地').fill('北京')
  await page.getByLabel('开始日期').fill('2026-06-01')
  await page.getByLabel('结束日期').fill('2026-06-03')
  await page.getByTestId('trip-form-submit').click()

  await expect(page).toHaveURL(/#\/trip\?tripId=/)
  await expect(page.locator('h2').filter({ hasText: '测试旅行' })).toBeVisible()
  await expect(page.getByTestId('trip-map-overview')).toContainText('行程地图预览')
  await expect(page.getByTestId('trip-map-overview')).toContainText('还没有可显示的坐标')
  await expect(page.getByTestId('trip-map-overview')).toContainText('给行程点补充坐标后，这里会显示地图预览。')
  await expect(page.getByTestId('trip-map-overview').getByRole('button', { name: '查看地图' })).toBeVisible()
})

test('新建旅行页面取消按钮返回首页', async ({ page }) => {
  await clearTravelDatabase(page)

  await page.getByRole('button', { name: '新建旅行' }).click()
  await expect(page).toHaveURL(/#\/trip\/new/)

  await page.getByTestId('trip-form-cancel').click()
  await expect(page).toHaveURL(/#\/home/)
})

test('编辑旅行页面可以修改并保存', async ({ page }) => {
  const tripId = await createDemoTripViaUi(page)

  await page.goto(`/#/trip/edit?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('trip-form-page')).toBeVisible()
  await expect(page.getByRole('heading', { name: '编辑旅行' })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  const titleInput = page.getByLabel('旅行标题')
  await expect(titleInput).toHaveValue('东京春日旅行')

  await titleInput.fill('东京春日旅行 v2')
  await page.getByTestId('trip-form-submit').click()

  await expect(page).toHaveURL(/#\/trip\?tripId=/)
})

test('新增行程点页面可以创建并返回日程', async ({ page }) => {
  const tripId = await createDemoTripViaUi(page)
  const { dayId } = await getDemoIds(page, tripId)
  expect(dayId).toBeTruthy()

  await page.goto(`/#/item/new?tripId=${tripId}&dayId=${dayId}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('item-form-page')).toBeVisible()
  await expect(page.getByRole('heading', { name: '新增行程点' })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.getByLabel('行程标题').fill('新景点')
  await page.getByRole('button', { name: '新增行程点' }).click()

  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=schedule/)
})

test('编辑行程点页面可以修改并保存', async ({ page }) => {
  const tripId = await createDemoTripViaUi(page)
  const { dayId, itemId } = await getDemoIds(page, tripId)
  expect(dayId).toBeTruthy()
  expect(itemId).toBeTruthy()

  await page.goto(`/#/item/edit?tripId=${tripId}&dayId=${dayId}&itemId=${itemId}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('item-form-page')).toBeVisible()
  await expect(page.getByRole('heading', { name: '编辑行程点' })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  const titleInput = page.getByLabel('行程标题')
  await expect(titleInput).not.toBeEmpty()

  await titleInput.fill('修改后的景点')
  await page.getByRole('button', { name: '保存修改' }).click()

  await expect(page).toHaveURL(/#\/item\?tripId=/)
})

test('缺少参数时显示错误并可返回', async ({ page }) => {
  await clearTravelDatabase(page)

  await page.goto('/#/trip/edit', { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('缺少旅行 ID')).toBeVisible()

  await page.goto('/#/item/new?tripId=fake', { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('缺少旅行或日程 ID')).toBeVisible()

  await page.goto('/#/item/edit?tripId=fake&dayId=fake', { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('缺少行程点 ID')).toBeVisible()
})
