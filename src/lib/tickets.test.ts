import { describe, expect, it } from 'vitest'
import {
  describeTicketMetaLine,
  describeTicketStorage,
  formatFileSize,
  getTicketDisplayTitle,
  getTicketFileType,
  getTicketScope,
  getTicketStorageMode,
  isValidExternalUrl,
  normalizeTicketFileName,
  shouldExpectTicketBlob,
} from './tickets'
import type { TicketMeta } from '../types'

function makeTicket(overrides: Partial<TicketMeta> = {}): TicketMeta {
  return {
    id: 'ticket-1',
    tripId: 'trip-1',
    fileName: 'boarding-pass.pdf',
    fileType: 'pdf',
    mimeType: 'application/pdf',
    size: 1024,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

describe('getTicketScope', () => {
  it('returns explicit scope when set', () => {
    expect(getTicketScope(makeTicket({ scope: 'trip' }))).toBe('trip')
  })

  it('returns item scope when itemId is set', () => {
    expect(getTicketScope(makeTicket({ itemId: 'item-1' }))).toBe('item')
  })

  it('returns unassigned when no scope or itemId', () => {
    expect(getTicketScope(makeTicket())).toBe('unassigned')
  })
})

describe('getTicketStorageMode', () => {
  it('returns explicit storage mode', () => {
    expect(getTicketStorageMode(makeTicket({ storageMode: 'reference' }))).toBe('reference')
  })

  it('defaults to copy', () => {
    expect(getTicketStorageMode(makeTicket())).toBe('copy')
  })
})

describe('shouldExpectTicketBlob', () => {
  it('returns true for copy mode', () => {
    expect(shouldExpectTicketBlob(makeTicket({ storageMode: 'copy' }))).toBe(true)
  })

  it('returns false for reference mode', () => {
    expect(shouldExpectTicketBlob(makeTicket({ storageMode: 'reference' }))).toBe(false)
  })

  it('returns false for external mode', () => {
    expect(shouldExpectTicketBlob(makeTicket({ storageMode: 'external' }))).toBe(false)
  })
})

describe('getTicketDisplayTitle', () => {
  it('prefers title', () => {
    expect(getTicketDisplayTitle(makeTicket({ title: 'My Ticket', note: 'note', fileName: 'file.pdf' }))).toBe(
      'My Ticket',
    )
  })

  it('falls back to note', () => {
    expect(getTicketDisplayTitle(makeTicket({ note: 'Important note', fileName: 'file.pdf' }))).toBe('Important note')
  })

  it('falls back to fileName', () => {
    expect(getTicketDisplayTitle(makeTicket({ fileName: 'ticket.pdf' }))).toBe('ticket.pdf')
  })

  it('returns fallback when all are empty', () => {
    expect(getTicketDisplayTitle(makeTicket({ fileName: '' }))).toBe('未命名票据')
  })
})

describe('normalizeTicketFileName', () => {
  it('returns fileName when present', () => {
    expect(normalizeTicketFileName('pass.pdf', 'fallback.pdf')).toBe('pass.pdf')
  })

  it('falls back to fallback', () => {
    expect(normalizeTicketFileName(undefined, 'fallback.pdf')).toBe('fallback.pdf')
  })

  it('returns default when both empty', () => {
    expect(normalizeTicketFileName(undefined, undefined)).toBe('未命名票据')
  })
})

describe('getTicketFileType', () => {
  it('returns image for image mime', () => {
    const file = new File([''], 'photo.jpg', { type: 'image/jpeg' })
    expect(getTicketFileType(file)).toBe('image')
  })

  it('returns pdf for pdf mime', () => {
    const file = new File([''], 'doc.pdf', { type: 'application/pdf' })
    expect(getTicketFileType(file)).toBe('pdf')
  })

  it('returns other for unknown mime', () => {
    const file = new File([''], 'data.zip', { type: 'application/zip' })
    expect(getTicketFileType(file)).toBe('other')
  })
})

describe('isValidExternalUrl', () => {
  it('accepts https URL', () => {
    expect(isValidExternalUrl('https://example.com')).toBe(true)
  })

  it('accepts http URL', () => {
    expect(isValidExternalUrl('http://example.com')).toBe(true)
  })

  it('rejects ftp URL', () => {
    expect(isValidExternalUrl('ftp://example.com')).toBe(false)
  })

  it('rejects non-URL string', () => {
    expect(isValidExternalUrl('not a url')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isValidExternalUrl('')).toBe(false)
  })
})

describe('formatFileSize', () => {
  it('formats zero', () => {
    expect(formatFileSize(0)).toBe('0 KB')
  })

  it('formats bytes as KB', () => {
    expect(formatFileSize(500)).toBe('1 KB')
  })

  it('formats exact KB', () => {
    expect(formatFileSize(1024)).toBe('1 KB')
  })

  it('formats MB', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB')
  })

  it('formats fractional MB', () => {
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe('1.5 MB')
  })
})

describe('describeTicketStorage', () => {
  it('describes reference mode', () => {
    expect(describeTicketStorage(makeTicket({ storageMode: 'reference' }))).toBe('仅记录位置')
  })

  it('describes external mode', () => {
    expect(describeTicketStorage(makeTicket({ storageMode: 'external' }))).toBe('外部链接')
  })

  it('describes copy mode with size', () => {
    const result = describeTicketStorage(makeTicket({ storageMode: 'copy', size: 2048 }))
    expect(result).toContain('保存票据文件')
    expect(result).toContain('KB')
  })
})

describe('describeTicketMetaLine', () => {
  it('combines file type and storage', () => {
    const result = describeTicketMetaLine(makeTicket({ fileType: 'pdf', size: 2048 }))
    expect(result).toContain('PDF')
    expect(result).toContain('保存票据文件')
  })
})
