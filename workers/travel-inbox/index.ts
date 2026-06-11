import { decryptJson, encryptJson, sha256Hex } from './crypto'
import { buildGmailAuthorizationUrl, createGmailAdapter, exchangeGmailAuthorizationCode } from './gmail'
import { createImapAdapter, validateImapEndpoint } from './imap'
import { HttpError, SupabaseAdmin } from './supabase'
import type { ConnectorRow, ConnectorSecret, MailAdapter, MailMessage, TravelInboxWorkerEnv } from './types'

const MAX_SOURCE_SIZE = 20 * 1024 * 1024
const MAX_ATTACHMENTS = 8

export default {
  fetch(request: Request, env: TravelInboxWorkerEnv) {
    return handleRequest(request, env)
  },
  scheduled(_controller: ScheduledController, env: TravelInboxWorkerEnv, context: ExecutionContext) {
    context.waitUntil(runScheduledSync(env))
  },
}

export async function handleRequest(request: Request, env: TravelInboxWorkerEnv) {
  const cors = corsHeaders(request, env)
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors, status: 204 })
  try {
    const url = new URL(request.url)
    const db = new SupabaseAdmin(env)
    if (url.pathname === '/v1/connectors/gmail/callback' && request.method === 'GET') return handleGmailCallback(url, env, db)
    const userId = await db.authenticate(request)

    if (url.pathname === '/v1/connectors' && request.method === 'GET') {
      return json(await db.listConnectors(userId), 200, cors)
    }
    if (url.pathname === '/v1/connectors' && request.method === 'POST') {
      return json(await createImapConnector(await readJson(request), userId, env, db), 201, cors)
    }
    if (url.pathname === '/v1/connectors/gmail/authorize' && request.method === 'POST') {
      return json(await authorizeGmail(await readJson(request), userId, env), 200, cors)
    }
    if (url.pathname === '/v1/connectors/imap/test' && request.method === 'POST') {
      const input = readImapInput(await readJson(request))
      await createImapAdapter().test?.(input.secret, input.folder)
      return json({ ok: true }, 200, cors)
    }

    const match = url.pathname.match(/^\/v1\/connectors\/([0-9a-f-]+)(?:\/(sync))?$/i)
    if (match) {
      const connector = await db.getConnector(match[1], userId)
      if (!connector) throw new HttpError(404, 'not_found')
      if (match[2] === 'sync' && request.method === 'POST') {
        const result = await syncConnector(connector, env, db)
        return json(result, 200, cors)
      }
      if (request.method === 'PATCH') {
        const body = await readJson(request)
        const status = body.status
        if (status !== 'active' && status !== 'paused') throw new HttpError(400, 'invalid_request')
        return json(await db.updateConnector(connector.id, { status }), 200, cors)
      }
      if (request.method === 'DELETE') {
        await db.deleteConnector(connector.id)
        return new Response(null, { headers: cors, status: 204 })
      }
    }
    throw new HttpError(404, 'not_found')
  } catch (caught) {
    const error = normalizeError(caught)
    return json({ code: error.code, message: error.message, ok: false }, error.status, cors)
  }
}

export async function runScheduledSync(env: TravelInboxWorkerEnv) {
  const db = new SupabaseAdmin(env)
  const connectors = await db.listConnectors()
  for (const connector of connectors) {
    try { await syncConnector(connector, env, db) } catch { await db.updateConnector(connector.id, { last_error_code: 'sync_failed', status: connector.status }) }
  }
  for (const source of await db.listExpiredSources()) {
    try { await db.expireSource(source) } catch { /* retry next cron */ }
  }
}

async function createImapConnector(input: Record<string, unknown>, userId: string, env: TravelInboxWorkerEnv, db: SupabaseAdmin) {
  if (input.kind !== 'imap') throw new HttpError(400, 'invalid_request')
  const parsed = readImapInput(input)
  await createImapAdapter().test?.(parsed.secret, parsed.folder)
  const connector = await db.createConnector({
    auto_ai_enabled: input.autoAiEnabled !== false,
    backfill_days: readBackfillDays(input.backfillDays),
    kind: 'imap',
    mailbox_folder: parsed.folder,
    name: readText(input.name, 120) || parsed.secret.username,
    status: 'active',
    sync_cursor: { connectedAt: Date.now() },
    user_id: userId,
  })
  await db.putSecret(connector.id, await encryptJson(parsed.secret, env.TRAVEL_INBOX_CREDENTIAL_KEY))
  return connector
}

