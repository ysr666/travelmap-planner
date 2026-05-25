import { expect, test, type Page } from '@playwright/test'
import {
  createDemoTripViaUi,
  expectNoHorizontalOverflow,
  mockMapStyle,
} from './helpers'

type DemoRecords = {
  dayId: string
  firstItemId: string
  secondItemId: string
  thirdItemId: string
}

type SeedTicket = {
  title: string
  storageMode: 'copy' | 'reference' | 'external'
  fileName: string
  fileType: 'image' | 'pdf' | 'other'
  mimeType: string
  size: number
  referenceLocation?: string
  externalUrl?: string
}

async function getDemoRecords(page: Page, tripId: string): Promise<DemoRecords> {
  return page.evaluate(async (tid) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('TravelConsoleDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })

    const tx = db.transaction(['days', 'itineraryItems'], 'readonly')
    const daysStore = tx.objectStore('days')
    const itemsStore = tx.objectStore('itineraryItems')
    const daysIndex = daysStore.index('tripId')

    const days = await new Promise<Array<{ id: string; sortOrder: number }>>((resolve, reject) => {
      const request = daysIndex.getAll(tid)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const firstDay = days.sort((first, second) => first.sortOrder - second.sortOrder)[0]
    if (!firstDay) {
      db.close()
      throw new Error('示例旅行没有日程')
    }

    const itemsIndex = itemsStore.index('dayId')
    const items = await new Promise<Array<{ id: string; sortOrder: number }>>((resolve, reject) => {
      const request = itemsIndex.getAll(firstDay.id)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const sortedItems = items.sort((first, second) => first.sortOrder - second.sortOrder)
    db.close()

    return {
      dayId: firstDay.id,
      firstItemId: sortedItems[0]?.id,
      secondItemId: sortedItems[1]?.id,
      thirdItemId: sortedItems[2]?.id,
    }
  }, tripId)
}

async function removeItemCoordinates(page: Page, itemId: string) {
  await page.evaluate(async (targetItemId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('TravelConsoleDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })

    const tx = db.transaction(['itineraryItems'], 'readwrite')
    const store = tx.objectStore('itineraryItems')
    const item = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = store.get(targetItemId)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    delete item.lat
    delete item.lng
    item.updatedAt = Date.now()
    await new Promise<void>((resolve, reject) => {
      const request = store.put(item)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
    db.close()
  }, itemId)
}

async function addItemTickets(page: Page, tripId: string, itemId: string, tickets: SeedTicket[]) {
  await page.evaluate(async ({ targetTripId, targetItemId, seedTickets }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('TravelConsoleDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })

    const tx = db.transaction(['itineraryItems', 'ticketMetas', 'ticketBlobs'], 'readwrite')
    const itemsStore = tx.objectStore('itineraryItems')
    const ticketsStore = tx.objectStore('ticketMetas')
    const blobsStore = tx.objectStore('ticketBlobs')
    const now = Date.now()
    const ticketIds: string[] = []

    for (let index = 0; index < seedTickets.length; index += 1) {
      const seedTicket = seedTickets[index]
      const id = `ticket_e2e_${now}_${index}`
      ticketIds.push(id)
      await new Promise<void>((resolve, reject) => {
        const request = ticketsStore.add({
          id,
          tripId: targetTripId,
          itemId: targetItemId,
          scope: 'item',
          title: seedTicket.title,
          storageMode: seedTicket.storageMode,
          referenceLocation: seedTicket.referenceLocation,
          externalUrl: seedTicket.externalUrl,
          fileName: seedTicket.fileName,
          fileType: seedTicket.fileType,
          mimeType: seedTicket.mimeType,
          size: seedTicket.size,
          createdAt: now + seedTickets.length - index,
          updatedAt: now + seedTickets.length - index,
        })
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })

      if (seedTicket.storageMode === 'copy') {
        await new Promise<void>((resolve, reject) => {
          const request = blobsStore.put({
            blob: buildTicketBlob(seedTicket),
            ticketId: id,
          })
          request.onsuccess = () => resolve()
          request.onerror = () => reject(request.error)
        })
      }
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

    function buildTicketBlob(seedTicket: SeedTicket) {
      if (seedTicket.fileType === 'image') {
        return new Blob([
          '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" fill="#e0f2fe"/><text x="120" y="84" text-anchor="middle" font-size="20" fill="#0369a1">旅图票据</text></svg>',
        ], { type: seedTicket.mimeType })
      }

      if (seedTicket.fileType === 'pdf') {
        return new Blob(['%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF'], { type: seedTicket.mimeType })
      }

      return new Blob(['ticket file'], { type: seedTicket.mimeType })
    }
  }, { targetTripId: tripId, targetItemId: itemId, seedTickets: tickets })
}

function makeTicketSeeds(count: number): SeedTicket[] {
  const seeds: SeedTicket[] = [
    {
      title: '酒店订单 PDF',
      storageMode: 'reference',
      referenceLocation: 'iCloud Drive/TravelMap/hotel-order.pdf',
      fileName: 'hotel-order.pdf',
      fileType: 'pdf',
      mimeType: 'application/pdf',
      size: 1280,
    },
    {
      title: '电子门票链接',
      storageMode: 'external',
      externalUrl: 'https://example.com/tickets/tokyo',
      fileName: 'tokyo-ticket-link.url',
      fileType: 'other',
      mimeType: 'text/uri-list',
      size: 0,
    },
    {
      title: '二维码截图',
      storageMode: 'copy',
      fileName: 'qr-code.svg',
      fileType: 'image',
      mimeType: 'image/svg+xml',
      size: 2048,
    },
    {
      title: '备用车票 PDF',
      storageMode: 'copy',
      fileName: 'train-backup.pdf',
      fileType: 'pdf',
      mimeType: 'application/pdf',
      size: 4096,
    },
  ]

  return seeds.slice(0, count)
}

test('日程来源打开行程点详情并返回日程', async ({ page }) => {
  await createDemoTripViaUi(page)

  await page.getByRole('button', { name: /Hotel Metropolitan Tokyo 入住/ }).click()
  await expect(page).toHaveURL(/#\/item\?/)
  await expect(page).toHaveURL(/view=schedule/)
  await expect(page.getByTestId('item-detail-page')).toBeVisible()
  await expect(page.getByTestId('item-detail-core')).toContainText('Hotel Metropolitan Tokyo 入住')
  await expect(page.getByTestId('item-detail-core')).toContainText('15:00')
  await expect(page.getByTestId('item-detail-core')).toContainText('Hotel Metropolitan Tokyo')
  await expect(page.getByTestId('item-detail-navigation').getByRole('link', { name: 'Apple 地图' })).toBeVisible()
  await expect(page.getByTestId('item-detail-navigation').getByRole('link', { name: 'Google 地图' })).toBeVisible()
  await expect(page.getByTestId('item-detail-tickets')).toContainText('现场票据')
  await expect(page.getByTestId('item-detail-tickets')).toContainText('暂无绑定票据')

  await page.getByRole('button', { name: '返回日程' }).click()
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=schedule/)
  await expectNoHorizontalOverflow(page)
})

test('日程来源详情可按当天顺序切换上一项和下一项', async ({ page }) => {
  await createDemoTripViaUi(page)

  await page.getByRole('button', { name: /Hotel Metropolitan Tokyo 入住/ }).click()
  await expect(page).toHaveURL(/view=schedule/)
  await expect(page.getByTestId('item-previous-button')).toBeDisabled()
  await expect(page.getByTestId('item-next-button')).toBeEnabled()

  await page.getByTestId('item-next-button').click()
  await expect(page).toHaveURL(/#\/item\?/)
  await expect(page).toHaveURL(/view=schedule/)
  await expect(page.getByTestId('item-detail-core')).toContainText('明治神宫散步')
  await expect(page.getByTestId('item-previous-button')).toBeEnabled()

  await page.getByTestId('item-previous-button').click()
  await expect(page.getByTestId('item-detail-core')).toContainText('Hotel Metropolitan Tokyo 入住')
  await expect(page).toHaveURL(/view=schedule/)

  await page.getByTestId('item-next-button').click()
  await page.getByTestId('item-next-button').click()
  await expect(page.getByTestId('item-detail-core')).toContainText('Shibuya Sky 夜景')
  await expect(page.getByTestId('item-next-button')).toBeDisabled()
  await expectNoHorizontalOverflow(page)
})

test('地图来源详情编辑后保留地图上下文', async ({ page }) => {
  await mockMapStyle(page)
  await createDemoTripViaUi(page)
  await page.getByTestId('view-switch-map').click()
  await expect(page.getByTestId('route-chip')).toBeVisible({ timeout: 15000 })
  await page.getByRole('button', { name: /选择 Hotel Metropolitan Tokyo 入住/ }).click()
  await page.getByTestId('map-marker-card-open').click()

  await expect(page).toHaveURL(/#\/item\?/)
  await expect(page).toHaveURL(/view=map/)
  await expect(page.getByRole('button', { name: '返回地图' })).toBeVisible()

  await page.getByRole('button', { name: '编辑行程点' }).click()
  await expect(page).toHaveURL(/#\/item\/edit\?/)
  await expect(page).toHaveURL(/view=map/)
  await page.getByLabel('行程标题').fill('Hotel Metropolitan Tokyo 入住 v2')
  await page.getByRole('button', { name: '保存修改' }).click()
  await expect(page).toHaveURL(/#\/item\?/)
  await expect(page).toHaveURL(/view=map/)
  await expect(page.getByTestId('item-detail-core')).toContainText('Hotel Metropolitan Tokyo 入住 v2')

  await page.getByRole('button', { name: '返回地图' }).click()
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=map/)
  await expectNoHorizontalOverflow(page)
})

test('地图来源详情上一项下一项保留地图上下文', async ({ page }) => {
  await mockMapStyle(page)
  await createDemoTripViaUi(page)
  await page.getByTestId('view-switch-map').click()
  await expect(page.getByTestId('route-chip')).toBeVisible({ timeout: 15000 })
  await page.getByRole('button', { name: /选择 明治神宫散步/ }).click()
  await page.getByTestId('map-marker-card-open').click()

  await expect(page).toHaveURL(/view=map/)
  await expect(page.getByTestId('item-detail-core')).toContainText('明治神宫散步')

  await page.getByTestId('item-next-button').click()
  await expect(page).toHaveURL(/#\/item\?/)
  await expect(page).toHaveURL(/view=map/)
  await expect(page.getByTestId('item-detail-core')).toContainText('Shibuya Sky 夜景')
  await expect(page.getByTestId('item-next-button')).toBeDisabled()

  await page.getByTestId('item-previous-button').click()
  await expect(page).toHaveURL(/view=map/)
  await expect(page.getByTestId('item-detail-core')).toContainText('明治神宫散步')

  await page.getByRole('button', { name: '返回地图' }).click()
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=map/)
})

test('无坐标行程点显示轻量导航不可用状态', async ({ page }) => {
  const tripId = await createDemoTripViaUi(page)
  const { dayId, secondItemId } = await getDemoRecords(page, tripId)
  await removeItemCoordinates(page, secondItemId)

  await page.goto(`/#/item?tripId=${tripId}&dayId=${dayId}&itemId=${secondItemId}&view=schedule`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('item-detail-page')).toBeVisible()
  await expect(page.getByTestId('item-detail-core')).toContainText('暂无坐标')
  await expect(page.getByTestId('item-detail-navigation')).toContainText('无法从这里打开外部地图导航')
  await expect(page.getByTestId('item-detail-navigation').getByRole('link', { name: /Apple 地图|Google 地图/ })).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('票据区显示现场卡片、预览和查看全部入口', async ({ page }) => {
  const tripId = await createDemoTripViaUi(page)
  const { dayId, firstItemId } = await getDemoRecords(page, tripId)
  await addItemTickets(page, tripId, firstItemId, makeTicketSeeds(4))

  const itemUrl = `/#/item?tripId=${tripId}&dayId=${dayId}&itemId=${firstItemId}&view=schedule`
  await page.goto(itemUrl, { waitUntil: 'domcontentloaded' })

  await expect(page.getByTestId('item-detail-tickets')).toContainText('现场票据')
  await expect(page.getByTestId('item-detail-tickets')).toContainText('4 张已绑定')
  await expect(page.getByTestId('item-ticket-entry')).toHaveCount(3)
  await expect(page.getByTestId('item-detail-tickets')).toContainText('酒店订单 PDF')
  await expect(page.getByTestId('item-detail-tickets')).toContainText('文件位置')
  await expect(page.getByTestId('item-detail-tickets')).toContainText('外部链接')
  await expect(page.getByTestId('item-detail-tickets')).toContainText('图片')
  await expect(page.getByTestId('item-detail-tickets')).toContainText('本地副本')
  await expect(page.getByTestId('item-ticket-view-all')).toContainText('+1')
  await page.getByTestId('item-ticket-entry').filter({ hasText: '酒店订单 PDF' }).click()
  await expect(page.getByTestId('ticket-preview')).toBeVisible()
  await expect(page.getByTestId('ticket-preview-counter')).toContainText('1 / 4')
  await expect(page.getByTestId('ticket-preview-reference')).toContainText('此票据仅记录文件位置')
  await page.getByTestId('ticket-preview-next').click()
  await expect(page.getByTestId('ticket-preview-counter')).toContainText('2 / 4')
  await expect(page.getByTestId('ticket-preview-external')).toContainText('此票据保存的是外部链接')
  await page.getByTestId('ticket-preview-next').click()
  await expect(page.getByTestId('ticket-preview-counter')).toContainText('3 / 4')
  await expect(page.getByTestId('ticket-preview-image')).toBeVisible()
  await page.getByTestId('ticket-preview-close').click()
  await expect(page.getByTestId('ticket-preview')).toHaveCount(0)

  await page.getByTestId('item-ticket-view-all').click()
  await expect(page).toHaveURL(/#\/tickets\?/)
  expect(new URL(page.url()).hash).toContain(`tripId=${tripId}`)
  expect(new URL(page.url()).hash).not.toContain('itemId=')
  await expectNoHorizontalOverflow(page)
})

test('票据摘要保持紧凑且删除后返回来源视图', async ({ page }) => {
  const tripId = await createDemoTripViaUi(page)
  const { dayId, firstItemId } = await getDemoRecords(page, tripId)
  await addItemTickets(page, tripId, firstItemId, makeTicketSeeds(1))

  await page.goto(`/#/item?tripId=${tripId}&dayId=${dayId}&itemId=${firstItemId}&view=schedule`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('item-detail-tickets')).toContainText('1 张已绑定')
  await expect(page.getByTestId('item-ticket-entry')).toHaveCount(1)
  await expect(page.getByTestId('item-detail-tickets')).toContainText('酒店订单 PDF')

  await page.getByRole('button', { name: '删除行程点' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('确认删除')
  await dialog.getByRole('button', { name: '删除行程点' }).click()
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=schedule/)
})
