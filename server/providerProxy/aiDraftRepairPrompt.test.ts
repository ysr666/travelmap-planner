import { describe, expect, it } from 'vitest'
import { buildAiTripDraftRepairPrompt } from './aiDraftRepairPrompt'
import type { ProviderProxyAiTripDraftRepairRequest } from '../../src/lib/ai/providerProxyContract'

describe('buildAiTripDraftRepairPrompt', () => {
  it('instructs provider to fix only listed quality findings', () => {
    const prompt = buildAiTripDraftRepairPrompt(validRepairRequest())

    expect(prompt).toContain('Fix ONLY the listed quality findings')
    expect(prompt).toContain('unreasonable transport')
    expect(prompt).toContain('duplicate sights')
    expect(prompt).toContain('Do NOT generate: tickets, routes, cloud fields')
    expect(prompt).not.toContain('Authorization')
    expect(prompt).not.toContain('Bearer')
  })
})

function validRepairRequest(): ProviderProxyAiTripDraftRepairRequest {
  return {
    draft: {
      title: '杭州之旅',
      destination: '杭州',
      startDate: '2025-04-01',
      endDate: '2025-04-01',
      days: [{
        date: '2025-04-01',
        items: [{ title: '西湖', locationName: '西湖', startTime: '09:00', endTime: '11:00' }],
      }],
    },
    operation: 'ai_trip_draft_repair',
    qualityFindings: [
      {
        dayDate: '2025-04-01',
        message: '西湖出现了 2 次。',
        ruleId: 'duplicate_sight',
        severity: 'warning',
        title: '重复景点',
      },
    ],
  }
}
