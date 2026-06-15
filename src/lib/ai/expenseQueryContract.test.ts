import { describe, expect, it } from 'vitest'
import { validateProviderProxyAiExpenseQueryRequest } from './providerProxyContract'

describe('AI expense query contract', () => {
  it('accepts only the source-bound structured bill context', () => {
    const result = validateProviderProxyAiExpenseQueryRequest({
      deterministicAnswer: '找到 1 笔账单，合计 ¥100.00。',
      operation: 'ai_expense_query',
      question: '东京酒店一共多少钱？',
      rows: [{ amountMinor: 10000, category: 'lodging', currency: 'CNY', date: '2026-06-02', id: 'expense-1', itemLinked: true, sourceRefs: [{ id: 'ticket:1', kind: 'ticket', role: 'payment_receipt' }], status: 'confirmed', title: '东京酒店' }],
    })
    expect(result.ok).toBe(true)
  })

  it('drops fields outside the allowlist, including full order numbers', () => {
    const result = validateProviderProxyAiExpenseQueryRequest({
      deterministicAnswer: '找到 1 笔账单。',
      operation: 'ai_expense_query',
      question: '有哪些酒店？',
      rows: [{ category: 'lodging', date: '2026-06-02', id: 'expense-1', itemLinked: true, orderNumber: 'SECRET-123', sourceRefs: [], status: 'confirmed', title: '东京酒店' }],
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(JSON.stringify(result.request)).not.toContain('SECRET-123')
  })
})
