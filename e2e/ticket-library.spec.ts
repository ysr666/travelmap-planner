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
  note?: string
  referenceLocation?: string
  size: number
  storageMode: 'copy' | 'reference' | 'external'
  ticketCategory?: string
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

    const tx = db.transaction(['itineraryItems', 'ticketMetas', 'ticketBlobs'], 'readwrite')
    const itemsStore = tx.objectStore('itineraryItems')
    const ticketsStore = tx.objectStore('ticketMetas')
    const blobsStore = tx.objectStore('ticketBlobs')
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
          note: seedTicket.note,
          referenceLocation: seedTicket.referenceLocation,
          scope: 'item',
          size: seedTicket.size,
          storageMode: seedTicket.storageMode,
          ticketCategory: seedTicket.ticketCategory,
          title: seedTicket.title,
          tripId: targetTripId,
          updatedAt: now + index,
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

async function readTicketBinding(page: Page, tripId: string, itemId: string, title: string) {
  return page.evaluate(async ({ targetItemId, targetTitle, targetTripId }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('TravelConsoleDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })

    const tx = db.transaction(['itineraryItems', 'ticketMetas'], 'readonly')
    const tickets = await new Promise<Array<{
      id: string
      itemId?: string
      note?: string
      scope?: string
      ticketCategory?: string
      title?: string
      tripId: string
    }>>((resolve, reject) => {
      const request = tx.objectStore('ticketMetas').index('tripId').getAll(targetTripId)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const item = await new Promise<{ ticketIds?: string[] }>((resolve, reject) => {
      const request = tx.objectStore('itineraryItems').get(targetItemId)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    db.close()

    const ticket = tickets.find((candidate) => candidate.title === targetTitle)
    if (!ticket) throw new Error(`没有找到票据 ${targetTitle}`)
    return {
      itemTicketIds: item.ticketIds ?? [],
      ticket,
    }
  }, { targetItemId: itemId, targetTitle: title, targetTripId: tripId })
}

async function openTicketPreview(page: Page, title: string) {
  await page.getByRole('group', { name: `${title} 操作` }).getByRole('button', { name: `查看${title}` }).click()
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
    fileName: 'qr-code.svg',
    fileType: 'image',
    mimeType: 'image/svg+xml',
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
  await expect(page.getByRole('heading', { name: '暂无票据' })).toBeVisible()
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
  await expect(page.getByTestId('ticket-gallery')).toContainText('离线可用')
  await expect(page.getByTestId('ticket-gallery')).toContainText('绑定到行程点')
  await expect(page.getByRole('button', { name: /删除酒店订单 PDF/ })).toBeVisible()

  await page.getByTestId('ticket-stat-copy').click()
  await expect(page.getByTestId('ticket-filter-summary')).toContainText('保存票据文件：2 张')
  await expect(page.getByTestId('ticket-card')).toHaveCount(2)
  await expect(page.getByTestId('ticket-gallery')).toContainText('二维码截图')
  await expect(page.getByTestId('ticket-gallery')).toContainText('备用车票 PDF')
  await expect(page.getByTestId('ticket-gallery')).not.toContainText('酒店订单 PDF')
  await openTicketPreview(page, '备用车票 PDF')
  await expect(page.getByTestId('ticket-preview-counter')).toContainText('1 / 2')
  await page.getByTestId('ticket-preview-close').click()
  await page.getByTestId('ticket-stat-all').click()
  await expect(page.getByTestId('ticket-filter-summary')).toContainText('全部票据：4 张')
  await expect(page.getByTestId('ticket-card')).toHaveCount(4)

  await openTicketPreview(page, '酒店订单 PDF')
  await expect(page.getByTestId('ticket-preview')).toBeVisible()
  await expect(page.getByTestId('ticket-preview-reference')).toContainText('此票据仅记录文件位置')
  await page.getByTestId('ticket-preview-close').click()
  await expect(page.getByTestId('ticket-preview')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('票据库可以编辑票据元数据并原子移除行程点绑定', async ({ page }) => {
  const tripId = await createDemoTripViaUi(page)
  const firstItemId = await getFirstItemId(page, tripId)
  await addTicketMetas(page, tripId, firstItemId, [ticketSeeds[0]])

  await page.goto(`/#/tickets?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: /编辑酒店订单 PDF/ }).click()
  const editor = page.getByTestId('ticket-metadata-editor')
  await expect(editor).toBeVisible()

  await editor.getByLabel('显示名称').fill('酒店订单已整理')
  await editor.getByLabel('票据分类').selectOption('hotel_booking')
  await editor.getByLabel('绑定对象').selectOption('unassigned')
  await editor.getByLabel('备注').fill('入住时出示护照')
  await editor.getByRole('button', { name: '保存修改' }).click()

  await expect(editor).toHaveCount(0)
  await expect(page.getByText('票据信息已更新。')).toBeVisible()
  await expect(page.getByTestId('ticket-gallery')).toContainText('酒店订单已整理')
  await expect(page.getByTestId('ticket-gallery-section').filter({ hasText: '未分类' })).toContainText('酒店订单已整理')

  const binding = await readTicketBinding(page, tripId, firstItemId, '酒店订单已整理')
  expect(binding.ticket.itemId).toBeUndefined()
  expect(binding.ticket).toMatchObject({
    note: '入住时出示护照',
    scope: 'unassigned',
    ticketCategory: 'hotel_booking',
    title: '酒店订单已整理',
  })
  expect(binding.itemTicketIds).not.toContain(binding.ticket.id)

  await openTicketPreview(page, '酒店订单已整理')
  await expect(page.getByTestId('ticket-preview')).toContainText('酒店订单')
  await page.getByTestId('ticket-preview-close').click()
  await expectNoHorizontalOverflow(page)
})

test('票据库预览器可以在线性上下文中切换图片、PDF 和外部票据', async ({ page }) => {
  const tripId = await createDemoTripViaUi(page)
  const firstItemId = await getFirstItemId(page, tripId)
  await addTicketMetas(page, tripId, firstItemId, ticketSeeds)

  await page.goto(`/#/tickets?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })
  await openTicketPreview(page, '备用车票 PDF')
  await expect(page.getByTestId('ticket-preview')).toBeVisible()
  await expect(page.getByTestId('ticket-preview-counter')).toContainText('1 / 4')
  await expect(page.getByTestId('ticket-preview-previous')).toBeDisabled()
  await expect(page.getByTestId('ticket-preview-next')).toBeEnabled()
  await expect(page.getByTestId('ticket-preview-pdf')).toBeVisible()

  await page.getByTestId('ticket-preview-next').click()
  await expect(page.getByTestId('ticket-preview-counter')).toContainText('2 / 4')
  await expect(page.getByTestId('ticket-preview-image')).toBeVisible()

  await page.getByTestId('ticket-preview-next').click()
  await expect(page.getByTestId('ticket-preview-counter')).toContainText('3 / 4')
  await expect(page.getByTestId('ticket-preview-external')).toContainText('此票据保存的是外部链接')

  await page.getByTestId('ticket-preview-next').click()
  await expect(page.getByTestId('ticket-preview-counter')).toContainText('4 / 4')
  await expect(page.getByTestId('ticket-preview-reference')).toContainText('此票据仅记录文件位置')
  await expect(page.getByTestId('ticket-preview-next')).toBeDisabled()
  await page.getByTestId('ticket-preview-close').click()
  await expect(page.getByTestId('ticket-preview')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('票据库打开第 2 张票据显示 2 / N 且缩略图条可切换', async ({ page }) => {
  const tripId = await createDemoTripViaUi(page)
  const firstItemId = await getFirstItemId(page, tripId)
  await addTicketMetas(page, tripId, firstItemId, ticketSeeds)

  await page.goto(`/#/tickets?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })

  // Open second ticket (二维码截图 — display order is: 备用车票 PDF, 二维码截图, 电子门票链接, 酒店订单 PDF)
  await openTicketPreview(page, '二维码截图')
  await expect(page.getByTestId('ticket-preview')).toBeVisible()
  await expect(page.getByTestId('ticket-preview-counter')).toContainText('2 / 4')
  await expect(page.getByTestId('ticket-preview-image')).toBeVisible()

  // Click thumbnail strip to switch to first ticket (备用车票 PDF)
  const thumbnails = page.getByTestId('ticket-preview-thumbnail')
  await thumbnails.first().click()
  await expect(page.getByTestId('ticket-preview-counter')).toContainText('1 / 4')
  await expect(page.getByTestId('ticket-preview-pdf')).toBeVisible()

  // Click thumbnail to go to third (电子门票链接)
  await thumbnails.nth(2).click()
  await expect(page.getByTestId('ticket-preview-counter')).toContainText('3 / 4')
  await expect(page.getByTestId('ticket-preview-external')).toContainText('此票据保存的是外部链接')

  await page.getByTestId('ticket-preview-close').click()
  await expect(page.getByTestId('ticket-preview')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('票据库预览 Escape 键可关闭', async ({ page }) => {
  const tripId = await createDemoTripViaUi(page)
  const firstItemId = await getFirstItemId(page, tripId)
  await addTicketMetas(page, tripId, firstItemId, ticketSeeds)

  await page.goto(`/#/tickets?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })
  await openTicketPreview(page, '酒店订单 PDF')
  await expect(page.getByTestId('ticket-preview')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('ticket-preview')).toHaveCount(0)
})

test('Package 5 票据费用草稿确认后进入 review queue 并持久显示完成记录', async ({ page }) => {
  const tripId = await createDemoTripViaUi(page)
  const firstItemId = await getFirstItemId(page, tripId)
  await seedLedgerReceiver(page, tripId)
  await addTicketMetas(page, tripId, firstItemId, [{
    fileName: 'meal-receipt.pdf',
    fileType: 'pdf',
    mimeType: 'application/pdf',
    note: '东京晚餐 receipt paid JPY 4800',
    referenceLocation: '本地测试票据',
    size: 0,
    storageMode: 'reference',
    ticketCategory: 'other',
    title: '东京晚餐票据',
  }])

  await page.goto(`/#/documents?tripId=${tripId}&tab=attachments`, { waitUntil: 'domcontentloaded' })
  await openTicketPreview(page, '东京晚餐票据')
  const preview = page.getByTestId('ticket-preview')
  await expect(preview.getByTestId('ticket-preview-intelligence')).toContainText('可生成费用草稿')
  expect(await countTripRecords(page, 'ledgerExpenses', tripId)).toBe(0)

  await preview.getByTestId('ticket-preview-intelligence-action').filter({ hasText: '生成费用草稿' }).click()
  expect(await countTripRecords(page, 'ledgerExpenses', tripId)).toBe(0)
  const confirm = page.getByRole('dialog', { name: '从票据生成费用草稿？' })
  await expect(confirm).toContainText('不会自动计入结算')
  await confirm.getByRole('button', { name: '生成草稿' }).click()

  await expect.poll(() => countTripRecords(page, 'ledgerExpenses', tripId)).toBe(1)
  await expect.poll(() => countTripRecords(page, 'tripIntelligenceAppliedChanges', tripId)).toBe(1)
  await page.goto(`/#/ledger?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('ledger-review-queue')).toContainText('东京晚餐票据')

  await page.goto(`/#/trip?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })
  const completed = page.locator('summary').filter({ hasText: '完成了什么' })
  await expect(completed).toBeVisible()
  await completed.click()
  await expect(page.getByTestId('trip-operations-history')).toContainText('已从票据生成费用草稿')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('summary').filter({ hasText: '完成了什么' }).click()
  await expect(page.getByTestId('trip-operations-history')).toContainText('已从票据生成费用草稿')
})

async function seedLedgerReceiver(page: Page, tripId: string) {
  await page.evaluate(async (targetTripId) => {
    const request = indexedDB.open('TravelConsoleDB')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const now = Date.now()
    const transaction = db.transaction(['ledgerSettings', 'ledgerParticipants', 'ledgerBudgets'], 'readwrite')
    transaction.objectStore('ledgerSettings').put({
      createdAt: now,
      homeCurrency: 'CNY',
      id: `settings-${targetTripId}`,
      settlementCurrency: 'CNY',
      tripCurrency: 'JPY',
      tripId: targetTripId,
      updatedAt: now,
    })
    transaction.objectStore('ledgerParticipants').put({
      createdAt: now,
      displayName: '我',
      id: `person-${targetTripId}`,
      isSelf: true,
      source: 'manual',
      tripId: targetTripId,
      updatedAt: now,
    })
    transaction.objectStore('ledgerBudgets').put({
      amountMinor: 100_000,
      createdAt: now,
      currency: 'JPY',
      id: `budget-${targetTripId}`,
      scope: 'trip',
      tripId: targetTripId,
      updatedAt: now,
    })
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()
  }, tripId)
}

async function countTripRecords(page: Page, storeName: string, tripId: string) {
  return page.evaluate(async ({ storeName: targetStoreName, tripId: targetTripId }) => {
    const request = indexedDB.open('TravelConsoleDB')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = db.transaction(targetStoreName, 'readonly')
    const countRequest = transaction.objectStore(targetStoreName).index('tripId').count(targetTripId)
    const count = await new Promise<number>((resolve, reject) => {
      countRequest.onsuccess = () => resolve(countRequest.result)
      countRequest.onerror = () => reject(countRequest.error)
    })
    db.close()
    return count
  }, { storeName, tripId })
}
