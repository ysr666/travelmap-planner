import { describe, expect, it } from 'vitest'
import { buildAiTripDraftRefinePrompt } from './aiDraftRefinePrompt'
import type { ProviderProxyAiTripDraftRefineRequest } from '../../src/lib/ai/providerProxyContract'

describe('buildAiTripDraftRefinePrompt', () => {
  it('includes scope preferences and scoped replacement constraints', () => {
    const prompt = buildAiTripDraftRefinePrompt(validRefineRequest())

    expect(prompt).toContain('kind=date_range')
    expect(prompt).toContain('startDate=2025-04-01')
    expect(prompt).toContain('endDate=2025-04-02')
    expect(prompt).toContain('party size: 3')
    expect(prompt).toContain('transport: walking')
    expect(prompt).toContain('Only change day content within the requested scope')
    expect(prompt).toContain('Days outside the scope must be copied unchanged')
    expect(prompt).toContain('Output ONLY valid JSON')
    expect(prompt).toContain('Do NOT generate: tickets, routes, route cache, cloud fields')
    expect(prompt).not.toContain('Authorization')
    expect(prompt).not.toContain('Bearer')
  })
})

function validRefineRequest(): ProviderProxyAiTripDraftRefineRequest {
  return {
    draft: {
      title: '东京之旅',
      destination: '东京',
      startDate: '2025-04-01',
      endDate: '2025-04-03',
      days: [
        { date: '2025-04-01', title: '抵达', items: [{ title: '浅草寺' }] },
        { date: '2025-04-02', title: '文化', items: [{ title: '上野公园' }] },
        { date: '2025-04-03', title: '购物', items: [{ title: '银座' }] },
      ],
    },
    guidance: '少购物，多留休息时间。',
    operation: 'ai_trip_draft_refine',
    preferences: {
      interestTags: ['美食'],
      interestText: '咖啡馆',
      partySize: 3,
      pace: 'relaxed',
      preferTransport: 'walking',
    },
    scope: { endDate: '2025-04-02', kind: 'date_range', startDate: '2025-04-01' },
  }
}
