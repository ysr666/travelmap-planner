import { describe, expect, it, vi } from 'vitest'
import { countAttachments, persistMessage } from './index'
import type { SupabaseAdmin } from './supabase'
import type { ConnectorRow, MailMessage } from './types'

describe('travel inbox source persistence', () => {
  it('deduplicates before upload', async () => {
    const db = mockDb({ sourceExists: true })
    await expect(persistMessage(connector, message('Subject: Duplicate\r\n\r\nBody'), db.value)).resolves.toBe('skipped')
    expect(db.uploadSource).not.toHaveBeenCalled()
    expect(db.createSource).not.toHaveBeenCalled()
  })

  it('records an error source when attachment count exceeds the limit', async () => {
    const raw = Array.from({ length: 9 }, (_, index) => `Content-Disposition: attachment; filename="${index}.pdf"`).join('\r\n')
    const db = mockDb()
    await expect(persistMessage(connector, message(raw), db.value)).resolves.toBe('imported')
    expect(countAttachments(new TextEncoder().encode(raw))).toBe(9)
    expect(db.uploadSource).not.toHaveBeenCalled()
    expect(db.createSource).toHaveBeenCalledWith(expect.objectContaining({ error_code: 'too_many_attachments', status: 'error' }))
  })
})

const connector: ConnectorRow = {
  auto_ai_enabled: true,
  backfill_days: 0,
  id: 'connector-1',
  kind: 'gmail',
  mailbox_folder: 'INBOX',
  name: 'Gmail',
  status: 'active',
  sync_cursor: {},
  user_id: 'user-1',
}

function message(raw: string): MailMessage {
  return { providerMessageId: 'message-1', raw: new TextEncoder().encode(raw), receivedAt: '2026-06-11T00:00:00.000Z', subject: 'Order' }
}

function mockDb(options: { sourceExists?: boolean } = {}) {
  const createSource = vi.fn(async () => undefined)
  const uploadSource = vi.fn(async () => undefined)
  return {
    createSource,
    uploadSource,
    value: {
      createSource,
      deleteSourceObject: vi.fn(async () => undefined),
      sourceExists: vi.fn(async () => options.sourceExists ?? false),
      uploadSource,
    } as unknown as SupabaseAdmin,
  }
}
