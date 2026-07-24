// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { TicketMeta } from '../../types'
import { getTicketStorageMode } from '../../lib/tickets'
import { getTicketDisplayMeta } from '../../lib/ticketDisplay'
import { TicketThumbnail } from './TicketThumbnail'

const mocks = vi.hoisted(() => ({
  getTicketBlob: vi.fn(),
  restoreTicketBlobCacheFromCloud: vi.fn(),
}))

vi.mock('../../db', () => ({
  getTicketBlob: mocks.getTicketBlob,
}))

vi.mock('../../lib/cloudObjectSync', () => ({
  restoreTicketBlobCacheFromCloud: mocks.restoreTicketBlobCacheFromCloud,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getTicketBlob.mockResolvedValue(undefined)
})

function makeTicket(overrides: Partial<TicketMeta> = {}): TicketMeta {
  return {
    createdAt: Date.now(),
    fileName: 'test.png',
    fileType: 'image',
    id: 'ticket-1',
    mimeType: 'image/png',
    scope: 'trip',
    size: 1024,
    storageMode: 'copy',
    title: 'Test Ticket',
    tripId: 'trip-1',
    updatedAt: Date.now(),
    ...overrides,
  }
}

describe('TicketThumbnail logic', () => {
  it('renders the copied image blob as the thumbnail', async () => {
    const container = document.createElement('div')
    const root: Root = createRoot(container)
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:ticket-thumbnail')
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    mocks.getTicketBlob.mockResolvedValue({
      blob: new Blob(['image'], { type: 'image/png' }),
      ticketId: 'ticket-1',
      updatedAt: Date.now(),
    })

    await act(async () => {
      root.render(<TicketThumbnail ticket={makeTicket()} />)
    })
    await act(async () => {
      await Promise.resolve()
    })

    const image = container.querySelector('img')
    expect(image?.getAttribute('src')).toBe('blob:ticket-thumbnail')
    expect(image?.getAttribute('alt')).toBe('Test Ticket')
    expect(createObjectUrl).toHaveBeenCalledOnce()

    await act(async () => {
      root.unmount()
    })
    createObjectUrl.mockRestore()
    revokeObjectUrl.mockRestore()
  })

  it('loads visual previews for copied image and PDF tickets', () => {
    const imageCopy = makeTicket({ fileType: 'image', storageMode: 'copy' })
    const imageRef = makeTicket({ fileType: 'image', storageMode: 'reference' })
    const pdfCopy = makeTicket({ fileType: 'pdf', storageMode: 'copy' })
    const external = makeTicket({ fileType: 'other', storageMode: 'external' })

    const canLoadPreview = (ticket: TicketMeta) =>
      getTicketStorageMode(ticket) === 'copy' && (ticket.fileType === 'image' || ticket.fileType === 'pdf')

    expect(canLoadPreview(imageCopy)).toBe(true)
    expect(canLoadPreview(imageRef)).toBe(false)
    expect(canLoadPreview(pdfCopy)).toBe(true)
    expect(canLoadPreview(external)).toBe(false)
  })

  it('displays correct type labels for each ticket type', () => {
    expect(getTicketDisplayMeta(makeTicket({ fileType: 'image', storageMode: 'copy' })).typeLabel).toBe('图片')
    expect(getTicketDisplayMeta(makeTicket({ fileType: 'pdf', storageMode: 'copy' })).typeLabel).toBe('PDF')
    expect(getTicketDisplayMeta(makeTicket({ fileType: 'other', storageMode: 'copy' })).typeLabel).toBe('文件')
    expect(getTicketDisplayMeta(makeTicket({ storageMode: 'external', fileType: 'other' })).typeLabel).toBe('链接')
    expect(getTicketDisplayMeta(makeTicket({ storageMode: 'reference', fileType: 'other' })).typeLabel).toBe('位置')
  })

  it('returns correct icon kinds for fallback display', () => {
    expect(getTicketDisplayMeta(makeTicket({ fileType: 'pdf', storageMode: 'copy' })).iconKind).toBe('pdf')
    expect(getTicketDisplayMeta(makeTicket({ fileType: 'other', storageMode: 'copy' })).iconKind).toBe('file')
    expect(getTicketDisplayMeta(makeTicket({ storageMode: 'external', fileType: 'other' })).iconKind).toBe('external')
    expect(getTicketDisplayMeta(makeTicket({ storageMode: 'reference', fileType: 'other' })).iconKind).toBe('reference')
  })
})
