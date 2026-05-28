import { describe, expect, it } from 'vitest'
import {
  buildAiTripEditSearchRequest,
  detectAiTripEditSearchIntent,
  summarizeTravelSearchResultsForPrompt,
} from './aiTripEditSearch'
import type { AiTripEditContext } from './aiTripEditContext'

describe('aiTripEditSearch helpers', () => {
  it('detects canonical search intent types', () => {
    expect(detectAiTripEditSearchIntent('查一下西湖今天开门吗')).toMatchObject({ needed: true, searchType: 'opening_hours' })
    expect(detectAiTripEditSearchIntent('查一下西湖门票价格')).toMatchObject({ needed: true, searchType: 'ticket_price' })
    expect(detectAiTripEditSearchIntent('找一下西湖官网')).toMatchObject({ needed: true, searchType: 'official_site' })
    expect(detectAiTripEditSearchIntent('看看明天怎么去西湖，交通方便吗')).toMatchObject({ needed: true, searchType: 'transport' })
    expect(detectAiTripEditSearchIntent('查一下西湖附近吃饭')).toMatchObject({ needed: true, searchType: 'nearby_food' })
    expect(detectAiTripEditSearchIntent('搜索西湖最新活动')).toMatchObject({ needed: true, searchType: 'general' })
  })

  it('does not trigger on standalone today now or current wording', () => {
    expect(detectAiTripEditSearchIntent('把今天的安排移到上午')).toEqual({ needed: false })
    expect(detectAiTripEditSearchIntent('move the current plan to day 2')).toEqual({ needed: false })
    expect(detectAiTripEditSearchIntent('move now to the afternoon')).toEqual({ needed: false })
  })

  it('builds a capped canonical search request without sensitive fields', () => {
    const request = buildAiTripEditSearchRequest(`查一下${'很长'.repeat(200)}西湖今天开门吗`, context())

    expect(request).toMatchObject({
      maxResults: 3,
      operation: 'travel_search',
      searchType: 'opening_hours',
    })
    expect(request?.query.length).toBeLessThanOrEqual(300)
    expect(JSON.stringify(request)).not.toContain('ticket_1')
    expect(JSON.stringify(request)).not.toContain('ticketBlobs')
    expect(JSON.stringify(request)).not.toContain('routeCache')
    expect(JSON.stringify(request)).not.toContain('cloudToken')
    expect(JSON.stringify(request)).not.toContain('coordinates')
    expect(JSON.stringify(request)).toContain('西湖')
  })

  it('summarizes travel search results to at most three compact sources', () => {
    const summary = summarizeTravelSearchResultsForPrompt({
      ok: true,
      operation: 'travel_search',
      query: '杭州 西湖',
      results: Array.from({ length: 5 }, (_, index) => ({
        confidence: index === 0 ? 'medium' as const : 'low' as const,
        displayUrl: `travel.example/search/${index}`,
        domain: 'travel.example',
        retrievedAt: '2026-01-01T00:00:00.000Z',
        snippet: `模拟片段 ${index} ${'x'.repeat(400)}`,
        sourceType: 'official' as const,
        title: `模拟结果 ${index}`,
        url: `https://travel.example/search/${index}`,
      })),
      retrievedAt: '2026-01-01T00:00:00.000Z',
      source: 'mock',
    })

    expect(summary?.results).toHaveLength(3)
    expect(summary?.results[0]).toMatchObject({
      displayUrl: 'travel.example/search/0',
      domain: 'travel.example',
      retrievedAt: '2026-01-01T00:00:00.000Z',
      sourceType: 'official',
      title: '模拟结果 0',
    })
    expect(summary?.results[0].snippet.length).toBeLessThanOrEqual(240)
  })
})

function context(): AiTripEditContext {
  return {
    days: [
      {
        date: '2026-07-10',
        id: 'day_1',
        items: [
          {
            address: '杭州市西湖区',
            dayId: 'day_1',
            id: 'item_1',
            locationName: '西湖风景名胜区',
            noteText: '默认不应进入搜索 query',
            ticketCount: 1,
            title: '西湖',
          },
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
  }
}
