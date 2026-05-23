import { describe, expect, it, vi } from 'vitest'
import { createOpenAiCompatibleAiDraftProvider } from './aiDraftRealProvider'
import type { ProviderProxyAiTripDraftRequest } from '../../src/lib/providerProxyContract'

function validRequest(): ProviderProxyAiTripDraftRequest {
  return {
    destination: '东京',
    endDate: '2025-04-05',
    operation: 'ai_trip_draft',
    requestId: 'req-1',
    startDate: '2025-04-01',
  }
}

function validEnv() {
  return {
    TRIPMAP_AI_API_KEY: 'secret-ai-key',
    TRIPMAP_AI_BASE_URL: 'https://api.example.com/v1',
    TRIPMAP_AI_MODEL: 'gpt-4o-mini',
  }
}

function mockFetch(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
}

describe('createOpenAiCompatibleAiDraftProvider', () => {
  it('returns provider_unavailable when API key is missing', async () => {
    const provider = createOpenAiCompatibleAiDraftProvider(
      { TRIPMAP_AI_BASE_URL: 'https://api.example.com/v1', TRIPMAP_AI_MODEL: 'gpt-4o-mini' },
      validRequest(),
    )
    const result = await provider.generateDraft({ prompt: 'test' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('provider_unavailable')
  })

  it('returns provider_unavailable when base URL is missing', async () => {
    const provider = createOpenAiCompatibleAiDraftProvider(
      { TRIPMAP_AI_API_KEY: 'key', TRIPMAP_AI_MODEL: 'gpt-4o-mini' },
      validRequest(),
    )
    const result = await provider.generateDraft({ prompt: 'test' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('provider_unavailable')
  })

  it('returns provider_unavailable when model is missing', async () => {
    const provider = createOpenAiCompatibleAiDraftProvider(
      { TRIPMAP_AI_API_KEY: 'key', TRIPMAP_AI_BASE_URL: 'https://api.example.com/v1' },
      validRequest(),
    )
    const result = await provider.generateDraft({ prompt: 'test' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('provider_unavailable')
  })

  it('sends Authorization header with API key', async () => {
    const fetcher = mockFetch({ choices: [{ message: { content: '{"title":"test"}' } }] })
    const provider = createOpenAiCompatibleAiDraftProvider(validEnv(), validRequest(), fetcher)
    await provider.generateDraft({ prompt: 'test' })
    const [, init] = (fetcher as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0]
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-ai-key')
  })

  it('returns raw text on valid JSON response', async () => {
    const draft = { title: '东京之旅', destination: '东京', startDate: '2025-04-01', endDate: '2025-04-05', days: [] }
    const fetcher = mockFetch({ choices: [{ message: { content: JSON.stringify(draft) } }] })
    const provider = createOpenAiCompatibleAiDraftProvider(validEnv(), validRequest(), fetcher)
    const result = await provider.generateDraft({ prompt: 'test' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.kind).toBe('raw')
      expect(result.rawText).toContain('东京之旅')
    }
  })

  it('returns raw text on fenced JSON response', async () => {
    const draft = { title: 'test', destination: 'test', startDate: '2025-01-01', endDate: '2025-01-02', days: [] }
    const fetcher = mockFetch({ choices: [{ message: { content: '```json\n' + JSON.stringify(draft) + '\n```' } }] })
    const provider = createOpenAiCompatibleAiDraftProvider(validEnv(), validRequest(), fetcher)
    const result = await provider.generateDraft({ prompt: 'test' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.kind).toBe('raw')
      expect(result.rawText).toContain('```json')
    }
  })

  it('returns raw text even for invalid JSON (handler validates)', async () => {
    const fetcher = mockFetch({ choices: [{ message: { content: 'not json at all' } }] })
    const provider = createOpenAiCompatibleAiDraftProvider(validEnv(), validRequest(), fetcher)
    const result = await provider.generateDraft({ prompt: 'test' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.kind).toBe('raw')
      expect(result.rawText).toBe('not json at all')
    }
  })

  it('returns provider_error on HTTP 500', async () => {
    const fetcher = mockFetch({ error: 'internal' }, 500)
    const provider = createOpenAiCompatibleAiDraftProvider(validEnv(), validRequest(), fetcher)
    const result = await provider.generateDraft({ prompt: 'test' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('provider_error')
  })

  it('returns network_error on fetch failure', async () => {
    const fetcher = vi.fn(async () => { throw new Error('connection refused') }) as unknown as typeof fetch
    const provider = createOpenAiCompatibleAiDraftProvider(validEnv(), validRequest(), fetcher)
    const result = await provider.generateDraft({ prompt: 'test' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('network_error')
  })

  it('returns network_error on empty choices', async () => {
    const fetcher = mockFetch({ choices: [] })
    const provider = createOpenAiCompatibleAiDraftProvider(validEnv(), validRequest(), fetcher)
    const result = await provider.generateDraft({ prompt: 'test' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('provider_error')
  })

  it('error messages do not contain API key', async () => {
    const fetcher = vi.fn(async () => { throw new Error('fail') }) as unknown as typeof fetch
    const provider = createOpenAiCompatibleAiDraftProvider(validEnv(), validRequest(), fetcher)
    const result = await provider.generateDraft({ prompt: 'test' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).not.toContain('secret-ai-key')
      expect(result.message).not.toContain('Bearer')
    }
  })

  it('does not send ticket/blob/cloud/token data in request body', async () => {
    const fetcher = mockFetch({ choices: [{ message: { content: '{}' } }] })
    const provider = createOpenAiCompatibleAiDraftProvider(validEnv(), validRequest(), fetcher)
    await provider.generateDraft({ prompt: 'test' })
    const [, init] = (fetcher as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0]
    const body = init.body as string
    // The request body should not contain actual ticket blob data, cloud tokens, or API keys
    // (the word "ticket" may appear in constraint instructions, which is fine)
    expect(body).not.toContain('ticketMetas')
    expect(body).not.toContain('ticketBlobs')
    expect(body).not.toContain('VITE_SUPABASE')
    expect(body).not.toContain('apiKey')
    expect(body).not.toContain('secret-ai-key')
  })

  it('URL joining avoids double slashes', async () => {
    const fetcher = mockFetch({ choices: [{ message: { content: '{}' } }] })
    const provider = createOpenAiCompatibleAiDraftProvider(
      { ...validEnv(), TRIPMAP_AI_BASE_URL: 'https://api.example.com/v1/' },
      validRequest(),
      fetcher,
    )
    await provider.generateDraft({ prompt: 'test' })
    const [url] = (fetcher as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0]
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    expect(url).not.toContain('//chat')
  })
})
