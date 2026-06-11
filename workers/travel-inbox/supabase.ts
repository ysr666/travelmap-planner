import type { ConnectorRow, TravelInboxWorkerEnv } from './types'

export class SupabaseAdmin {
  constructor(private readonly env: TravelInboxWorkerEnv, private readonly fetcher: typeof fetch = fetch) {}

  async authenticate(request: Request) {
    const authorization = request.headers.get('Authorization')
    if (!authorization?.startsWith('Bearer ')) throw new HttpError(401, 'unauthorized')
    const response = await this.fetcher(`${this.env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: this.env.SUPABASE_ANON_KEY, Authorization: authorization },
    })
    if (!response.ok) throw new HttpError(401, 'unauthorized')
    const user = await response.json() as { id?: string }
    if (!user.id) throw new HttpError(401, 'unauthorized')
    return user.id
  }

  listConnectors(userId?: string) {
    const query = userId ? `?user_id=eq.${encodeURIComponent(userId)}&order=updated_at.desc` : '?status=eq.active'
    return this.rest<ConnectorRow[]>('travel_inbox_connectors' + query)
  }

  async getConnector(id: string, userId?: string) {
    const rows = await this.rest<ConnectorRow[]>(`travel_inbox_connectors?id=eq.${encodeURIComponent(id)}${userId ? `&user_id=eq.${encodeURIComponent(userId)}` : ''}&limit=1`)
    return rows[0]
  }

  async createConnector(value: Record<string, unknown>) {
    const rows = await this.rest<ConnectorRow[]>('travel_inbox_connectors', { body: value, method: 'POST', prefer: 'return=representation' })
    return rows[0]
  }

  async updateConnector(id: string, value: Record<string, unknown>) {
    const rows = await this.rest<ConnectorRow[]>(`travel_inbox_connectors?id=eq.${encodeURIComponent(id)}`, { body: { ...value, updated_at: new Date().toISOString() }, method: 'PATCH', prefer: 'return=representation' })
    return rows[0]
  }

  async deleteConnector(id: string) {
    await this.rest(`travel_inbox_connectors?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  async putSecret(connectorId: string, encryptedSecret: string) {
    await this.rest('travel_inbox_connector_secrets?on_conflict=connector_id', {
      body: { connector_id: connectorId, encrypted_secret: encryptedSecret, updated_at: new Date().toISOString() },
      method: 'POST',
      prefer: 'resolution=merge-duplicates',
    })
  }

  async getSecret(connectorId: string) {
    const rows = await this.rest<Array<{ encrypted_secret: string }>>(`travel_inbox_connector_secrets?connector_id=eq.${encodeURIComponent(connectorId)}&limit=1`)
    return rows[0]?.encrypted_secret
  }

  async sourceExists(userId: string, fingerprint: string) {
    const [sources, tombstones] = await Promise.all([
      this.rest<Array<{ id: string }>>(`travel_inbox_sources?user_id=eq.${encodeURIComponent(userId)}&dedupe_fingerprint=eq.${fingerprint}&select=id&limit=1`),
      this.rest<Array<{ dedupe_fingerprint: string }>>(`travel_inbox_source_tombstones?user_id=eq.${encodeURIComponent(userId)}&dedupe_fingerprint=eq.${fingerprint}&select=dedupe_fingerprint&limit=1`),
    ])
    return sources.length > 0 || tombstones.length > 0
  }

  async createSource(value: Record<string, unknown>) {
    await this.rest('travel_inbox_sources', { body: value, method: 'POST' })
  }

  async uploadSource(path: string, raw: Uint8Array) {
    const response = await this.fetcher(`${this.env.SUPABASE_URL}/storage/v1/object/travel-inbox-sources/${path}`, {
      body: new Blob([raw.slice().buffer as ArrayBuffer], { type: 'message/rfc822' }),
      headers: this.headers({ 'Content-Type': 'message/rfc822', 'x-upsert': 'false' }),
      method: 'POST',
    })
    if (!response.ok) throw new HttpError(502, 'storage_error')
  }

  async deleteSourceObject(path: string) {
    const response = await this.fetcher(`${this.env.SUPABASE_URL}/storage/v1/object/travel-inbox-sources/${path}`, {
      headers: this.headers(), method: 'DELETE',
    })
    if (!response.ok && response.status !== 404) throw new HttpError(502, 'storage_error')
  }

  async listExpiredSources() {
    return this.rest<Array<{ id: string; user_id: string; dedupe_fingerprint: string; connector_kind: string; storage_path: string }>>(
      `travel_inbox_sources?expires_at=lt.${encodeURIComponent(new Date().toISOString())}&select=id,user_id,dedupe_fingerprint,connector_kind,storage_path&limit=100`,
    )
  }

  async expireSource(source: { id: string; user_id: string; dedupe_fingerprint: string; connector_kind: string; storage_path: string }) {
    await this.rest('travel_inbox_source_tombstones?on_conflict=user_id,dedupe_fingerprint', {
      body: { connector_kind: source.connector_kind, dedupe_fingerprint: source.dedupe_fingerprint, outcome: 'expired', user_id: source.user_id },
      method: 'POST', prefer: 'resolution=merge-duplicates',
    })
    await this.deleteSourceObject(source.storage_path)
    await this.rest(`travel_inbox_sources?id=eq.${source.id}`, { method: 'DELETE' })
  }

  private async rest<T = unknown>(path: string, options: { body?: unknown; method?: string; prefer?: string } = {}) {
    const response = await this.fetcher(`${this.env.SUPABASE_URL}/rest/v1/${path}`, {
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      headers: this.headers({ ...(options.prefer ? { Prefer: options.prefer } : {}), ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }) }),
      method: options.method ?? 'GET',
    })
    if (!response.ok) throw new HttpError(response.status, 'database_error')
    if (response.status === 204 || response.headers.get('Content-Length') === '0') return undefined as T
    const text = await response.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  private headers(extra: Record<string, string> = {}) {
    return { apikey: this.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${this.env.SUPABASE_SERVICE_ROLE_KEY}`, ...extra }
  }
}

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code) }
}
