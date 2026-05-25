import { describe, expect, it, vi } from 'vitest'
import { createMockAiTripEditProvider, createOpenAiCompatibleAiTripEditProvider } from './aiTripEditProvider'

describe('aiTripEditProvider', () => {
  it('returns deterministic mock patch plans with realtime warning', async () => {
    const request = editRequest('查一下今天开放吗，然后加一个散步')
    const provider = createMockAiTripEditProvider(request)

    const first = await provider.planEdit({ maxOutputTokens: 1000, prompt: 'prompt' })
    const second = await provider.planEdit({ maxOutputTokens: 1000, prompt: 'prompt' })

    expect(first).toEqual(second)
    expect(first.ok).toBe(true)
    if (first.ok && first.kind === 'patch') {
      expect(first.patchPlan.operations.length).toBeGreaterThanOrEqual(1)
      expect(first.patchPlan.operations.length).toBeLessThanOrEqual(3)
      expect(first.patchPlan.warnings).toContain('联网搜索暂未接入，未查询实时信息。')
    }
  })

  it('sends OpenAI-compatible JSON request with disabled thinking by default and no key in body', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body).toMatchObject({
        max_tokens: 900,
        model: 'deepseek-v4-flash',
        response_format: { type: 'json_object' },
        temperature: 0.2,
        thinking: { type: 'disabled' },
      })
      expect(JSON.stringify(body)).not.toContain('server-secret')
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer server-secret')
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"summary":"ok","operations":[]}' } }],
      }))
    }) as unknown as typeof fetch

    const provider = createOpenAiCompatibleAiTripEditProvider({
      TRIPMAP_AI_API_KEY: 'server-secret',
      TRIPMAP_AI_BASE_URL: 'https://api.example',
      TRIPMAP_AI_MODEL: 'deepseek-v4-flash',
    }, fetcher)
    const result = await provider.planEdit({ maxOutputTokens: 900, prompt: 'prompt' })

    expect(result.ok).toBe(true)
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('maps high reasoning to enabled thinking and omits temperature', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body).toMatchObject({
        reasoning_effort: 'high',
        response_format: { type: 'json_object' },
        thinking: { type: 'enabled' },
      })
      expect(body.temperature).toBeUndefined()
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"summary":"ok","operations":[]}' } }],
      }))
    }) as unknown as typeof fetch

    const provider = createOpenAiCompatibleAiTripEditProvider({
      TRIPMAP_AI_API_KEY: 'server-secret',
      TRIPMAP_AI_BASE_URL: 'https://api.example',
      TRIPMAP_AI_MODEL: 'deepseek-v4-flash',
    }, fetcher)
    const result = await provider.planEdit({ maxOutputTokens: 900, prompt: 'prompt', reasoningMode: 'high' })

    expect(result.ok).toBe(true)
  })

  it('normalizes fetch failures to network_error', async () => {
    const provider = createOpenAiCompatibleAiTripEditProvider({
      TRIPMAP_AI_API_KEY: 'server-secret',
      TRIPMAP_AI_BASE_URL: 'https://api.example',
      TRIPMAP_AI_MODEL: 'deepseek-v4-flash',
    }, vi.fn(async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch)

    const result = await provider.planEdit({ maxOutputTokens: 900, prompt: 'prompt' })

    expect(result).toMatchObject({ errorCode: 'network_error', ok: false })
  })
})

function editRequest(command = '第二天太满了，帮我放松一点') {
  return {
    command,
    context: {
      days: [
        {
          date: '2026-07-10',
          id: 'day_1',
          items: [
            { dayId: 'day_1', id: 'item_1', title: '西湖' },
            { dayId: 'day_1', id: 'item_2', title: '商场' },
          ],
          title: '第一天',
        },
      ],
      trip: {
        destination: '杭州',
        endDate: '2026-07-11',
        id: 'trip_1',
        startDate: '2026-07-10',
        title: '杭州两日',
      },
    },
    operation: 'ai_trip_edit_plan' as const,
  }
}
