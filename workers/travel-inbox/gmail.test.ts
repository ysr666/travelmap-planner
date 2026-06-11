import { describe, expect, it, vi } from 'vitest'
import { buildGmailAuthorizationUrl, createGmailAdapter } from './gmail'
import type { ConnectorRow, TravelInboxWorkerEnv } from './types'

const env: TravelInboxWorkerEnv = {
  GMAIL_CLIENT_ID: 'client-id',
  GMAIL_CLIENT_SECRET: 'client-secret',
  GMAIL_REDIRECT_URI: 'https://worker.example/v1/connectors/gmail/callback',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  SUPABASE_URL: 'https://project.supabase.co',
  TRAVEL_INBOX_APP_URL: 'https://app.example',
  TRAVEL_INBOX_CREDENTIAL_KEY: 'unused',
}

describe('Gmail travel inbox adapter', () => {
  it('uses gmail.readonly and preserves OAuth state', () => {
    const url = new URL(buildGmailAuthorizationUrl(env, 'encrypted-state'))
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/gmail.readonly')
    expect(url.searchParams.get('state')).toBe('encrypted-state')
    expect(url.searchParams.get('access_type')).toBe('offline')
  })

  it('lists at most fifty messages from the incremental cursor without mutating mail', async () => {
    const rawText = 'Subject: Tokyo hotel\r\n\r\nBooking details'
    const raw = btoa(rawText).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === 'https://oauth2.googleapis.com/token') return new Response(JSON.stringify({ access_token: 'access-token' }), { status: 200 })
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer access-token')
      if (url.includes('/messages?')) return new Response(JSON.stringify({ messages: [{ id: 'message-1' }] }), { status: 200 })
      return new Response(JSON.stringify({ id: 'message-1', internalDate: '1700000001000', raw }), { status: 200 })
    })
    const fetcher = fetchMock as unknown as typeof fetch
    const connector = makeConnector({ afterMs: 1_700_000_000_000 })

    const result = await createGmailAdapter(env, fetcher).sync(connector, { kind: 'gmail', refreshToken: 'refresh-token' })

    const listUrl = String(fetchMock.mock.calls[1]?.[0])
    expect(listUrl).toContain('maxResults=50')
    expect(listUrl).toContain('labelIds=INBOX')
    expect(listUrl).toContain('q=after%3A1700000000')
    expect(result.cursor).toEqual({ afterMs: 1_700_000_001_000 })
    expect(result.messages[0]).toMatchObject({ providerMessageId: 'message-1', subject: 'Tokyo hotel' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

function makeConnector(syncCursor: Record<string, unknown>): ConnectorRow {
  return {
    auto_ai_enabled: true,
    backfill_days: 0,
    gmail_label_id: 'INBOX',
    id: 'connector-1',
    kind: 'gmail',
    mailbox_folder: 'INBOX',
    name: 'Gmail',
    status: 'active',
    sync_cursor: syncCursor,
    user_id: 'user-1',
  }
}