async function authorizeGmail(input: Record<string, unknown>, userId: string, env: TravelInboxWorkerEnv) {
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REDIRECT_URI) throw new HttpError(503, 'gmail_not_configured')
  const state = await encryptJson({
    autoAiEnabled: input.autoAiEnabled !== false,
    backfillDays: readBackfillDays(input.backfillDays),
    expiresAt: Date.now() + 10 * 60 * 1000,
    labelId: readText(input.labelId, 160) || 'INBOX',
    name: readText(input.name, 120) || 'Gmail',
    userId,
  }, env.TRAVEL_INBOX_CREDENTIAL_KEY)
  return { authorizationUrl: buildGmailAuthorizationUrl(env, state) }
}

async function handleGmailCallback(url: URL, env: TravelInboxWorkerEnv, db: SupabaseAdmin) {
  const code = url.searchParams.get('code')
  const stateValue = url.searchParams.get('state')
  if (!code || !stateValue) throw new HttpError(400, 'invalid_oauth_callback')
  const state = await decryptJson<{ autoAiEnabled: boolean; backfillDays: number; expiresAt: number; labelId: string; name: string; userId: string }>(stateValue, env.TRAVEL_INBOX_CREDENTIAL_KEY)
  if (state.expiresAt < Date.now()) throw new HttpError(400, 'oauth_state_expired')
  const refreshToken = await exchangeGmailAuthorizationCode(env, code)
  const connector = await db.createConnector({
    auto_ai_enabled: state.autoAiEnabled,
    backfill_days: readBackfillDays(state.backfillDays),
    gmail_label_id: state.labelId,
    kind: 'gmail',
    mailbox_folder: 'INBOX',
    name: state.name,
    status: 'active',
    sync_cursor: { afterMs: Date.now() - state.backfillDays * 24 * 60 * 60 * 1000 },
    user_id: state.userId,
  })
  await db.putSecret(connector.id, await encryptJson({ kind: 'gmail', refreshToken }, env.TRAVEL_INBOX_CREDENTIAL_KEY))
  return Response.redirect(`${env.TRAVEL_INBOX_APP_URL.replace(/\/$/, '')}/#/inbox?connector=created`, 302)
}

async function syncConnector(connector: ConnectorRow, env: TravelInboxWorkerEnv, db: SupabaseAdmin) {
  if (connector.status !== 'active') return { imported: 0, skipped: 0 }
  const encrypted = await db.getSecret(connector.id)
  if (!encrypted) throw new HttpError(409, 'connector_secret_missing')
  const secret = await decryptJson<ConnectorSecret>(encrypted, env.TRAVEL_INBOX_CREDENTIAL_KEY)
  const adapter: MailAdapter = connector.kind === 'gmail' ? createGmailAdapter(env) : createImapAdapter()
  let result
  try {
    result = await adapter.sync(connector, secret)
  } catch (caught) {
    const code = caught instanceof Error && caught.message === 'gmail_reauth_required' ? 'reauth_required' : 'sync_failed'
    await db.updateConnector(connector.id, { last_error_code: code, status: code === 'reauth_required' ? 'reauth_required' : 'error' })
    throw new HttpError(502, code)
  }
  let imported = 0
  let skipped = 0
  for (const message of result.messages.slice(0, 50)) {
    const outcome = await persistMessage(connector, message, db)
    if (outcome === 'imported') imported += 1
    else skipped += 1
  }
  await db.updateConnector(connector.id, { last_error_code: null, last_synced_at: new Date().toISOString(), status: 'active', sync_cursor: result.cursor })
  return { imported, skipped }
}

