import { describe, expect, it, vi } from 'vitest'
import { answerExpenseQueryWithProvider } from './expenseQueryProvider'

const request = {
  operation: 'ai_expense_query' as const,
  question: '东京酒店一共多少钱？',
  rows: [{ amountMinor: 10000, category: 'lodging' as const, currency: 'CNY', date: '2026-06-02', id: 'expense-1', itemLinked: true, sourceRefs: [], status: 'confirmed' as const, title: '东京酒店' }],
}

describe('expense query provider', () => {
  it('returns a restricted query plan in mock mode', async () => {
    await expect(answerExpenseQueryWithProvider({}, request, vi.fn() as unknown as typeof fetch, true)).resolves.toMatchObject({ ok: true, plan: { aggregation: 'list' } })
  })

  it('rejects provider answers that include numeric conclusions outside the query plan', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ plan: { aggregation: 'sum', totalMinor: 99900 }, presentation: 'summary' }) } }] }), { status: 200 })) as unknown as typeof fetch
    await expect(answerExpenseQueryWithProvider({ TRIPMAP_AI_API_KEY: 'key', TRIPMAP_AI_BASE_URL: 'https://example.test', TRIPMAP_AI_MODEL: 'model' }, request, fetcher, false)).resolves.toMatchObject({ errorCode: 'invalid_response', ok: false })
  })

  it('accepts a valid whitelisted plan', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ plan: { aggregation: 'sum', categories: ['lodging'], cities: ['东京'] }, presentation: 'summary' }) } }] }), { status: 200 })) as unknown as typeof fetch
    await expect(answerExpenseQueryWithProvider({ TRIPMAP_AI_API_KEY: 'key', TRIPMAP_AI_BASE_URL: 'https://example.test', TRIPMAP_AI_MODEL: 'model' }, request, fetcher, false)).resolves.toMatchObject({ ok: true, plan: { aggregation: 'sum', categories: ['lodging'] } })
  })
})
