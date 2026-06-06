import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/database'
import {
  addTravelInboxErrorEntry,
  addTravelInboxExtraction,
  buildTravelInboxApplyFiles,
  buildTravelInboxProviderTicketSummaries,
  buildTravelInboxSourceSummaries,
  buildTravelInboxTicketSummaries,
  deleteTravelInboxEntries,
  getActiveTravelInboxPreview,
  isTravelInboxAutoRecognizeEnabled,
  replaceTravelInboxEntryWithExtraction,
  saveTravelInboxPreview,
  setTravelInboxAutoRecognizeEnabled,
} from './travelInbox'
import type { ExistingTripImportExtractionResult } from './existingTripImportExtraction'
import type { ExistingTripImportPreview } from './existingTripImport'

beforeEach(async () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: createMemoryStorage() },
  })
  await db.delete()
  await db.open()
})

describe('travel inbox local queue', () => {
  it('stores extracted sources as trip-scoped inbox entries and rewrites source ids', async () => {
    const file = new Blob(['ticket text'], { type: 'text/plain' })
    const extraction: ExistingTripImportExtractionResult = {
      filesBySourceId: new Map([['source:file:1', {
        blob: file,
        fileName: 'ticket.txt',
        mimeType: 'text/plain',
        size: file.size,
      }]]),
      sources: [{
        fileName: 'ticket.txt',
        id: 'source:file:1',
        kind: 'text_file',
        label: 'ticket.txt',
        mimeType: 'text/plain',
        size: file.size,
        text: '2026-04-01 10:00 西湖游船 门票',
      }],
      warnings: [],
    }

    const result = await addTravelInboxExtraction({ extraction, tripId: 'trip_inbox' })
    const entries = await db.travelInboxEntries.toArray()

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      extractedText: expect.stringContaining('西湖游船'),
      fileName: 'ticket.txt',
      status: 'ready',
      tripId: 'trip_inbox',
    })
    expect(result.sourceIdByEntryId.get('source:file:1')).toBe(entries[0].id)
    expect(buildTravelInboxSourceSummaries(entries)[0]).toMatchObject({
      id: entries[0].id,
      text: expect.stringContaining('西湖游船'),
    })
    const files = await buildTravelInboxApplyFiles([entries[0].id])
    expect(files.get(entries[0].id)).toMatchObject({ fileName: 'ticket.txt' })
  })

  it('stores text, PDF, and image sources in the local inbox before AI recognition', async () => {
    const pdf = new Blob(['pdf text'], { type: 'application/pdf' })
    const image = new Blob(['image bytes'], { type: 'image/png' })
    const extraction: ExistingTripImportExtractionResult = {
      filesBySourceId: new Map([
        ['source:pdf', { blob: pdf, fileName: 'hotel.pdf', mimeType: 'application/pdf', size: pdf.size }],
        ['source:image', { blob: image, fileName: 'ticket.png', mimeType: 'image/png', size: image.size }],
      ]),
      sources: [
        {
          fileName: 'mail.txt',
          id: 'source:text',
          kind: 'text_file',
          label: 'mail.txt',
          mimeType: 'text/plain',
          text: '2026-04-01 酒店确认邮件',
        },
        {
          fileName: 'hotel.pdf',
          id: 'source:pdf',
          kind: 'pdf',
          label: 'hotel.pdf',
          mimeType: 'application/pdf',
          size: pdf.size,
          text: '2026-04-01 酒店 PDF 确认',
        },
        {
          fileName: 'ticket.png',
          id: 'source:image',
          kind: 'image',
          label: 'ticket.png',
          mimeType: 'image/png',
          size: image.size,
          text: '2026-04-01 图片 OCR 门票',
        },
      ],
      warnings: [],
    }

    await addTravelInboxExtraction({ extraction, tripId: 'trip_inbox' })

    await expect(db.travelInboxEntries.toArray()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ fileName: 'mail.txt', sourceKind: 'text_file', status: 'ready' }),
      expect.objectContaining({ fileName: 'hotel.pdf', sourceKind: 'pdf', status: 'ready' }),
      expect.objectContaining({ fileName: 'ticket.png', sourceKind: 'image', status: 'ready' }),
    ]))
    await expect(db.travelInboxBlobs.toArray()).resolves.toHaveLength(2)
  })

  it('keeps OCR failures recoverable and deletes source material after discard', async () => {
    const entry = await addTravelInboxErrorEntry({
      blob: new Blob(['image'], { type: 'image/png' }),
      error: 'OCR 语言资源下载失败。',
      fileName: 'ticket.png',
      mimeType: 'image/png',
      size: 5,
      tripId: 'trip_inbox',
    })

    await expect(db.travelInboxEntries.get(entry.id)).resolves.toMatchObject({
      error: 'OCR 语言资源下载失败。',
      sourceKind: 'image',
      status: 'error',
    })
    await expect(db.travelInboxBlobs.get(entry.id)).resolves.toBeTruthy()

    await deleteTravelInboxEntries([entry.id])

    await expect(db.travelInboxEntries.get(entry.id)).resolves.toBeUndefined()
    await expect(db.travelInboxBlobs.get(entry.id)).resolves.toBeUndefined()
  })

  it('retries an OCR failure into a ready inbox entry while keeping source material local', async () => {
    const entry = await addTravelInboxErrorEntry({
      blob: new Blob(['image'], { type: 'image/png' }),
      error: 'OCR 语言资源下载失败。',
      fileName: 'ticket.png',
      mimeType: 'image/png',
      size: 5,
      tripId: 'trip_inbox',
    })

    const retryResult = await replaceTravelInboxEntryWithExtraction({
      entryId: entry.id,
      extraction: {
        filesBySourceId: new Map(),
        sources: [{
          fileName: 'ticket.png',
          id: 'source:retry',
          kind: 'image',
          label: 'ticket.png',
          mimeType: 'image/png',
          size: 5,
          text: '重试 OCR 后的门票文本',
        }],
        warnings: [],
      },
    })

    expect(retryResult).toMatchObject({ error: undefined, extractedText: '重试 OCR 后的门票文本', status: 'ready' })
    await expect(db.travelInboxBlobs.get(entry.id)).resolves.toBeTruthy()
  })

  it('keeps automatic AI recognition disabled by default and stores the local override only', () => {
    expect(isTravelInboxAutoRecognizeEnabled()).toBe(false)

    setTravelInboxAutoRecognizeEnabled(true)
    expect(isTravelInboxAutoRecognizeEnabled()).toBe(true)
    expect(window.localStorage.getItem('tripmap:travel-inbox:auto-recognize')).toBe('1')

    setTravelInboxAutoRecognizeEnabled(false)
    expect(isTravelInboxAutoRecognizeEnabled()).toBe(false)
    expect(window.localStorage.getItem('tripmap:travel-inbox:auto-recognize')).toBe('0')
  })

  it('builds sanitized existing ticket summaries for provider matching', () => {
    const summaries = buildTravelInboxTicketSummaries([{
      createdAt: 100,
      fileName: 'private-order-file.pdf',
      fileType: 'pdf',
      id: 'ticket-secret-id',
      itemId: 'item-1',
      mimeType: 'application/pdf',
      note: '原始备注',
      scope: 'item',
      size: 10,
      storageMode: 'copy',
      ticketCategory: 'hotel_booking',
      title: '酒店订单',
      tripId: 'trip_inbox',
      updatedAt: 100,
    }])

    expect(summaries[0]).toMatchObject({
      summaryId: 'existing-ticket:1',
      ticketCategory: 'hotel_booking',
      ticketId: 'ticket-secret-id',
      title: '酒店订单',
    })
    expect(buildTravelInboxProviderTicketSummaries(summaries)[0]).toEqual({
      itemId: 'item-1',
      scope: 'item',
      summaryId: 'existing-ticket:1',
      ticketCategory: 'hotel_booking',
      title: '酒店订单',
    })
    expect(JSON.stringify(buildTravelInboxProviderTicketSummaries(summaries))).not.toContain('private-order-file')
    expect(JSON.stringify(buildTravelInboxProviderTicketSummaries(summaries))).not.toContain('ticket-secret-id')
  })

  it('persists one active preview per trip and removes it with source entries', async () => {
    const entry = await addTravelInboxErrorEntry({
      error: '等待重试',
      fileName: 'order.txt',
      mimeType: 'text/plain',
      tripId: 'trip_inbox',
    })
    const preview: ExistingTripImportPreview = {
      baselineFingerprint: 'baseline',
      diffs: [],
      generatedAt: new Date(0).toISOString(),
      sourceSummaries: [],
      warnings: [],
    }

    await saveTravelInboxPreview({
      checkedDiffIds: [],
      entryIds: [entry.id],
      preview,
      tripId: 'trip_inbox',
    })

    await expect(getActiveTravelInboxPreview('trip_inbox')).resolves.toMatchObject({
      entryIds: [entry.id],
      status: 'ready',
    })

    await deleteTravelInboxEntries([entry.id])

    await expect(getActiveTravelInboxPreview('trip_inbox')).resolves.toBeUndefined()
  })
})

function createMemoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => {
      values.delete(key)
    },
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  }
}
