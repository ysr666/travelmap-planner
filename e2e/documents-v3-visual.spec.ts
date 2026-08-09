import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import documentsVisualFixture from './fixtures/home-v3-visual.json' with { type: 'json' }
import {
  clearTravelDatabase,
  expectNoHorizontalOverflow,
  seedTravelRecords,
} from './helpers'

test.use({ colorScheme: 'light', locale: 'zh-CN', timezoneId: 'Europe/London' })

const captureGoldens = process.env.CAPTURE_UI_V3_GOLDENS === '1'
const goldenOutputDirectory = resolve('output/playwright/ui-v3-documents')
const requiredViewports = [
  { height: 568, name: '320x568', width: 320 },
  { height: 844, name: '390x844', width: 390 },
  { height: 1133, name: '390x1133-reference', width: 390 },
  { height: 932, name: '430x932', width: 430 },
  { height: 1024, name: '768x1024', width: 768 },
  { height: 900, name: '1440x900', width: 1440 },
]

const visualTicketIds = [
  'ticket_documents_castle',
  'ticket_documents_hotel',
  'ticket_documents_train',
  'ticket_documents_insurance',
  'ticket_documents_museum',
  'ticket_documents_link',
]

test('UI V3 资料页使用真实预览的编辑式列表', async ({ page }) => {
  const browserErrors: string[] = []
  let providerRequests = 0
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))
  await page.route('**/api/provider-proxy', (route) => {
    providerRequests += 1
    void route.abort()
  })

  await page.clock.setFixedTime(new Date(documentsVisualFixture.fixedNow))
  await clearTravelDatabase(page)
  const now = new Date(documentsVisualFixture.fixedNow).getTime()
  const itemId = 'item_home_v3_castle'
  await seedTravelRecords(page, {
    ...documentsVisualFixture.records,
    itineraryItems: documentsVisualFixture.records.itineraryItems.map((item) => (
      item.id === itemId ? { ...item, ticketIds: visualTicketIds } : item
    )),
    ticketBlobs: [],
    ticketMetas: [
      {
        createdAt: now,
        fileName: 'edinburgh-castle-entry.pdf',
        fileType: 'pdf',
        id: visualTicketIds[0],
        itemId,
        mimeType: 'application/pdf',
        note: '11:00 入场',
        scope: 'item',
        size: 2048,
        storageMode: 'copy',
        ticketCategory: 'admission_ticket',
        title: '爱丁堡城堡入场门票2026年7月30日家庭套票确认凭证无空格超长名称',
        tripId: 'trip_home_v3',
        updatedAt: now,
      },
      {
        createdAt: now + 1,
        fileName: 'hotel-confirmation.pdf',
        fileType: 'pdf',
        id: visualTicketIds[1],
        itemId,
        mimeType: 'application/pdf',
        scope: 'item',
        size: 2048,
        storageMode: 'copy',
        ticketCategory: 'hotel_booking',
        title: '爱丁堡酒店预订确认单',
        tripId: 'trip_home_v3',
        updatedAt: now + 1,
      },
      {
        createdAt: now + 2,
        fileName: 'london-edinburgh-train.pdf',
        fileType: 'pdf',
        id: visualTicketIds[2],
        itemId,
        mimeType: 'application/pdf',
        scope: 'item',
        size: 4096,
        storageMode: 'copy',
        ticketCategory: 'train_ticket',
        title: '伦敦至爱丁堡火车票',
        tripId: 'trip_home_v3',
        updatedAt: now + 2,
      },
      {
        createdAt: now + 3,
        fileName: 'travel-insurance-policy.pdf',
        fileType: 'pdf',
        id: visualTicketIds[3],
        itemId,
        mimeType: 'application/pdf',
        scope: 'item',
        size: 4096,
        storageMode: 'copy',
        ticketCategory: 'other',
        title: '英国旅行保险保单',
        tripId: 'trip_home_v3',
        updatedAt: now + 3,
      },
      {
        createdAt: now + 4,
        fileName: 'british-museum-entry.pdf',
        fileType: 'pdf',
        id: visualTicketIds[4],
        itemId,
        mimeType: 'application/pdf',
        scope: 'item',
        size: 4096,
        storageMode: 'copy',
        ticketCategory: 'admission_ticket',
        title: '大英博物馆预约确认',
        tripId: 'trip_home_v3',
        updatedAt: now + 4,
      },
      {
        createdAt: now + 5,
        externalUrl: 'https://example.com/booking',
        fileName: 'hotel-booking.url',
        fileType: 'other',
        id: visualTicketIds[5],
        itemId,
        mimeType: 'text/uri-list',
        scope: 'item',
        size: 0,
        storageMode: 'external',
        ticketCategory: 'hotel_booking',
        title: '酒店原订单链接',
        tripId: 'trip_home_v3',
        updatedAt: now + 5,
      },
    ],
  })
  await seedCopiedTicketBlobs(page)
  await page.goto('/#/documents?tripId=trip_home_v3&tab=attachments', { waitUntil: 'domcontentloaded' })

  await expect(page.getByRole('heading', { exact: true, name: '资料' })).toBeVisible()
  await expect(page.getByTestId('ticket-gallery')).toBeVisible()
  await expect(page.getByTestId('ticket-card')).toHaveCount(6)
  await expect(page.locator('[data-ticket-layout="row"]')).toHaveCount(6)
  await expect(page.locator('[data-ticket-layout="thumbnail"]')).toHaveCount(0)
  await expect(page.locator('[data-preview-state="ready"]')).toHaveCount(5, { timeout: 15_000 })
  await expect(page.locator('[data-preview-state="fallback"]')).toHaveCount(1)
  await expect(page.getByRole('textbox', { name: '搜索票据' })).toBeHidden()
  await expect(page.getByRole('button', { exact: true, name: '搜索资料' })).toBeVisible()
  await expect(page.getByRole('button', { exact: true, name: '来源与导入' })).toBeVisible()

  if (captureGoldens) await mkdir(goldenOutputDirectory, { recursive: true })

  for (const viewport of requiredViewports) {
    await page.setViewportSize({ height: viewport.height, width: viewport.width })
    await page.evaluate(() => window.scrollTo(0, 0))
    await expectNoHorizontalOverflow(page)
    await expectDocumentListLayout(page)

    if (captureGoldens) {
      await page.screenshot({
        animations: 'disabled',
        caret: 'hide',
        path: resolve(goldenOutputDirectory, `documents-${viewport.name}.png`),
      })
    }
  }

  expect(providerRequests).toBe(0)
  expect(browserErrors).toEqual([])
})

