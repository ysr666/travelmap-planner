import { describe, expect, it, vi } from 'vitest'
import { HttpError, SupabaseAdmin } from './supabase'
import type { TravelInboxWorkerEnv } from './types'

const env: TravelInboxWorkerEnv = {
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  SUPABASE_URL: 'https://project.supabase.co',
  TRAVEL_INBOX_APP_URL: 'https://app.example',
  TRAVEL_INBOX_CREDENTIAL_KEY: 'unused',
}

describe('travel inbox Supabase boundary', () => {
  it('validates bearer tokens through Supabase Auth', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer user-jwt')
      expect((init?.headers as Record<string, string>).apikey).toBe('anon-key')
      return new Response(JSON.stringify({ id: 'user-1' }), { status: 200 })
    }) as unknown as typeof fetch
    const admin = new SupabaseAdmin(env, fetcher)

    await expect(admin.authenticate(new Request('https://worker.example', { headers: { Authorization: 'Bearer user-jwt' } }))).resolves.toBe('user-1')
    await expect(admin.authenticate(new Request('https://worker.example'))).rejects.toEqual(new HttpError(401, 'unauthorized'))
  })

  it('deletes expired objects, writes a tombstone, then deletes the source row', async () => {
    const calls: Array<{ method: string; url: string }> = []
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', url: String(input) })
      return new Response(null, { status: 204 })
    }) as unknown as typeof fetch
    const admin = new SupabaseAdmin(env, fetcher)

    await admin.expireSource({ connector_kind: 'gmail', dedupe_fingerprint: 'fingerprint', id: 'source-1', storage_path: 'user-1/source-1/message.eml', user_id: 'user-1' })

    expect(calls.map((call) => call.method)).toEqual(['POST', 'DELETE', 'DELETE'])
    expect(calls[0]?.url).toContain('/rest/v1/travel_inbox_source_tombstones')
    expect(calls[1]?.url).toContain('/storage/v1/object/travel-inbox-sources/user-1/source-1/message.eml')
    expect(calls[2]?.url).toContain('/rest/v1/travel_inbox_sources?id=eq.source-1')
  })
})
