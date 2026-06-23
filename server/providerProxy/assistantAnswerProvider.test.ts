import { describe, expect, it, vi } from 'vitest'
import {
  buildAssistantAnswerProviderInput,
  createMockAssistantAnswerProvider,
  createOpenAiCompatibleAssistantAnswerProvider,
} from './assistantAnswerProvider'

describe('assistantAnswerProvider', () => {
  it('returns deterministic mock answers from redacted context', async () => {
    const request = assistantRequest()
    const provider = createMockAssistantAnswerProvider(request)
    const result = await provider.answer(buildAssistantAnswerProviderInput(request))

    expect(result.ok).toBe(true)
    if (result.ok && result.kind === 'answer') {
      expect(result.response.operation).toBe('assistant_answer')
      expect(result.response.answer).toContain('全部旅行')
      expect(JSON.stringify(result.response)).not.toContain('Authorization')
    }
  })

  it('sends OpenAI-compatible JSON request without leaking the key in the body', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body).toMatchObject({
        max_tokens: 800,
        model: 'deepseek-v4-flash',
        response_format: { type: 'json_object' },
      })
      expect(JSON.stringify(body)).not.toContain('server-secret')
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer server-secret')
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"answer":"可以。","caveats":["不会写入。"],"sourceCards":[{"id":"local","kind":"local_context","title":"本地摘要"}]}' } }],
      }))
    }) as unknown as typeof fetch

    const provider = createOpenAiCompatibleAssistantAnswerProvider({
      TRIPMAP_AI_API_KEY: 'server-secret',
      TRIPMAP_AI_BASE_URL: 'https://api.example',
      TRIPMAP_AI_MODEL: 'deepseek-v4-flash',
    }, fetcher)
    const result = await provider.answer({ maxOutputTokens: 800, prompt: 'prompt' })

    expect(result.ok).toBe(true)
    expect(fetcher).toHaveBeenCalledOnce()
  })
})

function assistantRequest() {
  return {
    context: {
      scopeLabel: '全部旅行',
      sourceCards: [{ id: 'account', kind: 'local_context' as const, title: '账户摘要', detail: '1 个旅行' }],
      summaries: [{ key: 'trip_count', label: '旅行数量', value: '1 个旅行' }],
    },
    locale: 'zh-CN' as const,
    operation: 'assistant_answer' as const,
    question: '你能做什么？',
  }
}
