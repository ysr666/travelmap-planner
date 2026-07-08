import { expect, test, type Page } from '@playwright/test'
import {
  createDemoTripViaUi,
  expectNoHorizontalOverflow,
} from './helpers'

const layoutViewports = [
  { height: 844, label: '390px', width: 390 },
  { height: 820, label: 'desktop', width: 1180 },
]

test('Phase 11 shared action and status surfaces avoid overflow on mobile and desktop widths', async ({ page }) => {
  for (const viewport of layoutViewports) {
    await page.setViewportSize({ height: viewport.height, width: viewport.width })
    const tripId = await createDemoTripViaUi(page)
    await seedReferenceTicketForFirstItem(page, tripId)

    const timeline = page.getByTestId('day-timeline')
    await expect(timeline.getByRole('group', { name: '日程操作' })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await timeline.getByRole('button', { name: '排序' }).click()
    await expect(timeline.getByText('这里只调整浏览和路线顺序')).toBeVisible()
    await expect(timeline.getByRole('group', { name: '日程操作' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await timeline.getByRole('button', { name: '取消' }).click()

    await page.goto(`/#/tickets?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('ticket-card')).toHaveCount(1)
    await expect(page.getByRole('group', { name: '酒店订单 PDF 操作' })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await page.goto('/#/settings', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: '安装与离线' })).toBeVisible()
    await expect(page.locator('main')).toContainText('地图和外部路线需要网络')
    await expectNoHorizontalOverflow(page)
  }
})

async function seedReferenceTicketForFirstItem(page: Page, tripId: string) {
  await page.evaluate(async (targetTripId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('TravelConsoleDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('打开测试数据库失败'))
    })

    const daysTx = db.transaction('days', 'readonly')
    const days = await new Promise<Array<{ id: string; sortOrder: number }>>((resolve, reject) => {
      const request = daysTx.objectStore('days').index('tripId').getAll(targetTripId)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('读取日程失败'))
    })
    await new Promise<void>((resolve, reject) => {
      daysTx.oncomplete = () => resolve()
      daysTx.onerror = () => reject(daysTx.error ?? new Error('读取日程事务失败'))
      daysTx.onabort = () => reject(daysTx.error ?? new Error('读取日程事务中断'))
    })
    const firstDay = days.sort((first, second) => first.sortOrder - second.sortOrder)[0]
    if (!firstDay) throw new Error('示例旅行没有日程')

    const itemsTx = db.transaction('itineraryItems', 'readonly')
    const items = await new Promise<Array<{ id: string; sortOrder: number; ticketIds?: string[] }>>((resolve, reject) => {
      const request = itemsTx.objectStore('itineraryItems').index('dayId').getAll(firstDay.id)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('读取行程点失败'))
    })
    await new Promise<void>((resolve, reject) => {
      itemsTx.oncomplete = () => resolve()
      itemsTx.onerror = () => reject(itemsTx.error ?? new Error('读取行程点事务失败'))
      itemsTx.onabort = () => reject(itemsTx.error ?? new Error('读取行程点事务中断'))
    })
    const firstItem = items.sort((first, second) => first.sortOrder - second.sortOrder)[0]
    if (!firstItem) throw new Error('示例旅行没有行程点')

    const now = Date.now()
    const ticketId = `design_system_layout_${now}`
    const writeTx = db.transaction(['itineraryItems', 'ticketMetas'], 'readwrite')
    writeTx.objectStore('ticketMetas').put({
      createdAt: now,
      fileName: 'hotel-order.pdf',
      fileType: 'pdf',
      id: ticketId,
      itemId: firstItem.id,
      mimeType: 'application/pdf',
      referenceLocation: 'iCloud Drive/TripMap/酒店订单.pdf',
      scope: 'item',
      size: 0,
      storageMode: 'reference',
      ticketCategory: 'hotel_booking',
      title: '酒店订单 PDF',
      tripId: targetTripId,
      updatedAt: now,
    })
    writeTx.objectStore('itineraryItems').put({
      ...firstItem,
      ticketIds: [...(firstItem.ticketIds ?? []), ticketId],
      updatedAt: now,
    })
    await new Promise<void>((resolve, reject) => {
      writeTx.oncomplete = () => resolve()
      writeTx.onerror = () => reject(writeTx.error ?? new Error('写入票据失败'))
      writeTx.onabort = () => reject(writeTx.error ?? new Error('写入票据中断'))
    })
    db.close()
  }, tripId)
}