export async function persistMessage(connector: ConnectorRow, message: MailMessage, db: SupabaseAdmin) {
  const rawHash = await sha256Hex(message.raw)
  const fingerprint = await sha256Hex(`${connector.kind}:${message.providerMessageId}:${rawHash}`)
  if (await db.sourceExists(connector.user_id, fingerprint)) return 'skipped'
  const sourceId = crypto.randomUUID()
  const storagePath = `${connector.user_id}/${sourceId}/message.eml`
  const attachmentCount = countAttachments(message.raw)
  if (message.raw.length > MAX_SOURCE_SIZE || attachmentCount > MAX_ATTACHMENTS) {
    await db.createSource({
      connector_id: connector.id,
      connector_kind: connector.kind,
      dedupe_fingerprint: fingerprint,
      error_code: message.raw.length > MAX_SOURCE_SIZE ? 'source_too_large' : 'too_many_attachments',
      file_name: 'message.eml',
      id: sourceId,
      label: message.subject,
      mime_type: 'message/rfc822',
      provider_message_id: message.providerMessageId,
      received_at: message.receivedAt,
      size: 0,
      status: 'error',
      storage_path: storagePath,
      user_id: connector.user_id,
    })
    return 'imported'
  }
  await db.uploadSource(storagePath, message.raw)
  try {
    await db.createSource({
      connector_id: connector.id,
      connector_kind: connector.kind,
      dedupe_fingerprint: fingerprint,
      file_name: 'message.eml',
      id: sourceId,
      label: message.subject,
      mime_type: 'message/rfc822',
      provider_message_id: message.providerMessageId,
      received_at: message.receivedAt,
      size: message.raw.length,
      status: 'queued',
      storage_path: storagePath,
      user_id: connector.user_id,
    })
    return 'imported'
  } catch (caught) {
    await db.deleteSourceObject(storagePath)
    throw caught
  }
}

function readImapInput(input: Record<string, unknown>) {
  const host = readText(input.host, 255)
  const username = readText(input.username, 320)
  const password = readText(input.password, 1024)
  const folder = readText(input.folder, 255) || 'INBOX'
  if (!host || !username || !password) throw new HttpError(400, 'invalid_request')
  validateImapEndpoint(host, 993)
  return { folder, secret: { host, kind: 'imap', password, port: 993, username } as const }
}

function readBackfillDays(value: unknown): 0 | 7 | 30 { return value === 7 || value === 30 ? value : 0 }
function readText(value: unknown, max: number) { return typeof value === 'string' ? value.trim().slice(0, max) : '' }
async function readJson(request: Request) { try { const value = await request.json(); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} } catch { throw new HttpError(400, 'invalid_json') } }
export function countAttachments(raw: Uint8Array) { return (new TextDecoder().decode(raw).match(/Content-Disposition:\s*attachment/gi) ?? []).length }
function json(value: unknown, status: number, headers: HeadersInit) { return new Response(JSON.stringify(value), { headers: { ...headers, 'Content-Type': 'application/json' }, status }) }

function corsHeaders(request: Request, env: TravelInboxWorkerEnv) {
  const origin = request.headers.get('Origin') ?? ''
  const allowed = (env.TRAVEL_INBOX_ALLOWED_ORIGINS ?? env.TRAVEL_INBOX_APP_URL).split(',').map((item) => item.trim())
  return {
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0] ?? '',
    'Vary': 'Origin',
  }
}

function normalizeError(caught: unknown) {
  if (caught instanceof HttpError) return { code: caught.code, message: publicMessage(caught.code), status: caught.status }
  const code = caught instanceof Error && /^[a-z0-9_]+$/.test(caught.message) ? caught.message : 'internal_error'
  return { code, message: publicMessage(code), status: code.startsWith('invalid_') ? 400 : 500 }
}

function publicMessage(code: string) {
  const messages: Record<string, string> = {
    connector_secret_missing: '连接器凭据不可用，请重新连接。',
    gmail_not_configured: 'Gmail 连接器尚未配置。',
    imap_auth_failed: '无法登录邮箱，请检查应用专用密码。',
    imap_endpoint_not_allowed: '仅支持公开域名上的 IMAP TLS 993。',
    not_found: '未找到连接器。',
    reauth_required: '邮箱授权已失效，请重新连接。',
    sync_failed: '邮箱同步失败，请稍后重试。',
    unauthorized: '请先登录 TripMap。',
  }
  return messages[code] ?? '请求未完成，请稍后重试。'
}
