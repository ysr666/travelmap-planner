import { describe, expect, it } from 'vitest'
import { validateAiTripDraft } from '../../src/lib/ai/aiTripDraft'
import {
  createDisabledAiDraftProvider,
  createMockAiDraftProvider,
  createMockAiDraftRefineProvider,
  createMockAiDraftRepairProvider,
  createUnavailableAiDraftProvider,
} from './aiDraftProvider'
import type {
  ProviderProxyAiTripDraftRefineRequest,
  ProviderProxyAiTripDraftRepairRequest,
  ProviderProxyAiTripDraftRequest,
} from '../../src/lib/ai/providerProxyContract'

function validRequest(overrides?: Partial<ProviderProxyAiTripDraftRequest>): ProviderProxyAiTripDraftRequest {
  return {
    destination: '东京',
    endDate: '2025-04-05',
    operation: 'ai_trip_draft',
    requestId: 'req-1',
    startDate: '2025-04-01',
    ...overrides,
  }
}

describe('createDisabledAiDraftProvider', () => {
  it('returns unsupported error', async () => {
    const provider = createDisabledAiDraftProvider()
    expect(provider.name).toBe('disabled')
    const result = await provider.generateDraft({ prompt: 'test' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorCode).toBe('unsupported')
    }
  })
})

describe('createUnavailableAiDraftProvider', () => {
  it('returns provider_unavailable error', async () => {
    const provider = createUnavailableAiDraftProvider()
    expect(provider.name).toBe('unavailable')
    const result = await provider.generateDraft({ prompt: 'test' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorCode).toBe('provider_unavailable')
    }
  })
})

describe('createMockAiDraftProvider', () => {
  it('returns a valid draft with source mock', async () => {
    const provider = createMockAiDraftProvider(validRequest())
    expect(provider.name).toBe('mock')
    const result = await provider.generateDraft({ prompt: 'ignored' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.kind).toBe('draft')
      expect(result.source).toBe('mock')
      expect(result.draft.title).toContain('东京')
      expect(result.warnings).toContain('当前为本地示例草稿，非真实 AI 生成。')
    }
  })

  it('mock draft passes validateAiTripDraft', async () => {
    const provider = createMockAiDraftProvider(validRequest())
    const result = await provider.generateDraft({ prompt: 'ignored' })
    expect(result.ok).toBe(true)
    if (result.ok && result.kind === 'draft') {
      const validation = validateAiTripDraft(result.draft)
      expect(validation.valid).toBe(true)
      expect(validation.errors).toHaveLength(0)
    }
  })

  it('mock draft includes builder tips and transport suggestions', async () => {
    const provider = createMockAiDraftProvider(validRequest({
      interestTags: ['美食'],
      interestText: '咖啡馆',
      partySize: 2,
      preferTransport: 'taxi',
    }))
    const result = await provider.generateDraft({ prompt: 'ignored' })
    expect(result.ok).toBe(true)
    if (result.ok && result.kind === 'draft') {
      expect(result.draft.days[0].tips?.join('\n')).toContain('2 人')
      expect(result.draft.days[0].items[1].previousTransportMode).toBe('car')
      expect(result.draft.days[0].items[1].previousTransportNote).toContain('打车')
    }
  })

  it('mock draft is deterministic', async () => {
    const request = validRequest({ destination: '巴黎' })
    const a = await createMockAiDraftProvider(request).generateDraft({ prompt: '' })
    const b = await createMockAiDraftProvider(request).generateDraft({ prompt: '' })
    expect(a).toEqual(b)
  })

  it('mock draft does not contain forbidden fields', async () => {
    const provider = createMockAiDraftProvider(validRequest())
    const result = await provider.generateDraft({ prompt: 'ignored' })
    expect(result.ok).toBe(true)
    if (result.ok && result.kind === 'draft') {
      const json = JSON.stringify(result.draft)
      expect(json).not.toContain('ticket')
      expect(json).not.toContain('cloud')
      expect(json).not.toContain('apiKey')
      expect(json).not.toContain('routeCache')
    }
  })
})

describe('createMockAiDraftRefineProvider', () => {
  it('returns a valid mock refinement and only changes target scope', async () => {
    const request = validRefineRequest()
    const provider = createMockAiDraftRefineProvider(request)
    const result = await provider.refineDraft({ prompt: 'ignored' })

    expect(result.ok).toBe(true)
    if (result.ok && result.kind === 'draft') {
      const validation = validateAiTripDraft(result.draft)
      expect(validation.valid).toBe(true)
      expect(result.source).toBe('mock')
      expect(result.draft.title).toBe(request.draft.title)
      expect(result.draft.days[0]).toEqual(request.draft.days[0])
      expect(result.draft.days[1].title).not.toBe(request.draft.days[1].title)
      expect(result.warnings).toContain('当前为本地示例优化，非真实 AI 生成。')
    }
  })
})

describe('createMockAiDraftRepairProvider', () => {
  it('repairs only selected quality rule ids with deterministic output', async () => {
    const provider = createMockAiDraftRepairProvider(validRepairRequest(['duplicate_sight', 'unreasonable_transport']))
    const result = await provider.repairDraft({ prompt: 'ignored' })

    expect(result.ok).toBe(true)
    if (result.ok && result.kind === 'draft') {
      const validation = validateAiTripDraft(result.draft)
      expect(validation.valid).toBe(true)
      expect(result.draft.days[0].items[1].locationName).toContain('替代点')
      expect(result.draft.days[0].items[2].previousTransportMode).toBe('transit')
      expect(result.draft.days[0].items[2].previousTransportDurationMinutes).toBe(35)
      expect(result.draft.days[0].items[0].title).toBe('西湖')
    }
  })
})

function validRepairRequest(ruleIds: string[]): ProviderProxyAiTripDraftRepairRequest {
  return {
    draft: {
      title: '杭州之旅',
      destination: '杭州',
      startDate: '2025-04-01',
      endDate: '2025-04-01',
      days: [{
        date: '2025-04-01',
        items: [
          { title: '西湖', locationName: '西湖', startTime: '09:00', endTime: '11:00' },
          { title: '再次西湖', locationName: '西湖（湖滨）', startTime: '12:00', endTime: '13:00' },
          {
            title: '灵隐寺',
            locationName: '灵隐寺',
            previousTransportDurationMinutes: 90,
            previousTransportMode: 'walk',
            startTime: '15:00',
            endTime: '17:00',
          },
        ],
      }],
    },
    operation: 'ai_trip_draft_repair',
    qualityFindings: ruleIds.map((ruleId) => ({
      dayDate: '2025-04-01',
      message: `${ruleId} message`,
      ruleId,
      severity: 'warning',
      title: ruleId,
    })),
  }
}

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
    operation: 'ai_trip_draft_refine',
    preferences: {
      interestTags: ['咖啡'],
      partySize: 3,
      preferTransport: 'walking',
    },
    scope: { kind: 'day', date: '2025-04-02' },
  }
}
