import { describe, expect, it } from 'vitest'
import {
  createMockTripOperationsSummaryProvider,
  normalizeTripOperationsSummaryProviderOutput,
} from './tripOperationsSummaryProvider'
import type { ProviderProxyTripOperationsSummaryRequest } from '../../src/lib/ai/providerProxyContract'

describe('tripOperationsSummaryProvider', () => {
  it('returns a deterministic mock summary', async () => {
    const result = await createMockTripOperationsSummaryProvider().summarize(validRequest(), {
      maxOutputTokens: 700,
      prompt: 'prompt',
      reasoningMode: 'off',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.response.summary).toContain('先处理')
      expect(result.response.highlights[0]).toContain('2 天缺路线')
      expect(result.response.source).toBe('mock')
    }
  })

  it('normalizes JSON model output and rejects empty summaries', () => {
    const normalized = normalizeTripOperationsSummaryProviderOutput(JSON.stringify({
      highlights: ['先生成路线', '检查票据'],
      summary: '先生成路线，再检查票据。',
      warnings: ['示例'],
    }))
    expect(normalized.ok).toBe(true)
    if (normalized.ok) {
      expect(normalized.highlights).toEqual(['先生成路线', '检查票据'])
    }

    expect(normalizeTripOperationsSummaryProviderOutput('{"highlights":[]}').ok).toBe(false)
  })
})

function validRequest(): ProviderProxyTripOperationsSummaryRequest {
  return {
    destination: '杭州',
    operation: 'trip_operations_summary',
    phase: 'traveling',
    recommendations: [{
      actionKind: 'generate_routes',
      actionLabel: '生成路线',
      message: '2 天缺少路线。',
      severity: 'low',
      title: '2 天缺路线',
      type: 'missing_route',
    }],
    tripTitle: '杭州三日',
  }
}