async function seedCopiedTicketBlobs(page: Page) {
  await page.evaluate(async ({ ticketIds }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('TravelConsoleDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction('ticketBlobs', 'readwrite')
    const store = transaction.objectStore('ticketBlobs')
    store.put({ blob: buildPdfBlob('EDINBURGH CASTLE ENTRY'), ticketId: ticketIds[0] })
    store.put({ blob: buildPdfBlob('HOTEL BOOKING CONFIRMATION'), ticketId: ticketIds[1] })
    store.put({ blob: buildPdfBlob('LONDON TO EDINBURGH'), ticketId: ticketIds[2] })
    store.put({ blob: buildPdfBlob('TRAVEL INSURANCE POLICY'), ticketId: ticketIds[3] })
    store.put({ blob: buildPdfBlob('BRITISH MUSEUM ENTRY'), ticketId: ticketIds[4] })
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    database.close()

    function buildPdfBlob(title: string) {
      const stream = `BT\n/F1 20 Tf\n48 720 Td\n(${title}) Tj\n0 -36 Td\n/F1 12 Tf\n(TripMap visual fixture) Tj\nET\n`
      const objects = [
        '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
        '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
        '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
        '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
        `5 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj\n`,
      ]
      let pdf = '%PDF-1.4\n'
      const offsets = [0]
      for (const object of objects) {
        offsets.push(pdf.length)
        pdf += object
      }
      const xrefOffset = pdf.length
      pdf += `xref\n0 ${objects.length + 1}\n`
      pdf += '0000000000 65535 f \n'
      for (let index = 1; index < offsets.length; index += 1) {
        pdf += `${offsets[index].toString().padStart(10, '0')} 00000 n \n`
      }
      pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
      return new Blob([pdf], { type: 'application/pdf' })
    }
  }, { ticketIds: visualTicketIds })
}

async function expectDocumentListLayout(page: Page) {
  const layout = await page.evaluate(() => {
    const gallery = document.querySelector<HTMLElement>('[data-testid="ticket-gallery"]')
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-ticket-layout="row"]'))
    const thumbnails = Array.from(document.querySelectorAll<HTMLElement>('[data-ticket-layout="row"] [data-preview-state]'))
    const titles = Array.from(document.querySelectorAll<HTMLElement>('.document-preview-title'))
    if (!gallery || rows.length !== 6 || thumbnails.length !== 6 || titles.length !== 6) return null
    const rect = (element: HTMLElement) => {
      const bounds = element.getBoundingClientRect()
      return {
        bottom: bounds.bottom,
        height: bounds.height,
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        width: bounds.width,
      }
    }
    return {
      gallery: rect(gallery),
      rows: rows.map(rect),
      thumbnails: thumbnails.map(rect),
      titles: titles.map((title) => ({
        clientWidth: title.clientWidth,
        rect: rect(title),
        scrollWidth: title.scrollWidth,
      })),
      viewportWidth: innerWidth,
    }
  })

  expect(layout).not.toBeNull()
  if (!layout) return
  expect(layout.gallery.left).toBeGreaterThanOrEqual(-1)
  expect(layout.gallery.right).toBeLessThanOrEqual(layout.viewportWidth + 1)
  for (const row of layout.rows) {
    expect(row.left).toBeGreaterThanOrEqual(layout.gallery.left - 1)
    expect(row.right).toBeLessThanOrEqual(layout.gallery.right + 1)
    expect(row.height).toBeGreaterThanOrEqual(111)
  }
  for (const thumbnail of layout.thumbnails) {
    expect(thumbnail.width).toBeGreaterThan(0)
    if (layout.viewportWidth < 360) {
      expect(thumbnail.height).toBeGreaterThanOrEqual(85)
      expect(thumbnail.height).toBeLessThanOrEqual(87)
      expect(thumbnail.width).toBeGreaterThanOrEqual(87)
      expect(thumbnail.width).toBeLessThanOrEqual(89)
    } else {
      expect(thumbnail.height).toBeGreaterThanOrEqual(101)
      expect(thumbnail.height).toBeLessThanOrEqual(103)
      expect(thumbnail.width).toBeGreaterThanOrEqual(111)
      expect(thumbnail.width).toBeLessThanOrEqual(113)
    }
  }
  for (const title of layout.titles) {
    expect(title.rect.left).toBeGreaterThanOrEqual(layout.gallery.left - 1)
    expect(title.rect.right).toBeLessThanOrEqual(layout.gallery.right + 1)
    expect(title.clientWidth).toBeGreaterThan(0)
    expect(title.scrollWidth).toBeGreaterThanOrEqual(title.clientWidth)
  }
  const firstRowTop = layout.rows[0].top
  const firstRowCount = layout.rows.filter((row) => Math.abs(row.top - firstRowTop) < 2).length
  expect(firstRowCount).toBe(layout.viewportWidth < 768 ? 1 : 2)
}
