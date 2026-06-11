import { getCurrentSession } from './cloudBackup'
import { getSupabaseClient, getSupabaseConfigStatus } from './supabaseClient'
import type { TravelInboxConnectorKind, TravelInboxConnectorStatus } from '../types'

export type CloudTravelInboxConnector = {
  id: string
  kind: Exclude<TravelInboxConnectorKind, 'local_folder'>
  name: string
  status: TravelInboxConnectorStatus
  mailbox_folder: string
  gmail_label_id?: string | null
  auto_ai_enabled: boolean
  backfill_days: 0 | 7 | 30
  last_synced_at?: string | null
  last_error_code?: string | null
}

export type CloudTravelInboxSource = {
  id: string
  connector_id?: string | null
  connector_kind: 'gmail' | 'imap'
  status: string
  source_kind: string
  label: string
  file_name?: string | null
  mime_type: string
  size: number
  storage_path: string
  target_trip_id?: string | null
  classification?: unknown
  warnings?: unknown
  error_code?: string | null
  received_at: string
  created_at: string
  updated_at: string
}

export function getTravelInboxConnectorConfig() {
  const value = import.meta.env.VITE_TRAVEL_INBOX_CONNECTOR_URL?.trim()
  return { configured: Boolean(value && getSupabaseConfigStatus().configured), url: value || null }
}

export async function listTravelInboxConnectors() {
  return connectorRequest<CloudTravelInboxConnector[]>('/v1/connectors')
}

export async function createImapConnector(input: {
  autoAiEnabled: boolean
  backfillDays: 0 | 7 | 30
  folder: string
  host: string
  name: string
  password: string
  username: string
}) {
  return connectorRequest<CloudTravelInboxConnector>('/v1/connectors', { body: { ...input, kind: 'imap' }, method: 'POST' })
}

export async function testImapConnector(input: { folder: string; host: string; password: string; username: string }) {
  return connectorRequest<{ ok: true }>('/v1/connectors/imap/test', { body: input, method: 'POST' })
}

export async function getGmailAuthorizationUrl(input: { autoAiEnabled: boolean; backfillDays: 0 | 7 | 30; labelId: string; name: string }) {
  return connectorRequest<{ authorizationUrl: string }>('/v1/connectors/gmail/authorize', { body: input, method: 'POST' })
}

export async function updateTravelInboxConnector(id: string, status: 'active' | 'paused') {
  return connectorRequest<CloudTravelInboxConnector>(`/v1/connectors/${encodeURIComponent(id)}`, { body: { status }, method: 'PATCH' })
}

export async function deleteTravelInboxConnector(id: string) {
  await connectorRequest(`/v1/connectors/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function syncTravelInboxConnector(id: string) {
  return connectorRequest<{ imported: number; skipped: number }>(`/v1/connectors/${encodeURIComponent(id)}/sync`, { method: 'POST' })
}

export async function listCloudTravelInboxSources() {
  const client = requireClient()
  const { data, error } = await client.from('travel_inbox_sources').select('*').order('received_at', { ascending: false }).limit(200)
  if (error) throw new Error('读取云端旅行收件箱失败。')
  return (data ?? []) as CloudTravelInboxSource[]
}

export async function claimCloudTravelInboxSource(sourceId: string, claimant: string) {
  const client = requireClient()
  const { data, error } = await client.rpc('claim_travel_inbox_source', { claimant, lease_seconds: 300, source_id: sourceId })
  if (error) throw new Error('此来源正在其他设备处理。')
  return data as CloudTravelInboxSource | null
}

export async function downloadCloudTravelInboxSource(path: string) {
  const client = requireClient()
  const { data, error } = await client.storage.from('travel-inbox-sources').download(path)
  if (error || !data) throw new Error('下载收件箱原件失败。')
  return data
}

export async function updateCloudTravelInboxSource(sourceId: string, patch: Record<string, unknown>) {
  const client = requireClient()
  const { error } = await client.from('travel_inbox_sources').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', sourceId)
  if (error) throw new Error('更新旅行收件箱状态失败。')
}

export async function completeCloudTravelInboxSource(sourceId: string, outcome: 'applied' | 'discarded', resultSummary?: unknown) {
  const client = requireClient()
  const { data: source, error } = await client.from('travel_inbox_sources').select('*').eq('id', sourceId).maybeSingle()
  if (error) throw new Error('读取待完成来源失败。')
  if (!source) return
  const user = (await client.auth.getUser()).data.user
  if (!user) throw new Error('请先登录 TripMap 账号。')
  const { error: tombstoneError } = await client.from('travel_inbox_source_tombstones').upsert({
    connector_kind: source.connector_kind,
    dedupe_fingerprint: source.dedupe_fingerprint,
    outcome,
    result_summary: resultSummary,
    user_id: user.id,
  }, { onConflict: 'user_id,dedupe_fingerprint' })
  if (tombstoneError) throw new Error('保存旅行收件箱去重记录失败。')
  const { error: storageError } = await client.storage.from('travel-inbox-sources').remove([source.storage_path])
  if (storageError) throw new Error('删除旅行收件箱原件失败。')
  const { error: deleteError } = await client.from('travel_inbox_sources').delete().eq('id', sourceId)
  if (deleteError) throw new Error('完成旅行收件箱来源失败。')
}

async function connectorRequest<T = unknown>(path: string, options: { body?: unknown; method?: string } = {}) {
  const config = getTravelInboxConnectorConfig()
  if (!config.configured || !config.url) throw new Error('旅行收件箱连接器后端未配置。')
  const session = await getCurrentSession()
  if (!session?.access_token) throw new Error('请先登录 TripMap 账号。')
  const response = await fetch(`${config.url.replace(/\/$/, '')}${path}`, {
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers: { Authorization: `Bearer ${session.access_token}`, ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    method: options.method ?? 'GET',
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null
    throw new Error(body?.message || '连接器请求失败。')
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

function requireClient() {
  const client = getSupabaseClient()
  if (!client) throw new Error('云端同步未配置。')
  return client
}
