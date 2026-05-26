import { describe, expect, it } from 'vitest'
import { buildAiTripEditProviderInput, commandNeedsRealtimeSearch } from './aiTripEditPrompt'

describe('aiTripEditPrompt', () => {
  it('builds JSON-only patch-plan prompt without web-search claims', () => {
    const input = buildAiTripEditProviderInput(editRequest('把第一天上午换成博物馆'), 'req-1')

    expect(input.prompt).toContain('只输出 JSON')
    expect(input.prompt).toContain('只允许以下 operation type')
    expect(input.prompt).toContain('不要联网搜索')
    expect(input.prompt).toContain('summary、operation reason 和 warnings 必须使用中文')
    expect(input.prompt).toContain('不要不必要地翻译 Tower of London、British Museum 等专有名词')
    expect(input.prompt).not.toContain('我会搜索')
    expect(input.prompt).not.toContain('ticketBlobs')
    expect(input.prompt).not.toContain('routeCache')
    expect(input.prompt).not.toContain('cloudToken')
    expect(input.maxOutputTokens).toBeGreaterThan(0)
  })

  it('adds realtime warning instruction for realtime commands', () => {
    const input = buildAiTripEditProviderInput(editRequest('查一下最新票价，再帮我调整'), 'req-1')
    const englishInput = buildAiTripEditProviderInput(
      editRequest('Check whether Tower of London is open today and adjust the plan.'),
      'req-2',
    )

    expect(commandNeedsRealtimeSearch('查一下最新票价')).toBe(true)
    expect(commandNeedsRealtimeSearch('Check whether Tower of London is open today and adjust the plan.')).toBe(true)
    expect(commandNeedsRealtimeSearch('What is the ticket price for Tower of London?')).toBe(true)
    expect(input.prompt).toContain('联网搜索暂未接入，未查询实时信息。')
    expect(englishInput.prompt).toContain('联网搜索暂未接入，未查询实时信息。')
    expect(input.prompt).toContain('不要编造事实')
  })

  it('includes compact source summaries when search results are provided', () => {
    const input = buildAiTripEditProviderInput({
      ...editRequest('查一下西湖今天开放吗，然后调整安排'),
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
    }, 'req-search')

    expect(input.prompt).toContain('travel_search 来源摘要')
    expect(input.prompt).toContain('西湖官网')
    expect(input.prompt).toContain('travel.example')
    expect(input.prompt).toContain('2026-01-01T00:00:00.000Z')
    expect(input.prompt).toContain('只能使用下方已提供的 travel_search 来源')
    expect(input.prompt).not.toContain('联网搜索暂未接入，未查询实时信息。')
    expect(input.prompt).not.toContain('rawProviderBody')
    expect(input.prompt).not.toContain('Authorization')
  })

  it('does not treat ordinary schedule edits as realtime lookups', () => {
    expect(commandNeedsRealtimeSearch('Day 2 feels too packed. Make it more relaxed.')).toBe(false)
    expect(commandNeedsRealtimeSearch("move today's plan to the morning")).toBe(false)
    expect(commandNeedsRealtimeSearch('move the current plan to Day 2')).toBe(false)
    expect(commandNeedsRealtimeSearch('open now and adjust the plan')).toBe(true)
    expect(commandNeedsRealtimeSearch('current ticket price for Tower of London')).toBe(true)
  })
})

function editRequest(command: string) {
  return {
    command,
    context: {
      days: [
        {
          date: '2026-07-10',
          id: 'day_1',
          items: [{ dayId: 'day_1', id: 'item_1', title: '西湖' }],
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
