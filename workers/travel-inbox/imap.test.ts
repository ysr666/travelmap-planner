import { describe, expect, it, vi } from 'vitest'
import { createImapAdapter, validateImapEndpoint } from './imap'
import type { ConnectorRow } from './types'

describe('IMAP endpoint validation', () => {
  it('only accepts public-looking DNS hosts on TLS port 993', () => {
    expect(() => validateImapEndpoint('imap.example.com', 993)).not.toThrow()
    expect(() => validateImapEndpoint('imap.example.com', 143)).toThrow('imap_endpoint_not_allowed')
    expect(() => validateImapEndpoint('127.0.0.1', 993)).toThrow('imap_endpoint_not_allowed')
    expect(() => validateImapEndpoint('localhost', 993)).toThrow('imap_endpoint_not_allowed')
    expect(() => validateImapEndpoint('fd00::1', 993)).toThrow('imap_endpoint_not_allowed')
  })

  it('resets the UID cursor when UIDVALIDITY changes and fetches with BODY.PEEK', async () => {
    const raw = new TextEncoder().encode('Subject: Rail pass\r\n\r\nTicket')
    const commands: string[] = []
    const transcript = [
      '* OK ready\r\n',
      'A0001 OK LOGIN completed\r\n',
      '* OK [UIDVALIDITY 55] valid\r\nA0002 OK EXAMINE completed\r\n',
      '* SEARCH 8\r\nA0003 OK SEARCH completed\r\n',
      `* 1 FETCH (UID 8 INTERNALDATE "11-Jun-2026 10:00:00 +0000" RFC822.SIZE ${raw.length} BODY[] {${raw.length}}\r\n`,
      new TextDecoder().decode(raw),
      '\r\n)\r\nA0004 OK FETCH completed\r\n',
      '* BYE\r\nA0005 OK LOGOUT completed\r\n',
    ].join('')
    const socketFactory = async () => ({
      close: vi.fn(),
      readable: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(transcript)); controller.close() } }),
      writable: new WritableStream<Uint8Array>({ write(chunk) { commands.push(new TextDecoder().decode(chunk)) } }),
    })
    const connector: ConnectorRow = {
      auto_ai_enabled: true,
      backfill_days: 0,
      id: 'connector-1',
      kind: 'imap',
      mailbox_folder: 'Trips',
      name: 'Mailbox',
      status: 'active',
      sync_cursor: { connectedAt: Date.parse('2026-06-11T12:00:00.000Z'), lastUid: 999, uidValidity: 54 },
      user_id: 'user-1',
    }

    const result = await createImapAdapter(socketFactory).sync(connector, { host: 'imap.example.com', kind: 'imap', password: 'secret', port: 993, username: 'user@example.com' })

    expect(commands.join('')).toContain('EXAMINE "Trips"')
    expect(commands.join('')).toContain('UID SEARCH SINCE 04-Jun-2026')
    expect(commands.join('')).toContain('UID FETCH 8 (UID INTERNALDATE RFC822.SIZE BODY.PEEK[])')
    expect(result.cursor).toEqual({ connectedAt: Date.parse('2026-06-11T12:00:00.000Z'), lastUid: 8, uidValidity: 55 })
    expect(result.messages[0]).toMatchObject({ providerMessageId: '55:8', subject: 'Rail pass' })
  })
})
