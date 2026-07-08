import { describe, expect, it } from 'vitest'
import {
  buildAssistantAnswerFallbackAfterError,
  mergeAssistantAnswerProviderResponse,
  resolveGlobalAiInteraction,
  type GlobalAiInteractionContext,
} from './globalAiInteraction'

describe('globalAiInteraction', () => {
  it('answers capability questions locally without provider requests', async () => {
    const result = await resolveGlobalAiInteraction('你能做什么？', context())

    expect(result.kind).toBe('help')
    if (result.kind !== 'help') return
    expect(result.answer).toContain('预览和确认')
    expect(result.sourceCards[0].kind).toBe('local_context')
  })

  it('routes ordinary questions to assistant_answer instead of ai_trip_edit', async () => {
    const result = await resolveGlobalAiInteraction('我今天应该先确认什么？', context())

    expect(result.kind).toBe('assistant_answer')
    if (result.kind !== 'assistant_answer') return
    expect(result.providerRequest.operation).toBe('assistant_answer')
    expect(result.providerRequest.context.scopeLabel).toBe('当前旅行 / 东京旅行')
    expect(JSON.stringify(result.providerRequest)).not.toContain('PNR')
    expect(JSON.stringify(result.providerRequest)).not.toContain('Authorization')
  })

  it('includes page context tools in assistant answer requests', async () => {
    const result = await resolveGlobalAiInteraction('我现在应该注意什么？', context({
      activeRoute: 'ledger',
      pageContextTools: [{
        kind: 'ledger',
        label: '账本',
        sourceCard: { detail: '1 笔记录，1 笔待确认。', id: 'context-tool:ledger:trip_1', kind: 'local_context', title: '账本上下文' },
        summary: '1 笔账本记录，1 笔待确认',
      }],
      scopeLabel: '账本 / 东京旅行',
    }))

    expect(result.kind).toBe('assistant_answer')
    if (result.kind !== 'assistant_answer') return
    expect(result.providerRequest.context.scopeLabel).toBe('账本 / 东京旅行')
    expect(result.providerRequest.context.summaries.some((summary) => summary.label === '账本')).toBe(true)
    expect(JSON.stringify(result.providerRequest)).not.toContain('rawPayload')
  })

  it('wraps write-capable commands as unified action proposals', async () => {
    const result = await resolveGlobalAiInteraction('帮我把上午安排改一下', context())

    expect(result.kind).toBe('ai_trip_edit')
    if (result.kind !== 'ai_trip_edit') return
    expect(result.actionProposal?.kind).toBe('ai_trip_edit_patch_preview')
    expect(result.actionProposal?.suggestion.status).toBe('needs_confirmation')
    expect(result.actionProposal?.suggestion.source.kind).toBe('operations')
    expect(result.actionProposal?.suggestion.action?.mode).toBe('confirm_required')
  })

  it('can force write-like commands into ordinary assistant answers for recovery', async () => {
    const result = await resolveGlobalAiInteraction('帮我把上午安排改一下', context(), {
      forceMode: 'assistant_answer',
    })

    expect(result.kind).toBe('assistant_answer')
    if (result.kind !== 'assistant_answer') return
    expect(result.providerRequest.operation).toBe('assistant_answer')
    expect(JSON.stringify(result.providerRequest)).not.toContain('patchPlan')
  })

  it('merges provider answers and falls back locally after provider failures', async () => {
    const draft = await resolveGlobalAiInteraction('我今天应该先确认什么？', context())
    expect(draft.kind).toBe('assistant_answer')
    if (draft.kind !== 'assistant_answer') return

    const provider = mergeAssistantAnswerProviderResponse(draft, {
      answer: '先确认票据和费用草稿。',
      caveats: ['不会写入。'],
      ok: true,
      operation: 'assistant_answer',
      source: 'future_ai',
      sourceCards: [{ id: 'local', kind: 'local_context', title: '本地摘要' }],
    })
    expect(provider.source).toBe('future_ai')
    expect(provider.answer).toContain('票据')

    const fallback = buildAssistantAnswerFallbackAfterError(draft)
    expect(fallback.source).toBe('fallback')
    expect(fallback.caveats.join(' ')).toContain('当前资料')
  })
})

function context(overrides: Partial<GlobalAiInteractionContext> = {}): GlobalAiInteractionContext {
  return {
    accountSummary: {
      draftExpenseCount: 1,
      inboxNeedsAssignmentCount: 0,
      recentTripCount: 1,
      ticketCount: 2,
      totalTripCount: 1,
      upcomingTrips: [{ date: '2026-06-18', title: '东京旅行' }],
    },
    activeRoute: 'trip',
    days: [],
    hash: '#/trip?tripId=trip_1',
    items: [],
    ledgerExpenses: [],
    pageContextTools: [{
      kind: 'trip',
      label: '当前旅行',
      sourceCard: { detail: '0 天，0 个行程点，0 张票据。', id: 'context-tool:trip:trip_1', kind: 'local_context', title: '当前旅行上下文' },
      summary: '东京旅行，0 天，0 个行程点',
    }],
    params: new URLSearchParams('tripId=trip_1'),
    scopeLabel: '当前旅行 / 东京旅行',
    sourceCards: [{ id: 'trip', kind: 'local_context', title: '当前旅行摘要' }],
    tickets: [],
    trip: {
      createdAt: 1,
      destination: '东京',
      endDate: '2026-06-20',
      id: 'trip_1',
      startDate: '2026-06-18',
      title: '东京旅行',
      updatedAt: 1,
    },
    ...overrides,
  }
}
