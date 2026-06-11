import type { ConnectorRow, MailAdapter, MailMessage, TravelInboxWorkerEnv } from './types'

export function createGmailAdapter(env: TravelInboxWorkerEnv, fetcher: typeof fetch = fetch): MailAdapter {
  return {
    async sync(connector, secret) {
      if (secret.kind !== 'gmail') throw new Error('invalid_secret_kind')
      const accessToken = await refreshAccessToken(env, secret.refreshToken, fetcher)
      const cursorMs = readCursorMs(connector)
      const afterSeconds = Math.floor(cursorMs / 1000)
      const params = new URLSearchParams({ maxResults: '50', q: `after:${afterSeconds}` })
      if (connector.gmail_label_id) params.set('labelIds', connector.gmail_label_id)
      const listed = await gmailJson<{ messages?: Array<{ id: string }> }>(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, accessToken, fetcher)
      const messages: MailMessage[] = []
      let newest = cursorMs
      for (const item of listed.messages ?? []) {
        const message = await gmailJson<{ id: string; internalDate?: string; raw?: string }>(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=raw`,
          accessToken,
          fetcher,
        )
        if (!message.raw) continue
        const raw = decodeBase64Url(message.raw)
        const receivedAtMs = Number(message.internalDate) || Date.now()
        newest = Math.max(newest, receivedAtMs)
        messages.push({
          providerMessageId: message.id,
          raw,
          receivedAt: new Date(receivedAtMs).toISOString(),
          subject: readSubject(raw),
        })
      }
      return { cursor: { afterMs: newest }, messages }
    },
  }
}

export async function exchangeGmailAuthorizationCode(env: TravelInboxWorkerEnv, code: string, fetcher: typeof fetch = fetch) {
  const response = await fetcher('https://oauth2.googleapis.com/token', {
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID ?? '',
      client_secret: env.GMAIL_CLIENT_SECRET ?? '',
      code,
      grant_type: 'authorization_code',
      redirect_uri: env.GMAIL_REDIRECT_URI ?? '',
    }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    method: 'POST',
  })
  const body = await response.json() as { refresh_token?: string }
  if (!response.ok || !body.refresh_token) throw new Error('gmail_oauth_failed')
  return body.refresh_token
}

async function refreshAccessToken(env: TravelInboxWorkerEnv, refreshToken: string, fetcher: typeof fetch) {
  const response = await fetcher('https://oauth2.googleapis.com/token', {
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID ?? '',
      client_secret: env.GMAIL_CLIENT_SECRET ?? '',
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    method: 'POST',
  })
  const body = await response.json() as { access_token?: string }
  if (!response.ok || !body.access_token) throw new Error('gmail_reauth_required')
  return body.access_token
}

async function gmailJson<T>(url: string, accessToken: string, fetcher: typeof fetch) {
  const response = await fetcher(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!response.ok) throw new Error(response.status === 401 ? 'gmail_reauth_required' : 'gmail_sync_failed')
  return response.json() as Promise<T>
}

function readCursorMs(connector: ConnectorRow) {
  const cursor = Number(connector.sync_cursor.afterMs)
  if (Number.isFinite(cursor) && cursor > 0) return cursor
  const days = connector.backfill_days
  return Date.now() - days * 24 * 60 * 60 * 1000
}

function decodeBase64Url(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(base64)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function readSubject(raw: Uint8Array) {
  const header = new TextDecoder().decode(raw.slice(0, Math.min(raw.length, 16_384))).split(/\r?\n\r?\n/, 1)[0]
  return header.match(/^Subject:\s*(.+)$/im)?.[1]?.trim().slice(0, 240) || '邮件来源'
}

export function buildGmailAuthorizationUrl(env: TravelInboxWorkerEnv, state: string) {
  const params = new URLSearchParams({
    access_type: 'offline',
    client_id: env.GMAIL_CLIENT_ID ?? '',
    include_granted_scopes: 'true',
    prompt: 'consent',
    redirect_uri: env.GMAIL_REDIRECT_URI ?? '',
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/gmail.readonly',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}
