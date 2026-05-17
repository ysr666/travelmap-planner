import { expect, test, type Page } from '@playwright/test'
import {
  createDemoTripViaUi,
  expectNoHorizontalOverflow,
} from './helpers'

type SeedTicket = {
  externalUrl?: string
  fileName: string
  fileType: 'image' | 'pdf' | 'other'
  mimeType: string
  referenceLocation?: string
  size: number
  storageMode: 'copy' | 'reference' | 'external'
  title: string
}

async function getFirstItemId(page: Page, tripId: string) {
  return page.evaluate(async (targetTripId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('TravelConsoleDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })

    const tx = db.transaction(['days', 'itineraryItems'], 'readonly')
    const days = await new Promise<Array<{ id: string; sortOrder: number }>>((resolve, reject) => {
      const request = tx.objectStore('days').index('tripId').getAll(targetTripId)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const firstDay = days.sort((first, second) => first.sortOrder - second.sortOrder)[0]
    if (!firstDay) {
      db.close()
      throw new Error('示例旅行没有日程')
    }

    const items = await new Promise<Array<{ id: string; sortOrder: number }>>((resolve, reject) => {
      const request = tx.objectStore('itineraryItems').index('dayId').getAll(firstDay.id)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    db.close()

    const firstItem = items.sort((first, second) => first.sortOrder - second.sortOrder)[0]
    if (!firstItem) {
      throw new Error('示例旅行没有行程点')
    }

    return firstItem.id
  }, tripId)
}

async function addTicketMetas(page: Page, tripId: string, itemId: string, tickets: SeedTicket[]) {
  await page.evaluate(async ({ targetTripId, targetItemId, seedTickets }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('TravelConsoleDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })

    const tx = db.transaction(['itineraryItems', 'ticketMetas'], 'readwrite')
    const itemsStore = tx.objectStore('itineraryItems')
    const ticketsStore = tx.objectStore('ticketMetas')
    const now = Date.now()
    const ticketIds: string[] = []

    for (let index = 0; index < seedTickets.length; index += 1) {
      const seedTicket = seedTickets[index]
      const id = `ticket_library_e2e_${now}_${index}`
      ticketIds.push(id)
      await new Promise<void>((resolve, reject) => {
        const request = ticketsStore.add({
          createdAt: now + index,
          externalUrl: seedTicket.externalUrl,
          fileName: seedTicket.fileName,
          fileType: seedTicket.fileType,
          id,
          itemId: targetItemId,
          mimeType: seedTicket.mimeType,
          referenceLocation: seedTicket.referenceLocation,
          scope: 'item',
          size: seedTicket.size,
          storageMode: seedTicket.storageMode,
          title: seedTicket.title,
          tripId: targetTripId,
          updatedAt: now + index,
        })
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
    }

    const item = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = itemsStore.get(targetItemId)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    item.ticketIds = [...((item.ticketIds as string[] | undefined) ?? []), ...ticketIds]
    item.updatedAt = Date.now()
    await new Promise<void>((resolve, reject) => {
      const request = itemsStore.put(item)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })

    db.close()
  }, { targetTripId: tripId, targetItemId: itemId, seedTickets: tickets })
}

const ticketSeeds: SeedTicket[] = [
  {
    fileName: 'hotel-order.pdf',
    fileType: 'pdf',
    mimeType: 'application/pdf',
    referenceLocation: 'iCloud Drive/TravelMap/酒店订单与入住确认/hotel-order.pdf',
    size: 0,
    storageMode: 'reference',
    title: '酒店订单 PDF',
  },
  {
    externalUrl: 'https://example.com/tickets/tokyo-skytree-super-long-order-number-20260412-abcdef',
    fileName: 'tokyo-ticket-link.url',
    fileType: 'other',
    mimeType: 'text/uri-list',
    size: 0,
    storageMode: 'external',
    title: '电子门票链接 with very long English title that should wrap safely',
  },
  {
    fileName: 'qr-code.png',
    fileType: 'image',
    mimeType: 'image/png',
    size: 2048,
    storageMode: 'copy',
    title: '二维码截图',
  },
  {
    fileName: 'backup-train-ticket.pdf',
    fileType: 'pdf',
    mimeType: 'application/pdf',
    size: 4096,
    storageMode: 'copy',
    title: '备用车票 PDF',
  },
]

test('票据库空状态清楚可用', async ({ page }) => {
  const tripId = await createDemoTripViaUi(page)

  await page.goto(`/#/tickets?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: '票据和订单' })).toBeVisible()
  await expect(page.getByText('暂无票据')).toBeVisible()
  await expect(page.getByText('添加图片、PDF、文件位置或外部链接后，会显示在这里。')).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('票据库以 gallery 卡片展示多种票据并保留预览行为', async ({ page }) => {
  const tripId = await createDemoTripViaUi(page)
  const firstItemId = await getFirstItemId(page, tripId)
  await addTicketMetas(page, tripId, firstItemId, ticketSeeds)

  await page.goto(`/#/tickets?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('ticket-gallery')).toBeVisible()
  await expect(page.getByTestId('ticket-card')).toHaveCount(4)
  await expect(page.getByTestId('ticket-gallery')).toContainText('酒店订单 PDF')
  await expect(page.getByTestId('ticket-gallery')).toContainText('位置')
  await expect(page.getByTestId('ticket-gallery')).toContainText('链接')
  await expect(page.getByTestId('ticket-gallery')).toContainText('图片')
  await expect(page.getByTestId('ticket-gallery')).toContainText('PDF')
  await expect(page.getByTestId('ticket-gallery')).toContainText('本地副本')
  await expect(page.getByTestId('ticket-gallery')).toContainText('绑定到行程点')
  await expect(page.getByRole('button', { name: /删除酒店订单 PDF/ })).toBeVisible()

  await page.getByRole('button', { name: /查看酒店订单 PDF/ }).click()
  await expect(page.getByText('此票据仅记录文件位置')).toBeVisible()
  await page.getByLabel('关闭预览').click()
  await expectNoHorizontalOverflow(page)
})
