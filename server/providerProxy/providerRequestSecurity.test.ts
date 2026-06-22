import { describe, expect, it, vi } from 'vitest'
import { createProviderProxyMemoryQuotaStorage } from './quotaGuard'
import {
  consumeProviderEdgeIpLimit,
  evaluateProviderOrigin,
  extractBearerToken,
  readProviderRequestBody,
  verifyProviderAccessToken,
} from './providerRequestSecurity'

describe('provider request security', () => {
  it('rejects missing and forged origins in production but accepts owned Pages hosts', () => {
    expect(evaluateProviderOrigin(new Request('https://example.test'), {}, 'production').allowed).toBe(false)
    expect(evaluateProviderOrigin(new Request('https://example.test', { headers: { Origin: 'https://evil.example' } }), {}, 'production').allowed).toBe(false)
    expect(evaluateProviderOrigin(new Request('https://example.test', { headers: { Origin: 'https://travelmap-planner.pages.dev' } }), {}, 'production').allowed).toBe(true)
    expect(evaluateProviderOrigin(new Request('https://example.test', { headers: { Origin: 'https://preview-123.travelmap-planner.pages.dev' } }), {}, 'preview').allowed).toBe(true)
  })

  it('extracts only a bounded bearer token', () => {
    expect(extractBearerToken(new Request('https://example.test', { headers: { Authorization: 'Bearer token-value' } }))).toBe('token-value')
    expect(extractBearerToken(new Request('https://example.test', { headers: { Authorization: 'Basic token-value' } }))).toBeUndefined()
  })

  it('verifies a token through Supabase Auth without exposing it in the response', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ apikey: 'anon-key', Authorization: 'Bearer access-token' })
      return new Response(JSON.stringify({ id: 'verified-user-id' }), { status: 200 })
    }) as unknown as typeof fetch
    await expect(verifyProviderAccessToken({
      accessToken: 'access-token',
      env: { TRIPMAP_SUPABASE_ANON_KEY: 'anon-key', TRIPMAP_SUPABASE_URL: 'https://project.supabase.co' },
      fetcher,
    })).resolves.toEqual({ ok: true, userId: 'verified-user-id' })
  })

  it('rejects request bodies over the fixed byte limit before parsing', async () => {
    const request = new Request('https://example.test', {
      body: 'x'.repeat(256 * 1024 + 1),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
    await expect(readProviderRequestBody(request)).resolves.toEqual({ ok: false })
  })

  it('uses an isolated edge IP minute bucket', async () => {
    const consume = vi.fn(async () => ({ allowed: true as const, remaining: 119, resetAt: 61_000 }))
    await consumeProviderEdgeIpLimit({
      hasher: () => 'ip-hash',
      ip: '203.0.113.10',
      nowMs: 1_000,
      storage: { ...createProviderProxyMemoryQuotaStorage(), consume },
    })
    expect(consume).toHaveBeenCalledWith({
      key: 'edge_ip|ip-hash',
      maxRequests: 120,
      nowMs: 1_000,
      windowMs: 60_000,
    })
  })

  it('blocks the 121st edge request in one minute', async () => {
    const storage = createProviderProxyMemoryQuotaStorage()
    for (let count = 1; count <= 120; count += 1) {
      await expect(consumeProviderEdgeIpLimit({
        hasher: () => 'ip-hash',
        ip: '203.0.113.10',
        nowMs: 1_000,
        storage,
      })).resolves.toMatchObject({ allowed: true })
    }
    await expect(consumeProviderEdgeIpLimit({
      hasher: () => 'ip-hash',
      ip: '203.0.113.10',
      nowMs: 1_000,
      storage,
    })).resolves.toMatchObject({ allowed: false, reason: 'rate_limit' })
  })
})
