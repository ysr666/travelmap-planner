import { describe, expect, it } from 'vitest'
import { validateProviderProxyAiExpenseQueryRequest } from './providerProxyContract'

describe('AI expense query contract', () => {
  it('accepts only the source-bound structured bill context', () => {
    const result = validateProviderProxyAiExpenseQueryRequest({
      operation: 'ai_expense_query',
      question: '东京酒店一共多少钱？',
      rows: [{ amountMinor: 10000, category: 'lodging', currency: 'CNY', date: '2026-06-02', id: 'expense-1', itemLinked: true, sourceRefs: [{ id: 'ticket:1', kind: 'ticket', role: 'payment_receipt' }], status: 'confirmed', title: '东京酒店' }],
    })
    expect(result.ok).toBe(true)
  })

  it('drops fields outside the allowlist, including full order numbers', () => {
    const result = validateProviderProxyAiExpenseQueryRequest({
      operation: 'ai_expense_query',
      question: '有哪些酒店？',
      rows: [{ category: 'lodging', date: '2026-06-02', id: 'expense-1', itemLinked: true, orderNumber: 'SECRET-123', sourceRefs: [], status: 'confirmed', title: '东京酒店' }],
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(JSON.stringify(result.request)).not.toContain('SECRET-123')
  })

  it('rejects more than 80 rows', () => {
    const rows = Array.from({ length: 81 }, (_, index) => ({ category: 'other', date: '2026-06-02', id: `expense-${index}`, itemLinked: false, sourceRefs: [], status: 'draft', title: `账单 ${index}` }))
    expect(validateProviderProxyAiExpenseQueryRequest({ operation: 'ai_expense_query', question: '都有哪些？', rows }).ok).toBe(false)
  })
})
