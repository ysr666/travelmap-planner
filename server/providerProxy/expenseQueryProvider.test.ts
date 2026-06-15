import { describe, expect, it, vi } from 'vitest'
import { answerExpenseQueryWithProvider } from './expenseQueryProvider'

const request = {
  deterministicAnswer: '找到 1 笔账单，合计 ¥100.00。',
  operation: 'ai_expense_query' as const,
  question: '东京酒店一共多少钱？',
  rows: [{ amountMinor: 10000, category: 'lodging' as const, currency: 'CNY', date: '2026-06-02', id: 'expense-1', itemLinked: true, sourceRefs: [], status: 'confirmed' as const, title: '东京酒店' }],
}

describe('expense query provider', () => {
  it('returns the deterministic local answer in mock mode', async () => {
    await expect(answerExpenseQueryWithProvider({}, request, vi.fn() as unknown as typeof fetch, true)).resolves.toMatchObject({ answer: request.deterministicAnswer, ok: true })
  })

  it('rejects provider answers that replace the local numeric conclusion', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer: '合计 ¥999.00。', citationExpenseIds: ['expense-1'] }) } }] }), { status: 200 })) as unknown as typeof fetch
    await expect(answerExpenseQueryWithProvider({ TRIPMAP_AI_API_KEY: 'key', TRIPMAP_AI_BASE_URL: 'https://example.test', TRIPMAP_AI_MODEL: 'model' }, request, fetcher, false)).resolves.toMatchObject({ errorCode: 'invalid_response', ok: false })
  })
})
