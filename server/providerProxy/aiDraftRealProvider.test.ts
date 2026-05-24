import { describe, expect, it, vi } from 'vitest'
import {
  createOpenAiCompatibleAiDraftProvider,
  createOpenAiCompatibleAiDraftRepairProvider,
} from './aiDraftRealProvider'
import type { ProviderProxyAiTripDraftRepairRequest, ProviderProxyAiTripDraftRequest } from '../../src/lib/providerProxyContract'

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

function firstFetchBody(fetcher: typeof fetch): Record<string, unknown> {
  const [, init] = (fetcher as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0]
  return JSON.parse(init.body as string) as Record<string, unknown>
}

function validRepairRequest(): ProviderProxyAiTripDraftRepairRequest {
  return {
    draft: {
      title: '杭州周末',
      destination: '杭州',
      startDate: '2026-07-10',
      endDate: '2026-07-11',
      days: [
        {
          date: '2026-07-10',
          items: [
            {
              title: '上午游览',
              startTime: '09:00',
              endTime: '09:30',
              note: 'local note should already be filtered before the provider proxy call',
            },
          ],
        },
      ],
    },
    operation: 'ai_trip_draft_repair',
    qualityFindings: [
      {
        dayDate: '2026-07-10',
        message: '同一天安排过密，且标题过于笼统。',
        ruleId: 'dense_day',
        severity: 'warning',
        title: '行程过密',
      },
    ],
    requestId: 'repair-1',
  }
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

  it('sends JSON-only deterministic chat options', async () => {
    const fetcher = mockFetch({ choices: [{ message: { content: '{"title":"test"}' } }] })
    const provider = createOpenAiCompatibleAiDraftProvider(validEnv(), validRequest(), fetcher)
    await provider.generateDraft({ maxOutputTokens: 1234, prompt: 'test' })
    const body = firstFetchBody(fetcher)
    expect(body.model).toBe('gpt-4o-mini')
    expect(body.max_tokens).toBe(1234)
    expect(body.temperature).toBe(0.2)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.thinking).toEqual({ type: 'disabled' })
    expect(body.messages).toEqual([
      { role: 'system', content: 'test' },
      { role: 'user', content: 'Plan a trip to 东京 from 2025-04-01 to 2025-04-05.' },
    ])
  })

  it('maps auto reasoning to disabled thinking for this release', async () => {
    const fetcher = mockFetch({ choices: [{ message: { content: '{"title":"test"}' } }] })
    const provider = createOpenAiCompatibleAiDraftProvider(validEnv(), validRequest(), fetcher)
    await provider.generateDraft({ prompt: 'test', reasoningMode: 'auto' })
    const body = firstFetchBody(fetcher)
    expect(body.thinking).toEqual({ type: 'disabled' })
    expect(body.temperature).toBe(0.2)
    expect(body.reasoning_effort).toBeUndefined()
  })

  it('maps high reasoning to DeepSeek high thinking body', async () => {
    const fetcher = mockFetch({ choices: [{ message: { content: '{"title":"test"}' } }] })
    const provider = createOpenAiCompatibleAiDraftProvider(validEnv(), validRequest(), fetcher)
    await provider.generateDraft({ prompt: 'test', reasoningMode: 'high' })
    const body = firstFetchBody(fetcher)
    expect(body.thinking).toEqual({ type: 'enabled' })
    expect(body.reasoning_effort).toBe('high')
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.temperature).toBeUndefined()
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
    expect(body).not.toContain('Bearer')
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

describe('createOpenAiCompatibleAiDraftRepairProvider', () => {
  it('returns provider_unavailable when API key is missing', async () => {
    const provider = createOpenAiCompatibleAiDraftRepairProvider(
      { TRIPMAP_AI_BASE_URL: 'https://api.example.com/v1', TRIPMAP_AI_MODEL: 'gpt-4o-mini' },
    )
    const result = await provider.repairDraft({ prompt: 'test' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('provider_unavailable')
  })

  it('sends JSON-only deterministic chat options for repair', async () => {
    const fetcher = mockFetch({ choices: [{ message: { content: '{"title":"test"}' } }] })
    const provider = createOpenAiCompatibleAiDraftRepairProvider(validEnv(), fetcher)
    await provider.repairDraft({ maxOutputTokens: 2345, prompt: 'repair prompt' })
    const body = firstFetchBody(fetcher)
    expect(body.model).toBe('gpt-4o-mini')
    expect(body.max_tokens).toBe(2345)
    expect(body.temperature).toBe(0.2)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.thinking).toEqual({ type: 'disabled' })
    expect(body.messages).toEqual([{ role: 'system', content: 'repair prompt' }])
  })

  it('maps high reasoning to DeepSeek high thinking body for repair', async () => {
    const fetcher = mockFetch({ choices: [{ message: { content: '{"title":"test"}' } }] })
    const provider = createOpenAiCompatibleAiDraftRepairProvider(validEnv(), fetcher)
    await provider.repairDraft({ prompt: 'repair prompt', reasoningMode: 'high' })
    const body = firstFetchBody(fetcher)
    expect(body.thinking).toEqual({ type: 'enabled' })
    expect(body.reasoning_effort).toBe('high')
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.temperature).toBeUndefined()
  })

  it('repair request body omits secrets and local-only data fields', async () => {
    const fetcher = mockFetch({ choices: [{ message: { content: '{}' } }] })
    const provider = createOpenAiCompatibleAiDraftRepairProvider(validEnv(), fetcher)
    await provider.repairDraft({
      maxOutputTokens: 4000,
      prompt: JSON.stringify(validRepairRequest()),
    })
    const [, init] = (fetcher as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0]
    const body = init.body as string
    expect(body).not.toContain('secret-ai-key')
    expect(body).not.toContain('Bearer')
    expect(body).not.toContain('ticketMetas')
    expect(body).not.toContain('ticketBlobs')
    expect(body).not.toContain('routeCaches')
    expect(body).not.toContain('cloudToken')
    expect(body).not.toContain('providerApiKey')
  })

  it('returns raw text on valid repair response', async () => {
    const draft = { title: '杭州周末', destination: '杭州', startDate: '2026-07-10', endDate: '2026-07-11', days: [] }
    const fetcher = mockFetch({ choices: [{ message: { content: JSON.stringify(draft) } }] })
    const provider = createOpenAiCompatibleAiDraftRepairProvider(validEnv(), fetcher)
    const result = await provider.repairDraft({ prompt: 'repair prompt' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.kind).toBe('raw')
      expect(result.rawText).toContain('杭州周末')
    }
  })

  it('returns provider_error on repair HTTP 500', async () => {
    const fetcher = mockFetch({ error: 'internal' }, 500)
    const provider = createOpenAiCompatibleAiDraftRepairProvider(validEnv(), fetcher)
    const result = await provider.repairDraft({ prompt: 'repair prompt' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('provider_error')
  })

  it('returns provider_error on empty repair content', async () => {
    const fetcher = mockFetch({ choices: [{ message: { content: '' } }] })
    const provider = createOpenAiCompatibleAiDraftRepairProvider(validEnv(), fetcher)
    const result = await provider.repairDraft({ prompt: 'repair prompt' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('provider_error')
  })

  it('returns network_error on repair request timeout', async () => {
    vi.useFakeTimers()
    try {
      const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        })
      })) as unknown as typeof fetch
      const provider = createOpenAiCompatibleAiDraftRepairProvider(validEnv(), fetcher)
      const promise = provider.repairDraft({ prompt: 'repair prompt' })
      await vi.advanceTimersByTimeAsync(60_000)
      const result = await promise
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errorCode).toBe('network_error')
    } finally {
      vi.useRealTimers()
    }
  })
})
