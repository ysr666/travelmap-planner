import { describe, expect, it, vi } from 'vitest'
import { createMockAiTripEditProvider, createOpenAiCompatibleAiTripEditProvider } from './aiTripEditProvider'

describe('aiTripEditProvider', () => {
  it('returns deterministic mock patch plans with realtime warning', async () => {
    const request = editRequest('查一下今天开放吗，然后加一个咖啡休息')
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

  it('returns non-blocking mock realtime warning for English lookup intent', async () => {
    const request = editRequest('Check whether Tower of London is open today and adjust the plan.')
    const provider = createMockAiTripEditProvider(request)

    const result = await provider.planEdit({ maxOutputTokens: 1000, prompt: 'prompt' })

    expect(result.ok).toBe(true)
    if (result.ok && result.kind === 'patch') {
      expect(result.patchPlan.operations).toHaveLength(0)
      expect(result.patchPlan.warnings).toContain('联网搜索暂未接入，未查询实时信息。')
      expect(result.patchPlan.warnings?.join('\n')).toContain('暂未识别')
    }
  })

  it('returns valid source-aware mock patch plans without no-search warning', async () => {
    const request = {
      ...editRequest('查一下西湖今天开放吗，然后加一个咖啡休息'),
      searchResults: {
        query: '杭州 西湖 开放时间',
        results: [
          {
            confidence: 'medium' as const,
            displayUrl: 'travel.example/search/west-lake',
            domain: 'travel.example',
            retrievedAt: '2026-01-01T00:00:00.000Z',
            snippet: '模拟来源片段，不代表实时信息。',
            sourceType: 'official' as const,
            title: '西湖官网',
            url: 'https://travel.example/search/west-lake',
          },
        ],
        retrievedAt: '2026-01-01T00:00:00.000Z',
        source: 'mock' as const,
      },
    }
    const provider = createMockAiTripEditProvider(request)
    const result = await provider.planEdit({ maxOutputTokens: 1000, prompt: 'prompt with sources' })

    expect(result.ok).toBe(true)
    if (result.ok && result.kind === 'patch') {
      expect(result.patchPlan.operations[0].type).toBe('add_item')
      expect(result.patchPlan.warnings ?? []).not.toContain('联网搜索暂未接入，未查询实时信息。')
    }
  })

  it('supports shopping avoidance and missing-address marking with valid plans', async () => {
    const shopping = await createMockAiTripEditProvider(editRequest('第三天不要购物，改成轻松一点')).planEdit({ maxOutputTokens: 1000, prompt: 'prompt' })
    expect(shopping.ok).toBe(true)
    if (shopping.ok && shopping.kind === 'patch') {
      expect(shopping.patchPlan.operations[0].type).toBe('remove_item')
    }

    const missingAddress = await createMockAiTripEditProvider(editRequest('把所有没有地址的地点标出来')).planEdit({ maxOutputTokens: 1000, prompt: 'prompt' })
    expect(missingAddress.ok).toBe(true)
    if (missingAddress.ok && missingAddress.kind === 'patch') {
      expect(missingAddress.patchPlan.operations[0].type).toBe('update_item_note')
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
        choices: [{ message: { content: '{"summary":"ok","operations":[],"warnings":["无可写入修改。"]}' } }],
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
        choices: [{ message: { content: '{"summary":"ok","operations":[],"warnings":["无可写入修改。"]}' } }],
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
