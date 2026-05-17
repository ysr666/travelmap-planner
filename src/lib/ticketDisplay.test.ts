import { describe, expect, it } from 'vitest'
import { getTicketDisplayMeta } from './ticketDisplay'
import type { TicketMeta } from '../types'

function makeTicket(overrides: Partial<TicketMeta> = {}): TicketMeta {
  return {
    createdAt: Date.now(),
    fileName: 'boarding-pass.pdf',
    fileType: 'pdf',
    id: 'ticket-1',
    mimeType: 'application/pdf',
    size: 1024,
    tripId: 'trip-1',
    updatedAt: Date.now(),
    ...overrides,
  }
}

describe('getTicketDisplayMeta', () => {
  it('maps copy image tickets', () => {
    expect(getTicketDisplayMeta(makeTicket({
      fileName: 'qr.png',
      fileType: 'image',
      storageMode: 'copy',
    }))).toMatchObject({
      iconKind: 'image',
      secondaryLine: 'qr.png',
      storageLabel: '本地副本',
      toneKey: 'sky',
      typeLabel: '图片',
    })
  })

  it('maps copy pdf tickets', () => {
    expect(getTicketDisplayMeta(makeTicket({ storageMode: 'copy' }))).toMatchObject({
      iconKind: 'pdf',
      secondaryLine: 'boarding-pass.pdf',
      storageLabel: '本地副本',
      toneKey: 'rose',
      typeLabel: 'PDF',
    })
  })

  it('maps copy other tickets', () => {
    expect(getTicketDisplayMeta(makeTicket({
      fileName: 'order.zip',
      fileType: 'other',
      storageMode: 'copy',
    }))).toMatchObject({
      iconKind: 'file',
      secondaryLine: 'order.zip',
      storageLabel: '本地副本',
      toneKey: 'slate',
      typeLabel: '文件',
    })
  })

  it('maps reference tickets', () => {
    expect(getTicketDisplayMeta(makeTicket({
      referenceLocation: 'iCloud Drive/TravelMap/hotel.pdf',
      storageMode: 'reference',
    }))).toMatchObject({
      iconKind: 'reference',
      secondaryLine: 'iCloud Drive/TravelMap/hotel.pdf',
      storageLabel: '文件位置',
      toneKey: 'amber',
      typeLabel: '位置',
    })
  })

  it('maps external tickets', () => {
    expect(getTicketDisplayMeta(makeTicket({
      externalUrl: 'https://example.com/order',
      storageMode: 'external',
    }))).toMatchObject({
      iconKind: 'external',
      secondaryLine: 'https://example.com/order',
      storageLabel: '外部链接',
      toneKey: 'violet',
      typeLabel: '链接',
    })
  })
})
